-- ============================================================================
-- Reaper behaviour test for reap_stale_lazywait_syncs().
--
-- Runs against a throwaway Postgres with all migrations applied (see
-- docs/LAZYWAIT.md / the verification harness). Each case RAISES EXCEPTION on
-- failure, so the whole script aborts non-zero if any assertion fails; a clean
-- run prints the NOTICEs and commits nothing (wrapped in a rollback).
--
-- Covers the customer-confirmation-safe reaper contract (migration
-- 20260721120000):
--   1. 'syncing' younger than the timeout is NOT reclaimed.
--   2. 'synced' is NEVER reclaimed.
--   3. Stale WITH a ref -> 'synced' (NEVER re-POST — no idempotency key).
--   4. Stale WITHOUT a ref, phase marker SET (worker may have sent) ->
--      'confirmation_required' (NEVER auto-retry) + a deduped notification.
--   5. Stale WITHOUT a ref, phase marker NULL (proven not sent) -> safe requeue
--      to 'failed' on the fixed schedule, within the deadline.
--   6. Attempt ceiling -> 'dead_letter' (no infinite retry).
-- ============================================================================
begin;

set local session_replication_role = replica;  -- skip triggers/FKs for fixtures

do $$
declare
  v_young   uuid := gen_random_uuid();
  v_synced  uuid := gen_random_uuid();
  v_withref uuid := gen_random_uuid();
  v_reffail uuid := gen_random_uuid();
  v_amb     uuid := gen_random_uuid();
  v_safe    uuid := gen_random_uuid();
  v_maxed   uuid := gen_random_uuid();
  v_res jsonb;
  v_state text;
  v_attempts int;
  v_next timestamptz;
begin
  -- Seed rows directly in the states we want, backdating updated_at (the lease
  -- clock) as needed. pos_sync_started_at/deadline give an in-budget window;
  -- pos_create_attempted_at is the "may-have-sent" phase marker.
  insert into public.orders
    (id, order_number, branch_id, order_type, subtotal, total,
     lazywait_sync_state, lazywait_ref, pos_create_attempted_at,
     pos_sync_started_at, pos_sync_deadline_at, sync_attempt_count, updated_at,
     first_pos_sync_failure_at) values
    (v_young,  'R-1', gen_random_uuid(), 'pickup', 10, 10, 'syncing', null,       null,      now()-interval '1m', now()+interval '9m', 0, now()-interval '2 minutes', null),
    (v_synced, 'R-2', gen_random_uuid(), 'pickup', 10, 10, 'synced',  'REF_DONE', null,      now()-interval '5m', now()+interval '5m', 0, now()-interval '30 minutes', null),
    (v_withref,'R-3', gen_random_uuid(), 'pickup', 10, 10, 'syncing', 'REF_LOST', now()-interval '25m', now()-interval '5m', now()+interval '5m', 2, now()-interval '30 minutes', null),
    (v_reffail,'R-7', gen_random_uuid(), 'pickup', 10, 10, 'syncing', 'REF_RECOV', now()-interval '25m', now()-interval '5m', now()+interval '5m', 2, now()-interval '30 minutes', now()-interval '4 minutes'),
    (v_amb,    'R-4', gen_random_uuid(), 'pickup', 10, 10, 'syncing', null,       now()-interval '25m', now()-interval '5m', now()+interval '5m', 1, now()-interval '30 minutes', null),
    (v_safe,   'R-5', gen_random_uuid(), 'pickup', 10, 10, 'syncing', null,       null,      now()-interval '2m', now()+interval '8m', 1, now()-interval '30 minutes', null),
    (v_maxed,  'R-6', gen_random_uuid(), 'pickup', 10, 10, 'syncing', null,       null,      now()-interval '5m', now()+interval '5m', 4, now()-interval '30 minutes', null);

  -- Run the reaper with a 10-minute lease and the 5-attempt ceiling.
  v_res := public.reap_stale_lazywait_syncs(10, 5);
  raise notice 'reaper summary: %', v_res;

  -- Case 1: young 'syncing' NOT reclaimed.
  select lazywait_sync_state into v_state from public.orders where id = v_young;
  if v_state <> 'syncing' then raise exception 'CASE 1 FAILED: young syncing reclaimed -> %', v_state; end if;

  -- Case 2: 'synced' untouched.
  select lazywait_sync_state into v_state from public.orders where id = v_synced;
  if v_state <> 'synced' then raise exception 'CASE 2 FAILED: synced reclaimed -> %', v_state; end if;

  -- Case 3: stale WITH ref recovered to 'synced', ref NOT mutated (no re-POST).
  --         No prior failure -> NO pos_confirmed push (first-try recovery is silent).
  select lazywait_sync_state into v_state from public.orders where id = v_withref;
  if v_state <> 'synced' then raise exception 'CASE 3 FAILED: stale-with-ref not recovered -> %', v_state; end if;
  if (select lazywait_ref from public.orders where id = v_withref) <> 'REF_LOST' then
    raise exception 'CASE 3 FAILED: ref was mutated'; end if;
  if (select count(*) from public.notification_log
        where order_id = v_withref and kind = 'pos_sync') <> 0 then
    raise exception 'CASE 3 FAILED: pos_confirmed enqueued without a prior failure'; end if;

  -- Case 3b: stale WITH ref AND a prior failure -> 'synced' + exactly one deduped
  --          'pos_confirmed' (pending) so the customer's retrying/verifying message
  --          is closed. Ref/metadata preserved; never re-POST.
  select lazywait_sync_state into v_state from public.orders where id = v_reffail;
  if v_state <> 'synced' then raise exception 'CASE 3b FAILED: ref+failure not recovered -> %', v_state; end if;
  if (select lazywait_ref from public.orders where id = v_reffail) <> 'REF_RECOV' then
    raise exception 'CASE 3b FAILED: ref mutated'; end if;
  if (select count(*) from public.notification_log
        where order_id = v_reffail and kind = 'pos_sync' and status = 'pos_confirmed' and send_status = 'pending') <> 1 then
    raise exception 'CASE 3b FAILED: expected exactly one pending pos_confirmed event'; end if;

  -- Case 4: stale no-ref, marker SET -> confirmation_required (never auto-retry)
  --         + exactly one deduped pos_sync notification.
  select lazywait_sync_state into v_state from public.orders where id = v_amb;
  if v_state <> 'confirmation_required' then
    raise exception 'CASE 4 FAILED: may-have-sent not routed to confirmation_required -> %', v_state; end if;
  if (select count(*) from public.notification_log
        where order_id = v_amb and kind = 'pos_sync' and status = 'pos_confirmation_required') <> 1 then
    raise exception 'CASE 4 FAILED: missing/duplicate confirmation_required notification'; end if;

  -- Case 5: stale no-ref, marker NULL -> requeue to 'failed', attempt++, next on
  --         the fixed schedule (started + 1 minute for attempt 1 -> 2), <= deadline.
  select lazywait_sync_state, sync_attempt_count, sync_next_attempt_at
    into v_state, v_attempts, v_next from public.orders where id = v_safe;
  if v_state <> 'failed' then raise exception 'CASE 5 FAILED: proven-not-sent not requeued -> %', v_state; end if;
  if v_attempts <> 2 then raise exception 'CASE 5 FAILED: attempt not incremented -> %', v_attempts; end if;
  if v_next is null then raise exception 'CASE 5 FAILED: no next attempt scheduled'; end if;
  if v_next <> (select pos_sync_started_at + interval '1 minute' from public.orders where id = v_safe) then
    raise exception 'CASE 5 FAILED: next attempt off the fixed schedule -> %', v_next; end if;

  -- Case 6: attempt 4 -> 5 hits the ceiling -> dead_letter, off the queue.
  select lazywait_sync_state, sync_next_attempt_at into v_state, v_next
    from public.orders where id = v_maxed;
  if v_state <> 'dead_letter' then raise exception 'CASE 6 FAILED: maxed not dead-lettered -> %', v_state; end if;
  if v_next is not null then raise exception 'CASE 6 FAILED: dead_letter still scheduled -> %', v_next; end if;

  -- Summary counts: 2 recovered (ref, ref+failure), 1 confirmation_required,
  -- 1 requeued, 1 dead-lettered.
  if (v_res->>'recovered_synced')::int <> 2
     or (v_res->>'confirmation_required')::int <> 1
     or (v_res->>'requeued')::int <> 1
     or (v_res->>'dead_lettered')::int <> 1 then
    raise exception 'SUMMARY FAILED: %', v_res;
  end if;

  -- Idempotency: a second reap leaves no stale 'syncing' rows to touch, and does
  -- NOT enqueue a duplicate pos_confirmed for the already-recovered order.
  v_res := public.reap_stale_lazywait_syncs(10, 5);
  if (v_res->>'recovered_synced')::int <> 0
     or (v_res->>'confirmation_required')::int <> 0
     or (v_res->>'requeued')::int <> 0
     or (v_res->>'dead_lettered')::int <> 0 then
    raise exception 'IDEMPOTENCY FAILED: second reap changed rows: %', v_res;
  end if;
  if (select count(*) from public.notification_log
        where order_id = v_reffail and kind = 'pos_sync' and status = 'pos_confirmed') <> 1 then
    raise exception 'IDEMPOTENCY FAILED: duplicate pos_confirmed after second reap'; end if;

  -- Recovery is logged for Admin visibility (one row per reaped order): two
  -- ref recoveries + confirmation_required + requeued + dead_letter = 5.
  if (select count(*) from public.integration_sync_logs
        where provider = 'lazywait'
          and error in ('recovered_stale_syncing_with_ref',
                        'stale_syncing_after_send_confirmation_required',
                        'stale_syncing_no_ref_requeued',
                        'stale_syncing_no_ref_dead_letter')) <> 5 then
    raise exception 'LOGGING FAILED: expected 5 recovery log rows';
  end if;

  raise notice 'ALL REAPER CASES PASSED';
end $$;

rollback;
