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
  -- A genuinely-retrying order (state 'failed', a scheduled retry, deadline live)
  -- so 'pos_retrying' matches the authoritative state.
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, sync_next_attempt_at, pos_sync_started_at, pos_sync_deadline_at)
    values (v_oid, 'F-6', gen_random_uuid(),'pickup',10,10,'failed', now()+interval '2m', now()-interval '1m', now()+interval '9m');
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

-- ---- Consume-only claim + authoritative state validation (Finding 2) -------
do $$
declare v_sync uuid := gen_random_uuid(); v_conf uuid := gen_random_uuid();
  v_noref uuid := gen_random_uuid(); v_before bigint;
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, lazywait_ref, first_pos_sync_failure_at) values
    (v_sync,  'F-7', gen_random_uuid(),'pickup',10,10,'synced', 'REF7', now()-interval '5m'),
    (v_conf,  'F-8', gen_random_uuid(),'pickup',10,10,'confirmation_required', null, now()-interval '5m'),
    (v_noref, 'F-9', gen_random_uuid(),'pickup',10,10,'failed', null, now()-interval '5m');
  set local session_replication_role = origin;

  -- (1) No enqueued event -> 'no_event', and NOTHING is inserted (consume-only).
  select count(*) into v_before from public.notification_log where kind='pos_sync';
  if public.claim_pos_sync_notification(v_sync,'pos_confirmed','X1') <> 'no_event' then
    raise exception 'CONSUME FAILED: expected no_event when no row exists'; end if;
  if (select count(*) from public.notification_log where kind='pos_sync') <> v_before then
    raise exception 'CONSUME FAILED: claim manufactured an event'; end if;

  -- (2) A pending 'pos_confirmed' event whose order is NOT synced/no-ref is stale
  --     -> 'superseded' (terminal no-send); never claimed/sent.
  insert into public.notification_log (kind, order_id, status, send_status)
    values ('pos_sync', v_noref, 'pos_confirmed', 'pending');
  if public.claim_pos_sync_notification(v_noref,'pos_confirmed','X2') <> 'superseded' then
    raise exception 'CONSUME FAILED: pos_confirmed on non-synced order was not superseded'; end if;
  if (select send_status from public.notification_log where order_id=v_noref and status='pos_confirmed') <> 'superseded' then
    raise exception 'CONSUME FAILED: stale event not marked superseded'; end if;

  -- (3) A stale 'pos_retrying' event whose order has since synced -> 'superseded'.
  insert into public.notification_log (kind, order_id, status, send_status)
    values ('pos_sync', v_sync, 'pos_retrying', 'pending');
  if public.claim_pos_sync_notification(v_sync,'pos_retrying','X3') <> 'superseded' then
    raise exception 'CONSUME FAILED: stale pos_retrying after synced was not superseded'; end if;

  -- (4) A VALID pending 'pos_confirmed' (order synced + ref) claims exactly once.
  insert into public.notification_log (kind, order_id, status, send_status)
    values ('pos_sync', v_sync, 'pos_confirmed', 'pending');
  if public.claim_pos_sync_notification(v_sync,'pos_confirmed','X4') <> 'claimed' then
    raise exception 'CONSUME FAILED: valid pos_confirmed not claimable'; end if;
  if public.claim_pos_sync_notification(v_sync,'pos_confirmed','X5') <> 'in_progress' then
    raise exception 'CONSUME FAILED: claimed event reclaimable'; end if;

  -- (5) A valid pending 'pos_confirmation_required' (matching state) claims.
  insert into public.notification_log (kind, order_id, status, send_status)
    values ('pos_sync', v_conf, 'pos_confirmation_required', 'pending');
  if public.claim_pos_sync_notification(v_conf,'pos_confirmation_required','X6') <> 'claimed' then
    raise exception 'CONSUME FAILED: valid confirmation_required not claimable'; end if;

  raise notice 'CONSUME-ONLY OK';
end $$;

-- ---- FINAL token-fenced pre-send re-validation -----------------------------
-- The order can transition between the claim and sendToDevices; the dispatcher
-- must re-check authoritative state immediately before sending. These are the
-- deterministic OUTCOME cases (single session). The TRUE cross-session
-- serialization — the validator LOCKING the orders row so it waits for /
-- observes a concurrent Lazywait worker — is proven in
-- supabase/tests/lazywait_presend_concurrency_test.sql (dblink two-backend test).
--
-- LOCK-ORDER AUDIT (deadlock safety): every pos_sync path that takes both row
-- locks acquires them in the SAME canonical order — orders row -> notification_log
-- row: claim_pos_sync_notification and validate_pos_sync_notification_before_send
-- (orders FOR UPDATE, then the notification row FOR UPDATE);
-- begin_lazywait_create_attempt (orders only); the reaper (orders UPDATEs, then
-- notification inserts); record_lazywait_sync (order update, then notification
-- insert). finalize/release lock only the notification row. No path locks
-- notification-then-orders, so no inversion is possible.
do $$
declare
  v_retry uuid := gen_random_uuid();  -- pos_retrying, then order syncs
  v_conf  uuid := gen_random_uuid();  -- pos_confirmed stays valid
  v_noref uuid := gen_random_uuid();  -- pos_confirmed loses its ref
  v_cr    uuid := gen_random_uuid();  -- pos_confirmation_required order changes
  v_fail  uuid := gen_random_uuid();  -- pos_failed no longer terminal
  v_tok   uuid := gen_random_uuid();  -- wrong-token / finalize / not_found
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, lazywait_ref, sync_next_attempt_at, pos_sync_started_at, pos_sync_deadline_at) values
    (v_retry, 'V-1', gen_random_uuid(),'pickup',10,10,'failed', null, now()+interval '2m', now()-interval '1m', now()+interval '9m'),
    (v_conf,  'V-2', gen_random_uuid(),'pickup',10,10,'synced', 'REFV2', null, null, null),
    (v_noref, 'V-3', gen_random_uuid(),'pickup',10,10,'synced', 'REFV3', null, null, null),
    (v_cr,    'V-4', gen_random_uuid(),'pickup',10,10,'confirmation_required', null, null, null, null),
    (v_fail,  'V-5', gen_random_uuid(),'pickup',10,10,'dead_letter', null, null, null, null),
    (v_tok,   'V-6', gen_random_uuid(),'pickup',10,10,'synced', 'REFV6', null, null, null);
  set local session_replication_role = origin;

  -- (1) pos_retrying claimed while retryable, order SYNCS before send -> superseded.
  insert into public.notification_log (kind, order_id, status, send_status) values ('pos_sync', v_retry, 'pos_retrying', 'pending');
  if public.claim_pos_sync_notification(v_retry,'pos_retrying','T1') <> 'claimed' then raise exception 'PRESEND V1 FAILED: claim'; end if;
  update public.orders set lazywait_sync_state='synced', lazywait_ref='REFV1' where id=v_retry;
  if public.validate_pos_sync_notification_before_send(v_retry,'pos_retrying','T1') <> 'superseded' then
    raise exception 'PRESEND V1 FAILED: stale retrying not superseded'; end if;
  if (select send_status from public.notification_log where order_id=v_retry and status='pos_retrying') <> 'superseded' then
    raise exception 'PRESEND V1 FAILED: row not marked superseded'; end if;

  -- (2) pos_confirmed still synced+ref -> ready_to_send; row stays 'processing'.
  insert into public.notification_log (kind, order_id, status, send_status) values ('pos_sync', v_conf, 'pos_confirmed', 'pending');
  if public.claim_pos_sync_notification(v_conf,'pos_confirmed','T2') <> 'claimed' then raise exception 'PRESEND V2 FAILED: claim'; end if;
  if public.validate_pos_sync_notification_before_send(v_conf,'pos_confirmed','T2') <> 'ready_to_send' then
    raise exception 'PRESEND V2 FAILED: not ready_to_send'; end if;
  if (select send_status from public.notification_log where order_id=v_conf and status='pos_confirmed') <> 'processing' then
    raise exception 'PRESEND V2 FAILED: ready_to_send mutated the row'; end if;

  -- (3) pos_confirmed LOSES its ref before send -> superseded.
  insert into public.notification_log (kind, order_id, status, send_status) values ('pos_sync', v_noref, 'pos_confirmed', 'pending');
  perform public.claim_pos_sync_notification(v_noref,'pos_confirmed','T3');
  update public.orders set lazywait_ref=null where id=v_noref;   -- still 'synced', but no ref
  if public.validate_pos_sync_notification_before_send(v_noref,'pos_confirmed','T3') <> 'superseded' then
    raise exception 'PRESEND V3 FAILED: ref-less confirmed not superseded'; end if;

  -- (4) pos_confirmation_required order MOVES ON -> superseded (no stale verify msg).
  insert into public.notification_log (kind, order_id, status, send_status) values ('pos_sync', v_cr, 'pos_confirmation_required', 'pending');
  perform public.claim_pos_sync_notification(v_cr,'pos_confirmation_required','T4');
  update public.orders set lazywait_sync_state='synced', lazywait_ref='REFV4' where id=v_cr;
  if public.validate_pos_sync_notification_before_send(v_cr,'pos_confirmation_required','T4') <> 'superseded' then
    raise exception 'PRESEND V4 FAILED: stale confirmation_required not superseded'; end if;

  -- (5) pos_failed no longer terminal -> superseded.
  insert into public.notification_log (kind, order_id, status, send_status) values ('pos_sync', v_fail, 'pos_failed', 'pending');
  perform public.claim_pos_sync_notification(v_fail,'pos_failed','T5');
  update public.orders set lazywait_sync_state='synced', lazywait_ref='REFV5' where id=v_fail;
  if public.validate_pos_sync_notification_before_send(v_fail,'pos_failed','T5') <> 'superseded' then
    raise exception 'PRESEND V5 FAILED: stale pos_failed not superseded'; end if;

  -- (6) Wrong claim token -> lost_claim; the owner's row is NOT modified.
  insert into public.notification_log (kind, order_id, status, send_status) values ('pos_sync', v_tok, 'pos_confirmed', 'pending');
  if public.claim_pos_sync_notification(v_tok,'pos_confirmed','OWNER') <> 'claimed' then raise exception 'PRESEND V6 FAILED: claim'; end if;
  if public.validate_pos_sync_notification_before_send(v_tok,'pos_confirmed','INTRUDER') <> 'lost_claim' then
    raise exception 'PRESEND V6 FAILED: non-owner not lost_claim'; end if;
  if (select send_status from public.notification_log where order_id=v_tok and status='pos_confirmed') <> 'processing'
     or (select claim_token from public.notification_log where order_id=v_tok and status='pos_confirmed') <> 'OWNER' then
    raise exception 'PRESEND V6 FAILED: non-owner mutated the row'; end if;
  -- the true owner still validates ready.
  if public.validate_pos_sync_notification_before_send(v_tok,'pos_confirmed','OWNER') <> 'ready_to_send' then
    raise exception 'PRESEND V6 FAILED: owner not ready_to_send'; end if;

  -- (7) Already finalized ('sent') -> lost_claim (not processing); no send.
  perform public.finalize_pos_sync_notification(v_tok,'pos_confirmed','OWNER','sent',1,1,0,0);
  if public.validate_pos_sync_notification_before_send(v_tok,'pos_confirmed','OWNER') <> 'lost_claim' then
    raise exception 'PRESEND V7 FAILED: finalized row validated ready'; end if;

  -- (8) No event row at all -> not_found.
  if public.validate_pos_sync_notification_before_send(gen_random_uuid(),'pos_confirmed','T8') <> 'not_found' then
    raise exception 'PRESEND V8 FAILED: expected not_found'; end if;

  -- (9) Empty/NULL claim token is rejected outright (owner-fence input guard).
  begin
    perform public.validate_pos_sync_notification_before_send(v_conf,'pos_confirmed','');
    raise exception 'PRESEND V9 FAILED: empty token accepted';
  exception when sqlstate '22004' then null; end;

  raise notice 'PRE-SEND VALIDATION OK';
end $$;

-- ---- Whitespace-only POS ref is NOT a usable confirmation ------------------
-- A whitespace-only lazywait_ref must be treated exactly like a MISSING ref:
-- state 'synced' alone never proves POS confirmation. This keeps the canonical
-- SQL predicate in lock-step with the mobile hasUsablePosRef() rule (JS .trim(),
-- which strips the full ASCII whitespace set — space, tab, newline, CR, FF, VT),
-- so the customer is only ever told "confirmed" when Lazywait returned a REAL
-- order_ref. The trim MUST cover tabs/newlines, not just spaces (single-arg
-- btrim() would let a tab/newline-only ref slip through and re-open the drift).
do $$
begin
  -- Pure predicate: pos_confirmed requires synced AND a trimmed, non-empty ref.
  if public.pos_sync_status_matches('pos_confirmed','synced', null,     null, null) then
    raise exception 'WS PREDICATE FAILED: synced + null ref reported confirmed'; end if;
  if public.pos_sync_status_matches('pos_confirmed','synced', '',       null, null) then
    raise exception 'WS PREDICATE FAILED: synced + empty ref reported confirmed'; end if;
  if public.pos_sync_status_matches('pos_confirmed','synced', '   ',    null, null) then
    raise exception 'WS PREDICATE FAILED: synced + space-only ref reported confirmed'; end if;
  if public.pos_sync_status_matches('pos_confirmed','synced', E'\t',    null, null) then
    raise exception 'WS PREDICATE FAILED: synced + tab-only ref reported confirmed'; end if;
  if public.pos_sync_status_matches('pos_confirmed','synced', E'\n',    null, null) then
    raise exception 'WS PREDICATE FAILED: synced + newline-only ref reported confirmed'; end if;
  if public.pos_sync_status_matches('pos_confirmed','synced', E' \t\r\n ', null, null) then
    raise exception 'WS PREDICATE FAILED: synced + mixed-whitespace ref reported confirmed'; end if;
  -- A real ref (including one padded with whitespace) IS a usable confirmation.
  if not public.pos_sync_status_matches('pos_confirmed','synced', 'REF', null, null) then
    raise exception 'WS PREDICATE FAILED: synced + real ref not confirmed'; end if;
  if not public.pos_sync_status_matches('pos_confirmed','synced', E'  REF  ', null, null) then
    raise exception 'WS PREDICATE FAILED: synced + padded real ref not confirmed'; end if;
  raise notice 'WS PREDICATE OK';
end $$;

do $$
declare
  v_ws   uuid := gen_random_uuid();  -- synced, whitespace-only ref (claim supersede)
  v_lose uuid := gen_random_uuid();  -- synced, real ref that becomes whitespace pre-send
  v_ok   uuid := gen_random_uuid();  -- synced, real ref -> ready_to_send
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, lazywait_ref) values
    (v_ws,   'F-WS1', gen_random_uuid(),'pickup',10,10,'synced', '   '),
    (v_lose, 'F-WS2', gen_random_uuid(),'pickup',10,10,'synced', 'REFWS2'),
    (v_ok,   'F-WS3', gen_random_uuid(),'pickup',10,10,'synced', 'REFWS3');
  set local session_replication_role = origin;

  -- CLAIM: a pending pos_confirmed whose order is synced but ref is whitespace-only
  -- is stale -> superseded (terminal no-send); the customer is NOT told confirmed.
  insert into public.notification_log (kind, order_id, status, send_status)
    values ('pos_sync', v_ws, 'pos_confirmed', 'pending');
  if public.claim_pos_sync_notification(v_ws,'pos_confirmed','WS1') <> 'superseded' then
    raise exception 'WS CLAIM FAILED: whitespace-ref pos_confirmed not superseded'; end if;
  if (select send_status from public.notification_log where order_id=v_ws and status='pos_confirmed') <> 'superseded' then
    raise exception 'WS CLAIM FAILED: whitespace-ref event not marked superseded'; end if;

  -- PRE-SEND: a claim whose usable ref decays to whitespace (here a tab) before
  -- send -> superseded (never push "confirmed" on an unusable ref).
  insert into public.notification_log (kind, order_id, status, send_status)
    values ('pos_sync', v_lose, 'pos_confirmed', 'pending');
  if public.claim_pos_sync_notification(v_lose,'pos_confirmed','WS2') <> 'claimed' then
    raise exception 'WS PRESEND FAILED: valid confirmed not claimable'; end if;
  update public.orders set lazywait_ref = E'\t  ' where id = v_lose;   -- still 'synced', ref now whitespace
  if public.validate_pos_sync_notification_before_send(v_lose,'pos_confirmed','WS2') <> 'superseded' then
    raise exception 'WS PRESEND FAILED: whitespace-ref not superseded at send'; end if;

  -- CONTROL: a genuinely usable ref still claims and validates ready_to_send.
  insert into public.notification_log (kind, order_id, status, send_status)
    values ('pos_sync', v_ok, 'pos_confirmed', 'pending');
  if public.claim_pos_sync_notification(v_ok,'pos_confirmed','WS3') <> 'claimed' then
    raise exception 'WS CONTROL FAILED: usable-ref confirmed not claimable'; end if;
  if public.validate_pos_sync_notification_before_send(v_ok,'pos_confirmed','WS3') <> 'ready_to_send' then
    raise exception 'WS CONTROL FAILED: usable ref not ready_to_send'; end if;

  raise notice 'WS CLAIM/PRESEND OK';
end $$;

rollback;
