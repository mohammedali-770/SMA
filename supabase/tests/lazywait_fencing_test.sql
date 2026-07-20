-- ============================================================================
-- Fencing tests for the POS duplicate-prevention correction (migration
-- 20260721120000): the pre-send create-attempt gate and the pos_sync
-- notification claim/finalize/release protocol.
--
-- Runs against a throwaway Postgres with all migrations applied. Each case
-- RAISES EXCEPTION on failure; a clean run commits nothing (wrapped in rollback).
--
-- Invariants under test:
--   * No Create Order attempt may enter the send phase after the deadline.
--   * The phase marker + attempt token are stamped ATOMICALLY and only one
--     attempt may enter the send phase (concurrency single-entry).
--   * A pos_sync push is claimed by exactly one dispatcher; 'processing' is not
--     reclaimable; terminal rows are no-ops; only the owning token may finalize
--     or release; a released (pre-send) claim is safely retryable.
-- ============================================================================
begin;

-- ---- begin_lazywait_create_attempt (Findings 1 & 2) ------------------------
do $$
declare
  v_ok uuid := gen_random_uuid(); v_late uuid := gen_random_uuid();
  v_ref uuid := gen_random_uuid(); v_pending uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, lazywait_ref, pos_sync_started_at, pos_sync_deadline_at) values
    (v_ok,     'F-1', gen_random_uuid(),'pickup',10,10,'syncing', null, now()-interval '1m', now()+interval '9m'),
    (v_late,   'F-2', gen_random_uuid(),'pickup',10,10,'syncing', null, now()-interval '11m', now()-interval '1m'),
    (v_ref,    'F-3', gen_random_uuid(),'pickup',10,10,'syncing', 'REF', now()-interval '1m', now()+interval '9m'),
    (v_pending,'F-4', gen_random_uuid(),'pickup',10,10,'pending', null, now()-interval '1m', now()+interval '9m');
  set local session_replication_role = origin;

  -- ready_to_send durably stamps the marker + token.
  if public.begin_lazywait_create_attempt(v_ok, 'tok-A') <> 'ready_to_send' then
    raise exception 'GATE FAILED: expected ready_to_send'; end if;
  if (select pos_create_attempted_at from public.orders where id=v_ok) is null then
    raise exception 'GATE FAILED: marker not durably stamped'; end if;
  if (select pos_create_attempt_token from public.orders where id=v_ok) <> 'tok-A' then
    raise exception 'GATE FAILED: attempt token not stamped'; end if;

  -- Same token is idempotent (safe RPC retry).
  if public.begin_lazywait_create_attempt(v_ok, 'tok-A') <> 'ready_to_send' then
    raise exception 'GATE FAILED: same token not idempotent'; end if;

  -- A DIFFERENT token cannot also enter the send phase (concurrency single-entry).
  if public.begin_lazywait_create_attempt(v_ok, 'tok-B') <> 'invalid_state' then
    raise exception 'GATE FAILED: a second token entered the send phase'; end if;

  -- Past the deadline: never send, and NEVER stamp a marker.
  if public.begin_lazywait_create_attempt(v_late, 'tok-L') <> 'deadline_expired' then
    raise exception 'GATE FAILED: expected deadline_expired'; end if;
  if (select pos_create_attempted_at from public.orders where id=v_late) is not null then
    raise exception 'GATE FAILED: marker stamped past deadline'; end if;

  -- Already created (ref present) -> never resend.
  if public.begin_lazywait_create_attempt(v_ref, 'tok-R') <> 'already_synced' then
    raise exception 'GATE FAILED: expected already_synced'; end if;

  -- Not a live claim -> invalid_state. Missing row -> not_found.
  if public.begin_lazywait_create_attempt(v_pending, 'tok-P') <> 'invalid_state' then
    raise exception 'GATE FAILED: non-syncing entered send phase'; end if;
  if public.begin_lazywait_create_attempt(gen_random_uuid(), 'tok-X') <> 'not_found' then
    raise exception 'GATE FAILED: expected not_found'; end if;

  -- Empty/NULL token is rejected outright.
  begin
    perform public.begin_lazywait_create_attempt(v_ok, '');
    raise exception 'GATE FAILED: empty token accepted';
  exception when sqlstate '22004' then null; end;

  raise notice 'GATE OK';
end $$;

-- ---- Notification claim/finalize/release (Finding 3) -----------------------
do $$
declare v_oid uuid := gen_random_uuid(); r1 text; r2 text;
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total, lazywait_sync_state)
    values (v_oid, 'F-5', gen_random_uuid(),'pickup',10,10,'confirmation_required');
  set local session_replication_role = origin;
  -- Worker enqueued the dedup event as 'pending'.
  insert into public.notification_log (kind, order_id, status, send_status)
    values ('pos_sync', v_oid, 'pos_confirmation_required', 'pending');

  -- Two concurrent claims: exactly one wins the send.
  r1 := public.claim_pos_sync_notification(v_oid, 'pos_confirmation_required', 'D1');
  r2 := public.claim_pos_sync_notification(v_oid, 'pos_confirmation_required', 'D2');
  if not (r1 = 'claimed' and r2 = 'in_progress') then
    raise exception 'NOTIF FAILED: concurrent claims r1=% r2=%', r1, r2; end if;

  -- A non-owning token cannot finalize (returns false, changes nothing).
  if public.finalize_pos_sync_notification(v_oid,'pos_confirmation_required','D2','sent',1,1,0,0) then
    raise exception 'NOTIF FAILED: wrong token finalized'; end if;
  if (select send_status from public.notification_log where order_id=v_oid and kind='pos_sync') <> 'processing' then
    raise exception 'NOTIF FAILED: wrong token mutated state'; end if;

  -- The owner finalizes to a terminal state.
  if not public.finalize_pos_sync_notification(v_oid,'pos_confirmation_required','D1','sent',1,1,0,0) then
    raise exception 'NOTIF FAILED: owner could not finalize'; end if;
  if (select send_status from public.notification_log where order_id=v_oid and kind='pos_sync') <> 'sent' then
    raise exception 'NOTIF FAILED: not terminal after finalize'; end if;

  -- 'sent' is a terminal no-op: never reclaimed / re-sent.
  if public.claim_pos_sync_notification(v_oid,'pos_confirmation_required','D3') <> 'duplicate' then
    raise exception 'NOTIF FAILED: sent row was reclaimable'; end if;

  raise notice 'NOTIF CLAIM OK';
end $$;

do $$
declare v_oid uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total, lazywait_sync_state)
    values (v_oid, 'F-6', gen_random_uuid(),'pickup',10,10,'failed');
  set local session_replication_role = origin;
  insert into public.notification_log (kind, order_id, status, send_status)
    values ('pos_sync', v_oid, 'pos_retrying', 'pending');

  -- Claim, then a PROVEN pre-send failure releases the claim back to 'pending'.
  if public.claim_pos_sync_notification(v_oid,'pos_retrying','C1') <> 'claimed' then
    raise exception 'RELEASE FAILED: initial claim'; end if;
  -- Wrong token cannot release.
  if public.release_pos_sync_notification(v_oid,'pos_retrying','WRONG') then
    raise exception 'RELEASE FAILED: wrong token released'; end if;
  -- Owner releases -> 'pending' -> safely reclaimable by a later dispatch.
  if not public.release_pos_sync_notification(v_oid,'pos_retrying','C1') then
    raise exception 'RELEASE FAILED: owner could not release'; end if;
  if (select send_status from public.notification_log where order_id=v_oid and kind='pos_sync') <> 'pending' then
    raise exception 'RELEASE FAILED: not returned to pending'; end if;
  if public.claim_pos_sync_notification(v_oid,'pos_retrying','C2') <> 'claimed' then
    raise exception 'RELEASE FAILED: not reclaimable after release'; end if;

  -- A terminal 'failed' (post-send) row is NOT reclaimable (no auto-resend).
  perform public.finalize_pos_sync_notification(v_oid,'pos_retrying','C2','failed',1,0,1,0);
  if public.claim_pos_sync_notification(v_oid,'pos_retrying','C3') <> 'duplicate' then
    raise exception 'RELEASE FAILED: terminal failed row was reclaimable'; end if;

  raise notice 'RELEASE OK';
end $$;

rollback;
