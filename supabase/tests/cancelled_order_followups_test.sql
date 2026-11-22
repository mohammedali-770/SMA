-- ============================================================================
-- A cancelled order is not started at the POS and is not re-queued by the
-- admin Retry (migration 20261015120000_cancelled_order_followups.sql; the
-- follow-ups #471 listed in docs/MIGRATIONS.md §64).
--
-- Every GUARD case fails on the chain before that migration and passes with
-- it. Every HONEST case passes on both: it is the flow the guard must not
-- break, and it is what fails if a guard over-refuses. Each raises
-- 'CASE n FAILED: ...'. To see every case on an older chain, run it with
-- -v ON_ERROR_STOP=0 -v ON_ERROR_ROLLBACK=on.
--
--   CASE 1   guard   the gate: a cancelled order a claim left 'syncing' is
--                    answered order_cancelled and parked blocked/order_cancelled,
--                    one skipped log row, no notification, no marker
--   CASE 2   honest  the gate: a received or preparing order is still
--                    answered ready_to_send, with the marker stamped (AMENDED
--                    for 20261022120000: ready, out_for_delivery and delivered
--                    are now order_progressed, see below)
--   CASE 3   guard   the gate: a cancelled order past its deadline is
--                    order_cancelled, not deadline_expired, and so never gets
--                    a pos_failed event; a received one is still deadline_expired
--   CASE 4   honest  the gate: where the refusal sits. A POS ref still answers
--                    already_synced / ref_present_unverified; a cancelled order
--                    that is not 'syncing' is invalid_state and untouched; one
--                    whose send phase ANOTHER attempt owns is invalid_state and
--                    untouched; the same token's RPC retry is unchanged
--   CASE 5   guard   once parked, nothing brings it back: the stale reaper, both
--                    claims, the admin Retry and the customer Resend all leave it
--                    exactly as it is, and no pos_* event is ever queued
--   CASE 6   guard   the admin Retry refuses a cancelled order in every state it
--                    would otherwise re-queue, with order_cancelled: and P0001,
--                    and changes nothing; one it would refuse anyway is refused
--                    as cancelled first
--   CASE 7   honest  the admin Retry still re-queues an eligible RECEIVED order
--                    (AMENDED for 20261022120000: the other four statuses are now
--                    refused as order_in_progress, see below)
--   CASE 8   honest  the admin Retry: the admin gate still comes first (42501 for
--                    a cancelled order), and a missing order is still P0002
--   CASE 9   guard   the follow-up's own story, end to end: the worker claims an
--                    order, an administrator cancels it while the worker is
--                    preparing, and the gate parks it instead of sending; the
--                    reaper and the admin Retry then leave it alone
--   CASE 10  g+h     the money-path pair and grants
-- ============================================================================
begin;

create temporary table t_fx (k text primary key, fx_id uuid);

do $$
declare v_branch uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.branches (id, name_en, name_ar, is_active) values (v_branch, 'Cancelled follow-ups', 'Cancelled follow-ups', true);
  set local session_replication_role = origin;
  insert into t_fx values ('branch', v_branch);
end $$;

create function pg_temp.as_nobody() returns void language sql as $$
  select set_config('test.auth_uid', '', true),
         set_config('test.is_admin', '', true),
         set_config('test.is_staff', '', true);
$$;

create function pg_temp.as_admin() returns void language sql as $$
  select set_config('test.is_admin', 'true', true),
         set_config('test.is_staff', 'true', true);
$$;

-- An order in an exact sync shape. Inserted with triggers off, so the insert
-- triggers do not reshape it; every later UPDATE fires them all.
create function pg_temp.new_order(
  p_status   public.order_status,
  p_state    text,
  p_deadline timestamptz default now() + interval '9 minutes',
  p_ref      text        default null,
  p_marker   timestamptz default null,
  p_token    text        default null,
  p_attempts integer     default 0,
  p_type     public.order_type default 'pickup'
) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                             payment_method, payment_status, lazywait_sync_state, lazywait_ref,
                             pos_create_attempted_at, pos_create_attempt_token, sync_attempt_count,
                             pos_sync_started_at, pos_sync_deadline_at)
  values (v, 'COF-' || replace(v::text, '-', ''), (select fx_id from t_fx where k = 'branch'),
          p_type, p_status, 25, 25, 'cash', 'pending', p_state, p_ref,
          p_marker, p_token, p_attempts, now() - interval '1 minute', p_deadline);
  set local session_replication_role = origin;
  return v;
end $$;

-- The admin Retry: 'OK' or '<sqlstate> <message>'.
create function pg_temp.requeue(p_id uuid) returns text language plpgsql as $$
declare s text;
begin
  begin
    perform public.requeue_lazywait_order(p_id);
    s := 'OK';
  exception when others then
    s := sqlstate || ' ' || sqlerrm;
  end;
  return s;
end $$;

-- The sync-relevant shape of an order, for "nothing moved" comparisons.
create function pg_temp.shape(p_id uuid) returns text language sql as $$
  select concat_ws('|', o.status, o.lazywait_sync_state, coalesce(o.sync_blocked_reason, '-'),
                   coalesce(o.sync_last_error, '-'), coalesce(o.lazywait_ref, '-'),
                   coalesce(o.pos_create_attempted_at::text, '-'), coalesce(o.pos_create_attempt_token, '-'),
                   coalesce(o.sync_next_attempt_at::text, '-'), o.sync_attempt_count)
    from public.orders o where o.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- CASE 1 — guard: the gate parks a cancelled order instead of starting it
-- ---------------------------------------------------------------------------
do $$
declare
  v_id  uuid;
  v_ans text;
  o     public.orders;
begin
  -- Exactly what a claim leaves: 'syncing', no ref, no marker, deadline ahead.
  foreach v_id in array array[
    pg_temp.new_order('cancelled', 'syncing'),
    pg_temp.new_order('cancelled', 'syncing', p_type => 'delivery')] loop
    v_ans := public.begin_lazywait_create_attempt(v_id, 'tok-1');
    if v_ans is distinct from 'order_cancelled' then
      raise exception 'CASE 1 FAILED: a cancelled order was answered % (expected order_cancelled)', coalesce(v_ans, '<null>');
    end if;
    select * into o from public.orders where id = v_id;
    if o.pos_create_attempted_at is not null or o.pos_create_attempt_token is not null then
      raise exception 'CASE 1 FAILED: an attempt marker was stamped on a cancelled order';
    end if;
    if o.lazywait_sync_state is distinct from 'blocked' or o.sync_blocked_reason is distinct from 'order_cancelled'
       or o.sync_last_error is distinct from 'order_cancelled_before_send' or o.sync_next_attempt_at is not null
       or o.sync_status is distinct from 'failed' then
      raise exception 'CASE 1 FAILED: not parked as blocked/order_cancelled: %', pg_temp.shape(v_id);
    end if;
    if (select count(*) from public.integration_sync_logs
         where order_id = v_id and provider = 'lazywait' and status = 'skipped'
           and error = 'order_cancelled_before_send') <> 1
       or (select count(*) from public.integration_sync_logs where order_id = v_id) <> 1 then
      raise exception 'CASE 1 FAILED: expected exactly one skipped sync-log row';
    end if;
    if exists (select 1 from public.notification_log where order_id = v_id) then
      raise exception 'CASE 1 FAILED: a notification was queued for the parked order';
    end if;
    if o.status <> 'cancelled' or o.refund_state <> 'none' then
      raise exception 'CASE 1 FAILED: the order itself moved (% / %)', o.status, o.refund_state;
    end if;
  end loop;
  raise notice 'CASE 1 ok: a cancelled order is parked blocked/order_cancelled, never stamped, never notified';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — honest: every other status is still started
-- ---------------------------------------------------------------------------
-- AMENDED for 20261022120000_pos_resend_refund_guards (audit F-X04-001). This
-- case used to require ready_to_send for all five non-cancelled statuses, which
-- is the behaviour that finding records as a defect: a ticket for an order the
-- branch has already made or handed over. It now pins the two statuses that are
-- still sent (received, and preparing, which an unpaid card order can reach
-- before its first send) and that the other three are answered
-- order_progressed. The full behaviour is supabase/tests/
-- pos_resend_refund_guards_test.sql CASE 5.
do $$
declare
  v_s   public.order_status;
  v_id  uuid;
  v_ans text;
  o     public.orders;
begin
  foreach v_s in array array['ready', 'out_for_delivery', 'delivered']::public.order_status[] loop
    v_id := pg_temp.new_order(v_s, 'syncing');
    v_ans := public.begin_lazywait_create_attempt(v_id, 'tok-2');
    if v_ans is distinct from 'order_progressed' then
      raise exception 'CASE 2 FAILED: a % order was answered % (expected order_progressed)', v_s, coalesce(v_ans, '<null>');
    end if;
  end loop;
  foreach v_s in array array['received', 'preparing']::public.order_status[] loop
    v_id := pg_temp.new_order(v_s, 'syncing');
    v_ans := public.begin_lazywait_create_attempt(v_id, 'tok-2');
    select * into o from public.orders where id = v_id;
    if v_ans is distinct from 'ready_to_send' or o.pos_create_attempted_at is null
       or o.pos_create_attempt_token is distinct from 'tok-2' or o.lazywait_sync_state <> 'syncing' then
      raise exception 'CASE 2 FAILED: a % order was answered % / %', v_s, coalesce(v_ans, '<null>'), pg_temp.shape(v_id);
    end if;
    if exists (select 1 from public.integration_sync_logs where order_id = v_id) then
      raise exception 'CASE 2 FAILED: the gate wrote a sync-log row for a % order', v_s;
    end if;
  end loop;
  raise notice 'CASE 2 ok: received and preparing are still started; ready, out_for_delivery and delivered are order_progressed';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — guard: past the deadline, cancelled still wins
-- ---------------------------------------------------------------------------
do $$
declare
  v_c   uuid := pg_temp.new_order('cancelled', 'syncing', now() - interval '1 minute');
  v_r   uuid := pg_temp.new_order('received',  'syncing', now() - interval '1 minute');
  v_ans text;
begin
  v_ans := public.begin_lazywait_create_attempt(v_c, 'tok-3');
  if v_ans is distinct from 'order_cancelled' then
    raise exception 'CASE 3 FAILED: a cancelled order past its deadline was answered % (the worker would dead-letter it and queue pos_failed)', coalesce(v_ans, '<null>');
  end if;
  if (select lazywait_sync_state from public.orders where id = v_c) <> 'blocked' then
    raise exception 'CASE 3 FAILED: the cancelled order past its deadline was not parked';
  end if;
  v_ans := public.begin_lazywait_create_attempt(v_r, 'tok-3');
  if v_ans is distinct from 'deadline_expired' then
    raise exception 'CASE 3 FAILED: a received order past its deadline was answered % (expected deadline_expired)', coalesce(v_ans, '<null>');
  end if;
  if (select pos_create_attempted_at from public.orders where id = v_r) is not null then
    raise exception 'CASE 3 FAILED: a marker was stamped past the deadline';
  end if;
  raise notice 'CASE 3 ok: past the deadline a cancelled order is parked, a received one is deadline_expired as before';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4 — honest: where the refusal sits
-- ---------------------------------------------------------------------------
-- Passes before and after. It pins the position of the new statement: placed
-- ahead of the ref check it would hide that a ticket exists; ahead of the
-- 'syncing' check it would rewrite orders the worker does not hold; ahead of
-- the marker check it would take the row from under an attempt that may be
-- mid-POST, and hide it from the verification feed.
do $$
declare
  v_ref    uuid := pg_temp.new_order('cancelled', 'syncing', p_ref => 'LW-REF-9');
  v_blank  uuid := pg_temp.new_order('cancelled', 'syncing', p_ref => '  ');
  v_synced uuid := pg_temp.new_order('cancelled', 'synced');
  v_other  uuid := pg_temp.new_order('cancelled', 'syncing', p_marker => now(), p_token => 'tok-other');
  v_same   uuid := pg_temp.new_order('cancelled', 'syncing', p_marker => now(), p_token => 'tok-4');
  v_st     text;
  v_id     uuid;
  v_before text;
  v_ans    text;
begin
  if public.begin_lazywait_create_attempt(v_ref, 'tok-4') is distinct from 'already_synced' then
    raise exception 'CASE 4 FAILED: a usable POS ref no longer answers already_synced';
  end if;
  if public.begin_lazywait_create_attempt(v_blank, 'tok-4') is distinct from 'ref_present_unverified'
     or public.begin_lazywait_create_attempt(v_synced, 'tok-4') is distinct from 'ref_present_unverified' then
    raise exception 'CASE 4 FAILED: an unusable marker or a synced row no longer answers ref_present_unverified';
  end if;

  foreach v_st in array array['pending', 'failed', 'blocked', 'dead_letter', 'skipped', 'awaiting_payment', 'confirmation_required'] loop
    v_id := pg_temp.new_order('cancelled', v_st);
    v_before := pg_temp.shape(v_id);
    v_ans := public.begin_lazywait_create_attempt(v_id, 'tok-4');
    if v_ans is distinct from 'invalid_state' or pg_temp.shape(v_id) is distinct from v_before
       or exists (select 1 from public.integration_sync_logs where order_id = v_id) then
      raise exception 'CASE 4 FAILED: a cancelled % order the worker does not hold was answered % and rewritten', v_st, v_ans;
    end if;
  end loop;

  v_before := pg_temp.shape(v_other);
  v_ans := public.begin_lazywait_create_attempt(v_other, 'tok-4');
  if v_ans is distinct from 'invalid_state' or pg_temp.shape(v_other) is distinct from v_before then
    raise exception 'CASE 4 FAILED: another attempt''s send phase was taken over (% / %)', v_ans, pg_temp.shape(v_other);
  end if;

  if public.begin_lazywait_create_attempt(v_same, 'tok-4') is distinct from 'ready_to_send' then
    raise exception 'CASE 4 FAILED: the same token''s RPC retry no longer answers ready_to_send';
  end if;
  raise notice 'CASE 4 ok: the refusal sits after the ref, state and marker checks and before the deadline checks';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5 — guard: once parked, nothing brings it back
-- ---------------------------------------------------------------------------
do $$
declare
  v_c      uuid := gen_random_uuid();
  v_id     uuid := pg_temp.new_order('cancelled', 'syncing');
  v_before text;
  v_res    jsonb;
  v_n      int;
begin
  if public.begin_lazywait_create_attempt(v_id, 'tok-5') is distinct from 'order_cancelled' then
    raise exception 'CASE 5 FAILED: the fixture was not parked by the gate';
  end if;
  insert into auth.users (id) values (v_c);
  update public.orders set customer_id = v_c where id = v_id;
  -- Long enough ago for the reaper to consider it, and past its deadline.
  update public.orders set updated_at = now() - interval '1 hour', pos_sync_deadline_at = now() - interval '30 minutes'
   where id = v_id;
  v_before := pg_temp.shape(v_id);

  perform public.reap_stale_lazywait_syncs(10, 5);
  select count(*) into v_n from public.claim_lazywait_sync_one(v_id);
  v_n := v_n + (select count(*) from public.claim_lazywait_sync_batch(100) where id = v_id);
  if v_n <> 0 then raise exception 'CASE 5 FAILED: a claim took the parked order'; end if;

  perform pg_temp.as_admin();
  if pg_temp.requeue(v_id) not like 'P0001 order_cancelled:%' then
    raise exception 'CASE 5 FAILED: the admin Retry did not refuse the parked order';
  end if;
  perform pg_temp.as_nobody();

  perform set_config('test.auth_uid', v_c::text, true);
  perform set_config('test.is_admin', 'false', true);
  perform set_config('test.is_staff', 'false', true);
  discard plans;
  set local role authenticated;
  v_res := public.request_customer_pos_resend(v_id);
  reset role;
  perform pg_temp.as_nobody();
  if v_res->>'reason' is distinct from 'order_cancelled' then
    raise exception 'CASE 5 FAILED: the customer Resend did not refuse the parked order: %', v_res;
  end if;

  if pg_temp.shape(v_id) is distinct from v_before then
    raise exception 'CASE 5 FAILED: the parked order moved: % -> %', v_before, pg_temp.shape(v_id);
  end if;
  if exists (select 1 from public.notification_log where order_id = v_id) then
    raise exception 'CASE 5 FAILED: a notification was queued for the parked order';
  end if;
  raise notice 'CASE 5 ok: the reaper, both claims, the admin Retry and the Resend leave a parked order alone';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 6 — guard: the admin Retry refuses a cancelled order
-- ---------------------------------------------------------------------------
do $$
declare
  v_st     text;
  v_id     uuid;
  v_before text;
  v_res    text;
begin
  perform pg_temp.as_admin();
  -- The four states lazywait_requeue_eligibility answers 'requeued' for, inside
  -- the budget and with no ref or marker: every one of these was re-queued
  -- before the migration.
  foreach v_st in array array['failed', 'blocked', 'dead_letter', 'skipped'] loop
    v_id := pg_temp.new_order('cancelled', v_st);
    if public.lazywait_requeue_eligibility(v_st, null, now() + interval '9 minutes', 0, null, 'pickup', null) <> 'requeued' then
      raise exception 'CASE 6 FAILED: the fixture shape is no longer eligible, so this case proves nothing';
    end if;
    v_before := pg_temp.shape(v_id);
    v_res := pg_temp.requeue(v_id);
    if v_res is distinct from 'P0001 order_cancelled: This order was cancelled. A cancelled order is never sent to the branch.' then
      raise exception 'CASE 6 FAILED: the Retry of a cancelled % order answered %', v_st, v_res;
    end if;
    if pg_temp.shape(v_id) is distinct from v_before then
      raise exception 'CASE 6 FAILED: the refused Retry changed the order: % -> %', v_before, pg_temp.shape(v_id);
    end if;
  end loop;
  -- And a cancelled order the predicate would refuse anyway is refused AS
  -- cancelled, ahead of the predicate, so the console names the real reason
  -- rather than "retry window has expired".
  foreach v_id in array array[
    pg_temp.new_order('cancelled', 'failed', now() - interval '1 minute'),
    pg_temp.new_order('cancelled', 'failed', p_marker => now()),
    pg_temp.new_order('cancelled', 'failed', p_attempts => 5)] loop
    v_res := pg_temp.requeue(v_id);
    if v_res not like 'P0001 order_cancelled:%' then
      raise exception 'CASE 6 FAILED: a cancelled order the predicate refuses was answered % (expected order_cancelled first)', v_res;
    end if;
  end loop;
  perform pg_temp.as_nobody();
  raise notice 'CASE 6 ok: the admin Retry refuses a cancelled order in every state it would re-queue, and names cancellation first';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 7 — honest: every other status is still re-queued
-- ---------------------------------------------------------------------------
-- AMENDED for 20261022120000_pos_resend_refund_guards (audit F-X04-001). This
-- case used to require that the Retry re-queue an order in all five
-- non-cancelled statuses: a second ticket for an order staff have already moved
-- on, which is the defect. A received order is still re-queued; the other four
-- are refused as order_in_progress. Full behaviour:
-- supabase/tests/pos_resend_refund_guards_test.sql CASE 2 and CASE 3.
do $$
declare
  v_s   public.order_status;
  v_id  uuid;
  v_res text;
begin
  perform pg_temp.as_admin();
  foreach v_s in array array['preparing', 'ready', 'out_for_delivery', 'delivered']::public.order_status[] loop
    v_id := pg_temp.new_order(v_s, 'failed');
    v_res := pg_temp.requeue(v_id);
    if v_res not like 'P0001 order_in_progress:%' or (select lazywait_sync_state from public.orders where id = v_id) <> 'failed' then
      raise exception 'CASE 7 FAILED: the Retry of a % order answered % (%)', v_s, v_res, pg_temp.shape(v_id);
    end if;
  end loop;
  foreach v_s in array array['received']::public.order_status[] loop
    v_id := pg_temp.new_order(v_s, 'failed');
    v_res := pg_temp.requeue(v_id);
    if v_res is distinct from 'OK' or (select lazywait_sync_state from public.orders where id = v_id) <> 'pending' then
      raise exception 'CASE 7 FAILED: the Retry of an eligible % order answered % (%)', v_s, v_res, pg_temp.shape(v_id);
    end if;
  end loop;
  -- And the existing refusals still carry their own reasons.
  v_id := pg_temp.new_order('received', 'failed', now() - interval '1 minute');
  if pg_temp.requeue(v_id) not like 'P0001 deadline_expired:%' then
    raise exception 'CASE 7 FAILED: an expired order is no longer refused as deadline_expired';
  end if;
  perform pg_temp.as_nobody();
  raise notice 'CASE 7 ok: a received order is still re-queued; the other four statuses are order_in_progress';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 8 — honest: the admin gate and not_found are unchanged
-- ---------------------------------------------------------------------------
do $$
declare
  v_id  uuid := pg_temp.new_order('cancelled', 'failed');
  v_res text;
begin
  perform pg_temp.as_nobody();
  perform set_config('test.is_admin', 'false', true);
  v_res := pg_temp.requeue(v_id);
  if v_res not like '42501 %' then
    raise exception 'CASE 8 FAILED: a caller who is not an administrator was answered % (expected 42501)', v_res;
  end if;
  perform pg_temp.as_admin();
  v_res := pg_temp.requeue(gen_random_uuid());
  if v_res is distinct from 'P0002 not_found: Order not found' then
    raise exception 'CASE 8 FAILED: a missing order was answered %', v_res;
  end if;
  perform pg_temp.as_nobody();
  raise notice 'CASE 8 ok: the admin gate comes first, and a missing order is still not_found';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 9 — the follow-up's story, end to end
-- ---------------------------------------------------------------------------
-- A cash order is queued and the worker claims it. While the worker loads the
-- items and builds the ticket, the customer calls and an administrator cancels
-- the order. Before the migration the gate answered ready_to_send and the
-- ticket printed; then the Retry could re-queue it and the stale sweep would
-- tell the customer "we could not send your order".
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_id    uuid := pg_temp.new_order('received', 'pending', p_deadline => now() + interval '9 minutes');
  v_n     int;
  v_ans   text;
begin
  update public.orders set sync_next_attempt_at = now() - interval '1 second' where id = v_id;
  select count(*) into v_n from public.claim_lazywait_sync_one(v_id);
  if v_n <> 1 or (select lazywait_sync_state from public.orders where id = v_id) <> 'syncing' then
    raise exception 'CASE 9 FAILED: the fixture was not claimed';
  end if;

  insert into auth.users (id, email) values (v_admin, 'cancelled-followups-admin@x');
  update public.profiles set role = 'admin' where id = v_admin;
  perform set_config('test.auth_uid', v_admin::text, true);
  perform pg_temp.as_admin();
  perform public.admin_set_order_status(v_id, 'cancelled');
  perform pg_temp.as_nobody();
  if (select status from public.orders where id = v_id) <> 'cancelled' then
    raise exception 'CASE 9 FAILED: the fixture was not cancelled';
  end if;

  v_ans := public.begin_lazywait_create_attempt(v_id, 'tok-9');
  if v_ans is distinct from 'order_cancelled' then
    raise exception 'CASE 9 FAILED: the gate answered % for an order cancelled after its claim; the ticket would print', coalesce(v_ans, '<null>');
  end if;

  update public.orders set updated_at = now() - interval '1 hour', pos_sync_deadline_at = now() - interval '30 minutes'
   where id = v_id;
  perform public.reap_stale_lazywait_syncs(10, 5);
  perform pg_temp.as_admin();
  if pg_temp.requeue(v_id) not like 'P0001 order_cancelled:%' then
    raise exception 'CASE 9 FAILED: the admin Retry re-queued the cancelled order';
  end if;
  perform pg_temp.as_nobody();

  if (select lazywait_sync_state from public.orders where id = v_id) <> 'blocked'
     or exists (select 1 from public.notification_log where order_id = v_id and kind = 'pos_sync') then
    raise exception 'CASE 9 FAILED: the cancelled order ended % with % pos_sync events',
      (select lazywait_sync_state from public.orders where id = v_id),
      (select count(*) from public.notification_log where order_id = v_id and kind = 'pos_sync');
  end if;
  raise notice 'CASE 9 ok: cancelled after its claim, the order is parked, never sent, never re-queued, never told it failed';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 10 — the money path, and grants
-- ---------------------------------------------------------------------------
do $$
begin
  if (select md5(pg_get_functiondef('public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)'::regprocedure)))
       is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'CASE 10 FAILED: place_order moved';
  end if;
  if (select md5(pg_get_functiondef('public.compute_order_snapshot(uuid, uuid, public.order_type, jsonb, uuid, text, integer)'::regprocedure)))
       is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'CASE 10 FAILED: compute_order_snapshot moved';
  end if;
  if has_function_privilege('anon', 'public.begin_lazywait_create_attempt(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_lazywait_create_attempt(uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.begin_lazywait_create_attempt(uuid, text)', 'execute') then
    raise exception 'CASE 10 FAILED: begin_lazywait_create_attempt is not service-role only';
  end if;
  if has_function_privilege('anon', 'public.requeue_lazywait_order(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.requeue_lazywait_order(uuid)', 'execute') then
    raise exception 'CASE 10 FAILED: requeue_lazywait_order grants moved';
  end if;
  raise notice 'CASE 10 ok: money path unchanged; the gate is service-role only; the console keeps its Retry';
end $$;

rollback;
