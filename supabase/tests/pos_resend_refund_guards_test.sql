-- ============================================================================
-- The POS and refunds stop contradicting each other
-- (migration 20261022120000_pos_resend_refund_guards.sql; audit findings
-- F-X04-001, F-X03-002 and F-X04-002; docs/MIGRATIONS.md §71).
--
-- Every GUARD case fails on the chain before that migration and passes with
-- it. Every HONEST case passes on both: it is the flow the guard must not
-- break. Each raises 'CASE n FAILED: ...'. Orders are driven through the real
-- functions with every trigger on: place_customer_order, the worker's claim,
-- gate and record_lazywait_sync, admin_set_order_status, the customer Resend,
-- the admin Retry and the refund worker's claim and finalize.
--
--   CASE 1   guard   X04-001  Resend: refused once staff have moved the order on
--                             (preparing, ready, out for delivery, delivered),
--                             with a reason, and nothing about the order moves
--   CASE 2   guard   X04-001  Retry: the admin Retry refuses the same orders
--   CASE 3   honest           Resend and Retry still re-queue a failed RECEIVED
--                             cash order, and the worker still sends it
--   CASE 4   guard   X03-002  Retry: refused while the refund is pending, and
--                             after it was paid out
--   CASE 5   guard   X03-002  the pre-send gate: no ticket for an order with any
--                             refund lifecycle, or one already ready, out for
--                             delivery or delivered; received and preparing are
--                             still sent
--   CASE 6   guard   X04-002  the POS-failure refund is enrolled while received
--                             and never once the order has moved on; a moved-on
--                             paid order that is cancelled is still refunded
--   CASE 7   guard   X04-002  staff cannot move an order on while its refund is
--                             pending, processing or refunded; cancelling stays
--                             open; a 'failed' refund does not block
--   CASE 8   guard   X04-002  claim_order_refund never hands the worker a refund
--                             for an order the branch fulfilled
--   CASE 9   honest           a cash order end to end: placed, sent, confirmed,
--                             walked to delivered, never refunded
--   CASE 10  g+h              the trigger and the grants
-- ============================================================================
begin;

create function pg_temp.as_nobody() returns void language sql as $$
  select set_config('test.auth_uid', '', true),
         set_config('test.is_admin', '', true),
         set_config('test.is_staff', '', true);
$$;

-- The customer's Resend; the response, or {error, message}.
create function pg_temp.resend_as(p_uid uuid, p_order uuid) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  perform set_config('test.auth_uid', p_uid::text, true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.is_admin', 'false', true);
  discard plans;
  set local role authenticated;
  begin
    v := public.request_customer_pos_resend(p_order);
  exception when others then
    v := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  reset role;
  perform pg_temp.as_nobody();
  return v;
end $$;

-- An administrator call: 'OK' or '<sqlstate> <message>'.
create function pg_temp.admin_status(p_order uuid, p_status text) returns text
language plpgsql as $$
declare s text := 'OK';
begin
  perform set_config('test.auth_uid', (select fx_id from t_fx where k = 'admin')::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  discard plans;
  set local role authenticated;
  begin
    perform public.admin_set_order_status(p_order, p_status::public.order_status);
  exception when others then
    s := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.as_nobody();
  return s;
end $$;

create function pg_temp.admin_retry(p_order uuid) returns text
language plpgsql as $$
declare s text; o public.orders;
begin
  perform set_config('test.auth_uid', (select fx_id from t_fx where k = 'admin')::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  discard plans;
  set local role authenticated;
  begin
    o := public.requeue_lazywait_order(p_order);
    s := 'OK ' || o.lazywait_sync_state;
  exception when others then
    s := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.as_nobody();
  return s;
end $$;

-- A customer, phone-verified the way a WhatsApp sign-in makes one. The number
-- is invented and on scripts/test-phone-allowlist.json.
create function pg_temp.new_customer() returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, phone, phone_confirmed_at) values (v, '+966500000001', now());
  return v;
end $$;

-- A cash order placed by the customer through the real RPC.
create function pg_temp.place_cash(p_uid uuid) returns uuid
language plpgsql as $$
declare v jsonb;
begin
  perform set_config('test.auth_uid', p_uid::text, true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.is_admin', 'false', true);
  discard plans;
  set local role authenticated;
  v := public.place_customer_order(
    (select fx_id from t_fx where k = 'branch'), 'pickup',
    jsonb_build_array(jsonb_build_object('product_id', (select fx_id from t_fx where k = 'prod'), 'quantity', 1)),
    null, null, null, 0, gen_random_uuid(), 'cash');
  reset role;
  perform pg_temp.as_nobody();
  return (v ->> 'id')::uuid;
end $$;

-- A paid card order, the shape insert_order_from_snapshot leaves, with its
-- paid payment record. Every trigger fires.
create function pg_temp.place_paid(p_uid uuid, p_total numeric default 40) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.orders (id, customer_id, branch_id, order_type, subtotal, total,
                             payment_method, payment_status, payment_provider)
  values (v, p_uid, (select fx_id from t_fx where k = 'branch'), 'pickup', p_total, p_total,
          'online', 'paid', 'moyasar');
  insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode, confirmed_at)
  values (v, 'moyasar', 'pay_' || left(replace(v::text, '-', ''), 12), 'paid', p_total, 'SAR', 'test', now());
  return v;
end $$;

-- One worker attempt: claim, gate, then the outcome the worker records.
--   'refused_4xx'  a terminal 4xx (lazywait-sync records blocked + last error)
--   'rate_limited' a 429 safe retry (recorded failed)
--   'ok'           Create Order succeeded
-- Returns 'not_claimed', 'gate:<answer>' or the outcome.
create function pg_temp.attempt(p uuid, p_outcome text) returns text
language plpgsql as $$
declare r public.orders; g text;
begin
  select * into r from public.claim_lazywait_sync_one(p);
  if r.id is null then return 'not_claimed'; end if;
  g := public.begin_lazywait_create_attempt(p, gen_random_uuid()::text);
  if g <> 'ready_to_send' then return 'gate:' || g; end if;
  if p_outcome = 'refused_4xx' then
    perform public.record_lazywait_sync(p, jsonb_build_object(
      'lazywait_sync_state', 'blocked', 'sync_blocked_reason', 'client_error_422',
      'sync_attempt_count', r.sync_attempt_count + 1, 'first_pos_sync_failure_at', now()::text,
      'sync_last_error', 'client_error_422'),
      'failed', 'push', null, null, 'client_error_422', 'pos_failed');
  elsif p_outcome = 'rate_limited' then
    perform public.record_lazywait_sync(p, jsonb_build_object(
      'lazywait_sync_state', 'failed', 'sync_attempt_count', r.sync_attempt_count + 1,
      'sync_next_attempt_at', (now() + interval '30 s')::text,
      'first_pos_sync_failure_at', now()::text, 'sync_last_error', 'http_429'),
      'failed', 'push', null, null, 'rate_limited', 'pos_retrying');
  else
    perform public.record_lazywait_sync(p, jsonb_build_object(
      'lazywait_sync_state', 'synced', 'lazywait_ref', 'LW-' || left(replace(p::text, '-', ''), 8),
      'sync_attempt_count', r.sync_attempt_count + 1, 'sync_last_error', null),
      'success', 'push', null, null, null, 'pos_confirmed');
  end if;
  return p_outcome;
end $$;

-- Drive a paid order to its POS-failure refund the way a customer would: a
-- 429, then three Resends that each fail the same way.
create function pg_temp.fail_until_refund(p_uid uuid, p uuid) returns void
language plpgsql as $$
declare i int; v jsonb;
begin
  if pg_temp.attempt(p, 'rate_limited') <> 'rate_limited' then raise exception 'setup: first attempt did not run'; end if;
  for i in 1 .. 3 loop
    v := pg_temp.resend_as(p_uid, p);
    if v ->> 'outcome' is distinct from 'accepted' then raise exception 'setup: resend % refused: %', i, v; end if;
    if pg_temp.attempt(p, 'rate_limited') <> 'rate_limited' then raise exception 'setup: attempt % did not run', i; end if;
  end loop;
end $$;

-- Put an order back in the shape a claim leaves, without the claim's filters.
create function pg_temp.make_syncing(p uuid) returns void language sql as $$
  update public.orders
     set lazywait_sync_state = 'syncing', lazywait_ref = null,
         pos_create_attempted_at = null, pos_create_attempt_token = null,
         pos_sync_deadline_at = now() + interval '5 minutes'
   where id = p;
$$;

create temporary table t_fx (k text primary key, fx_id uuid);

do $$
declare
  v_branch uuid := gen_random_uuid();
  v_cat    uuid := gen_random_uuid();
  v_prod   uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.branches (id, name_en, name_ar, is_active) values (v_branch, 'POS guard', 'POS guard', true);
  insert into public.categories (id, name_en, name_ar, sort_order) values (v_cat, 'C', 'C', 1);
  insert into public.products (id, category_id, name_en, name_ar, price, is_active, sort_order)
    values (v_prod, v_cat, 'P', 'P', 25, true, 1);
  set local session_replication_role = origin;
  insert into auth.users (id) values (v_admin);
  insert into public.profiles (id) values (v_admin) on conflict do nothing;
  update public.profiles set role = 'admin' where id = v_admin;
  insert into t_fx values ('branch', v_branch), ('prod', v_prod), ('admin', v_admin);
end $$;
grant select on t_fx to authenticated;

update public.app_settings
   set cash_payment_enabled = true, default_payment_method = 'cash'
 where id = true;

-- ---------------------------------------------------------------------------
-- CASE 1 — guard: no Resend once staff have moved the order on
-- ---------------------------------------------------------------------------
do $$
declare
  v_c    uuid := pg_temp.new_customer();
  v_o    uuid;
  v_res  jsonb;
  v_path text[];
  v_step text;
  o      public.orders;
  b      public.orders;
  i      int;
  v_targets text[] := array['preparing', 'ready', 'delivered'];
begin
  for i in 1 .. 3 loop
    v_o := pg_temp.place_cash(v_c);
    if pg_temp.attempt(v_o, 'refused_4xx') <> 'refused_4xx' then
      raise exception 'CASE 1 FAILED: setup, the first attempt did not run';
    end if;
    -- The branch takes it by hand and staff walk it to the target status.
    v_path := (array[array['preparing', '', ''], array['preparing', 'ready', ''],
                     array['preparing', 'ready', 'delivered']])[i:i];
    foreach v_step in array v_path loop
      if v_step <> '' and pg_temp.admin_status(v_o, v_step) <> 'OK' then
        raise exception 'CASE 1 FAILED: setup, staff could not move a cash order to %', v_step;
      end if;
    end loop;
    select * into b from public.orders where id = v_o;
    if b.status::text is distinct from v_targets[i] or b.lazywait_sync_state is distinct from 'blocked'
       or b.pos_create_attempted_at is not null then
      raise exception 'CASE 1 FAILED: setup shape % / % / %', b.status, b.lazywait_sync_state, b.pos_create_attempted_at;
    end if;

    v_res := pg_temp.resend_as(v_c, v_o);
    if v_res ->> 'outcome' is distinct from 'unavailable' or v_res ->> 'reason' is distinct from 'order_in_progress'
       or coalesce(v_res ->> 'message', '') = '' then
      raise exception 'CASE 1 FAILED: a Resend on a % order was answered %', v_targets[i], v_res;
    end if;
    select * into o from public.orders where id = v_o;
    if o.lazywait_sync_state is distinct from 'blocked' or o.pos_customer_retry_count is distinct from b.pos_customer_retry_count
       or o.pos_sync_deadline_at is distinct from b.pos_sync_deadline_at or o.sync_last_error is distinct from b.sync_last_error then
      raise exception 'CASE 1 FAILED: the refused Resend moved the % order (% / retries %)', v_targets[i], o.lazywait_sync_state, o.pos_customer_retry_count;
    end if;
    if (select count(*) from public.integration_sync_logs where order_id = v_o and status = 'skipped'
         and error = 'resend_rejected_order_in_progress') <> 1 then
      raise exception 'CASE 1 FAILED: the refusal of the % order did not log exactly one skipped row', v_targets[i];
    end if;
    -- And the worker has nothing to take.
    if pg_temp.attempt(v_o, 'ok') <> 'not_claimed' then
      raise exception 'CASE 1 FAILED: the worker found the refused % order in its queue', v_targets[i];
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — guard: the admin Retry refuses the same orders
-- ---------------------------------------------------------------------------
do $$
declare
  v_c   uuid := pg_temp.new_customer();
  v_o   uuid;
  v_ans text;
  o     public.orders;
  v_st  text;
begin
  foreach v_st in array array['preparing', 'ready', 'delivered'] loop
    v_o := pg_temp.place_cash(v_c);
    perform pg_temp.attempt(v_o, 'refused_4xx');
    perform pg_temp.admin_status(v_o, 'preparing');
    if v_st in ('ready', 'delivered') then perform pg_temp.admin_status(v_o, 'ready'); end if;
    if v_st = 'delivered' then perform pg_temp.admin_status(v_o, 'delivered'); end if;
    if (select status::text from public.orders where id = v_o) is distinct from v_st then
      raise exception 'CASE 2 FAILED: setup did not reach %', v_st;
    end if;
    v_ans := pg_temp.admin_retry(v_o);
    if v_ans not like 'P0001 order_in_progress: This order is already %' then
      raise exception 'CASE 2 FAILED: the admin Retry on a % order answered %', v_st, v_ans;
    end if;
    select * into o from public.orders where id = v_o;
    if o.lazywait_sync_state is distinct from 'blocked' then
      raise exception 'CASE 2 FAILED: the refused Retry moved the % order to %', v_st, o.lazywait_sync_state;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — honest: a failed RECEIVED cash order is still resent and retried
-- ---------------------------------------------------------------------------
do $$
declare
  v_c   uuid := pg_temp.new_customer();
  v_a   uuid;
  v_b   uuid;
  v_res jsonb;
  v_ans text;
begin
  v_a := pg_temp.place_cash(v_c);
  perform pg_temp.attempt(v_a, 'refused_4xx');
  v_res := pg_temp.resend_as(v_c, v_a);
  if v_res ->> 'outcome' is distinct from 'accepted' then
    raise exception 'CASE 3 FAILED: a Resend on a failed received cash order was answered %', v_res;
  end if;
  if pg_temp.attempt(v_a, 'ok') <> 'ok' then
    raise exception 'CASE 3 FAILED: the resent order was not sent';
  end if;

  v_b := pg_temp.place_cash(v_c);
  perform pg_temp.attempt(v_b, 'refused_4xx');
  v_ans := pg_temp.admin_retry(v_b);
  if v_ans is distinct from 'OK pending' then
    raise exception 'CASE 3 FAILED: the admin Retry on a failed received cash order answered %', v_ans;
  end if;
  if pg_temp.attempt(v_b, 'ok') <> 'ok' then
    raise exception 'CASE 3 FAILED: the retried order was not sent';
  end if;
  if (select count(*) from public.orders where id in (v_a, v_b) and lazywait_sync_state = 'synced') <> 2 then
    raise exception 'CASE 3 FAILED: the two orders did not end synced';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4 — guard: no admin Retry for an order whose money is going back
-- ---------------------------------------------------------------------------
do $$
declare
  v_c   uuid := pg_temp.new_customer();
  v_o   uuid;
  v_ans text;
  v_rid uuid;
  v_exc uuid[];
  o     public.orders;
begin
  v_o := pg_temp.place_paid(v_c);
  perform pg_temp.fail_until_refund(v_c, v_o);
  select * into o from public.orders where id = v_o;
  if o.lazywait_sync_state is distinct from 'dead_letter' or o.refund_state is distinct from 'pending'
     or public.lazywait_requeue_eligibility(o.lazywait_sync_state, o.lazywait_ref, o.pos_sync_deadline_at,
          o.sync_attempt_count, o.pos_create_attempted_at, o.order_type::text, o.sync_blocked_reason) is distinct from 'requeued' then
    raise exception 'CASE 4 FAILED: setup shape % / refund % (the Retry must look eligible to the console)', o.lazywait_sync_state, o.refund_state;
  end if;

  -- (a) Refund pending.
  v_ans := pg_temp.admin_retry(v_o);
  if v_ans not like 'P0001 refund_in_progress:%' then
    raise exception 'CASE 4 FAILED: the admin Retry with a refund pending answered %', v_ans;
  end if;
  if (select lazywait_sync_state from public.orders where id = v_o) is distinct from 'dead_letter' then
    raise exception 'CASE 4 FAILED: the refused Retry moved the order';
  end if;

  -- (b) Refund paid out.
  select id into v_rid from public.order_refunds where order_id = v_o;
  select coalesce(array_agg(id), '{}') into v_exc from public.order_refunds where id <> v_rid;
  if (select cr.refund_id from public.claim_order_refund('case4', v_exc) cr) is distinct from v_rid then
    raise exception 'CASE 4 FAILED: setup, the refund of a received order was not claimable';
  end if;
  if not public.finalize_order_refund(v_rid, 'case4', 'succeeded', 'rf_case4', null, null) then
    raise exception 'CASE 4 FAILED: setup, the refund was not finalized';
  end if;
  v_ans := pg_temp.admin_retry(v_o);
  if v_ans not like 'P0001 refund_in_progress:%' then
    raise exception 'CASE 4 FAILED: the admin Retry after the refund was paid out answered %', v_ans;
  end if;
  select * into o from public.orders where id = v_o;
  if o.lazywait_sync_state is distinct from 'dead_letter' or o.refund_state is distinct from 'refunded' then
    raise exception 'CASE 4 FAILED: the refunded order ended % / %', o.lazywait_sync_state, o.refund_state;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5 — guard: the pre-send gate
-- ---------------------------------------------------------------------------
do $$
declare
  v_c    uuid := pg_temp.new_customer();
  v_o    uuid;
  v_ans  text;
  o      public.orders;
  v_st   text;
  v_rs   text;
begin
  -- Each status, cash, put in the shape a claim leaves.
  foreach v_st in array array['received', 'preparing', 'ready', 'out_for_delivery', 'delivered'] loop
    v_o := pg_temp.place_cash(pg_temp.new_customer());
    set local session_replication_role = replica;
    update public.orders set status = v_st::public.order_status where id = v_o;
    set local session_replication_role = origin;
    perform pg_temp.make_syncing(v_o);
    v_ans := public.begin_lazywait_create_attempt(v_o, 'case5');
    select * into o from public.orders where id = v_o;
    if v_st in ('received', 'preparing') then
      if v_ans is distinct from 'ready_to_send' or o.pos_create_attempt_token is distinct from 'case5' then
        raise exception 'CASE 5 FAILED: a % order was answered % (expected ready_to_send)', v_st, v_ans;
      end if;
    else
      if v_ans is distinct from 'order_progressed' or o.lazywait_sync_state is distinct from 'blocked'
         or o.sync_blocked_reason is distinct from 'order_progressed' or o.pos_create_attempted_at is not null then
        raise exception 'CASE 5 FAILED: a % order was answered % and left % / %', v_st, v_ans, o.lazywait_sync_state, o.sync_blocked_reason;
      end if;
      if exists (select 1 from public.notification_log where order_id = v_o and created_at >= o.updated_at) then
        raise exception 'CASE 5 FAILED: the gate refusal of a % order queued a notification', v_st;
      end if;
    end if;
  end loop;

  -- Each refund lifecycle on a received order.
  foreach v_rs in array array['pending', 'processing', 'refunded', 'failed'] loop
    v_o := pg_temp.place_cash(pg_temp.new_customer());
    set local session_replication_role = replica;
    update public.orders set refund_state = v_rs where id = v_o;
    set local session_replication_role = origin;
    perform pg_temp.make_syncing(v_o);
    v_ans := public.begin_lazywait_create_attempt(v_o, 'case5');
    select * into o from public.orders where id = v_o;
    if v_ans is distinct from 'refund_started' or o.lazywait_sync_state is distinct from 'blocked'
       or o.sync_blocked_reason is distinct from 'refund_started' or o.pos_create_attempted_at is not null then
      raise exception 'CASE 5 FAILED: an order with refund % was answered % and left % / %', v_rs, v_ans, o.lazywait_sync_state, o.sync_blocked_reason;
    end if;
    if (select count(*) from public.integration_sync_logs where order_id = v_o and status = 'skipped'
         and error = 'refund_started_before_send') <> 1 then
      raise exception 'CASE 5 FAILED: the refund refusal did not log exactly one skipped row';
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 6 — guard: the POS-failure refund only for a received order
-- ---------------------------------------------------------------------------
do $$
declare
  v_c   uuid := pg_temp.new_customer();
  v_rcv uuid;
  v_o   uuid;
  v_st  text;
  o     public.orders;
begin
  -- Control: received, fails at the POS until the budget is spent → refund.
  v_rcv := pg_temp.place_paid(v_c);
  perform pg_temp.fail_until_refund(v_c, v_rcv);
  select * into o from public.orders where id = v_rcv;
  if o.refund_state is distinct from 'pending'
     or (select count(*) from public.order_refunds where order_id = v_rcv) <> 1 then
    raise exception 'CASE 6 FAILED: a received paid order that failed at the POS was not enrolled (%)', o.refund_state;
  end if;

  -- Staff moved it on first; the POS then fails with the budget spent.
  foreach v_st in array array['preparing', 'ready', 'out_for_delivery', 'delivered'] loop
    v_o := pg_temp.place_paid(v_c);
    set local session_replication_role = replica;
    update public.orders set status = v_st::public.order_status where id = v_o;
    set local session_replication_role = origin;
    update public.orders
       set lazywait_sync_state = 'blocked', sync_blocked_reason = 'client_error_422',
           sync_last_error = 'client_error_422', pos_create_attempted_at = null,
           pos_customer_retry_count = public.customer_pos_resend_limit()
     where id = v_o;
    select * into o from public.orders where id = v_o;
    if o.refund_state is distinct from 'none' or o.refund_required_at is not null
       or exists (select 1 from public.order_refunds where order_id = v_o) then
      raise exception 'CASE 6 FAILED: a % paid order that failed at the POS was enrolled (refund %)', v_st, o.refund_state;
    end if;
    -- A later unrelated update does not enrol it either.
    update public.orders set notes = 'later update' where id = v_o;
    if (select refund_state from public.orders where id = v_o) is distinct from 'none' then
      raise exception 'CASE 6 FAILED: a later update enrolled the % order', v_st;
    end if;
  end loop;

  -- Nothing paid is stranded: a moved-on order the branch cannot fulfil is
  -- cancelled, and the cancellation refunds it (20261018120000).
  v_o := pg_temp.place_paid(v_c);
  perform pg_temp.attempt(v_o, 'refused_4xx');
  if pg_temp.admin_status(v_o, 'preparing') <> 'OK' then
    raise exception 'CASE 6 FAILED: setup, staff could not move a paid order to preparing';
  end if;
  if pg_temp.admin_status(v_o, 'cancelled') <> 'OK' then
    raise exception 'CASE 6 FAILED: staff could not cancel a preparing paid order';
  end if;
  select * into o from public.orders where id = v_o;
  if o.refund_state is distinct from 'pending'
     or (select reason from public.order_refunds where order_id = v_o) is distinct from 'order_cancelled' then
    raise exception 'CASE 6 FAILED: a cancelled preparing paid order was not refunded (%)', o.refund_state;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 7 — guard: no fulfilment while the money is going back
-- ---------------------------------------------------------------------------
do $$
declare
  v_c   uuid := pg_temp.new_customer();
  v_o   uuid;
  v_ans text;
  v_rid uuid;
  v_exc uuid[];
  v_rs  text;
  v_st  text;
begin
  -- Pending, from the real enrolment.
  v_o := pg_temp.place_paid(v_c);
  perform pg_temp.fail_until_refund(v_c, v_o);
  if (select refund_state from public.orders where id = v_o) is distinct from 'pending' then
    raise exception 'CASE 7 FAILED: setup, no refund pending';
  end if;
  v_ans := pg_temp.admin_status(v_o, 'preparing');
  if v_ans not like 'P0001 refund_in_progress: This order''s payment is being refunded to the customer, so it cannot be moved to preparing.%' then
    raise exception 'CASE 7 FAILED: moving an order with a refund pending answered %', v_ans;
  end if;
  if (select status::text from public.orders where id = v_o) is distinct from 'received' then
    raise exception 'CASE 7 FAILED: the refused move changed the status';
  end if;

  -- Processing: claimed by the worker.
  select id into v_rid from public.order_refunds where order_id = v_o;
  select coalesce(array_agg(id), '{}') into v_exc from public.order_refunds where id <> v_rid;
  perform 1 from public.claim_order_refund('case7', v_exc);
  if (select refund_state from public.orders where id = v_o) is distinct from 'processing' then
    raise exception 'CASE 7 FAILED: setup, the refund was not claimed';
  end if;
  v_ans := pg_temp.admin_status(v_o, 'preparing');
  if v_ans not like 'P0001 refund_in_progress:%' then
    raise exception 'CASE 7 FAILED: moving an order whose refund is processing answered %', v_ans;
  end if;

  -- Refunded.
  perform public.finalize_order_refund(v_rid, 'case7', 'succeeded', 'rf_case7', null, null);
  v_ans := pg_temp.admin_status(v_o, 'preparing');
  if v_ans not like 'P0001 refund_in_progress: This order''s payment has been refunded%' then
    raise exception 'CASE 7 FAILED: moving a refunded order answered %', v_ans;
  end if;
  -- Cancelling is the exit, and opens no second refund.
  if pg_temp.admin_status(v_o, 'cancelled') <> 'OK' then
    raise exception 'CASE 7 FAILED: a refunded order could not be cancelled';
  end if;
  if (select count(*) from public.order_refunds where order_id = v_o) <> 1 then
    raise exception 'CASE 7 FAILED: cancelling a refunded order opened a second refund';
  end if;

  -- Each live or completed refund, on an order already moved on (the shape
  -- left by a refund opened before 20261022120000): delivering is refused.
  foreach v_rs in array array['pending', 'processing', 'refunded'] loop
    foreach v_st in array array['ready', 'out_for_delivery'] loop
      v_o := pg_temp.place_cash(pg_temp.new_customer());
      set local session_replication_role = replica;
      update public.orders set status = v_st::public.order_status, refund_state = v_rs where id = v_o;
      set local session_replication_role = origin;
      v_ans := pg_temp.admin_status(v_o, 'delivered');
      if v_ans not like 'P0001 refund_in_progress:%delivered%' then
        raise exception 'CASE 7 FAILED: delivering a % order with refund % answered %', v_st, v_rs, v_ans;
      end if;
    end loop;
  end loop;

  -- A refund the worker stopped ('failed') does not block.
  v_o := pg_temp.place_cash(pg_temp.new_customer());
  set local session_replication_role = replica;
  update public.orders set refund_state = 'failed' where id = v_o;
  set local session_replication_role = origin;
  if pg_temp.admin_status(v_o, 'preparing') <> 'OK' then
    raise exception 'CASE 7 FAILED: an order whose refund failed could not be moved on';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 8 — guard: the refund worker is never handed a fulfilled order
-- ---------------------------------------------------------------------------
do $$
declare
  v_c    uuid := pg_temp.new_customer();
  v_rcv  uuid;
  v_can  uuid;
  v_ids  uuid[] := '{}';
  v_o    uuid;
  v_st   text;
  v_exc  uuid[];
  v_got  uuid[] := '{}';
  r      record;
  n      int := 0;
begin
  -- Refunds opened before 20261022120000 on orders the branch went on to
  -- fulfil: inserted as they would stand, every trigger off.
  foreach v_st in array array['preparing', 'ready', 'out_for_delivery', 'delivered'] loop
    v_o := pg_temp.place_paid(v_c);
    set local session_replication_role = replica;
    update public.orders set status = v_st::public.order_status, refund_state = 'pending' where id = v_o;
    insert into public.order_refunds (order_id, provider, idempotency_key, amount, currency, status, reason)
      values (v_o, 'moyasar', 'refund_' || replace(v_o::text, '-', ''), 40, 'SAR', 'pending',
              'pos_delivery_failed_after_customer_retries');
    set local session_replication_role = origin;
    v_ids := v_ids || v_o;
  end loop;
  -- A received order's refund and a cancelled order's refund, the two real ones.
  v_rcv := pg_temp.place_paid(v_c);
  perform pg_temp.fail_until_refund(v_c, v_rcv);
  v_can := pg_temp.place_paid(v_c);
  if pg_temp.admin_status(v_can, 'cancelled') <> 'OK' then raise exception 'CASE 8 FAILED: setup, cancel'; end if;

  -- Drain the queue, as the worker does, excluding every refund outside this case.
  select coalesce(array_agg(id), '{}') into v_exc from public.order_refunds
   where not (order_id = any (v_ids || array[v_rcv, v_can]));
  loop
    select * into r from public.claim_order_refund('case8', v_exc) limit 1;
    exit when r.refund_id is null;
    v_exc := v_exc || r.refund_id;
    v_got := v_got || r.order_id;
    n := n + 1;
    exit when n > 20;
  end loop;
  if v_got && v_ids then
    raise exception 'CASE 8 FAILED: the worker was handed a refund for a fulfilled order (%)',
      (select string_agg(status::text, ',') from public.orders where id = any (v_got) and id = any (v_ids));
  end if;
  if not (v_rcv = any (v_got)) or not (v_can = any (v_got)) or n <> 2 then
    raise exception 'CASE 8 FAILED: the claim handed out % refunds, not exactly the received and the cancelled one', n;
  end if;
  if (select count(*) from public.order_refunds where order_id = any (v_ids) and status = 'pending') <> 4 then
    raise exception 'CASE 8 FAILED: a fulfilled order''s refund was touched';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 9 — honest: a cash order end to end
-- ---------------------------------------------------------------------------
do $$
declare
  v_c  uuid := pg_temp.new_customer();
  v_o  uuid;
  v_st text;
  o    public.orders;
begin
  v_o := pg_temp.place_cash(v_c);
  if pg_temp.attempt(v_o, 'ok') <> 'ok' then
    raise exception 'CASE 9 FAILED: a new cash order was not sent';
  end if;
  foreach v_st in array array['preparing', 'ready', 'delivered'] loop
    if pg_temp.admin_status(v_o, v_st) <> 'OK' then
      raise exception 'CASE 9 FAILED: staff could not move a cash order to %', v_st;
    end if;
  end loop;
  select * into o from public.orders where id = v_o;
  if o.status::text <> 'delivered' or o.lazywait_sync_state <> 'synced' or o.refund_state <> 'none'
     or exists (select 1 from public.order_refunds where order_id = v_o) then
    raise exception 'CASE 9 FAILED: the cash order ended % / % / refund %', o.status, o.lazywait_sync_state, o.refund_state;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 10 — the trigger and the grants
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.orders'::regclass and tgname = 'set_orders_refund_progress_guard'
                    and not tgisinternal and tgenabled = 'O') then
    raise exception 'CASE 10 FAILED: set_orders_refund_progress_guard is missing or disabled';
  end if;
  for r in
    select * from (values
      ('public.begin_lazywait_create_attempt(uuid, text)', false, true),
      ('public.request_customer_pos_resend(uuid)',         true,  false),
      ('public.requeue_lazywait_order(uuid)',              true,  false),
      ('public.claim_order_refund(text, uuid[])',          false, true),
      ('public.guard_order_progress_refund()',             false, false)
    ) as t(sig, authed, service)
  loop
    if has_function_privilege('anon', r.sig, 'execute') then
      raise exception 'CASE 10 FAILED: anon can execute %', r.sig;
    end if;
    if has_function_privilege('authenticated', r.sig, 'execute') is distinct from r.authed then
      raise exception 'CASE 10 FAILED: authenticated EXECUTE on % is not %', r.sig, r.authed;
    end if;
    if r.service and not has_function_privilege('service_role', r.sig, 'execute') then
      raise exception 'CASE 10 FAILED: service_role cannot execute %', r.sig;
    end if;
  end loop;
end $$;

select 'pos_resend_refund_guards_test: all cases passed' as result;
rollback;
