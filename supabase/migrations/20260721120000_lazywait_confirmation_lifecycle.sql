-- ============================================================================
-- Spicy Meal — Lazywait POS customer-confirmation lifecycle (operational safety).
--
-- GOAL: a customer is NEVER told "the restaurant confirmed your order" unless
-- Lazywait POS actually returned a usable order reference (lazywait_ref). Every
-- ambiguous POS outcome (timeout, dropped connection, 2xx-without-ref,
-- success:true-without-ref, malformed body, 5xx) is treated as MAY-HAVE-BEEN
-- CREATED and routed to a new terminal state `confirmation_required` for human
-- verification — it is NEVER auto-retried, because Create Order has no
-- idempotency key and a blind resend could double the POS ticket.
--
-- Only EXPLICIT evidence that Create Order was NOT processed (HTTP 429 rate
-- limit, or a worker that provably died BEFORE sending) may be auto-retried,
-- and only inside a hard budget: at most 5 attempts AND a 10-minute absolute
-- deadline measured from first eligibility.
--
-- This migration is FORWARD-ONLY and, at authoring time, REPOSITORY-ONLY /
-- UNAPPLIED (it is not part of the production migration ledger yet). It does not
-- touch payment functions, credentials, cron, Vault, or the push master flag.
--
-- Contents:
--   1. Extend the sync-state check constraint with `confirmation_required`.
--   2. New lifecycle columns (deadline window, first-failure marker, a
--      "request may have been sent" phase marker, a stable confirmation reason).
--   3. Deadline trigger: stamp the 10-minute window the first time an order
--      becomes eligible ('pending') — covers cash-at-insert AND online-at-paid
--      WITHOUT modifying the payment or initial-sync functions.
--   4. Backfill the window for any in-flight rows.
--   5. Claim RPCs: exclude past-deadline rows + clear the phase marker/token.
--  5b. begin_lazywait_create_attempt: the fenced pre-send gate — re-checks the
--      deadline AND durably stores the phase marker + attempt token under one
--      lock, immediately before the worker POSTs (Findings 1 & 2).
--   6. record_lazywait_sync: persist the new columns + enqueue a deduplicated
--      pos_sync notification ('pending') atomically with the state change.
--   7. Stale reaper: phase-marker-aware (proven-not-sent => safe requeue within
--      budget; may-have-sent => confirmation_required) + past-deadline sweep.
--  7b. requeue_lazywait_order: deadline-safe manual retry — rejects an expired /
--      ambiguous / already-sent / attempt-exhausted order (no false success),
--      preserves the original deadline + attempt count. One shared eligibility
--      predicate (mirrored by the admin UI to hide the Retry action).
--   8. notification_log: allow kind='pos_sync', 'pending'/'superseded' send_status,
--      a fencing claim_token, and a per-(order,status) dedup index.
--  8b. CONSUME-ONLY fenced pos_sync notification claim/validate/finalize/release
--      RPCs + one canonical pure state-match predicate — at-most-once customer
--      delivery under concurrent dispatch, and a FINAL pre-send re-validation
--      that LOCKS the order row (canonical order: orders -> notification_log) so
--      it serializes against a concurrent worker; only producers create events.
--   9. Admin dashboard RPC: read-only "Orders Requiring Verification" feed.
--  10. Partial indexes for the deadline-bounded queue and the dashboard query.
--
-- Idempotent: guarded so it can be re-applied safely.
-- ============================================================================

-- ---- 1. Extend the sync-state check constraint -----------------------------
-- Add `confirmation_required` while preserving every existing state (including
-- 'awaiting_payment' from 20260709140000). The constraint is unnamed inline in
-- earlier migrations but Postgres names it `orders_lazywait_sync_state_check`.
do $$
begin
  alter table public.orders drop constraint if exists orders_lazywait_sync_state_check;
  alter table public.orders add constraint orders_lazywait_sync_state_check
    check (lazywait_sync_state in (
      'pending','syncing','synced','failed','blocked','dead_letter','skipped',
      'awaiting_payment','confirmation_required'));
end $$;

-- ---- 2. Lifecycle columns --------------------------------------------------
-- pos_sync_started_at      : when the order FIRST became eligible to be sent
--                            (first entered 'pending'); anchors the schedule.
-- pos_sync_deadline_at     : pos_sync_started_at + 10 min; absolute hard stop.
-- first_pos_sync_failure_at: first time a send did not cleanly confirm; drives
--                            the "retrying" customer message and the
--                            "confirmed AFTER a failure" push (first-try success
--                            stays silent).
-- pos_create_attempted_at  : PHASE MARKER. Set by the worker IMMEDIATELY before
--                            it POSTs Create Order; cleared on every claim. Lets
--                            the reaper distinguish "worker died BEFORE sending"
--                            (marker null => safe to retry) from "worker may have
--                            sent" (marker set => confirmation_required).
-- pos_confirmation_reason  : stable machine reason for the admin card
--                            (timeout | connection | missing_ref |
--                             ambiguous_response | provider_5xx). No secrets.
-- pos_create_attempt_token : FENCING TOKEN for the current send phase. A unique
--                            per-attempt token stored ATOMICALLY with the phase
--                            marker by begin_lazywait_create_attempt() so the
--                            durable "may have sent" transition is provable and
--                            two attempts can never both enter the send phase.
--                            Internal operational metadata — never logged.
alter table public.orders add column if not exists pos_sync_started_at       timestamptz;
alter table public.orders add column if not exists pos_sync_deadline_at      timestamptz;
alter table public.orders add column if not exists first_pos_sync_failure_at timestamptz;
alter table public.orders add column if not exists pos_create_attempted_at   timestamptz;
alter table public.orders add column if not exists pos_confirmation_reason   text;
alter table public.orders add column if not exists pos_create_attempt_token  text;

-- ---- 3. Deadline trigger ---------------------------------------------------
-- Stamp the 10-minute window the FIRST time an order becomes 'pending'. Fires
-- BEFORE INSERT OR UPDATE OF lazywait_sync_state, so it composes with BOTH:
--   * set_lazywait_initial_sync (BEFORE INSERT) for cash/pickup — that trigger
--     is named 'set_orders_lazywait_initial_sync' which sorts before
--     'set_pos_sync_deadline', so the state is already 'pending' when we run; and
--   * confirm_order_payment (UPDATE awaiting_payment -> pending) for paid online
--     orders — it always assigns lazywait_sync_state, so this fires.
-- The `pos_sync_started_at is null` guard makes it a one-shot: the window is
-- anchored to FIRST eligibility and is never reset by a later retry/requeue.
create or replace function public.set_pos_sync_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.lazywait_sync_state = 'pending' and new.pos_sync_started_at is null then
    new.pos_sync_started_at  := now();
    new.pos_sync_deadline_at := now() + interval '10 minutes';
  end if;
  return new;
end $$;

drop trigger if exists set_pos_sync_deadline on public.orders;
create trigger set_pos_sync_deadline
  before insert or update of lazywait_sync_state on public.orders
  for each row execute function public.set_pos_sync_deadline();

-- ---- 4. Backfill in-flight rows --------------------------------------------
-- Give any order currently in the retry pipeline a FRESH 10-minute window from
-- the moment this migration is applied (not from its original creation), so a
-- long-idle queued row is not instantly shoved past a back-dated deadline.
update public.orders
   set pos_sync_started_at  = now(),
       pos_sync_deadline_at = now() + interval '10 minutes'
 where lazywait_sync_state in ('pending','failed','syncing')
   and pos_sync_started_at is null;

-- ---- 4b. Canonical USABLE-POS-ref helper -----------------------------------
-- The ONE authority for "is this lazywait_ref a USABLE POS reference?" — i.e.
-- may it prove restaurant confirmation, produce pos_confirmed, show the
-- customer-confirmed UI, or finalize a recovery as confirmed. This is a strictly
-- DIFFERENT question from "is a ref MARKER stored?" (any non-null value, even
-- blank/malformed, conservatively blocks an automatic Create Order resend — that
-- check stays `lazywait_ref is not null`, NOT this helper).
--
-- Usable == a non-empty value remains after stripping leading/trailing
-- whitespace under JavaScript String.prototype.trim() semantics: the Unicode
-- WhiteSpace + LineTerminator set plus U+FEFF (BOM) — U+0009..U+000D, U+0020,
-- U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
-- (U+200B ZERO WIDTH SPACE is NOT in that set, matching .trim().) This mirrors the
-- mobile hasUsablePosRef(ref.trim()) rule so SQL and client can never diverge.
-- The trim set is built with chr() (ASCII source) and covers the FULL set, NOT
-- single-arg btrim() which strips only U+0020 spaces. Pure/immutable, no table
-- access, no secrets. Callers: pos_sync_status_matches('pos_confirmed'), the
-- stale reaper's confirmed enqueue, begin_lazywait_create_attempt, the
-- record_lazywait_sync producer guard, and lazywait_requeue_eligibility.
create or replace function public.lazywait_pos_ref_is_usable(p_ref text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select nullif(
    btrim(coalesce(p_ref, ''),
      E'\t\n\x0b\f\r ' || chr(160) || chr(5760)
      || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196)
      || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201)
      || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287)
      || chr(12288) || chr(65279)),
    '') is not null;
$$;

-- authenticated needs execute because lazywait_requeue_eligibility (granted to
-- authenticated, plain SQL/not SECURITY DEFINER) calls this helper.
revoke all on function public.lazywait_pos_ref_is_usable(text) from public, anon;
grant execute on function public.lazywait_pos_ref_is_usable(text) to authenticated, service_role;

-- ---- 5. Claim RPCs (deadline-bounded + clear phase marker) ------------------
-- A row is claimable only while it is still WITHIN its deadline. Past-deadline
-- rows are left for the reaper's sweep (step 7) so they finalize deterministically
-- instead of being POSTed after the customer-facing budget has already expired.
-- pos_create_attempted_at is CLEARED on claim: the new lease starts in the
-- "not yet sent" phase until the worker stamps it right before POST.
create or replace function public.claim_lazywait_sync_batch(p_limit integer default 10)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders o
     set lazywait_sync_state = 'syncing',
         pos_create_attempted_at = null,
         pos_create_attempt_token = null,
         updated_at = now()
   where o.id in (
     select id from public.orders
      where lazywait_sync_state in ('pending','failed')
        and (sync_next_attempt_at is null or sync_next_attempt_at <= now())
        and (pos_sync_deadline_at is null or now() < pos_sync_deadline_at)
      order by sync_next_attempt_at nulls first, created_at
      limit greatest(1, least(coalesce(p_limit, 10), 100))
      for update skip locked
   )
   returning o.*;
end $$;

revoke all on function public.claim_lazywait_sync_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_lazywait_sync_batch(integer) to service_role;

create or replace function public.claim_lazywait_sync_one(p_order_id uuid)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders o
     set lazywait_sync_state = 'syncing',
         pos_create_attempted_at = null,
         pos_create_attempt_token = null,
         updated_at = now()
   where o.id in (
     select id from public.orders
      where id = p_order_id
        and lazywait_sync_state in ('pending','failed')
        and (sync_next_attempt_at is null or sync_next_attempt_at <= now())
        and (pos_sync_deadline_at is null or now() < pos_sync_deadline_at)
      for update skip locked
   )
   returning o.*;
end $$;

revoke all on function public.claim_lazywait_sync_one(uuid) from public, anon, authenticated;
grant execute on function public.claim_lazywait_sync_one(uuid) to service_role;

-- ---- 5b. begin_lazywait_create_attempt(): fenced pre-send gate --------------
-- The single authoritative gate the worker MUST pass immediately before it POSTs
-- Create Order — after all preparatory work (branch/item load, optional CRM).
-- Under ONE row lock it re-validates from authoritative state and, only when the
-- send is allowed, DURABLY stores the phase marker + a unique attempt token in
-- the same statement. This closes two duplicate-prevention holes at once:
--   * FINDING 1 (deadline): no /pos/orders/create may begin after
--     pos_sync_deadline_at — the gate rejects an expired row (`deadline_expired`)
--     no matter how long claim→prep→CRM took.
--   * FINDING 2 (durable marker): the marker is committed by THIS function before
--     the caller is told `ready_to_send`, so a crash after the POST leaves can
--     never be misread by the reaper as proven-not-sent (no blind resend).
-- Concurrency: FOR UPDATE serializes callers; the first to stamp the marker+token
-- wins, a second caller bearing a DIFFERENT token gets `invalid_state`, and the
-- SAME token is idempotent (safe retry of this RPC). Returns exactly one of:
--   ready_to_send | already_synced | ref_present_unverified | deadline_expired
--   | invalid_state | not_found
-- ('ref_present_unverified' = a non-null but UNUSABLE ref marker, or 'synced'
-- without a usable ref: never resend, never confirm — route to verification.)
create or replace function public.begin_lazywait_create_attempt(
  p_order_id      uuid,
  p_attempt_token text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.orders;
begin
  if p_attempt_token is null or p_attempt_token = '' then
    raise exception 'attempt token required' using errcode = '22004';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;

  -- A STORED ref marker (any non-null value, even blank/malformed) OR a 'synced'
  -- row means Create Order MAY already have produced a ticket — it has no
  -- idempotency key, so NEVER resend. But distinguish PROOF of confirmation from
  -- a mere marker: only a USABLE ref proves the POS ticket exists (-> synced,
  -- customer-confirmed). A non-null-but-unusable marker (or 'synced' without a
  -- usable ref) is ambiguous -> 'ref_present_unverified': still no resend, but
  -- the worker must route it to manual verification, NOT report confirmation.
  if v_row.lazywait_ref is not null or v_row.lazywait_sync_state = 'synced' then
    if public.lazywait_pos_ref_is_usable(v_row.lazywait_ref) then
      return 'already_synced';
    end if;
    return 'ref_present_unverified';
  end if;

  -- Only a live claim may enter the send phase. Terminal/ambiguous states
  -- (confirmation_required/dead_letter/blocked/failed/pending/…) are never 'syncing'.
  if v_row.lazywait_sync_state <> 'syncing' then
    return 'invalid_state';
  end if;

  -- The send phase is single-entry. If the marker is already stamped, only the
  -- SAME token may proceed (idempotent RPC retry); a different token means a
  -- concurrent attempt already owns the send phase.
  if v_row.pos_create_attempted_at is not null then
    if v_row.pos_create_attempt_token is not distinct from p_attempt_token then
      return 'ready_to_send';
    end if;
    return 'invalid_state';
  end if;

  -- Absolute 10-minute deadline. It is REQUIRED (set by the deadline trigger /
  -- backfill for every eligible row) and must not have passed.
  if v_row.pos_sync_deadline_at is null then
    return 'invalid_state';
  end if;
  if now() >= v_row.pos_sync_deadline_at then
    return 'deadline_expired';
  end if;

  -- Durably commit the phase marker + fencing token BEFORE the caller sends.
  update public.orders
     set pos_create_attempted_at  = now(),
         pos_create_attempt_token = p_attempt_token,
         updated_at               = now()
   where id = p_order_id;

  return 'ready_to_send';
end $$;

revoke all on function public.begin_lazywait_create_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_lazywait_create_attempt(uuid, text) to service_role;

-- ---- 6. record_lazywait_sync (new columns + deduped notification) ----------
-- Redefined with two additions:
--   * persists the new lifecycle columns when present in p_patch
--     (first_pos_sync_failure_at, pos_confirmation_reason, pos_create_attempted_at);
--   * an optional p_notify_status: when non-null, atomically enqueues ONE
--     deduplicated pos_sync notification row (insert-first, ON CONFLICT DO
--     NOTHING against the per-(order,status) unique index) in the SAME
--     transaction as the state change, so a transition and its customer
--     notification can never diverge.
-- Signature changes, so drop the old function first to avoid overload ambiguity.
drop function if exists public.record_lazywait_sync(uuid, jsonb, text, text, jsonb, jsonb, text);
create or replace function public.record_lazywait_sync(
  p_order_id     uuid,
  p_patch        jsonb,
  p_log_status   text default 'success',   -- success | failed | skipped
  p_direction    text default 'push',
  p_request      jsonb default null,
  p_response     jsonb default null,
  p_error        text  default null,
  p_notify_status text default null         -- pos_retrying|pos_confirmed|pos_confirmation_required|pos_failed
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text := p_patch->>'lazywait_sync_state';
  v_new_state text;
  v_new_ref   text;
begin
  update public.orders set
    lazywait_sync_state   = coalesce(v_state, lazywait_sync_state),
    lazywait_ref          = coalesce(p_patch->>'lazywait_ref', lazywait_ref),
    lazywait_order_id     = coalesce(p_patch->>'lazywait_order_id', lazywait_order_id),
    lazywait_order_number = coalesce(p_patch->>'lazywait_order_number', lazywait_order_number),
    lazywait_status       = coalesce(p_patch->>'lazywait_status', lazywait_status),
    sync_attempt_count    = coalesce((p_patch->>'sync_attempt_count')::int, sync_attempt_count),
    sync_next_attempt_at  = case when p_patch ? 'sync_next_attempt_at'
                                 then nullif(p_patch->>'sync_next_attempt_at','')::timestamptz
                                 else sync_next_attempt_at end,
    sync_last_error       = case when p_patch ? 'sync_last_error'
                                 then p_patch->>'sync_last_error' else sync_last_error end,
    sync_blocked_reason   = case when p_patch ? 'sync_blocked_reason'
                                 then p_patch->>'sync_blocked_reason' else sync_blocked_reason end,
    synced_at             = case when p_patch ? 'synced_at'
                                 then nullif(p_patch->>'synced_at','')::timestamptz else synced_at end,
    first_pos_sync_failure_at = case when p_patch ? 'first_pos_sync_failure_at'
                                 then nullif(p_patch->>'first_pos_sync_failure_at','')::timestamptz
                                 else first_pos_sync_failure_at end,
    pos_create_attempted_at   = case when p_patch ? 'pos_create_attempted_at'
                                 then nullif(p_patch->>'pos_create_attempted_at','')::timestamptz
                                 else pos_create_attempted_at end,
    pos_confirmation_reason   = case when p_patch ? 'pos_confirmation_reason'
                                 then p_patch->>'pos_confirmation_reason' else pos_confirmation_reason end,
    sync_status           = case
        when v_state = 'synced'  then 'synced'::public.sync_status
        when v_state = 'syncing' then 'syncing'::public.sync_status
        when v_state in ('failed','dead_letter','blocked','confirmation_required') then 'failed'::public.sync_status
        when v_state in ('pending','skipped') then 'not_synced'::public.sync_status
        else sync_status end,
    updated_at = now()
  where id = p_order_id
  returning lazywait_sync_state, lazywait_ref into v_new_state, v_new_ref;

  insert into public.integration_sync_logs (provider, order_id, direction, status, request, response, error)
    values ('lazywait', p_order_id, p_direction, p_log_status, p_request, p_response, p_error);

  -- Deduplicated customer notification event (idempotent per order+status).
  -- Enqueued as 'pending' (awaiting dispatch): the unique (order_id,status) index
  -- guarantees the event is recorded at most once, and 'pending' is the only
  -- state a dispatcher may atomically claim (see claim_pos_sync_notification),
  -- so the push fires at most once even under concurrent dispatch. push-dispatch
  -- stays master-flag gated (disabled); this only records the event.
  --
  -- PRODUCER-SIDE DEFENSE IN DEPTH: a 'pos_confirmed' event is enqueued ONLY when
  -- the AUTHORITATIVE post-update row (captured via RETURNING, same transaction)
  -- is 'synced' with a USABLE ref. This does not merely rely on push-dispatch to
  -- supersede an invalid event at send-time: an invalid pos_confirmed row would
  -- become a TERMINAL 'superseded' entry that, via the per-(order,status) unique
  -- index, would then BLOCK a later legitimate confirmation. Suppressing it here
  -- keeps that slot free so a subsequent unusable->usable correction can still
  -- enqueue the real confirmation. Non-confirmed statuses are unaffected.
  if p_notify_status is not null
     and (p_notify_status <> 'pos_confirmed'
          or (v_new_state = 'synced' and public.lazywait_pos_ref_is_usable(v_new_ref))) then
    insert into public.notification_log (kind, order_id, status, send_status)
      values ('pos_sync', p_order_id, p_notify_status, 'pending')
      on conflict do nothing;
  end if;
end $$;

revoke all on function public.record_lazywait_sync(uuid, jsonb, text, text, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.record_lazywait_sync(uuid, jsonb, text, text, jsonb, jsonb, text, text) to service_role;

-- ---- 6b. pos_next_attempt_at(): fixed retry schedule -----------------------
-- Attempt N (1-based) is scheduled at started_at + offset[N] minutes, where the
-- offsets are [0, 1, 3, 6, 9] — five attempts, all inside a 10-minute window.
-- The SQL reaper and the TS worker share this exact schedule (helpers mirror it).
-- Immutable + no table access, so it is safe to call inside the reaper's UPDATE.
create or replace function public.pos_next_attempt_at(
  p_started_at timestamptz,
  p_attempt    integer      -- the attempt we are ABOUT to schedule (1-based)
)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select case
    when p_started_at is null then now()
    when p_attempt <= 1 then p_started_at
    when p_attempt = 2  then p_started_at + interval '1 minute'
    when p_attempt = 3  then p_started_at + interval '3 minutes'
    when p_attempt = 4  then p_started_at + interval '6 minutes'
    else                     p_started_at + interval '9 minutes'
  end;
$$;

revoke all on function public.pos_next_attempt_at(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.pos_next_attempt_at(timestamptz, integer) to service_role;

-- ---- 7. Stale reaper (phase-marker-aware + deadline sweep) ------------------
-- Replaces the previous "requeue every ref-less stale row" behaviour, which
-- could blindly resend an order the dead worker had ALREADY POSTed. Now:
--   (a) stale 'syncing' + USABLE ref          -> 'synced' (never re-POST);
--   (a2) stale 'syncing' + non-null UNUSABLE ref marker
--                                             -> 'confirmation_required';
--   (b) stale 'syncing', no ref, marker SET   -> 'confirmation_required'
--       (the worker may have sent it; verifying beats risking a duplicate);
--   (c) stale 'syncing', no ref, marker NULL  -> proven not sent: safe requeue
--       to 'failed' within the schedule/deadline budget, else 'dead_letter';
--   (d) past-deadline 'pending'/'failed'      -> 'dead_letter' (budget expired;
--       these states are only ever reached via proven-not-sent paths, so this
--       is a known non-delivery, not an ambiguous one).
-- Branch (a) applies ONLY to a USABLE ref (canonical helper); a NON-NULL but
-- UNUSABLE stored marker takes branch (a2) -> 'confirmation_required' (ref
-- preserved as evidence, never resent, surfaced to the admin verification feed).
-- Every reaped row writes an integration_sync_logs row; (a2)/(b)/(c-dead)/(d)
-- also enqueue the matching deduplicated pos_sync notification.
create or replace function public.reap_stale_lazywait_syncs(
  p_timeout_minutes integer default 10,
  p_max_attempts    integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes integer := greatest(1, coalesce(p_timeout_minutes, 10));
  v_cutoff  timestamptz := now() - make_interval(mins => v_minutes);
  v_max     integer := greatest(1, coalesce(p_max_attempts, 5));
  v_recovered_synced      integer := 0;
  v_requeued              integer := 0;
  v_dead_lettered         integer := 0;
  v_confirmation_required integer := 0;  -- sum of (a2) unusable-marker + (b) may-have-sent
  v_deadline_failed       integer := 0;
  v_rows                  integer := 0;
begin
  -- (a) WITH a USABLE ref -> synced. Create Order provably succeeded; NEVER
  --     re-POST. Only the canonical usable-ref test may finalize a recovery as
  --     customer-confirmed — a merely-STORED marker (blank/whitespace/malformed)
  --     is handled by branch (a2) below, mutually exclusive with this one. If the
  --     order had a PRIOR failure (first_pos_sync_failure_at set — the customer
  --     may have already seen a retrying/verifying message), enqueue the deduped
  --     'pos_confirmed' event in the SAME transaction so the "confirmed after a
  --     failure" message closes the lifecycle instead of leaving the customer on
  --     the last failure copy. First-try recoveries (no prior failure) stay silent.
  --     The COUNTED (outer) statement is the 1:1 recovery sync-log insert.
  with recovered as (
    update public.orders o
       set lazywait_sync_state = 'synced',
           synced_at           = coalesce(o.synced_at, now()),
           sync_last_error     = null,
           sync_status         = 'synced'::public.sync_status,
           updated_at          = now()
     where o.lazywait_sync_state = 'syncing'
       and o.updated_at < v_cutoff
       and public.lazywait_pos_ref_is_usable(o.lazywait_ref)
     returning o.id, o.first_pos_sync_failure_at as first_failure
  ), notified_confirmed as (
    insert into public.notification_log (kind, order_id, status, send_status)
      select 'pos_sync', id, 'pos_confirmed', 'pending' from recovered
       where first_failure is not null
      on conflict do nothing
      returning 1
  )
  insert into public.integration_sync_logs (provider, order_id, direction, status, error)
    select 'lazywait', id, 'push', 'success', 'recovered_stale_syncing_with_ref' from recovered;
  get diagnostics v_recovered_synced = row_count;

  -- (a2) WITH a NON-NULL but UNUSABLE ref marker -> confirmation_required. The
  --     stored value (empty / ASCII- or Unicode-whitespace / BOM / malformed)
  --     blocks any automatic resend (a response of SOME kind came back, so the
  --     ticket may exist) but proves nothing — the row must NOT be finalized as
  --     'synced', or it becomes an operational orphan: no pos_confirmed, no
  --     verification-feed entry, and a falsely-green sync_status. Route it to
  --     manual verification instead: the suspicious ref is PRESERVED exactly as
  --     evidence (not touched by this UPDATE), no synced_at is stamped, retry
  --     scheduling is cleared (never auto-retried), and the deduped
  --     'pos_confirmation_required' event tells the customer "verifying" — never
  --     "confirmed". Surfaces automatically in list_pos_confirmation_required via
  --     the state change alone. Mutually exclusive with (a): usable vs not.
  --     The COUNTED (outer) statement is the 1:1 failed sync-log insert.
  with marker_unverified as (
    update public.orders o
       set lazywait_sync_state       = 'confirmation_required',
           first_pos_sync_failure_at = coalesce(o.first_pos_sync_failure_at, now()),
           pos_confirmation_reason   = coalesce(o.pos_confirmation_reason, 'missing_ref'),
           sync_next_attempt_at      = null,
           sync_last_error           = 'stale_syncing_ref_present_unverified',
           sync_status               = 'failed'::public.sync_status,
           updated_at                = now()
     where o.lazywait_sync_state = 'syncing'
       and o.updated_at < v_cutoff
       and o.lazywait_ref is not null
       and not public.lazywait_pos_ref_is_usable(o.lazywait_ref)
     returning o.id
  ), notified_marker as (
    insert into public.notification_log (kind, order_id, status, send_status)
      select 'pos_sync', id, 'pos_confirmation_required', 'pending' from marker_unverified
      on conflict do nothing
      returning 1
  )
  insert into public.integration_sync_logs (provider, order_id, direction, status, error)
    select 'lazywait', id, 'push', 'failed', 'stale_syncing_ref_present_unverified' from marker_unverified;
  get diagnostics v_rows = row_count;
  v_confirmation_required := v_confirmation_required + v_rows;

  -- (b) no ref, marker SET (may have sent) -> confirmation_required. Do NOT
  --     resend: the request could have reached the POS. Human verifies.
  --     The COUNTED (outer) statement is the 1:1 sync-log insert; the deduped
  --     notification runs as a data-modifying CTE so ON CONFLICT skips don't
  --     understate the transition count.
  with ambiguous as (
    update public.orders o
       set lazywait_sync_state       = 'confirmation_required',
           first_pos_sync_failure_at = coalesce(o.first_pos_sync_failure_at, now()),
           pos_confirmation_reason   = coalesce(o.pos_confirmation_reason, 'connection'),
           sync_last_error           = 'stale_syncing_after_send_unverified',
           sync_status               = 'failed'::public.sync_status,
           updated_at                = now()
     where o.lazywait_sync_state = 'syncing'
       and o.updated_at < v_cutoff
       and o.lazywait_ref is null
       and o.pos_create_attempted_at is not null
     returning o.id
  ), notified_amb as (
    insert into public.notification_log (kind, order_id, status, send_status)
      select 'pos_sync', id, 'pos_confirmation_required', 'pending' from ambiguous
      on conflict do nothing
      returning 1
  )
  insert into public.integration_sync_logs (provider, order_id, direction, status, error)
    select 'lazywait', id, 'push', 'failed', 'stale_syncing_after_send_confirmation_required' from ambiguous;
  get diagnostics v_rows = row_count;
  v_confirmation_required := v_confirmation_required + v_rows;

  -- (c) no ref, marker NULL (proven not sent) -> safe requeue within budget,
  --     else dead_letter. The next attempt is anchored to the fixed schedule
  --     and must still fall on/before the absolute deadline.
  with reaped as (
    update public.orders o
       set sync_attempt_count   = o.sync_attempt_count + 1,
           lazywait_sync_state  = case
             when o.sync_attempt_count + 1 >= v_max then 'dead_letter'
             when o.pos_sync_deadline_at is not null
                  and public.pos_next_attempt_at(o.pos_sync_started_at, o.sync_attempt_count + 1)
                      > o.pos_sync_deadline_at then 'dead_letter'
             else 'failed' end,
           sync_next_attempt_at = case
             when o.sync_attempt_count + 1 >= v_max then null
             when o.pos_sync_deadline_at is not null
                  and public.pos_next_attempt_at(o.pos_sync_started_at, o.sync_attempt_count + 1)
                      > o.pos_sync_deadline_at then null
             else public.pos_next_attempt_at(o.pos_sync_started_at, o.sync_attempt_count + 1) end,
           first_pos_sync_failure_at = coalesce(o.first_pos_sync_failure_at, now()),
           sync_last_error      = 'reclaimed_stale_syncing_no_ref',
           sync_status          = 'failed'::public.sync_status,
           updated_at           = now()
     where o.lazywait_sync_state = 'syncing'
       and o.updated_at < v_cutoff
       and o.lazywait_ref is null
       and o.pos_create_attempted_at is null
     returning o.id, o.lazywait_sync_state as new_state
  ), logged as (
    insert into public.integration_sync_logs (provider, order_id, direction, status, error)
      select 'lazywait', id, 'push', 'failed',
             case when new_state = 'dead_letter'
                  then 'stale_syncing_no_ref_dead_letter'
                  else 'stale_syncing_no_ref_requeued' end
        from reaped
      returning 1
  ), notified as (
    insert into public.notification_log (kind, order_id, status, send_status)
      select 'pos_sync', id, 'pos_failed', 'pending' from reaped where new_state = 'dead_letter'
      on conflict do nothing
      returning 1
  )
  select
    count(*) filter (where new_state = 'failed'),
    count(*) filter (where new_state = 'dead_letter')
    into v_requeued, v_dead_lettered
    from reaped;

  -- (d) budget expired while still queued (past deadline, never confirmed) ->
  --     dead_letter. 'pending'/'failed' are only reached via proven-not-sent
  --     paths, so this is a known non-delivery.
  with swept as (
    update public.orders o
       set lazywait_sync_state = 'dead_letter',
           sync_next_attempt_at = null,
           sync_last_error      = 'pos_sync_deadline_exceeded',
           sync_status          = 'failed'::public.sync_status,
           updated_at           = now()
     where o.lazywait_sync_state in ('pending','failed')
       and o.pos_sync_deadline_at is not null
       and o.pos_sync_deadline_at <= now()
     returning o.id
  ), notified_sweep as (
    insert into public.notification_log (kind, order_id, status, send_status)
      select 'pos_sync', id, 'pos_failed', 'pending' from swept
      on conflict do nothing
      returning 1
  )
  insert into public.integration_sync_logs (provider, order_id, direction, status, error)
    select 'lazywait', id, 'push', 'failed', 'pos_sync_deadline_exceeded' from swept;
  get diagnostics v_deadline_failed = row_count;

  return jsonb_build_object(
    'recovered_synced',      v_recovered_synced,
    'requeued',              v_requeued,
    'dead_lettered',         v_dead_lettered,
    'confirmation_required', v_confirmation_required,
    'deadline_failed',       v_deadline_failed,
    'timeout_minutes',       v_minutes
  );
end $$;

revoke all on function public.reap_stale_lazywait_syncs(integer, integer) from public, anon, authenticated;
grant execute on function public.reap_stale_lazywait_syncs(integer, integer) to service_role;

-- ---- 7b. requeue_lazywait_order(): deadline-safe manual retry ----------------
-- REDEFINES the admin "Retry" action to be AUTHORITATIVE and safe. A POS order
-- that has passed its absolute 10-minute deadline (or is otherwise not proven
-- safe to resend) must NOT be requeued into the automatic Create Order pipeline —
-- otherwise the dashboard reports success while the claim RPC rejects the order,
-- the worker never sends it, and the deadline reaper returns it to dead_letter.
-- The prior definition (20260708140000) reset the attempt count and left the
-- expired deadline in place, producing exactly that false success.
--
-- The eligibility rule lives in ONE pure predicate (mirrored by the admin UI to
-- hide the Retry action; the DB stays authoritative). RESEND SAFETY uses the
-- STORED-REF-MARKER test (any non-null lazywait_ref, even blank/malformed),
-- NOT the usable-ref test: if ANY ref is stored, Create Order may already have
-- produced a ticket, so an automatic resend is blocked. A row is requeuable ONLY
-- when it is a proven-safe failure still inside its original budget:
--   delivery                                     -> not_retryable
--   a USABLE ref                                 -> already_synced (proven created; never resend)
--   any OTHER non-null ref marker, OR 'synced' w/o a usable ref
--                                                -> ref_present_unverified (marker present; verify, never resend)
--   state 'confirmation_required'                -> confirmation_required (manual only)
--   phase marker set (Create Order may have left)-> may_have_sent
--   state not in failed/blocked/dead_letter/skipped -> not_retryable
--   attempt count >= 5                           -> attempt_limit_reached
--   past the absolute deadline                    -> deadline_expired
--   else                                          -> requeued
create or replace function public.lazywait_requeue_eligibility(
  p_state         text,
  p_ref           text,
  p_deadline_at   timestamptz,
  p_attempt_count integer,
  p_marker_at     timestamptz,   -- pos_create_attempted_at (may-have-sent marker)
  p_order_type    text
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_order_type = 'delivery' then 'not_retryable'
    -- ANY stored ref marker blocks an automatic resend (do NOT trim here).
    when public.lazywait_pos_ref_is_usable(p_ref) then 'already_synced'
    when p_ref is not null then 'ref_present_unverified'
    when p_state = 'synced' then 'ref_present_unverified'
    when p_state = 'confirmation_required' then 'confirmation_required'
    when p_marker_at is not null then 'may_have_sent'
    when p_state not in ('failed','blocked','dead_letter','skipped') then 'not_retryable'
    when coalesce(p_attempt_count, 0) >= 5 then 'attempt_limit_reached'
    when p_deadline_at is not null and now() >= p_deadline_at then 'deadline_expired'
    else 'requeued'
  end;
$$;

revoke all on function public.lazywait_requeue_eligibility(text, text, timestamptz, integer, timestamptz, text) from public, anon;
grant execute on function public.lazywait_requeue_eligibility(text, text, timestamptz, integer, timestamptz, text) to authenticated;

-- Signature is unchanged (returns the order row) so the existing admin API keeps
-- working; ineligible requeues RAISE with the reason code + a clear internal
-- message, so the dashboard never reports a false success. Row-locked so a
-- concurrent worker claim / admin action cannot bypass the rules. Admin-only.
drop function if exists public.requeue_lazywait_order(uuid);
create or replace function public.requeue_lazywait_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_elig  text;
begin
  if not public.is_admin() then
    raise exception 'Only admins may requeue Lazywait sync' using errcode = '42501';
  end if;

  -- Lock the order row (atomic validation vs. a concurrent worker/admin action).
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found: Order not found' using errcode = 'P0002';
  end if;

  v_elig := public.lazywait_requeue_eligibility(
    v_order.lazywait_sync_state, v_order.lazywait_ref, v_order.pos_sync_deadline_at,
    v_order.sync_attempt_count, v_order.pos_create_attempted_at, v_order.order_type::text);

  if v_elig <> 'requeued' then
    raise exception '%', v_elig || ': ' || case v_elig
      when 'deadline_expired'      then 'Automatic POS retry window has expired. Verify the order manually.'
      when 'confirmation_required' then 'Order needs manual verification; automatic retry is disabled.'
      when 'already_synced'        then 'Order already has a usable POS reference / is synced; never resend.'
      when 'ref_present_unverified' then 'An existing POS reference marker requires manual verification; automatic resend is disabled.'
      when 'may_have_sent'         then 'A Create Order request may already have been sent; verify manually before any resend.'
      when 'attempt_limit_reached' then 'Maximum POS retry attempts reached. Verify the order manually.'
      else                              'Order is not in a safe, retryable state.'
    end
    using errcode = 'P0001';
  end if;

  -- Eligible: move back to a claimable 'pending' NOW. Do NOT reset
  -- pos_sync_started_at / pos_sync_deadline_at (the one-shot deadline trigger
  -- preserves the original window; a never-eligible 'skipped' row that has no
  -- window gets a fresh one from the trigger) or sync_attempt_count.
  update public.orders set
    lazywait_sync_state  = 'pending',
    sync_next_attempt_at = now(),
    sync_last_error      = null,
    sync_blocked_reason  = null,
    sync_status          = 'not_synced'::public.sync_status,
    updated_at           = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end $$;

revoke all on function public.requeue_lazywait_order(uuid) from public, anon;
grant execute on function public.requeue_lazywait_order(uuid) to authenticated;

-- ---- 8. notification_log: allow kind='pos_sync' + dedup index --------------
-- Extend the kind check and add a per-(order,status) unique index scoped to the
-- new kind, mirroring the existing order_status idempotency key. This is the
-- ledger that makes each of the four customer transitions fire AT MOST ONCE.
do $$
begin
  alter table public.notification_log drop constraint if exists notification_log_kind_check;
  alter table public.notification_log add constraint notification_log_kind_check
    check (kind in ('order_status','test','broadcast','pos_sync'));
end $$;

-- Add a 'pending' send_status (awaiting dispatch) — the state a pos_sync event
-- is enqueued in, and the ONLY state a dispatcher may atomically claim — and a
-- 'superseded' TERMINAL no-send state for a stale event whose order has since
-- moved on (defense-in-depth in claim_pos_sync_notification). Neither adds an
-- automatic retry path. 'pending' keeps the worker's dedup enqueue distinct from
-- an in-flight dispatch claim.
do $$
begin
  alter table public.notification_log drop constraint if exists notification_log_send_status_check;
  alter table public.notification_log add constraint notification_log_send_status_check
    check (send_status in ('pending','processing','sent','failed','no_targets','superseded'));
end $$;

-- Per-dispatch lease/fencing token. A dispatcher claims a 'pending' row by
-- writing its token + flipping to 'processing'; every finalize is guarded by the
-- same token, so only the owner may complete or release the send.
alter table public.notification_log add column if not exists claim_token text;

create unique index if not exists notification_log_pos_sync_uq
  on public.notification_log (order_id, status)
  where kind = 'pos_sync';

-- ---- 8b. Fenced pos_sync notification claim / validate / finalize / release --
-- Guarantee AT-MOST-ONCE customer delivery even with concurrent dispatchers,
-- keep the dispatcher a pure CONSUMER (only the lifecycle producers
-- record_lazywait_sync + the stale reaper may CREATE a pos_sync event), and
-- re-validate authoritative order state a FINAL time immediately before the push
-- leaves — LOCKING THE ORDER ROW so the check serializes against a concurrent
-- Lazywait worker, evaluated through one canonical pure predicate so claim-time
-- and send-time rules cannot drift.

-- pos_sync_status_matches(): the ONE canonical pure predicate for "does this
-- lifecycle status still match the order?", evaluated from ALREADY-LOCKED order
-- column values (state / ref / next-attempt / deadline) so the claim-time and
-- send-time rules can NEVER drift. STABLE (references now() for the retry/deadline
-- window), no table access, no secrets/PII. This is the single source of the rules:
--   pos_confirmed             -> synced + a USABLE ref (lazywait_pos_ref_is_usable)
--   pos_confirmation_required -> confirmation_required
--   pos_retrying              -> failed + a FUTURE sync_next_attempt_at + unexpired deadline
--   pos_failed                -> blocked | dead_letter
create or replace function public.pos_sync_status_matches(
  p_status          text,
  p_state           text,
  p_ref             text,
  p_next_attempt_at timestamptz,
  p_deadline_at     timestamptz
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case p_status
    when 'pos_confirmed' then
      -- Customer confirmation requires 'synced' AND a USABLE ref (the canonical
      -- helper trims JS .trim() whitespace incl. Unicode/BOM). A whitespace-only
      -- or otherwise-blank ref is NOT proof of confirmation.
      p_state = 'synced' and public.lazywait_pos_ref_is_usable(p_ref)
    when 'pos_confirmation_required' then
      p_state = 'confirmation_required'
    when 'pos_retrying' then
      p_state = 'failed'
      and p_next_attempt_at is not null and p_next_attempt_at > now()
      and (p_deadline_at is null or now() < p_deadline_at)
    when 'pos_failed' then
      p_state in ('blocked','dead_letter')
    else false
  end;
$$;

revoke all on function public.pos_sync_status_matches(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.pos_sync_status_matches(text, text, text, timestamptz, timestamptz) to service_role;

-- The earlier UNLOCKED helper pos_sync_event_matches_order(uuid,text) is replaced
-- by locked order reads + the pure predicate above, so drop it to keep a SINGLE
-- source of the match rules (no drift, no unlocked read path left behind).
drop function if exists public.pos_sync_event_matches_order(uuid, text);

-- CANONICAL LOCK ORDER for every pos_sync path that needs BOTH rows:
--   orders row  ->  notification_log row
-- This mirrors the lifecycle producer direction (an order's state changes BEFORE
-- its notification event is inserted), so claim/validate never invert against the
-- reaper (which locks orders via UPDATE, then inserts notifications) or against
-- begin_lazywait_create_attempt (orders only). finalize/release lock ONLY the
-- notification row; no path ever locks notification-then-orders.

-- claim_pos_sync_notification(): CONSUME-ONLY atomic claim. It NEVER inserts an
-- event (so push-dispatch can never manufacture a lifecycle transition). Under the
-- canonical lock order (orders FOR UPDATE, then the notification row FOR UPDATE)
-- it evaluates the match against the LOCKED order snapshot and returns:
--   * no order / no row -> 'no_event'   (nothing enqueued; send nothing)
--   * terminal          -> 'duplicate'  (sent/no_targets/failed/superseded)
--   * processing         -> 'in_progress' (owned by another dispatcher)
--   * pending + stale    -> 'superseded' (state no longer matches; terminal no-send)
--   * pending + valid    -> 'claimed'    (flips to 'processing' with the lease token)
-- Service-role only.
create or replace function public.claim_pos_sync_notification(
  p_order_id uuid, p_status text, p_claim_token text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text; v_ref text; v_next timestamptz; v_dead timestamptz;
  v_nid   uuid;
  v_send  text;
begin
  if p_claim_token is null or p_claim_token = '' then
    raise exception 'claim token required' using errcode = '22004';
  end if;

  -- LOCK 1 (canonical): the authoritative order row.
  select lazywait_sync_state, lazywait_ref, sync_next_attempt_at, pos_sync_deadline_at
    into v_state, v_ref, v_next, v_dead
    from public.orders where id = p_order_id
   for update;
  if not found then
    return 'no_event';                                   -- no order (FK) -> no event
  end if;

  -- LOCK 2 (canonical): the EXISTING event row (never create it).
  select id, send_status into v_nid, v_send
    from public.notification_log
   where kind = 'pos_sync' and order_id = p_order_id and status = p_status
   for update;
  if v_nid is null then
    return 'no_event';                                   -- nothing to dispatch
  end if;
  if v_send in ('sent','no_targets','failed','superseded') then
    return 'duplicate';                                  -- terminal no-op
  end if;
  if v_send = 'processing' then
    return 'in_progress';                                -- another owner
  end if;

  -- v_send = 'pending': match against the LOCKED order snapshot (pure predicate).
  if not public.pos_sync_status_matches(p_status, v_state, v_ref, v_next, v_dead) then
    update public.notification_log set send_status = 'superseded', updated_at = now()
     where id = v_nid;
    return 'superseded';                                 -- stale -> terminal no-send
  end if;

  update public.notification_log
     set send_status = 'processing', claim_token = p_claim_token, updated_at = now()
   where id = v_nid;
  return 'claimed';
end $$;

revoke all on function public.claim_pos_sync_notification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_pos_sync_notification(uuid, text, text) to service_role;

-- validate_pos_sync_notification_before_send(): the FINAL, token-fenced
-- authoritative-state re-check the dispatcher MUST pass immediately before the
-- push leaves. The order can transition between the claim and the send (e.g. a
-- concurrent sync worker completes the due retry and moves 'failed' -> 'synced'
-- after a 'pos_retrying' was claimed). To SERIALIZE against that worker this
-- function LOCKS THE ORDER ROW (FOR UPDATE) and evaluates the match against that
-- locked snapshot — the notification token fence alone does not serialize against
-- updates to the orders row. Canonical lock order (orders -> notification_log);
-- no second unlocked orders read is performed. Requires the caller to still OWN a
-- 'processing' claim (exact token). Returns exactly one of:
--   ready_to_send | superseded | lost_claim | not_found
-- On 'superseded' it atomically marks the row terminal 'superseded' (owner-fenced,
-- NO release to pending, no retry path); on lost_claim/not_found it changes nothing
-- (never touches a foreign claim). The caller sends ONLY on 'ready_to_send'.
-- NOTE: a DB transaction cannot span the external Expo call, so a tiny cross-system
-- window remains AFTER this function commits and BEFORE fetch() starts — that gap
-- is unavoidable and is NOT claimed to be atomic. Service-role only.
create or replace function public.validate_pos_sync_notification_before_send(
  p_order_id uuid, p_status text, p_claim_token text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text; v_ref text; v_next timestamptz; v_dead timestamptz;
  v_nid   uuid;
  v_send  text;
  v_token text;
begin
  if p_claim_token is null or p_claim_token = '' then
    raise exception 'claim token required' using errcode = '22004';
  end if;

  -- LOCK 1 (canonical): the authoritative order row — serializes against a
  -- concurrent Lazywait worker updating the SAME order.
  select lazywait_sync_state, lazywait_ref, sync_next_attempt_at, pos_sync_deadline_at
    into v_state, v_ref, v_next, v_dead
    from public.orders where id = p_order_id
   for update;
  if not found then
    return 'not_found';
  end if;

  -- LOCK 2 (canonical): the claimed notification row (owner-fenced).
  select id, send_status, claim_token into v_nid, v_send, v_token
    from public.notification_log
   where kind = 'pos_sync' and order_id = p_order_id and status = p_status
   for update;
  if v_nid is null then
    return 'not_found';
  end if;
  -- Must still be OUR live claim. A non-processing row, or a different (or null)
  -- token, means we no longer own the send — never mutate a foreign claim.
  if v_send <> 'processing' or v_token is distinct from p_claim_token then
    return 'lost_claim';
  end if;

  -- Match against the LOCKED order snapshot (pure predicate; no second read).
  if not public.pos_sync_status_matches(p_status, v_state, v_ref, v_next, v_dead) then
    update public.notification_log set send_status = 'superseded', updated_at = now()
     where id = v_nid and send_status = 'processing' and claim_token = p_claim_token;
    return 'superseded';
  end if;

  return 'ready_to_send';
end $$;

revoke all on function public.validate_pos_sync_notification_before_send(uuid, text, text) from public, anon, authenticated;
grant execute on function public.validate_pos_sync_notification_before_send(uuid, text, text) to service_role;

create or replace function public.finalize_pos_sync_notification(
  p_order_id uuid, p_status text, p_claim_token text, p_send_status text,
  p_targeted integer default 0, p_sent integer default 0,
  p_failed integer default 0, p_deactivated integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_send_status not in ('sent','no_targets','failed') then
    raise exception 'invalid final send_status %', p_send_status;
  end if;
  -- Only the owning, still-processing claim may finalize (token-fenced).
  update public.notification_log
     set send_status = p_send_status,
         targeted = p_targeted, sent = p_sent, failed = p_failed, deactivated = p_deactivated,
         updated_at = now()
   where kind = 'pos_sync' and order_id = p_order_id and status = p_status
     and send_status = 'processing' and claim_token = p_claim_token
   returning id into v_id;
  return v_id is not null;
end $$;

revoke all on function public.finalize_pos_sync_notification(uuid, text, text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.finalize_pos_sync_notification(uuid, text, text, text, integer, integer, integer, integer) to service_role;

create or replace function public.release_pos_sync_notification(
  p_order_id uuid, p_status text, p_claim_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  -- Proven pre-send failure only: return the owned claim to 'pending' so a later
  -- dispatch can safely retry. Owner-fenced; never touches a foreign claim.
  update public.notification_log
     set send_status = 'pending', claim_token = null, updated_at = now()
   where kind = 'pos_sync' and order_id = p_order_id and status = p_status
     and send_status = 'processing' and claim_token = p_claim_token
   returning id into v_id;
  return v_id is not null;
end $$;

revoke all on function public.release_pos_sync_notification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.release_pos_sync_notification(uuid, text, text) to service_role;

-- ---- 9. Admin dashboard RPC: Orders Requiring Verification ------------------
-- Read-only feed for the admin side card. Returns a total count (for the badge)
-- plus the oldest N confirmation_required orders with ONLY safe fields — no
-- phone, no secrets, no raw provider bodies, no payment references. Admin-gated
-- (is_admin()) and SECURITY DEFINER, matching the existing admin RPC pattern.
drop function if exists public.list_pos_confirmation_required(integer);
create or replace function public.list_pos_confirmation_required(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_items jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins may view orders requiring verification' using errcode = '42501';
  end if;

  select count(*) into v_total
    from public.orders
   where lazywait_sync_state = 'confirmation_required';

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_items from (
    select
      o.id,
      o.order_number,
      o.order_type,
      o.total,
      o.created_at,
      o.pos_sync_started_at,
      o.first_pos_sync_failure_at,
      coalesce(o.pos_confirmation_reason, 'ambiguous_response') as reason
    from public.orders o
    where o.lazywait_sync_state = 'confirmation_required'
    order by coalesce(o.first_pos_sync_failure_at, o.created_at) asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) t;

  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;

revoke all on function public.list_pos_confirmation_required(integer) from public, anon;
grant execute on function public.list_pos_confirmation_required(integer) to authenticated;

-- ---- 10. Partial indexes ---------------------------------------------------
-- Deadline-bounded retry queue: the claim predicate now also filters on the
-- deadline, so index the due, in-budget rows.
create index if not exists orders_lazywait_deadline_queue_idx
  on public.orders (sync_next_attempt_at)
  where lazywait_sync_state in ('pending','failed');

-- Dashboard "Orders Requiring Verification": oldest-first, small result set.
create index if not exists orders_lazywait_confirmation_required_idx
  on public.orders (first_pos_sync_failure_at, created_at)
  where lazywait_sync_state = 'confirmation_required';
