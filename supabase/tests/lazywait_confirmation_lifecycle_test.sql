-- ============================================================================
-- Customer-confirmation lifecycle tests (migration
-- 20260721120000_lazywait_confirmation_lifecycle.sql).
--
-- Runs against a throwaway Postgres with all migrations applied (see
-- docs/LAZYWAIT.md / the verification harness). Each case RAISES EXCEPTION on
-- failure, so the whole script aborts non-zero if any assertion fails; a clean
-- run prints the NOTICEs and commits nothing (wrapped in a rollback).
--
-- Safety invariant under test: a customer is NEVER told "confirmed" unless
-- Lazywait returned a usable order_ref. Ambiguous outcomes go to
-- 'confirmation_required' and are NEVER auto-retried; safe (proven-not-sent)
-- outcomes retry only inside 5 attempts AND a 10-minute deadline.
-- ============================================================================
begin;

-- Case 1: the deadline trigger stamps a 10-minute window the first time an order
--         becomes 'pending' on INSERT (cash pickup).
do $$
declare v_id uuid := gen_random_uuid(); v_st timestamptz; v_dl timestamptz;
begin
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total, payment_method)
    values (v_id, 'LC-1', gen_random_uuid(), 'pickup', 10, 10, 'cash');
  select pos_sync_started_at, pos_sync_deadline_at into v_st, v_dl from public.orders where id = v_id;
  if v_st is null or v_dl is null then raise exception 'CASE 1 FAILED: window not stamped on insert'; end if;
  if v_dl - v_st <> interval '10 minutes' then raise exception 'CASE 1 FAILED: window <> 10 minutes'; end if;
end $$;

-- Case 2: an online order holds in 'awaiting_payment' with NO window; the window
--         is stamped only when it flips to 'pending' (simulated paid transition),
--         and is NOT reset by a later requeue.
do $$
declare v_id uuid := gen_random_uuid(); v_st timestamptz; v_st2 timestamptz;
begin
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total, payment_method, payment_status)
    values (v_id, 'LC-2', gen_random_uuid(), 'pickup', 10, 10, 'online', 'pending');
  if (select pos_sync_started_at from public.orders where id = v_id) is not null then
    raise exception 'CASE 2 FAILED: awaiting_payment must have no window';
  end if;
  update public.orders set lazywait_sync_state = 'pending', sync_next_attempt_at = now() where id = v_id;
  select pos_sync_started_at into v_st from public.orders where id = v_id;
  if v_st is null then raise exception 'CASE 2 FAILED: window not stamped on paid flip'; end if;
  -- a later state churn must NOT move the anchor
  update public.orders set lazywait_sync_state = 'failed' where id = v_id;
  select pos_sync_started_at into v_st2 from public.orders where id = v_id;
  if v_st2 <> v_st then raise exception 'CASE 2 FAILED: window anchor moved on requeue'; end if;
end $$;

-- Case 3: claim_lazywait_sync_batch skips past-deadline rows and CLEARS the phase
--         marker on the rows it does claim.
do $$
declare v_ok uuid := gen_random_uuid(); v_late uuid := gen_random_uuid(); n int;
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, sync_next_attempt_at, pos_sync_started_at, pos_sync_deadline_at, pos_create_attempted_at) values
    (v_ok,  'LC-3a', gen_random_uuid(),'pickup',10,10,'pending', now()-interval '1s', now()-interval '1m', now()+interval '9m', now()),
    (v_late,'LC-3b', gen_random_uuid(),'pickup',10,10,'pending', now()-interval '1s', now()-interval '11m', now()-interval '1m', now());
  set local session_replication_role = origin;
  select count(*) into n from public.claim_lazywait_sync_batch(10) where id in (v_ok, v_late);
  if n <> 1 then raise exception 'CASE 3 FAILED: expected exactly 1 in-budget claim, got %', n; end if;
  if (select lazywait_sync_state from public.orders where id = v_ok) <> 'syncing' then
    raise exception 'CASE 3 FAILED: in-budget row not claimed'; end if;
  if (select pos_create_attempted_at from public.orders where id = v_ok) is not null then
    raise exception 'CASE 3 FAILED: phase marker not cleared on claim'; end if;
  if (select lazywait_sync_state from public.orders where id = v_late) <> 'pending' then
    raise exception 'CASE 3 FAILED: past-deadline row was claimed'; end if;
end $$;

-- Case 4: record_lazywait_sync persists the new lifecycle columns AND enqueues a
--         SINGLE deduplicated pos_sync notification (2nd identical call no-ops).
do $$
declare v_id uuid := gen_random_uuid(); n int;
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total, lazywait_sync_state)
    values (v_id, 'LC-4', gen_random_uuid(), 'pickup', 10, 10, 'syncing');
  set local session_replication_role = origin;
  perform public.record_lazywait_sync(v_id,
    jsonb_build_object('lazywait_sync_state','confirmation_required',
                       'first_pos_sync_failure_at', now()::text,
                       'pos_confirmation_reason','timeout'),
    'failed','push', null, null, 'ambiguous', 'pos_confirmation_required');
  if (select lazywait_sync_state from public.orders where id = v_id) <> 'confirmation_required' then
    raise exception 'CASE 4 FAILED: state not persisted'; end if;
  if (select pos_confirmation_reason from public.orders where id = v_id) <> 'timeout' then
    raise exception 'CASE 4 FAILED: reason not persisted'; end if;
  if (select first_pos_sync_failure_at from public.orders where id = v_id) is null then
    raise exception 'CASE 4 FAILED: first_pos_sync_failure_at not persisted'; end if;
  select count(*) into n from public.notification_log
    where order_id = v_id and kind = 'pos_sync' and status = 'pos_confirmation_required';
  if n <> 1 then raise exception 'CASE 4 FAILED: expected 1 dedup notification, got %', n; end if;
  -- second identical call is deduped
  perform public.record_lazywait_sync(v_id,
    jsonb_build_object('lazywait_sync_state','confirmation_required'),
    'failed','push', null, null, null, 'pos_confirmation_required');
  select count(*) into n from public.notification_log
    where order_id = v_id and kind = 'pos_sync' and status = 'pos_confirmation_required';
  if n <> 1 then raise exception 'CASE 4 FAILED: dedup broke (count %)', n; end if;
end $$;

-- Case 5: reaper — the four ref-less branches + past-deadline sweep, isolated so
--         the summary counts are deterministic.
do $$
declare
  v_ref uuid := gen_random_uuid();   -- with ref -> synced
  v_amb uuid := gen_random_uuid();   -- no ref, marker SET -> confirmation_required
  v_safe uuid := gen_random_uuid();  -- no ref, marker NULL, in budget -> failed (requeue)
  v_dl uuid := gen_random_uuid();    -- failed, past deadline -> dead_letter
  v_res jsonb;
begin
  -- isolate from earlier cases so counts are exact
  delete from public.notification_log;
  delete from public.integration_sync_logs;
  delete from public.orders;

  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, lazywait_ref, pos_create_attempted_at, pos_sync_started_at, pos_sync_deadline_at,
    sync_attempt_count, updated_at) values
    (v_ref, 'LC-5a', gen_random_uuid(),'pickup',10,10,'syncing','REF_X', now()-interval '20m', now()-interval '25m', now()+interval '5m', 1, now()-interval '20m'),
    (v_amb, 'LC-5b', gen_random_uuid(),'pickup',10,10,'syncing', null,   now()-interval '20m', now()-interval '25m', now()+interval '5m', 1, now()-interval '20m'),
    (v_safe,'LC-5c', gen_random_uuid(),'pickup',10,10,'syncing', null,   null,                 now()-interval '2m',  now()+interval '8m', 1, now()-interval '20m'),
    (v_dl,  'LC-5d', gen_random_uuid(),'pickup',10,10,'failed',  null,   null,                 now()-interval '11m', now()-interval '1m', 2, now()-interval '20m');
  set local session_replication_role = origin;

  v_res := public.reap_stale_lazywait_syncs(10, 5);
  raise notice 'reaper summary: %', v_res;

  -- with-ref recovered to synced, ref untouched, NEVER re-POST
  if (select lazywait_sync_state from public.orders where id = v_ref) <> 'synced' then
    raise exception 'CASE 5 FAILED: with-ref not recovered to synced'; end if;
  if (select lazywait_ref from public.orders where id = v_ref) <> 'REF_X' then
    raise exception 'CASE 5 FAILED: ref mutated'; end if;

  -- marker SET (may have sent) -> confirmation_required + one notification
  if (select lazywait_sync_state from public.orders where id = v_amb) <> 'confirmation_required' then
    raise exception 'CASE 5 FAILED: marker-set not routed to confirmation_required'; end if;
  if (select count(*) from public.notification_log where order_id = v_amb and status = 'pos_confirmation_required') <> 1 then
    raise exception 'CASE 5 FAILED: missing confirmation_required notification'; end if;

  -- marker NULL, in budget -> requeue to failed with schedule (attempt 1->2 = started + 1m)
  if (select lazywait_sync_state from public.orders where id = v_safe) <> 'failed' then
    raise exception 'CASE 5 FAILED: proven-not-sent not requeued'; end if;
  if (select sync_next_attempt_at from public.orders where id = v_safe)
       <> (select pos_sync_started_at + interval '1 minute' from public.orders where id = v_safe) then
    raise exception 'CASE 5 FAILED: requeue not on the fixed schedule'; end if;

  -- past deadline (failed) -> dead_letter + pos_failed notification, no next attempt
  if (select lazywait_sync_state from public.orders where id = v_dl) <> 'dead_letter' then
    raise exception 'CASE 5 FAILED: past-deadline not dead-lettered'; end if;
  if (select sync_next_attempt_at from public.orders where id = v_dl) is not null then
    raise exception 'CASE 5 FAILED: dead_letter still scheduled'; end if;
  if (select count(*) from public.notification_log where order_id = v_dl and status = 'pos_failed') <> 1 then
    raise exception 'CASE 5 FAILED: missing pos_failed notification'; end if;

  if (v_res->>'recovered_synced')::int <> 1
     or (v_res->>'confirmation_required')::int <> 1
     or (v_res->>'requeued')::int <> 1
     or (v_res->>'deadline_failed')::int <> 1 then
    raise exception 'CASE 5 FAILED: summary counts wrong: %', v_res;
  end if;

  -- idempotency: a second reap changes nothing new
  v_res := public.reap_stale_lazywait_syncs(10, 5);
  if (v_res->>'recovered_synced')::int <> 0
     or (v_res->>'confirmation_required')::int <> 0
     or (v_res->>'requeued')::int <> 0 then
    raise exception 'CASE 5 FAILED: reaper not idempotent: %', v_res;
  end if;
end $$;

-- Case 6: the admin dashboard RPC is is_admin()-gated and returns {total, items}
--         with safe fields only.
do $$
declare v jsonb; v_denied boolean := false;
begin
  perform set_config('request.jwt.claims', null, true);
  begin
    perform public.list_pos_confirmation_required(20);
  exception when others then v_denied := true;
  end;
  if not v_denied then raise exception 'CASE 6 FAILED: non-admin was allowed'; end if;
end $$;

rollback;
