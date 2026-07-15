-- ============================================================================
-- Spicy Meal — Automated customer account deletion (queue + processor support).
--
-- ADDITIVE + safe. Introduces a queued, idempotent, mostly-automated deletion
-- workflow. NOTHING here deletes an Auth user; the destructive GoTrue admin
-- deletion happens LAST and only from the trusted service-role Edge Function
-- (`account-delete-process`) after cleanup + anonymization succeed.
--
-- Retention model (verified against the live schema):
--   * orders.customer_id is ON DELETE SET NULL, so completed orders + their
--     items, amounts, tax, order numbers and operational refs are RETAINED and
--     merely un-linked when the Auth user is deleted. This function anonymizes
--     the PII snapshot columns on those orders (customer_name / customer_phone /
--     notes / address_snapshot) WITHOUT touching any monetary/tax/operational
--     value.
--   * addresses / push_devices / checkout_sessions / loyalty_transactions are
--     ON DELETE CASCADE from profiles; we also delete them explicitly so each
--     stage is idempotent and independently verifiable.
--   * otp_challenges / whatsapp_message_logs have NO foreign key (keyed only by
--     phone_e164) so the cascade never reaches them — they are purged by phone.
--
-- Security: no client can write request status; creation, claiming and
-- anonymization are SECURITY DEFINER + service_role-only. The authenticated
-- JWT identity (auth.uid()) is the only source of truth for whose account is
-- deleted — request creation never trusts a client-supplied user id.
-- ============================================================================

-- ---- OTP: allow a dedicated 'account_deletion' purpose (additive) -----------
-- Re-verification reuses the existing hardened OTP infrastructure with its own
-- purpose so a phone-verification code can never be replayed to delete an
-- account and vice-versa. No WhatsApp *login* is enabled by this.
alter table public.otp_challenges drop constraint if exists otp_challenges_purpose_check;
alter table public.otp_challenges add constraint otp_challenges_purpose_check
  check (purpose in ('login', 'signup', 'phone_verification', 'passwordless_login', 'account_deletion'));

-- ---- account_deletion_requests: the queue --------------------------------
-- One durable row per deletion request. It PERSISTS after the Auth user is
-- deleted (user_id is SET NULL, not cascaded) so it remains a non-sensitive
-- audit record of the completed erasure.
create table if not exists public.account_deletion_requests (
  id                    uuid primary key default gen_random_uuid(),
  -- SET NULL (not cascade): the row survives Auth-user deletion as an anonymized
  -- audit record. Non-null for every active request (the user still exists).
  user_id               uuid references auth.users(id) on delete set null,
  status                text not null default 'queued'
                          check (status in (
                            'queued',
                            'waiting_for_active_order',
                            'waiting_for_financial_process',
                            'processing',
                            'completed',
                            'retry_scheduled',
                            'manual_review',
                            'failed'
                          )),
  -- Which factor proved identity at creation ('otp' | 'reauth'); non-sensitive.
  verification_method   text check (verification_method in ('otp', 'reauth')),
  requested_at          timestamptz not null default now(),
  identity_verified_at  timestamptz,          -- set at creation; gates processing
  processing_started_at timestamptz,
  completed_at          timestamptz,
  next_attempt_at       timestamptz,          -- earliest time the processor may retry
  attempt_count         integer not null default 0,
  failure_code          text,                 -- safe internal code, never a raw error
  failure_stage         text,                 -- e.g. 'blockers' | 'anonymize' | 'auth_delete'
  manual_review_reason  text,                 -- safe reason string, never PII
  retention_summary     jsonb,                -- non-sensitive counts of what was done
  -- Processor lease / fencing (see push-dispatch convention).
  locked_until          timestamptz,
  lock_token            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- At most ONE active (in-flight) request per user → idempotent creation and no
-- duplicates. Terminal states ('completed','failed') are excluded so a user
-- whose earlier request failed could (in principle) request again.
create unique index if not exists account_deletion_requests_one_active
  on public.account_deletion_requests (user_id)
  where status in (
    'queued', 'waiting_for_active_order', 'waiting_for_financial_process',
    'processing', 'retry_scheduled', 'manual_review'
  );

-- Processor scan index.
create index if not exists account_deletion_requests_due_idx
  on public.account_deletion_requests (status, next_attempt_at);

drop trigger if exists set_account_deletion_requests_updated_at on public.account_deletion_requests;
create trigger set_account_deletion_requests_updated_at
  before update on public.account_deletion_requests
  for each row execute function public.set_updated_at();

-- ---- RLS: read-only for the owner + staff; NO client writes ----------------
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant select on public.account_deletion_requests to authenticated;

-- The signed-in customer may READ only their own request (to show pending
-- state). There are deliberately NO client insert/update/delete policies — the
-- only write path is the SECURITY DEFINER RPCs + the service role, so a client
-- can neither create a request without re-verification nor mark one completed.
drop policy if exists account_deletion_requests_select_own on public.account_deletion_requests;
create policy account_deletion_requests_select_own on public.account_deletion_requests
  for select to authenticated
  using (user_id = auth.uid());

-- Support/admin visibility for the manual-review queue (read-only).
drop policy if exists account_deletion_requests_staff_read on public.account_deletion_requests;
create policy account_deletion_requests_staff_read on public.account_deletion_requests
  for select to authenticated
  using (public.is_staff());

-- ============================================================================
-- Service-role RPCs. All: SECURITY DEFINER + pinned search_path + revoke from
-- public/anon/authenticated + grant to service_role only. Customers can never
-- call them; the trusted Edge Functions call them AFTER verifying the JWT.
-- ============================================================================

-- Idempotent request creation. The Edge Function derives p_user_id from the
-- VERIFIED JWT (never from the client body) and calls this only AFTER identity
-- re-verification (OTP or reauth) has succeeded. A repeat call for a user who
-- already has an active request returns that existing row (no duplicate).
create or replace function public.create_account_deletion_request(
  p_user_id uuid,
  p_method  text
)
returns public.account_deletion_requests
language plpgsql security definer set search_path = public as $$
declare
  v_row public.account_deletion_requests;
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22004';
  end if;

  -- Return an existing in-flight request if there is one (idempotent).
  select * into v_row
  from public.account_deletion_requests
  where user_id = p_user_id
    and status in (
      'queued', 'waiting_for_active_order', 'waiting_for_financial_process',
      'processing', 'retry_scheduled', 'manual_review'
    )
  order by requested_at desc
  limit 1;
  if found then
    return v_row;
  end if;

  insert into public.account_deletion_requests
    (user_id, status, verification_method, identity_verified_at, next_attempt_at)
  values
    (p_user_id, 'queued',
     case when p_method in ('otp', 'reauth') then p_method else null end,
     now(), now())
  returning * into v_row;

  return v_row;
exception
  -- Lost the race against a concurrent create → return the winner's row.
  when unique_violation then
    select * into v_row
    from public.account_deletion_requests
    where user_id = p_user_id
      and status in (
        'queued', 'waiting_for_active_order', 'waiting_for_financial_process',
        'processing', 'retry_scheduled', 'manual_review'
      )
    order by requested_at desc
    limit 1;
    return v_row;
end $$;
revoke all on function public.create_account_deletion_request(uuid, text) from public, anon, authenticated;
grant execute on function public.create_account_deletion_request(uuid, text) to service_role;

-- Atomically claim due requests for one processor run. Uses FOR UPDATE SKIP
-- LOCKED so two concurrent processor invocations never grab the same row. Each
-- claimed row is marked 'processing' with a fresh lease + fencing token; the
-- processor must present that token to complete/transition the row.
create or replace function public.claim_due_account_deletions(
  p_limit         integer default 5,
  p_lease_seconds integer default 300
)
returns setof public.account_deletion_requests
language plpgsql security definer set search_path = public as $$
declare
  v_token uuid := gen_random_uuid();
begin
  return query
  with due as (
    select r.id
    from public.account_deletion_requests r
    where r.identity_verified_at is not null
      -- 'processing' is included so a claim abandoned by a crashed run is
      -- recoverable — but ONLY once its lease has expired (the locked_until
      -- filter below), so an actively-processing row is never double-claimed.
      and r.status in (
        'queued', 'retry_scheduled', 'processing',
        'waiting_for_active_order', 'waiting_for_financial_process'
      )
      and (r.next_attempt_at is null or r.next_attempt_at <= now())
      and (r.locked_until is null or r.locked_until <= now())
    order by r.requested_at
    limit greatest(1, coalesce(p_limit, 5))
    for update skip locked
  )
  -- NOTE: attempt_count is intentionally NOT incremented on claim. It is a
  -- FAILURE budget (bumped only by the processor on a transient error). Expected
  -- blocker-waits (active order / pending payment) must not exhaust it.
  update public.account_deletion_requests r
     set status                = 'processing',
         locked_until          = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300))),
         lock_token            = v_token,
         processing_started_at = coalesce(r.processing_started_at, now()),
         updated_at            = now()
    from due
   where r.id = due.id
  returning r.*;
end $$;
revoke all on function public.claim_due_account_deletions(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_due_account_deletions(integer, integer) to service_role;

-- Transactional, idempotent cleanup + anonymization for ONE user. Runs BEFORE
-- the Auth user is deleted (profiles still present to read the phone; orders
-- still linked by customer_id). Never alters monetary/tax/operational values.
-- Returns a NON-SENSITIVE jsonb summary of counts for retention_summary.
create or replace function public.anonymize_account_data(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone            text;
  v_orders_anon      integer := 0;
  v_addresses        integer := 0;
  v_devices          integer := 0;
  v_sessions         integer := 0;
  v_loyalty          integer := 0;
  v_otp              integer := 0;
  v_logs             integer := 0;
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22004';
  end if;

  select phone_number into v_phone from public.profiles where id = p_user_id;

  -- Retained orders: strip PII snapshot columns; keep amounts/tax/order_number/
  -- branch/items/operational refs entirely untouched. Idempotent (re-nulling
  -- already-null columns is a no-op) and matched while customer_id is still set.
  update public.orders
     set customer_name    = null,
         customer_phone   = null,
         notes            = null,
         address_snapshot = null
   where customer_id = p_user_id
     and (customer_name is not null
       or customer_phone is not null
       or notes is not null
       or address_snapshot is not null);
  get diagnostics v_orders_anon = row_count;

  -- Delete customer-owned personal/transient rows explicitly (also cascade on
  -- Auth deletion; explicit delete keeps this stage idempotent + verifiable).
  delete from public.addresses where customer_id = p_user_id;
  get diagnostics v_addresses = row_count;

  delete from public.push_devices where customer_id = p_user_id;
  get diagnostics v_devices = row_count;

  delete from public.checkout_sessions where customer_id = p_user_id;
  get diagnostics v_sessions = row_count;

  delete from public.loyalty_transactions where profile_id = p_user_id;
  get diagnostics v_loyalty = row_count;

  -- Purge phone-keyed records that carry no FK (best-effort by registered phone).
  if v_phone is not null and btrim(v_phone) <> '' then
    delete from public.otp_challenges where phone_e164 = v_phone;
    get diagnostics v_otp = row_count;
    delete from public.whatsapp_message_logs where phone_e164 = v_phone;
    get diagnostics v_logs = row_count;
  end if;

  return jsonb_build_object(
    'orders_anonymized', v_orders_anon,
    'addresses_deleted', v_addresses,
    'push_devices_deleted', v_devices,
    'checkout_sessions_deleted', v_sessions,
    'loyalty_transactions_deleted', v_loyalty,
    'otp_challenges_purged', v_otp,
    'whatsapp_logs_purged', v_logs,
    'phone_purged', (v_phone is not null and btrim(v_phone) <> '')
  );
end $$;
revoke all on function public.anonymize_account_data(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_account_data(uuid) to service_role;

-- ---- Documentation comments -------------------------------------------------
comment on table public.account_deletion_requests is
  'Queued, idempotent customer account-deletion requests. Client-read-only (own row); all writes via service-role RPCs. Row persists after Auth-user deletion (user_id SET NULL) as a non-sensitive audit record.';
comment on function public.create_account_deletion_request(uuid, text) is
  'Service-role only. Idempotent: returns the existing active request or creates one. p_user_id must come from the verified JWT, never the client body.';
comment on function public.anonymize_account_data(uuid) is
  'Service-role only. Idempotent cleanup + PII anonymization run BEFORE GoTrue Auth deletion. Never alters monetary/tax/operational values.';
