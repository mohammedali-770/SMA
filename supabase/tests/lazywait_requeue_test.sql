-- ============================================================================
-- Deadline-safe manual requeue tests for requeue_lazywait_order() +
-- lazywait_requeue_eligibility() (migration 20260721120000).
--
-- Runs against a throwaway Postgres with all migrations applied. Transactional
-- (begin; … rollback;); each case RAISES on failure. is_admin() is stubbed via
-- the test.is_admin GUC in the throwaway bootstrap.
--
-- Invariant under test: a POS order past its absolute 10-minute deadline (or
-- otherwise not proven safe to resend) must NOT be requeued into the automatic
-- Create Order pipeline, and the requeue must never report a false success.
-- ============================================================================
begin;

select set_config('test.is_admin', 'true', true);

-- Helper: assert requeue is REJECTED with the given reason code AND the order's
-- state is unchanged (no false success, no silent mutation).
create function pg_temp.reject_requeue(p_id uuid, p_reason text) returns void
language plpgsql as $$
declare v_before text; v_after text;
begin
  select lazywait_sync_state into v_before from public.orders where id = p_id;
  begin
    perform public.requeue_lazywait_order(p_id);
    raise exception 'REJECT FAILED (%): requeue was allowed', p_reason;
  exception
    when sqlstate 'P0001' then
      if position(p_reason in sqlerrm) = 0 then
        raise exception 'REJECT FAILED: expected % , got %', p_reason, sqlerrm;
      end if;
  end;
  select lazywait_sync_state into v_after from public.orders where id = p_id;
  if v_after is distinct from v_before then
    raise exception 'REJECT FAILED (%): state changed % -> %', p_reason, v_before, v_after;
  end if;
end $$;

-- ---- Pure eligibility predicate --------------------------------------------
do $$
begin
  if public.lazywait_requeue_eligibility('failed', null, now()+interval '5m', 1, null, 'pickup') <> 'requeued' then
    raise exception 'PREDICATE FAILED: safe failure in budget'; end if;
  if public.lazywait_requeue_eligibility('skipped', null, null, 0, null, 'pickup') <> 'requeued' then
    raise exception 'PREDICATE FAILED: skipped (no window) requeuable'; end if;
  if public.lazywait_requeue_eligibility('failed', null, now()-interval '1m', 1, null, 'pickup') <> 'deadline_expired' then
    raise exception 'PREDICATE FAILED: past deadline'; end if;
  if public.lazywait_requeue_eligibility('dead_letter', null, now()-interval '1m', 2, null, 'pickup') <> 'deadline_expired' then
    raise exception 'PREDICATE FAILED: dead_letter past deadline'; end if;
  if public.lazywait_requeue_eligibility('confirmation_required', null, now()+interval '5m', 0, null, 'pickup') <> 'confirmation_required' then
    raise exception 'PREDICATE FAILED: confirmation_required'; end if;
  if public.lazywait_requeue_eligibility('synced', 'REF', now()+interval '5m', 1, null, 'pickup') <> 'already_synced' then
    raise exception 'PREDICATE FAILED: synced'; end if;
  if public.lazywait_requeue_eligibility('blocked', 'REF', now()+interval '5m', 1, null, 'pickup') <> 'already_synced' then
    raise exception 'PREDICATE FAILED: ref-bearing'; end if;
  -- ANY non-null ref marker blocks resend; a non-usable one is ref_present_unverified
  -- (NOT already_synced — the reference is not proven usable).
  if public.lazywait_requeue_eligibility('blocked', '', now()+interval '5m', 1, null, 'pickup') <> 'ref_present_unverified' then
    raise exception 'PREDICATE FAILED: empty ref marker'; end if;
  if public.lazywait_requeue_eligibility('blocked', '   ', now()+interval '5m', 1, null, 'pickup') <> 'ref_present_unverified' then
    raise exception 'PREDICATE FAILED: spaces ref marker'; end if;
  if public.lazywait_requeue_eligibility('blocked', chr(9), now()+interval '5m', 1, null, 'pickup') <> 'ref_present_unverified' then
    raise exception 'PREDICATE FAILED: tab ref marker'; end if;
  if public.lazywait_requeue_eligibility('blocked', chr(160), now()+interval '5m', 1, null, 'pickup') <> 'ref_present_unverified' then
    raise exception 'PREDICATE FAILED: unicode-ws ref marker'; end if;
  if public.lazywait_requeue_eligibility('synced', null, now()+interval '5m', 1, null, 'pickup') <> 'ref_present_unverified' then
    raise exception 'PREDICATE FAILED: synced without usable ref'; end if;
  if public.lazywait_requeue_eligibility('failed', null, now()+interval '5m', 1, null, 'pickup') <> 'requeued' then
    raise exception 'PREDICATE FAILED: null ref safe failure should requeue'; end if;
  if public.lazywait_requeue_eligibility('failed', null, now()+interval '5m', 5, null, 'pickup') <> 'attempt_limit_reached' then
    raise exception 'PREDICATE FAILED: attempt ceiling'; end if;
  if public.lazywait_requeue_eligibility('blocked', null, now()+interval '5m', 1, now(), 'pickup') <> 'may_have_sent' then
    raise exception 'PREDICATE FAILED: may-have-sent marker'; end if;
  if public.lazywait_requeue_eligibility('failed', null, now()+interval '5m', 1, null, 'delivery') <> 'not_retryable' then
    raise exception 'PREDICATE FAILED: delivery'; end if;
  if public.lazywait_requeue_eligibility('pending', null, now()+interval '5m', 0, null, 'pickup') <> 'not_retryable' then
    raise exception 'PREDICATE FAILED: pending not retryable'; end if;
  raise notice 'PREDICATE OK';
end $$;

-- ---- requeue_lazywait_order() behaviour ------------------------------------
do $$
declare
  v_exp uuid := gen_random_uuid();  -- expired failed
  v_dl  uuid := gen_random_uuid();  -- past-deadline dead_letter
  v_cr  uuid := gen_random_uuid();  -- confirmation_required
  v_ref uuid := gen_random_uuid();  -- ref-bearing
  v_max uuid := gen_random_uuid();  -- attempt limit
  v_may uuid := gen_random_uuid();  -- may-have-sent marker
  v_unv uuid := gen_random_uuid();  -- non-null but UNUSABLE ref marker
  v_ok  uuid := gen_random_uuid();  -- safe failure in budget
  v_skip uuid := gen_random_uuid(); -- skipped (no window)
  v_state text; v_before_deadline timestamptz; v_after_deadline timestamptz;
  v_attempts int; v_next timestamptz; n int;
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, lazywait_ref, sync_attempt_count, pos_create_attempted_at,
    pos_sync_started_at, pos_sync_deadline_at) values
    (v_exp, 'RQ-1', gen_random_uuid(),'pickup',10,10,'failed',      null,  2, null, now()-interval '11m', now()-interval '1m'),
    (v_dl,  'RQ-2', gen_random_uuid(),'pickup',10,10,'dead_letter', null,  2, null, now()-interval '11m', now()-interval '1m'),
    (v_cr,  'RQ-3', gen_random_uuid(),'pickup',10,10,'confirmation_required', null, 1, null, now()-interval '3m', now()+interval '7m'),
    (v_ref, 'RQ-4', gen_random_uuid(),'pickup',10,10,'blocked',     'REFX',1, null, now()-interval '3m', now()+interval '7m'),
    (v_max, 'RQ-5', gen_random_uuid(),'pickup',10,10,'failed',      null,  5, null, now()-interval '3m', now()+interval '7m'),
    (v_may, 'RQ-6', gen_random_uuid(),'pickup',10,10,'blocked',     null,  1, now()-interval '2m', now()-interval '3m', now()+interval '7m'),
    (v_unv, 'RQ-10', gen_random_uuid(),'pickup',10,10,'blocked',    '   ', 1, null, now()-interval '3m', now()+interval '7m'),
    (v_ok,  'RQ-7', gen_random_uuid(),'pickup',10,10,'blocked',     null,  1, null, now()-interval '3m', now()+interval '7m'),
    (v_skip,'RQ-8', gen_random_uuid(),'pickup',10,10,'skipped',     null,  0, null, null,               null);
  set local session_replication_role = origin;

  -- Rejections: no state change, correct reason code (no false success).
  perform pg_temp.reject_requeue(v_exp,  'deadline_expired');
  perform pg_temp.reject_requeue(v_dl,   'deadline_expired');
  perform pg_temp.reject_requeue(v_cr,   'confirmation_required');
  perform pg_temp.reject_requeue(v_ref,  'already_synced');
  perform pg_temp.reject_requeue(v_max,  'attempt_limit_reached');
  perform pg_temp.reject_requeue(v_may,  'may_have_sent');
  -- A non-null but UNUSABLE ref marker blocks an automatic resend but is NOT
  -- reported as already_synced (the reference is not proven usable).
  perform pg_temp.reject_requeue(v_unv,  'ref_present_unverified');

  -- Eligible safe failure -> 'pending', deadline + attempt count PRESERVED, and
  -- actually claimable.
  v_before_deadline := (select pos_sync_deadline_at from public.orders where id=v_ok);
  perform public.requeue_lazywait_order(v_ok);
  select lazywait_sync_state, pos_sync_deadline_at, sync_attempt_count, sync_next_attempt_at
    into v_state, v_after_deadline, v_attempts, v_next from public.orders where id=v_ok;
  if v_state <> 'pending' then raise exception 'REQUEUE FAILED: eligible not pending -> %', v_state; end if;
  if v_attempts <> 1 then raise exception 'REQUEUE FAILED: attempt count changed -> %', v_attempts; end if;
  if v_after_deadline is distinct from v_before_deadline then
    raise exception 'REQUEUE FAILED: deadline changed % -> %', v_before_deadline, v_after_deadline; end if;
  if v_next is null or v_next > v_after_deadline then
    raise exception 'REQUEUE FAILED: next attempt null or past deadline -> %', v_next; end if;
  select count(*) into n from public.claim_lazywait_sync_batch(10) where id=v_ok;
  if n <> 1 then raise exception 'REQUEUE FAILED: requeued order not claimable -> %', n; end if;

  -- Eligible 'skipped' (no prior window) -> 'pending' + a FRESH window (trigger).
  perform public.requeue_lazywait_order(v_skip);
  select lazywait_sync_state, pos_sync_deadline_at into v_state, v_after_deadline from public.orders where id=v_skip;
  if v_state <> 'pending' then raise exception 'REQUEUE FAILED: skipped not pending'; end if;
  if v_after_deadline is null then raise exception 'REQUEUE FAILED: skipped got no fresh window'; end if;

  raise notice 'REQUEUE OK';
end $$;

-- ---- Authorization ---------------------------------------------------------
do $$
declare v_id uuid := gen_random_uuid(); v_denied boolean := false;
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
    lazywait_sync_state, pos_sync_started_at, pos_sync_deadline_at)
    values (v_id, 'RQ-9', gen_random_uuid(),'pickup',10,10,'blocked', now()-interval '2m', now()+interval '8m');
  set local session_replication_role = origin;
  perform set_config('test.is_admin', 'false', true);
  begin
    perform public.requeue_lazywait_order(v_id);
  exception when sqlstate '42501' then v_denied := true;
  end;
  perform set_config('test.is_admin', 'true', true);
  if not v_denied then raise exception 'AUTH FAILED: non-admin requeue allowed'; end if;
  raise notice 'AUTH OK';
end $$;

rollback;
