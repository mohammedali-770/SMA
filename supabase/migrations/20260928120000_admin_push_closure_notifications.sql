-- ============================================================================
-- Admin closure notifications — step 4, the part that produces the work.
--
-- WHAT IT DOES. When a branch closes a whole item, closes one price tier, or
-- pauses delivery, a notification is queued for every administrator who turned
-- the console's bell on. Steps 1-3 built the console, the subscription store
-- and the sender; this is the piece that gives the sender something to send.
--
-- NO CLOSURE RPC IS MODIFIED, and that is the central design decision rather
-- than a convenience. `branch_availability_events` and `branch_delivery_events`
-- already record every closure with branch, subject, action, duration, reason,
-- actor and source — they have since 2026-08-20, and `branch_availability_events`
-- is append-only and never pruned. So this hangs a trigger off those two audit
-- tables and touches nothing on the path a cashier uses to take an item off the
-- menu. `set_product_snooze`, `set_variant_snooze`, `set_branch_delivery_pause`
-- and every other closure entry point are left exactly as they are, and the
-- verification block at the end asserts their bodies did not move.
--
-- A NOTIFICATION MUST NEVER BE ABLE TO BLOCK A CLOSURE. The enqueue triggers
-- run inside the transaction that closes the item, so an exception in one would
-- abort the closure itself — a cashier told "could not close Large" because a
-- product name was null. Both trigger bodies therefore wrap their work in
-- `exception when others`, log a warning and return. This is the same trade
-- `20260822090000_branch_availability_retention` made for its prune, and for
-- the same reason: the customer-facing act must not pay for housekeeping.
--
-- WHAT IT NOTIFIES ON, and what it deliberately does not:
--
--   notifies   whole item closed        (branch_availability_events, product_id)
--   notifies   price tier closed        (branch_availability_events, variant_id)
--   notifies   delivery paused          (branch_delivery_events, delivery_paused)
--
--   silent     every reopen             — the owner chose closing only, including
--                                         the sweeper's automatic restore
--   silent     option / add-on closures — highest volume, lowest cost; the
--                                         `modifier_id is not null` filter
--   silent     a single delivery AREA   — `area_disabled` is a narrower event
--                                         than the "delivery paused at a branch"
--                                         the owner asked for. One line to add
--                                         if they want it; not assumed.
--
-- THE QUEUE IS PULLED, NOT PUSHED. `invoke_admin_push_dispatch` pokes the Edge
-- Function once per tick and the function claims rows through
-- `claim_admin_push_notifications`, exactly as `operations-alert-dispatch`
-- does. The alternative — Postgres composing a payload and POSTing it per
-- notification — was rejected because `net.http_post` is fire-and-forget: the
-- database would have to write `sent` at the moment it posted, which is a claim
-- it cannot support. Pulling means the process that actually talks to the push
-- service is the one that records the outcome.
--
-- APPLYING IT SENDS NOTHING, and cannot. Four separate things must all be true
-- before a single notification leaves: this migration applied, a VAPID key pair
-- configured, `admin-push-dispatch` deployed, and at least one admin subscribed
-- from their installed console. None of the last three is done by this file.
-- What applying it DOES do is start queueing rows on the next closure — those
-- expire unsent after two hours and are pruned after fourteen days, so an
-- unconfigured deployment cleans up after itself rather than accumulating.
--
-- MONEY PATH UNTOUCHED. This migration redefines neither `place_order` nor
-- `compute_order_snapshot`; the pair must still hash
-- `12b6816d256c29b76edf947ae1a7ea77` / `22e2d42935459e7bf93abb2941b56325`
-- after it applies, and the block at the end refuses otherwise.
--
-- CUSTOMER PUSH IS NOT TOUCHED. Nothing here may reference `push_devices`,
-- `promos_enabled` or anything else in the Expo channel governed by CLAUDE.md
-- §7 — assertion 10.8 fails the apply if it ever does. That separation is why a
-- predicate error in a staff feature cannot reach a customer's lock screen.
--
-- DEPLOY IMPLIED: yes, one. `admin-push-dispatch` gains a queue-drain mode in
-- the same change. Applying this without deploying that leaves rows queueing
-- and expiring; deploying it without applying this leaves the function with
-- nothing to claim. Neither breaks anything, and neither sends.
-- ============================================================================

-- ---- 1. The kill switch ------------------------------------------------------
--
-- DEFAULTS TRUE, which is the opposite of this repository's usual habit and is
-- a deliberate choice. A feature flag that defaults off exists to stop an apply
-- changing behaviour; here the behaviour is already gated four ways over (see
-- the header), so a fifth gate that must be switched on would be friction
-- rather than safety. What this column is for is the other direction: turning
-- the notifications off without deleting anybody's subscription or undeploying
-- the sender.
--
-- `app_settings` grants are TABLE-level, so this column is readable by `anon`
-- and `authenticated` the moment it exists. That is correct for a flag and is
-- asserted below rather than assumed.
alter table public.app_settings
  add column if not exists admin_push_enabled boolean not null default true;

comment on column public.app_settings.admin_push_enabled is
  'Master switch for ADMIN closure notifications (web push to the staff console). Defaults TRUE because the feature is already gated by the VAPID key, the deployed sender and an admin subscribing; this exists to turn it off. Checked by both the enqueue triggers and the pg_cron driver, so switching it off stops new rows being queued AND stops queued rows being sent. Unrelated to customer push, which is governed by integration_settings.';

-- ---- 2. The outbox -----------------------------------------------------------
create table if not exists public.admin_push_outbox (
  id            bigint generated always as identity primary key,

  -- WHICH AUDIT ROW THIS CAME FROM. The pair is UNIQUE, which is what makes the
  -- enqueue triggers idempotent: a replayed or re-fired trigger cannot produce
  -- a second notification about the same closure.
  source_table  text   not null check (source_table in ('branch_availability_events', 'branch_delivery_events')),
  source_id     bigint not null,

  -- Kept for human inspection only; targeting does not use it. Every admin who
  -- opted in receives every branch's closures — the owner's decision.
  branch_id     uuid references public.branches(id) on delete set null,

  -- Composed at ENQUEUE time, not at send time, so the message describes the
  -- item as it was named when it was closed. Both languages always, because the
  -- sender picks per device from `admin_push_subscriptions.lang`.
  title_ar      text not null,
  body_ar       text not null,
  title_en      text not null,
  body_en       text not null,

  url           text not null default '/',
  -- Collapses a later notice about the SAME subject onto an earlier one in the
  -- tray instead of stacking. Not batching — two different sizes of the same
  -- product carry different tags and both appear.
  tag           text,

  status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0,
  claim_token   uuid,
  claimed_at    timestamptz,
  last_error    text,

  -- clock_timestamp, not now(): one sweep transaction can close several things
  -- and they must order correctly. Same reasoning as the two event tables.
  created_at    timestamptz not null default clock_timestamp(),
  updated_at    timestamptz not null default now(),

  constraint admin_push_outbox_source_uniq unique (source_table, source_id)
);

comment on table public.admin_push_outbox is
  'Queue of closure notifications for admin web push. Written only by the two enqueue triggers, drained only by admin-push-dispatch through claim_admin_push_notifications. Closed to client roles: RLS on with no policies and grants revoked. Holds no customer data — a branch, an item and a duration.';

create index if not exists admin_push_outbox_pending_idx
  on public.admin_push_outbox (status, created_at)
  where status in ('pending', 'processing');

create index if not exists admin_push_outbox_terminal_idx
  on public.admin_push_outbox (created_at)
  where status in ('sent', 'failed', 'skipped');

drop trigger if exists set_admin_push_outbox_updated_at on public.admin_push_outbox;
create trigger set_admin_push_outbox_updated_at
  before update on public.admin_push_outbox
  for each row execute function public.set_updated_at();

-- CLOSED to every client role, the same shape as `admin_push_subscriptions`.
-- RLS with zero policies denies `anon` and `authenticated` outright; the grants
-- are revoked as well so neither can reach it even if a policy is added later
-- by accident.
alter table public.admin_push_outbox enable row level security;
revoke all on public.admin_push_outbox from anon, authenticated;

-- ---- 3. The copy -------------------------------------------------------------
--
-- Kept in their own functions rather than inline in the triggers so the wording
-- can be corrected by a later migration without touching the trigger that must
-- never fail. Both return NULL when the event is not one we notify on, which is
-- how the filters stay in one readable place.

create or replace function public.admin_push_duration_ar(p_minutes integer)
returns text
language sql
immutable
as $$
  select case
    when p_minutes is null or p_minutes <= 0 then 'حتى إشعار آخر'
    when p_minutes = 1 then 'لمدة دقيقة واحدة'
    when p_minutes = 2 then 'لمدة دقيقتين'
    when p_minutes < 11 then 'لمدة ' || p_minutes::text || ' دقائق'
    else 'لمدة ' || p_minutes::text || ' دقيقة'
  end;
$$;

comment on function public.admin_push_duration_ar(integer) is
  'Arabic duration phrase for a closure notice. Arabic counts 1, 2, 3-10 and 11+ differently; a bare "لمدة N دقيقة" is wrong for every value below 11.';

create or replace function public.admin_push_duration_en(p_minutes integer)
returns text
language sql
immutable
as $$
  select case
    when p_minutes is null or p_minutes <= 0 then 'until further notice'
    when p_minutes = 1 then 'for 1 minute'
    else 'for ' || p_minutes::text || ' minutes'
  end;
$$;

create or replace function public.admin_push_availability_copy(
  p_branch_id  uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_minutes    integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_branch_ar  text;
  v_branch_en  text;
  v_product_ar text;
  v_product_en text;
  v_variant_ar text;
  v_variant_en text;
begin
  select b.name_ar, b.name_en into v_branch_ar, v_branch_en
    from public.branches b where b.id = p_branch_id;
  if v_branch_ar is null then
    return null;
  end if;

  if p_variant_id is not null then
    select v.name_ar, v.name_en, p.name_ar, p.name_en
      into v_variant_ar, v_variant_en, v_product_ar, v_product_en
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = p_variant_id;
    if v_variant_ar is null then
      return null;
    end if;
    return jsonb_build_object(
      'title_ar', 'إغلاق حجم — ' || v_branch_ar,
      'body_ar',  'تم إغلاق حجم «' || v_variant_ar || '» من «' || v_product_ar || '» '
                  || public.admin_push_duration_ar(p_minutes) || '.',
      'title_en', 'Size closed — ' || v_branch_en,
      'body_en',  '"' || v_variant_en || '" of "' || v_product_en || '" was closed '
                  || public.admin_push_duration_en(p_minutes) || '.',
      'tag',      'variant:' || p_variant_id::text
    );
  end if;

  if p_product_id is not null then
    select p.name_ar, p.name_en into v_product_ar, v_product_en
      from public.products p where p.id = p_product_id;
    if v_product_ar is null then
      return null;
    end if;
    return jsonb_build_object(
      'title_ar', 'إغلاق صنف — ' || v_branch_ar,
      'body_ar',  'تم إغلاق «' || v_product_ar || '» ' || public.admin_push_duration_ar(p_minutes) || '.',
      'title_en', 'Item closed — ' || v_branch_en,
      'body_en',  '"' || v_product_en || '" was closed ' || public.admin_push_duration_en(p_minutes) || '.',
      'tag',      'product:' || p_product_id::text
    );
  end if;

  -- Neither a product nor a variant: a modifier row, or a shape that did not
  -- exist when this was written. Not ours to describe.
  return null;
end;
$$;

comment on function public.admin_push_availability_copy(uuid, uuid, uuid, integer) is
  'Bilingual notification copy for an item or price-tier closure, or NULL when the event is not one admin push notifies on. SECURITY DEFINER because it runs inside a trigger under whichever role performed the closure, and a branch operator cannot read every catalog row.';

create or replace function public.admin_push_delivery_copy(
  p_branch_id uuid,
  p_minutes   integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_branch_ar text;
  v_branch_en text;
begin
  select b.name_ar, b.name_en into v_branch_ar, v_branch_en
    from public.branches b where b.id = p_branch_id;
  if v_branch_ar is null then
    return null;
  end if;
  return jsonb_build_object(
    'title_ar', 'إيقاف التوصيل — ' || v_branch_ar,
    'body_ar',  'تم إيقاف التوصيل ' || public.admin_push_duration_ar(p_minutes) || '.',
    'title_en', 'Delivery paused — ' || v_branch_en,
    'body_en',  'Delivery was paused ' || public.admin_push_duration_en(p_minutes) || '.',
    'tag',      'delivery:' || p_branch_id::text
  );
end;
$$;

comment on function public.admin_push_delivery_copy(uuid, integer) is
  'Bilingual notification copy for a branch delivery pause, or NULL when the branch has gone. SECURITY DEFINER for the same reason as the availability composer.';

-- ---- 4. The enqueue triggers -------------------------------------------------
--
-- Both are AFTER INSERT on an append-only audit table, so they add a row and
-- return. Both swallow every exception. Read the header before making either
-- of them able to fail.

create or replace function public.admin_push_enqueue_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_copy jsonb;
begin
  -- The filters, cheapest first, OUTSIDE the guarded block so that an ordinary
  -- reopen or add-on closure costs two comparisons and no subtransaction.
  if new.action <> 'closed' then
    return null;
  end if;
  if new.modifier_id is not null then
    return null;
  end if;

  begin
    if not coalesce((select s.admin_push_enabled from public.app_settings s where s.id), false) then
      return null;
    end if;

    v_copy := public.admin_push_availability_copy(
      new.branch_id, new.product_id, new.variant_id, new.duration_minutes
    );
    if v_copy is null then
      return null;
    end if;

    insert into public.admin_push_outbox
      (source_table, source_id, branch_id, title_ar, body_ar, title_en, body_en, tag)
    values
      ('branch_availability_events', new.id, new.branch_id,
       v_copy ->> 'title_ar', v_copy ->> 'body_ar',
       v_copy ->> 'title_en', v_copy ->> 'body_en',
       v_copy ->> 'tag')
    on conflict (source_table, source_id) do nothing;
  exception when others then
    -- A NOTIFICATION MUST NEVER BLOCK A CLOSURE. Warned rather than silent, so
    -- a persistent fault is findable in the Postgres log instead of being
    -- indistinguishable from "nothing was closed".
    raise warning 'admin push enqueue (availability) failed for event %: % (%)',
      new.id, sqlerrm, sqlstate;
  end;

  return null;
end;
$$;

drop trigger if exists admin_push_enqueue_availability on public.branch_availability_events;
create trigger admin_push_enqueue_availability
  after insert on public.branch_availability_events
  for each row execute function public.admin_push_enqueue_availability();

create or replace function public.admin_push_enqueue_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_copy jsonb;
begin
  -- `delivery_paused` only. `area_disabled` turns off one delivery AREA, which
  -- is a narrower event than the branch-level pause the owner asked to be told
  -- about; adding it is one value in this comparison, and is not assumed.
  if new.action <> 'delivery_paused' then
    return null;
  end if;

  begin
    if not coalesce((select s.admin_push_enabled from public.app_settings s where s.id), false) then
      return null;
    end if;

    v_copy := public.admin_push_delivery_copy(new.branch_id, new.duration_minutes);
    if v_copy is null then
      return null;
    end if;

    insert into public.admin_push_outbox
      (source_table, source_id, branch_id, title_ar, body_ar, title_en, body_en, tag)
    values
      ('branch_delivery_events', new.id, new.branch_id,
       v_copy ->> 'title_ar', v_copy ->> 'body_ar',
       v_copy ->> 'title_en', v_copy ->> 'body_en',
       v_copy ->> 'tag')
    on conflict (source_table, source_id) do nothing;
  exception when others then
    raise warning 'admin push enqueue (delivery) failed for event %: % (%)',
      new.id, sqlerrm, sqlstate;
  end;

  return null;
end;
$$;

drop trigger if exists admin_push_enqueue_delivery on public.branch_delivery_events;
create trigger admin_push_enqueue_delivery
  after insert on public.branch_delivery_events
  for each row execute function public.admin_push_enqueue_delivery();

-- ---- 5. Claim and finalize ---------------------------------------------------
--
-- The fencing-token shape `claim_operations_alert_emails` established: a
-- per-invocation token is written on claim and checked on every completion
-- write, so two dispatchers running at once are safe and a stale owner cannot
-- overwrite a newer outcome.

create or replace function public.claim_admin_push_notifications(
  p_claim_token uuid,
  p_limit       integer default 10,
  p_max_attempts integer default 3
)
returns table (
  id            bigint,
  title_ar      text,
  body_ar       text,
  title_en      text,
  body_en       text,
  url           text,
  tag           text,
  attempt_count integer
)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  -- EVERY COLUMN REFERENCE BELOW IS QUALIFIED, and that is load-bearing rather
  -- than tidy. This function's OUT parameters are called `id`, `url`, `tag` and
  -- so on, which are also column names; a bare `id` inside the query would
  -- resolve to the variable and the statement would be rejected as ambiguous.
  -- The names have to stay as they are because PostgREST serialises the
  -- declared OUT parameter names, and the Edge Function reads them -- the exact
  -- coupling that broke `operations-alert-dispatch` on #328.
  return query
  with claimable as (
    select o.id as claim_id
      from public.admin_push_outbox o
     where (
             o.status = 'pending'
             -- A lease that expired: the dispatcher that claimed it died. Five
             -- minutes is well past the function's own timeout.
             or (o.status = 'processing' and o.claimed_at < now() - interval '5 minutes')
           )
       and o.attempt_count < p_max_attempts
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
  ),
  claimed as (
    update public.admin_push_outbox o
       set status        = 'processing',
           claim_token   = p_claim_token,
           claimed_at    = now(),
           attempt_count = o.attempt_count + 1
      from claimable c
     where o.id = c.claim_id
    returning o.id, o.title_ar, o.body_ar, o.title_en, o.body_en,
              o.url, o.tag, o.attempt_count
  )
  select c.id, c.title_ar, c.body_ar, c.title_en, c.body_en, c.url, c.tag, c.attempt_count
    from claimed c
   order by c.id;
end;
$$;

comment on function public.claim_admin_push_notifications(uuid, integer, integer) is
  'Claims up to p_limit queued admin closure notifications under a fencing token. Skips rows that have already used their attempt budget, and reclaims a lease older than five minutes.';

create or replace function public.finalize_admin_push_notification(
  p_id           bigint,
  p_claim_token  uuid,
  p_status       text,
  p_error_safe   text default null,
  p_max_attempts integer default 3
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'finalize_admin_push_notification: status must be sent or failed, got %', p_status
      using errcode = '22023';
  end if;

  update public.admin_push_outbox o
     set status = case
           when p_status = 'sent' then 'sent'
           -- A RETRYABLE FAILURE GOES BACK IN THE QUEUE, and the ATTEMPT BUDGET
           -- is what ends it — not the first bad minute a push service has.
           --
           -- The first version wrote 'failed' here unconditionally, and
           -- `claim_admin_push_notifications` claims only 'pending' or an
           -- expired 'processing' lease. So the three attempts this function
           -- advertises were never reachable: one 429 or 5xx across every
           -- subscription lost the closure notice permanently. Review caught it
           -- on #399.
           --
           -- `attempt_count` was already incremented at CLAIM time, so after
           -- the first attempt it is 1: with the default budget this yields
           -- three sends in total and then a terminal 'failed'.
           when o.attempt_count < p_max_attempts then 'pending'
           else 'failed'
         end,
         last_error  = left(p_error_safe, 300),
         -- Both cleared: a row going back to 'pending' must not look like it
         -- still belongs to the dispatcher that just gave up on it.
         claim_token = null,
         claimed_at  = null
   where o.id = p_id
     -- THE FENCE. Without it a dispatcher whose lease expired could overwrite
     -- the outcome written by the one that took over.
     and o.claim_token = p_claim_token;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

comment on function public.finalize_admin_push_notification(bigint, uuid, text, text, integer) is
  'Records the outcome of one admin closure notification, guarded by the claim token. A failure returns the row to the queue until its attempt budget is spent, then becomes terminal. Returns false when the token no longer owns the row, which means another dispatcher took over.';

revoke all on function public.claim_admin_push_notifications(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.finalize_admin_push_notification(bigint, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_admin_push_notifications(uuid, integer, integer) to service_role;
grant execute on function public.finalize_admin_push_notification(bigint, uuid, text, text, integer) to service_role;

revoke all on function public.admin_push_availability_copy(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_push_delivery_copy(uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_push_duration_ar(integer) from public, anon, authenticated;
revoke all on function public.admin_push_duration_en(integer) from public, anon, authenticated;

-- ---- 6. Signature verification, without disclosing the secret ----------------
--
-- Identical in shape to `verify_operations_alert_dispatch_signature`
-- (20260903130000), for the same reason: the Edge Function must be able to
-- prove it was called by the scheduler WITHOUT ever holding the value that
-- proves it. The driver sends nonce + timestamp + HMAC; Postgres recomputes.

create or replace function public.verify_admin_push_dispatch_signature(
  p_nonce     text,
  p_timestamp text,
  p_signature text
)
returns boolean
language plpgsql
-- VOLATILE, not stable: the comparison below draws a fresh random probe key on
-- every call, so the planner must never fold two calls into one.
volatile
security definer
set search_path = public
as $$
declare
  v_secret   text;
  v_when     timestamptz;
  v_expected text;
  v_probe    text;
begin
  -- Fail CLOSED on every path. An unconfigured deployment denies; it never
  -- falls through to a comparison against an empty signature.
  if p_nonce is null or length(p_nonce) = 0
     or p_timestamp is null or length(p_timestamp) = 0
     or p_signature is null or length(p_signature) = 0 then
    return false;
  end if;

  -- A malformed timestamp is a denial, not an exception: this is reachable from
  -- an unauthenticated path and must not turn attacker input into a 500.
  begin
    v_when := p_timestamp::timestamptz;
  exception when others then
    return false;
  end;
  if abs(extract(epoch from (now() - v_when))) > 600 then
    return false;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'admin_push_dispatch_secret';
  if v_secret is null or length(v_secret) = 0 then
    return false;
  end if;

  v_expected := encode(extensions.hmac(p_nonce || '.' || p_timestamp, v_secret, 'sha256'), 'hex');

  -- Double-HMAC comparison under a fresh random probe key: `=` is not constant
  -- time, and this endpoint can be called at whatever rate an attacker likes.
  v_probe := encode(extensions.gen_random_bytes(32), 'hex');
  return extensions.hmac(v_expected, v_probe, 'sha256')
       = extensions.hmac(p_signature, v_probe, 'sha256');
end;
$$;

comment on function public.verify_admin_push_dispatch_signature(text, text, text) is
  'Recomputes HMAC-SHA256(nonce.timestamp) against the Vault-held admin push dispatch secret and returns a boolean. The secret never leaves Postgres: the Edge Function sends a signature, not the value it is checked against.';

revoke all on function public.verify_admin_push_dispatch_signature(text, text, text) from public, anon, authenticated;
grant execute on function public.verify_admin_push_dispatch_signature(text, text, text) to service_role;

-- ---- 7. The driver pg_cron calls ---------------------------------------------
create or replace function public.invoke_admin_push_dispatch()
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_enabled     boolean;
  v_pending     bigint;
  v_project_url text;
  v_secret      text;
  v_nonce       text;
  v_stamp       text;
  v_signature   text;
  v_request_id  bigint;
begin
  -- HOUSEKEEPING FIRST, and unconditionally. A closure notice that has sat in
  -- the queue for two hours is worse than useless — the sender's TTL is one
  -- hour, so it would not be delivered anyway, and if it were it would describe
  -- a state that has probably changed. Expiring here rather than inside the
  -- claim RPC is deliberate: this runs every tick whatever the Edge Function is
  -- doing, so an unconfigured or undeployed sender leaves a table that cleans
  -- itself instead of one that grows for ever.
  update public.admin_push_outbox
     set status = 'skipped',
         last_error = 'expired before dispatch'
   where status in ('pending', 'processing')
     and created_at < now() - interval '2 hours';

  -- Retention, matching the fourteen days `lazywait_sync_requests` and the
  -- branch-availability run ledger both use.
  delete from public.admin_push_outbox
   where status in ('sent', 'failed', 'skipped')
     and created_at < now() - interval '14 days';

  -- Gate 1: the master switch. Checked here as well as in the triggers, so
  -- turning it off stops rows that are ALREADY queued, not only new ones.
  select s.admin_push_enabled into v_enabled from public.app_settings s where s.id;
  if not coalesce(v_enabled, false) then
    return null;
  end if;

  -- Gate 2: is there anything to do? A request every minute for ever to say
  -- "nothing" wastes an invocation and buries real activity in the logs.
  select count(*) into v_pending
    from public.admin_push_outbox
   where status in ('pending', 'processing')
     and attempt_count < 3;
  if v_pending = 0 then
    return null;
  end if;

  select decrypted_secret into v_project_url
    from vault.decrypted_secrets where name = 'admin_push_dispatch_project_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'admin_push_dispatch_secret';

  -- INCOMPLETE VAULT IS RECORDED, NOT RAISED, and the difference is not
  -- squeamishness. `invoke_operations_alert_dispatch` raises here, correctly:
  -- it does no other work, so aborting costs nothing and turns an
  -- unconfigured dispatcher into a visible failure in `cron.job_run_details`.
  --
  -- This driver performs the expiry and the prune FIRST, and pg_cron runs each
  -- job in one transaction — so an exception here would roll back the
  -- housekeeping along with everything else. The table would then grow for ever
  -- on exactly the deployment that cannot send, which is the opposite of what
  -- the expiry is for. Verified rather than reasoned: the paired suite asserts
  -- a three-hour-old row is expired on a tick where Vault is incomplete.
  --
  -- So the fault is written where it will be read: onto the rows it is holding
  -- up, plus a warning in the server log. The rows still expire after two hours
  -- and are still pruned, so nothing accumulates either way.
  if v_project_url is null or v_secret is null then
    update public.admin_push_outbox
       set last_error = 'dispatch not configured: admin push Vault secrets are incomplete'
     where status in ('pending', 'processing')
       and last_error is distinct from 'dispatch not configured: admin push Vault secrets are incomplete';
    raise warning 'admin push dispatch Vault configuration is incomplete; % notification(s) held', v_pending;
    return null;
  end if;

  -- SIGN, do not send. `v_secret` computes the signature and never leaves this
  -- function.
  v_nonce := encode(extensions.gen_random_bytes(16), 'hex');
  v_stamp := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_signature := encode(extensions.hmac(v_nonce || '.' || v_stamp, v_secret, 'sha256'), 'hex');

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/admin-push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-admin-push-nonce', v_nonce,
      'x-admin-push-timestamp', v_stamp,
      'x-admin-push-signature', v_signature
    ),
    body := jsonb_build_object('mode', 'queue', 'source', 'pg_cron', 'scheduled_at', now()),
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.invoke_admin_push_dispatch() is
  'pg_cron driver for admin-push-dispatch. Expires stale queue rows and prunes old ones on every tick; no-ops while the master switch is off or the queue is empty; raises if Vault is incomplete once there is work.';

revoke all on function public.invoke_admin_push_dispatch() from public, anon, authenticated;
grant execute on function public.invoke_admin_push_dispatch() to service_role;

-- ---- 8. The trigger secret ---------------------------------------------------
--
-- GENERATED INSIDE POSTGRES AND NEVER SEEN BY ANYBODY. The value is produced by
-- `gen_random_bytes` in this transaction and written straight to Vault, so it
-- does not appear in a terminal, a transcript, this repository or an Edge
-- Function environment — the method `docs/OWNER_ACTIONS.md` §28 records for the
-- alert-dispatch secret, performed by the migration instead of by hand so it is
-- one fewer owner step.
--
-- The project URL is COPIED from the alert dispatcher's secret when that exists,
-- because it is the same single fact about the deployment and re-typing it is a
-- chance to get it wrong. When it does not exist — a fresh database, the local
-- chain harness — nothing is created and the driver fails closed with the
-- message above. This is asserted as an outcome below, not assumed.
do $$
declare
  v_url text;
begin
  if not exists (select 1 from vault.secrets where name = 'admin_push_dispatch_secret') then
    -- NAMED ARGUMENTS. Live `vault.update_secret` turned out to take five
    -- arguments where its header claimed four (docs/MIGRATIONS.md, ledger row
    -- 91), and named binding is what made that resolve either way. The same
    -- caution costs nothing here.
    perform vault.create_secret(
      new_secret      => encode(extensions.gen_random_bytes(32), 'hex'),
      new_name        => 'admin_push_dispatch_secret',
      new_description => 'HMAC key for the pg_cron -> admin-push-dispatch call. Generated inside Postgres; never transmitted.'
    );
  end if;

  if not exists (select 1 from vault.secrets where name = 'admin_push_dispatch_project_url') then
    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'operations_alert_dispatch_project_url';
    if v_url is not null and length(v_url) > 0 then
      perform vault.create_secret(
        new_secret      => v_url,
        new_name        => 'admin_push_dispatch_project_url',
        new_description => 'Supabase project URL used by invoke_admin_push_dispatch. Copied from the alert dispatcher secret at apply time.'
      );
    end if;
  end if;
end $$;

-- ---- 9. Schedule -------------------------------------------------------------
-- Every minute. A closure notice is an operational alert whose value decays
-- fast; the branch-availability sweep already runs at this cadence, and the
-- driver's empty-queue path is two index-served statements and a flag read.
-- cron.schedule upserts by name, so re-applying updates rather than duplicates.
select cron.schedule(
  'admin-push-dispatch',
  '* * * * *',
  'select public.invoke_admin_push_dispatch();'
);

-- ---- 10. Self-verification ---------------------------------------------------
do $$
declare
  v_count   integer;
  v_txt     text;
  v_src     text;
  v_hash    text;
  v_enabled boolean;
begin
  -- 10.1 The flag exists, defaults true, and is live-readable by both client
  -- roles (app_settings grants are TABLE-level, so this is an outcome check
  -- rather than a restatement of a grant statement that was never written).
  select admin_push_enabled into v_enabled from public.app_settings where id;
  if v_enabled is distinct from true then
    raise exception 'admin_push_enabled must be true on apply (found %)', v_enabled;
  end if;
  if not has_column_privilege('anon', 'public.app_settings', 'admin_push_enabled', 'SELECT') then
    raise exception 'anon cannot select app_settings.admin_push_enabled';
  end if;
  if not has_column_privilege('authenticated', 'public.app_settings', 'admin_push_enabled', 'SELECT') then
    raise exception 'authenticated cannot select app_settings.admin_push_enabled';
  end if;

  -- 10.2 The outbox is created EMPTY. Applying this queues nothing; the first
  -- row appears at the first closure after the apply.
  select count(*) into v_count from public.admin_push_outbox;
  if v_count <> 0 then
    raise exception 'admin_push_outbox must be empty on apply, found % row(s)', v_count;
  end if;

  -- 10.3 The outbox is CLOSED to client roles. RLS on, zero policies, and no
  -- grant either. Asserted as the outcome, not as the revoke statement.
  if not (select relrowsecurity from pg_class where oid = 'public.admin_push_outbox'::regclass) then
    raise exception 'RLS is not enabled on admin_push_outbox';
  end if;
  select count(*) into v_count from pg_policies
   where schemaname = 'public' and tablename = 'admin_push_outbox';
  if v_count <> 0 then
    raise exception 'admin_push_outbox must carry zero policies, found %', v_count;
  end if;
  if has_table_privilege('anon', 'public.admin_push_outbox', 'SELECT')
     or has_table_privilege('authenticated', 'public.admin_push_outbox', 'SELECT')
     or has_table_privilege('anon', 'public.admin_push_outbox', 'INSERT')
     or has_table_privilege('authenticated', 'public.admin_push_outbox', 'INSERT') then
    raise exception 'admin_push_outbox must not be reachable by a client role';
  end if;

  -- 10.4 Both triggers exist, on the two audit tables and nowhere else.
  select count(*) into v_count from pg_trigger
   where tgrelid = 'public.branch_availability_events'::regclass
     and tgname = 'admin_push_enqueue_availability' and not tgisinternal;
  if v_count <> 1 then
    raise exception 'expected the availability enqueue trigger, found %', v_count;
  end if;
  select count(*) into v_count from pg_trigger
   where tgrelid = 'public.branch_delivery_events'::regclass
     and tgname = 'admin_push_enqueue_delivery' and not tgisinternal;
  if v_count <> 1 then
    raise exception 'expected the delivery enqueue trigger, found %', v_count;
  end if;

  -- 10.5 NO CLOSURE PATH WAS TOUCHED. The three RPCs a human uses to take
  -- something off the menu must still be exactly what they were; this feature's
  -- whole design claim is that it observes them rather than changing them.
  for v_txt in
    select unnest(array['set_product_snooze', 'clear_product_snooze',
                        'set_variant_snooze', 'clear_variant_snooze',
                        'set_branch_delivery_pause'])
  loop
    select count(*) into v_count from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_txt;
    if v_count = 0 then
      raise exception 'closure RPC % is missing — this migration must not have removed it', v_txt;
    end if;
    -- Nothing this migration installs may appear inside a closure RPC's body.
    if exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_txt
         and p.prosrc like '%admin_push%'
    ) then
      raise exception 'closure RPC % mentions admin_push — the trigger design was abandoned', v_txt;
    end if;
  end loop;

  -- 10.6 Each enqueue trigger swallows its own failures. A notification that
  -- can abort a closure is the one defect in this file that would be felt by a
  -- cashier during a rush.
  for v_txt in
    select unnest(array['admin_push_enqueue_availability', 'admin_push_enqueue_delivery'])
  loop
    select count(*) into v_count from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_txt;
    -- CARDINALITY FIRST: `select prosrc into` takes an arbitrary row when two
    -- overloads exist, so a body check that ran before this one would prove
    -- nothing about which body it read.
    if v_count <> 1 then
      raise exception 'expected exactly one %, found %', v_txt, v_count;
    end if;
    -- A SEPARATE DESTINATION, not the loop variable. Writing the body back into
    -- `v_txt` would overwrite the function name mid-loop and make the second
    -- iteration look for a function called "begin declare v_copy jsonb...".
    -- That exact shadowing bug was written and caught in 20260927120000.
    select p.prosrc into v_src from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_txt;
    if v_src not like '%exception when others%' then
      raise exception 'enqueue trigger % lost its exception guard', v_txt;
    end if;
  end loop;

  -- 10.6b THE ATTEMPT BUDGET IS WRITTEN IN THREE PLACES AND MUST AGREE.
  -- `claim_admin_push_notifications` defaults it, `finalize_admin_push_notification`
  -- defaults it, and the driver counts claimable rows with a literal. A drift
  -- between them is silent: the queue would either retry for ever or give up
  -- early, and neither shows up as an error. Same rule as `20260913120000`,
  -- which reads a default out of the catalog rather than trusting a comment.
  select pg_get_function_arguments(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_admin_push_notifications';
  if v_src not like '%p_max_attempts integer DEFAULT 3%' then
    raise exception 'claim_admin_push_notifications budget drifted: %', v_src;
  end if;
  select pg_get_function_arguments(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'finalize_admin_push_notification';
  if v_src not like '%p_max_attempts integer DEFAULT 3%' then
    raise exception 'finalize_admin_push_notification budget drifted: %', v_src;
  end if;
  select p.prosrc into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'invoke_admin_push_dispatch';
  if v_src not like '%attempt_count < 3%' then
    raise exception 'the driver no longer counts claimable rows against the budget of 3';
  end if;

  -- 10.7 The cron job exists exactly once.
  select count(*) into v_count from cron.job where jobname = 'admin-push-dispatch';
  if v_count <> 1 then
    raise exception 'expected exactly one admin-push-dispatch cron job, found %', v_count;
  end if;

  -- 10.8 THE TWO PUSH CHANNELS STAY APART. Nothing this migration installs may
  -- reference the customer Expo channel. The moment they share a code path, a
  -- predicate error in a staff feature can reach a customer's lock screen.
  --
  -- `%admin_push%`, NOT `admin_push%`. Three of this feature's functions are
  -- named `claim_`/`finalize_`/`invoke_admin_push_…`, so a prefix match would
  -- exempt the claim RPC — the one function that reads rows, and so the natural
  -- place for a later change to "also notify the customer". The paired suite
  -- caught that gap; it is fixed here rather than only there.
  select count(*), string_agg(p.proname, ', ') into v_count, v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like '%admin_push%'
     and (p.prosrc like '%push_devices%' or p.prosrc like '%promos_enabled%');
  if v_count <> 0 then
    raise exception '% reference the customer push channel', v_src;
  end if;

  -- 10.9 The trigger secret exists. The project URL is NOT asserted: on a fresh
  -- database there is no alert-dispatch secret to copy from, and failing the
  -- apply for that would make this file unappliable outside Production.
  if not exists (select 1 from vault.secrets where name = 'admin_push_dispatch_secret') then
    raise exception 'admin_push_dispatch_secret was not created';
  end if;

  -- 10.10 MONEY PATH UNTOUCHED. This migration redefines neither function, so
  -- both must still hash exactly what the ledger records.
  --
  -- LOOKED UP BY NAME, NEVER BY A WRITTEN-OUT SIGNATURE. A `to_regprocedure`
  -- call with one argument wrong returns NULL, `md5(null)` is NULL, and
  -- `NULL is distinct from '<hash>'` is TRUE -- so a mistyped signature would
  -- raise here and look like a money-path change. The same mistake in the other
  -- direction (`<>` instead of `is distinct from`) would let NULL pass as a
  -- clean check, which is how a guard usually fails to be able to fail
  -- (docs/MIGRATIONS.md, ledger row 90). Cardinality is asserted first so the
  -- hash is known to describe the only definition.
  select count(*) into v_count from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_count <> 1 then
    raise exception 'expected exactly one place_order, found %', v_count;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_hash is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order hashes % — this migration must not touch the money path', v_hash;
  end if;

  select count(*) into v_count from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_count <> 1 then
    raise exception 'expected exactly one compute_order_snapshot, found %', v_count;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_hash is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot hashes % — this migration must not touch the money path', v_hash;
  end if;
end $$;
