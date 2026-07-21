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
--   3. Stale WITH a USABLE ref -> 'synced' (NEVER re-POST — no idempotency key);
--      pos_confirmed only after a prior failure. A padded real ref is usable.
--  3c. Stale with a NON-NULL but UNUSABLE ref marker (empty / spaces / tab+
--      newline / Unicode NBSP+BOM) -> 'confirmation_required', sync_status
--      'failed', ref PRESERVED as evidence, exactly one deduped
--      pos_confirmation_required, zero pos_confirmed, retry scheduling cleared,
--      surfaced in list_pos_confirmation_required. Never 'synced'.
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
  v_wsref   uuid := gen_random_uuid();  -- spaces-only ref marker
  v_empref  uuid := gen_random_uuid();  -- empty-string ref marker
  v_tabref  uuid := gen_random_uuid();  -- tab+newline ref marker
  v_uniref  uuid := gen_random_uuid();  -- Unicode NBSP+BOM ref marker
  v_padref  uuid := gen_random_uuid();  -- padded REAL ref (usable)
  v_amb     uuid := gen_random_uuid();
  v_safe    uuid := gen_random_uuid();
  v_maxed   uuid := gen_random_uuid();
  v_res jsonb;
  v_state text;
  v_sync  public.sync_status;
  v_ref   text;
  v_attempts int;
  v_next timestamptz;
  v_feed jsonb;
  m uuid;
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
    (v_wsref,  'R-8', gen_random_uuid(), 'pickup', 10, 10, 'syncing', '   ',       now()-interval '25m', now()-interval '5m', now()+interval '5m', 2, now()-interval '30 minutes', now()-interval '4 minutes'),
    (v_empref, 'R-9', gen_random_uuid(), 'pickup', 10, 10, 'syncing', '',          null,                 now()-interval '5m', now()+interval '5m', 1, now()-interval '30 minutes', null),
    (v_tabref, 'R-10',gen_random_uuid(), 'pickup', 10, 10, 'syncing', chr(9)||chr(10), null,             now()-interval '5m', now()+interval '5m', 1, now()-interval '30 minutes', null),
    (v_uniref, 'R-11',gen_random_uuid(), 'pickup', 10, 10, 'syncing', chr(160)||chr(65279), null,        now()-interval '5m', now()+interval '5m', 1, now()-interval '30 minutes', null),
    (v_padref, 'R-12',gen_random_uuid(), 'pickup', 10, 10, 'syncing', '  REF_PAD '||chr(12288), null,    now()-interval '5m', now()+interval '5m', 1, now()-interval '30 minutes', null),
    (v_amb,    'R-4', gen_random_uuid(), 'pickup', 10, 10, 'syncing', null,       now()-interval '25m', now()-interval '5m', now()+interval '5m', 1, now()-interval '30 minutes', null),
    (v_safe,   'R-5', gen_random_uuid(), 'pickup', 10, 10, 'syncing', null,       null,      now()-interval '2m', now()+interval '8m', 1, now()-interval '30 minutes', null),
    (v_maxed,  'R-6', gen_random_uuid(), 'pickup', 10, 10, 'syncing', null,       null,      now()-interval '5m', now()+interval '5m', 4, now()-interval '30 minutes', null);

  -- Give one unusable-marker row a live retry schedule so the reaper's clearing
  -- of automatic scheduling is actually exercised (not vacuously null).
  update public.orders set sync_next_attempt_at = now() + interval '2 minutes' where id = v_empref;

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

  -- Case 3c: stale with a NON-NULL but UNUSABLE ref marker (spaces / empty /
  --          tab+newline / Unicode NBSP+BOM) -> 'confirmation_required' with
  --          sync_status 'failed', the suspicious ref PRESERVED exactly as
  --          evidence, NO new synced_at, retry scheduling cleared, exactly ONE
  --          deduped pos_confirmation_required, and ZERO pos_confirmed. The row
  --          must NEVER be finalized 'synced' (that would orphan it: blocked
  --          from resend but invisible to the verification feed).
  for m in select unnest(array[v_wsref, v_empref, v_tabref, v_uniref]) loop
    select lazywait_sync_state, sync_status, lazywait_ref
      into v_state, v_sync, v_ref from public.orders where id = m;
    if v_state <> 'confirmation_required' then
      raise exception 'CASE 3c FAILED (%): unusable marker not confirmation_required -> %', m, v_state; end if;
    if v_sync <> 'failed' then
      raise exception 'CASE 3c FAILED (%): sync_status not failed -> %', m, v_sync; end if;
    if v_ref is null then
      raise exception 'CASE 3c FAILED (%): suspicious ref not preserved', m; end if;
    if (select synced_at from public.orders where id = m) is not null then
      raise exception 'CASE 3c FAILED (%): synced_at stamped for unverified marker', m; end if;
    if (select sync_next_attempt_at from public.orders where id = m) is not null then
      raise exception 'CASE 3c FAILED (%): retry still scheduled', m; end if;
    if (select first_pos_sync_failure_at from public.orders where id = m) is null then
      raise exception 'CASE 3c FAILED (%): first failure not stamped', m; end if;
    if (select count(*) from public.notification_log
          where order_id = m and kind = 'pos_sync' and status = 'pos_confirmation_required' and send_status = 'pending') <> 1 then
      raise exception 'CASE 3c FAILED (%): expected exactly one pos_confirmation_required', m; end if;
    if (select count(*) from public.notification_log
          where order_id = m and kind = 'pos_sync' and status = 'pos_confirmed') <> 0 then
      raise exception 'CASE 3c FAILED (%): pos_confirmed enqueued for an unusable marker', m; end if;
  end loop;
  -- Ref content preserved byte-for-byte (spaces case) + reason defaulted.
  if (select lazywait_ref from public.orders where id = v_wsref) <> '   ' then
    raise exception 'CASE 3c FAILED: whitespace ref mutated'; end if;
  if (select pos_confirmation_reason from public.orders where id = v_wsref) <> 'missing_ref' then
    raise exception 'CASE 3c FAILED: confirmation reason not missing_ref'; end if;

  -- Case 3d: a PADDED real ref is USABLE -> normal recovery to 'synced' (with a
  --          pos_confirmed only if a prior failure existed; none here).
  select lazywait_sync_state, sync_status into v_state, v_sync from public.orders where id = v_padref;
  if v_state <> 'synced' or v_sync <> 'synced' then
    raise exception 'CASE 3d FAILED: padded usable ref not recovered -> % / %', v_state, v_sync; end if;
  if (select count(*) from public.notification_log where order_id = v_padref and kind = 'pos_sync') <> 0 then
    raise exception 'CASE 3d FAILED: unexpected notification for first-try padded recovery'; end if;

  -- Case 3e: verification feed — the unusable-marker order IS surfaced by
  --          list_pos_confirmation_required via the state change alone; a
  --          usable-ref recovered order is NOT.
  perform set_config('test.is_admin', 'true', true);
  v_feed := public.list_pos_confirmation_required(100);
  if not exists (select 1 from jsonb_array_elements(v_feed->'items') it
                  where (it->>'id')::uuid = v_wsref) then
    raise exception 'CASE 3e FAILED: unusable-marker order missing from verification feed'; end if;
  if exists (select 1 from jsonb_array_elements(v_feed->'items') it
              where (it->>'id')::uuid in (v_withref, v_reffail, v_padref)) then
    raise exception 'CASE 3e FAILED: usable-ref recovered order leaked into the feed'; end if;

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

  -- Summary counts: recovered_synced counts ONLY usable refs (REF_LOST,
  -- REF_RECOV, padded) = 3; confirmation_required includes the 4 unusable
  -- stored markers + the may-have-sent row = 5; 1 requeued; 1 dead-lettered.
  if (v_res->>'recovered_synced')::int <> 3
     or (v_res->>'confirmation_required')::int <> 5
     or (v_res->>'requeued')::int <> 1
     or (v_res->>'dead_lettered')::int <> 1 then
    raise exception 'SUMMARY FAILED: %', v_res;
  end if;

  -- Idempotency: a second reap leaves no stale 'syncing' rows to touch (the
  -- unusable markers are now 'confirmation_required', so neither branch matches
  -- them again), and enqueues no duplicate notifications.
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
  if (select count(*) from public.notification_log
        where order_id in (v_wsref, v_empref, v_tabref, v_uniref) and kind = 'pos_sync') <> 4 then
    raise exception 'IDEMPOTENCY FAILED: duplicate marker notification after second reap'; end if;
  if (select lazywait_sync_state from public.orders where id = v_wsref) <> 'confirmation_required' then
    raise exception 'IDEMPOTENCY FAILED: marker row transitioned again'; end if;

  -- No resend path was introduced: every ref-bearing fixture kept its exact ref
  -- and none returned to a claimable automatic-retry state.
  if (select count(*) from public.orders
        where id in (v_withref, v_reffail, v_padref, v_wsref, v_empref, v_tabref, v_uniref)
          and lazywait_sync_state in ('pending','failed')) <> 0 then
    raise exception 'RESEND GUARD FAILED: a ref-bearing row re-entered the retry pipeline'; end if;

  -- Recovery is logged for Admin visibility (one row per reaped order): three
  -- usable-ref recoveries + 4 unusable-marker verifications + may-have-sent +
  -- requeued + dead_letter = 10.
  if (select count(*) from public.integration_sync_logs
        where provider = 'lazywait'
          and error in ('recovered_stale_syncing_with_ref',
                        'stale_syncing_ref_present_unverified',
                        'stale_syncing_after_send_confirmation_required',
                        'stale_syncing_no_ref_requeued',
                        'stale_syncing_no_ref_dead_letter')) <> 10 then
    raise exception 'LOGGING FAILED: expected 10 recovery log rows';
  end if;
  if (select count(*) from public.integration_sync_logs
        where provider = 'lazywait' and error = 'stale_syncing_ref_present_unverified'
          and status = 'failed') <> 4 then
    raise exception 'LOGGING FAILED: expected 4 failed unusable-marker log rows';
  end if;

  raise notice 'ALL REAPER CASES PASSED';
end $$;

rollback;
