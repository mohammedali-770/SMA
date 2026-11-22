-- ============================================================================
-- A cancelled order is never resent, sent, refunded automatically or paid
-- (migration 20261012120000_cancelled_orders_guard.sql; card-payment gaps
-- PG-03 and PG-27, and docs/OWNER_ACTIONS.md §47.13).
--
-- AMENDED for 20261018120000_refund_cancelled_paid_orders (the owner's
-- decision of 2026-11-19, "do the auto refund"): a paid card order is now
-- refunded automatically AT its cancellation, once, with reason
-- 'order_cancelled'. What this suite still pins is the 20261012120000 rule:
-- the POS-failure refund (order_refund_due) never fires for a cancelled order,
-- so a cancelled order never gets a SECOND refund from that path. CASE 7's
-- fixtures are inserted already cancelled, the shape the new rule never
-- enrols, and CASE 13 now asserts the one cancellation refund deliberately.
-- The new rule itself: supabase/tests/refund_cancelled_paid_orders_test.sql.
--
-- Every GUARD case fails on the chain before that migration and passes with
-- it. Every HONEST case passes on both: it is the flow the guard must not
-- break. Each raises 'CASE n FAILED: ...'. To see every case on an older
-- chain, run it with -v ON_ERROR_STOP=0 -v ON_ERROR_ROLLBACK=on.
--
--   CASE 1   guard   PG-03  Resend: a cancelled order is refused, with a reason and
--                           a message, and nothing about the order moves
--   CASE 2   honest  PG-03  Resend: an eligible RECEIVED order is still re-queued
--                           (AMENDED for 20261022120000: the other statuses are
--                           refused as order_in_progress)
--   CASE 3   guard   PG-03  Resend: an order nobody owns any more is refused
--                           (the NULL-safe ownership test)
--   CASE 4   guard   PG-03  Resend: a cancelled order whose refund exists keeps the
--                           refund as its state
--   CASE 5   g+h     PG-03  claim_lazywait_sync_one: never a cancelled order, still an
--                           order in every other status
--   CASE 6   g+h     PG-03  claim_lazywait_sync_batch: never a cancelled order, still
--                           orders in every other status, in queue order
--   CASE 7   g+h     PG-03  the refund trigger: a cancelled order is enrolled by no
--                           path; an eligible RECEIVED order still is (AMENDED for
--                           20261022120000: a progressed one is not)
--   CASE 8   guard   PG-27  place_customer_order refuses 'online' however written,
--                           and creates nothing
--   CASE 9   guard   PG-27  place_customer_order refuses a call with no method that
--                           would resolve to online
--   CASE 10  honest  PG-27  cash, and a method-less call that resolves to cash,
--                           still place
--   CASE 11  guard   §47.13 begin_payment_attempt opens and reuses nothing for a
--                           cancelled order
--   CASE 12  honest  §47.13 begin_payment_attempt still serves an unpaid online
--                           order; begin_session_attempt (the app's card path) is
--                           unaffected
--   CASE 13  guard   PG-03  the gap's own story, end to end: a paid order that never
--                           reached the branch is cancelled by an administrator,
--                           and then neither Resend nor the worker acts on it,
--                           and the POS-failure rule adds no second refund to
--                           the one cancellation refund (since 20261018120000)
--   CASE 14  g+h            the money-path pair, and grants: anon executes none of
--                           the six, the app keeps what it calls
--   CASE 15  honest  PG-03  Resend: a customer who does not own a cancelled order
--                           learns nothing about it ("not found", no log row), so
--                           the cancelled refusal stays behind the ownership test
-- ============================================================================
begin;

-- Every impersonation helper runs `discard plans` before switching role: a plan
-- cached as postgres can skip an EXECUTE check (see server_input_bounds_test).
create function pg_temp.as_nobody() returns void language sql as $$
  select set_config('test.auth_uid', '', true),
         set_config('test.is_admin', '', true),
         set_config('test.is_staff', '', true);
$$;

-- Resend as a signed-in customer; the response, or {error, message}.
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

-- Place an order as a signed-in customer: 'OK <id>' or '<sqlstate> <hint|message>'.
create function pg_temp.place_as(p_uid uuid, p_method text, p_key uuid default null) returns text
language plpgsql as $$
declare v jsonb; s text; v_hint text; v_msg text;
begin
  perform set_config('test.auth_uid', p_uid::text, true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.is_admin', 'false', true);
  discard plans;
  set local role authenticated;
  begin
    v := public.place_customer_order(
      (select fx_id from t_fx where k = 'branch'), 'pickup',
      jsonb_build_array(jsonb_build_object('product_id', (select fx_id from t_fx where k = 'prod'), 'quantity', 1)),
      null, null, null, 0, p_key, p_method);
    s := 'OK ' || (v ->> 'id');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    s := sqlstate || ' ' || coalesce(nullif(v_hint, ''), v_msg);
  end;
  reset role;
  perform pg_temp.as_nobody();
  return s;
end $$;

-- A customer. With a phone, phone-verified, the way a WhatsApp sign-in makes
-- one (place_customer_order needs that); without one, an ordinary account.
-- The numbers are invented and on scripts/test-phone-allowlist.json.
create function pg_temp.new_customer(p_phone text default null) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  if p_phone is null then
    insert into auth.users (id) values (v);
  else
    insert into auth.users (id, phone, phone_confirmed_at) values (v, p_phone, now());
  end if;
  return v;
end $$;

-- An order in an exact sync shape. Inserted with triggers off, so the insert
-- triggers do not put it back in the queue; every later UPDATE fires them all.
create function pg_temp.new_order(
  p_customer uuid,
  p_status   public.order_status,
  p_method   text,
  p_pay      public.payment_status,
  p_state    text,
  p_retries  integer     default 0,
  p_next     timestamptz default null,
  p_refund   text        default 'none',
  p_total    numeric     default 25
) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.orders (id, customer_id, order_number, branch_id, order_type, status,
                             subtotal, total, payment_method, payment_status,
                             lazywait_sync_state, pos_customer_retry_count, sync_next_attempt_at,
                             pos_sync_started_at, pos_sync_deadline_at, refund_state)
  values (v, p_customer, 'COG-' || replace(v::text, '-', ''), (select fx_id from t_fx where k = 'branch'),
          'pickup', p_status, p_total, p_total, p_method, p_pay,
          p_state, p_retries, p_next, now() - interval '1 minute', now() + interval '9 minutes', p_refund);
  set local session_replication_role = origin;
  return v;
end $$;

create temporary table t_fx (k text primary key, fx_id uuid);

do $$
declare
  v_branch uuid := gen_random_uuid();
  v_cat    uuid := gen_random_uuid();
  v_prod   uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.branches (id, name_en, name_ar, is_active) values (v_branch, 'Cancelled guard', 'Cancelled guard', true);
  insert into public.categories (id, name_en, name_ar, sort_order) values (v_cat, 'C', 'C', 1);
  insert into public.products (id, category_id, name_en, name_ar, price, is_active, sort_order)
    values (v_prod, v_cat, 'P', 'P', 25, true, 1);
  set local session_replication_role = origin;
  insert into t_fx values ('branch', v_branch), ('prod', v_prod);
end $$;
grant select on t_fx to authenticated;

update public.app_settings
   set cash_payment_enabled = true, online_payment_enabled = true, default_payment_method = 'cash'
 where id = true;

-- ---------------------------------------------------------------------------
-- CASE 1 — guard: a cancelled order is refused, and nothing about it moves
-- ---------------------------------------------------------------------------
do $$
declare
  v_c    uuid := pg_temp.new_customer();
  v_cash uuid;
  v_paid uuid;
  v_res  jsonb;
  o      public.orders;
  v_id   uuid;
begin
  -- Cash, proven not sent, budget untouched: every other test says "eligible".
  v_cash := pg_temp.new_order(v_c, 'cancelled', 'cash', 'pending', 'failed');
  -- Paid by card, one resend already spent.
  v_paid := pg_temp.new_order(v_c, 'cancelled', 'online', 'paid', 'failed', 1);

  foreach v_id in array array[v_cash, v_paid] loop
    v_res := pg_temp.resend_as(v_c, v_id);
    if v_res->>'outcome' is distinct from 'unavailable' then
      raise exception 'CASE 1 FAILED: a cancelled order was not refused: %', v_res;
    end if;
    if v_res->>'reason' is distinct from 'order_cancelled' then
      raise exception 'CASE 1 FAILED: the refusal carries no order_cancelled reason: %', v_res;
    end if;
    if v_res->>'message' is distinct from 'This order was cancelled, so it was not sent to the branch.' then
      raise exception 'CASE 1 FAILED: the refusal carries no message the app can show: %', v_res;
    end if;
    if v_res->>'state' is distinct from 'order_cancelled' then
      raise exception 'CASE 1 FAILED: advisory state %, expected order_cancelled', v_res->>'state';
    end if;
    select * into o from public.orders where id = v_id;
    if o.lazywait_sync_state <> 'failed' or o.sync_next_attempt_at is not null then
      raise exception 'CASE 1 FAILED: the refused order was re-queued (% / %)', o.lazywait_sync_state, o.sync_next_attempt_at;
    end if;
    if o.pos_customer_retry_count <> (case when v_id = v_paid then 1 else 0 end) then
      raise exception 'CASE 1 FAILED: a refusal spent a resend (%)', o.pos_customer_retry_count;
    end if;
    if not exists (select 1 from public.integration_sync_logs
                    where order_id = v_id and status = 'skipped' and error = 'resend_rejected_order_cancelled') then
      raise exception 'CASE 1 FAILED: the refusal was not logged as resend_rejected_order_cancelled';
    end if;
    if exists (select 1 from public.integration_sync_logs where order_id = v_id and status = 'success') then
      raise exception 'CASE 1 FAILED: a success sync log was written for a refused resend';
    end if;
  end loop;
  raise notice 'CASE 1 ok: a cancelled order is refused with a reason and a message, and stays as it was';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — honest: an eligible order in every status but cancelled is still
-- re-queued. Every status is probed, so a guard that also refused a later
-- status (a paid order that failed to send while it was being prepared) fails.
-- ---------------------------------------------------------------------------
-- AMENDED for 20261022120000_pos_resend_refund_guards (audit F-X04-001). The
-- paragraph above is the rule that finding records as the defect: a Resend on an
-- order staff have moved on sends a second ticket for food already being made
-- or handed over. A received order is still re-queued exactly once; the four
-- later statuses are now refused with reason order_in_progress and left as they
-- were. Full behaviour: supabase/tests/pos_resend_refund_guards_test.sql CASE 1.
do $$
declare
  v_c   uuid := pg_temp.new_customer();
  v_id  uuid;
  v_res jsonb;
  v_st  public.order_status;
  o     public.orders;
begin
  foreach v_st in array array['preparing', 'ready', 'out_for_delivery', 'delivered']::public.order_status[] loop
    v_id := pg_temp.new_order(v_c, v_st, 'cash', 'pending', 'failed');
    v_res := pg_temp.resend_as(v_c, v_id);
    select * into o from public.orders where id = v_id;
    if v_res->>'outcome' is distinct from 'unavailable' or v_res->>'reason' is distinct from 'order_in_progress'
       or o.lazywait_sync_state <> 'failed' or o.pos_customer_retry_count <> 0 then
      raise exception 'CASE 2 FAILED: a % order was not refused as order_in_progress: % (% / %)', v_st, v_res, o.lazywait_sync_state, o.pos_customer_retry_count;
    end if;
  end loop;
  foreach v_st in array array['received']::public.order_status[] loop
    v_id := pg_temp.new_order(v_c, v_st, 'cash', 'pending', 'failed');
    v_res := pg_temp.resend_as(v_c, v_id);
    if v_res->>'outcome' is distinct from 'accepted' then
      raise exception 'CASE 2 FAILED: an eligible % order was refused: %', v_st, v_res;
    end if;
    select * into o from public.orders where id = v_id;
    if o.lazywait_sync_state <> 'pending' or o.pos_customer_retry_count <> 1 then
      raise exception 'CASE 2 FAILED: the % resend did not queue exactly one send (% / %)', v_st, o.lazywait_sync_state, o.pos_customer_retry_count;
    end if;
  end loop;
  raise notice 'CASE 2 ok: an eligible received order is re-queued once; the four later statuses are order_in_progress';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — guard: an order nobody owns any more is refused
-- ---------------------------------------------------------------------------
-- orders.customer_id is ON DELETE SET NULL, so an account deletion leaves the
-- order with no owner. `customer_id <> auth.uid()` is then NULL, not true, and
-- every signed-in caller passed the ownership test.
do $$
declare
  v_c   uuid := pg_temp.new_customer();
  v_id  uuid;
  v_res jsonb;
  o     public.orders;
begin
  v_id := pg_temp.new_order(null, 'received', 'cash', 'pending', 'failed');
  v_res := pg_temp.resend_as(v_c, v_id);
  if v_res->>'error' is distinct from 'P0002' then
    raise exception 'CASE 3 FAILED: a signed-in caller could resend an order with no owner: %', v_res;
  end if;
  select * into o from public.orders where id = v_id;
  if o.lazywait_sync_state <> 'failed' or o.pos_customer_retry_count <> 0 then
    raise exception 'CASE 3 FAILED: the ownerless order moved (% / %)', o.lazywait_sync_state, o.pos_customer_retry_count;
  end if;
  raise notice 'CASE 3 ok: an ownerless order is "not found" to every caller';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4 — guard: a cancelled order whose refund exists keeps it as its state
-- ---------------------------------------------------------------------------
do $$
declare
  v_c   uuid := pg_temp.new_customer();
  v_id  uuid;
  v_res jsonb;
begin
  v_id := pg_temp.new_order(v_c, 'cancelled', 'online', 'paid', 'dead_letter', 3, null, 'refunded');
  v_res := pg_temp.resend_as(v_c, v_id);
  if v_res->>'outcome' is distinct from 'unavailable' or v_res->>'reason' is distinct from 'order_cancelled' then
    raise exception 'CASE 4 FAILED: expected an order_cancelled refusal, got %', v_res;
  end if;
  if v_res->>'state' is distinct from 'final_failure_refunded' then
    raise exception 'CASE 4 FAILED: a refunded order should say so, got state %', v_res->>'state';
  end if;
  raise notice 'CASE 4 ok: the refund, once it exists, stays the customer''s story';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5 — claim_lazywait_sync_one: never a cancelled order, still a received one
-- ---------------------------------------------------------------------------
do $$
declare
  v_cancelled uuid := pg_temp.new_order(null, 'cancelled', 'cash', 'pending', 'pending', 0, now() - interval '1 minute');
  v_received  uuid := pg_temp.new_order(null, 'received',  'cash', 'pending', 'pending', 0, now() - interval '1 minute');
  v_status    public.order_status;
  v_other     uuid;
  v_n int;
begin
  select count(*) into v_n from public.claim_lazywait_sync_one(v_cancelled);
  if v_n <> 0 then raise exception 'CASE 5 FAILED: a cancelled order was claimed for the POS'; end if;
  if (select lazywait_sync_state from public.orders where id = v_cancelled) <> 'pending' then
    raise exception 'CASE 5 FAILED: the cancelled order changed state';
  end if;

  select count(*) into v_n from public.claim_lazywait_sync_one(v_received);
  if v_n <> 1 then raise exception 'CASE 5 FAILED: a due received order was not claimed'; end if;
  if (select lazywait_sync_state from public.orders where id = v_received) <> 'syncing' then
    raise exception 'CASE 5 FAILED: the claimed order is not syncing';
  end if;

  -- Every other status still reaches the POS: the filter is "not cancelled",
  -- not "received or preparing".
  foreach v_status in array array['preparing', 'ready', 'out_for_delivery', 'delivered']::public.order_status[] loop
    v_other := pg_temp.new_order(null, v_status, 'cash', 'pending', 'pending', 0, now() - interval '1 minute');
    select count(*) into v_n from public.claim_lazywait_sync_one(v_other);
    if v_n <> 1 then raise exception 'CASE 5 FAILED: a due % order was not claimed', v_status; end if;
  end loop;
  raise notice 'CASE 5 ok: the targeted claim skips a cancelled order and takes one in every other status';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 6 — claim_lazywait_sync_batch: never a cancelled order, in queue order
-- ---------------------------------------------------------------------------
do $$
declare
  -- The cancelled order is the most overdue of anything in the queue, so a
  -- missing filter would take it first. Other cases leave due orders behind,
  -- which is why the second batch is read for these three ids only.
  v_cancelled uuid := pg_temp.new_order(null, 'cancelled', 'cash',   'pending', 'pending', 0, '2000-01-01 00:00:00+00');
  v_first     uuid := pg_temp.new_order(null, 'received',  'cash',   'pending', 'pending', 0, '2000-01-01 00:01:00+00');
  v_second    uuid := pg_temp.new_order(null, 'preparing', 'online', 'paid',    'pending', 0, '2000-01-01 00:02:00+00');
  v_ready     uuid := pg_temp.new_order(null, 'ready',            'cash', 'pending', 'pending', 0, '2000-01-01 00:03:00+00');
  v_out       uuid := pg_temp.new_order(null, 'out_for_delivery', 'cash', 'pending', 'pending', 0, '2000-01-01 00:04:00+00');
  v_delivered uuid := pg_temp.new_order(null, 'delivered',        'cash', 'pending', 'pending', 0, '2000-01-01 00:05:00+00');
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.claim_lazywait_sync_batch(1);
  if v_ids is distinct from array[v_first] then
    raise exception 'CASE 6 FAILED: claim_lazywait_sync_batch(1) took %, expected the oldest received order', v_ids;
  end if;
  select array_agg(id order by sync_next_attempt_at) into v_ids from public.claim_lazywait_sync_batch(100)
   where id in (v_cancelled, v_first, v_second, v_ready, v_out, v_delivered);
  if v_ids is distinct from array[v_second, v_ready, v_out, v_delivered] then
    raise exception 'CASE 6 FAILED: the second batch took %, expected the four remaining non-cancelled orders', v_ids;
  end if;
  if (select lazywait_sync_state from public.orders where id = v_cancelled) <> 'pending' then
    raise exception 'CASE 6 FAILED: the cancelled order changed state';
  end if;
  raise notice 'CASE 6 ok: the scheduled claim never takes a cancelled order';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 7 — the refund trigger: no POS-failure path enrols a cancelled order
-- ---------------------------------------------------------------------------
-- Since 20261018120000 a cancelled paid card order IS enrolled, once, by the
-- write that cancels it. These fixtures are inserted already cancelled (with
-- triggers off), which that rule deliberately never enrols, so what this case
-- pins is unchanged: the POS-failure rule never fires for a cancelled order.
do $$
declare
  v_by_resend   uuid := pg_temp.new_order(null, 'cancelled', 'online', 'paid', 'syncing', 3);
  v_by_sweep    uuid;
  v_direct      uuid := pg_temp.new_order(null, 'cancelled', 'online', 'paid', 'pending', 3);
  v_eligible    uuid := pg_temp.new_order(null, 'received',  'online', 'paid', 'syncing', 3);
  v_status      public.order_status;
  v_id          uuid;
  o             public.orders;
begin
  -- (a) The worker records a proven failure on the third resend: failed -> the
  -- limit trigger makes it dead_letter -> the refund rule is asked.
  update public.orders set lazywait_sync_state = 'failed', sync_last_error = 'http_500' where id in (v_by_resend, v_eligible);

  -- (b) The deadline sweep: a failed order whose POS deadline has passed.
  v_by_sweep := pg_temp.new_order(null, 'cancelled', 'online', 'paid', 'failed', 3);
  update public.orders set pos_sync_deadline_at = now() - interval '1 minute' where id = v_by_sweep;
  perform public.reap_stale_lazywait_syncs(10, 5);

  -- (c) A direct write of the refund-due shape.
  update public.orders set lazywait_sync_state = 'dead_letter' where id = v_direct;

  foreach v_id in array array[v_by_resend, v_by_sweep, v_direct] loop
    select * into o from public.orders where id = v_id;
    if o.lazywait_sync_state <> 'dead_letter' then
      raise exception 'CASE 7 FAILED: fixture % did not reach dead_letter (%)', v_id, o.lazywait_sync_state;
    end if;
    if o.refund_state <> 'none' then
      raise exception 'CASE 7 FAILED: a cancelled order was enrolled for an automatic refund (%)', o.refund_state;
    end if;
    if exists (select 1 from public.order_refunds where order_id = v_id) then
      raise exception 'CASE 7 FAILED: a refund record was opened for a cancelled order';
    end if;
  end loop;

  -- (d) Any later write to it changes nothing.
  update public.orders set notes = 'later edit' where id = v_direct;
  if (select refund_state from public.orders where id = v_direct) <> 'none' then
    raise exception 'CASE 7 FAILED: a later edit enrolled the cancelled order';
  end if;

  -- Honest: the same story for an order that was never cancelled.
  select * into o from public.orders where id = v_eligible;
  if o.lazywait_sync_state <> 'dead_letter' or o.refund_state <> 'pending' then
    raise exception 'CASE 7 FAILED: an eligible paid order was not enrolled (% / %)', o.lazywait_sync_state, o.refund_state;
  end if;
  if (select count(*) from public.order_refunds
       where order_id = v_eligible and reason = 'pos_delivery_failed_after_customer_retries') <> 1 then
    raise exception 'CASE 7 FAILED: an eligible paid order did not get exactly one refund record';
  end if;

  -- AMENDED for 20261022120000_pos_resend_refund_guards (audit F-X04-002). This
  -- loop used to require enrolment in every other status ("the trigger skips
  -- cancelled, nothing more"), which is the defect: a delivered order refunded in
  -- full. The POS-failure refund is now enrolled only while the order is
  -- received; an order staff have moved on is cancelled to be refunded. Full
  -- behaviour: supabase/tests/pos_resend_refund_guards_test.sql CASE 6.
  foreach v_status in array array['preparing', 'ready', 'out_for_delivery', 'delivered']::public.order_status[] loop
    v_id := pg_temp.new_order(null, v_status, 'online', 'paid', 'pending', 3);
    update public.orders set lazywait_sync_state = 'dead_letter' where id = v_id;
    if (select refund_state from public.orders where id = v_id) <> 'none'
       or (select count(*) from public.order_refunds where order_id = v_id) <> 0 then
      raise exception 'CASE 7 FAILED: a paid % order was enrolled for the POS-failure refund', v_status;
    end if;
  end loop;
  raise notice 'CASE 7 ok: no path enrols a cancelled order, an eligible received one is still enrolled, and a progressed one is not';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 8 — place_customer_order refuses 'online' however written
-- ---------------------------------------------------------------------------
do $$
declare
  v_c      uuid := pg_temp.new_customer('966500009108');
  v_method text;
  r        text;
  v_seq    text := (select last_value || '/' || is_called from public.order_number_seq);
begin
  foreach v_method in array array['online', 'ONLINE', '  Online '] loop
    r := pg_temp.place_as(v_c, v_method);
    if r is distinct from 'P0001 online_orders_use_checkout' then
      raise exception 'CASE 8 FAILED: method "%" answered "%"', v_method, r;
    end if;
  end loop;
  if exists (select 1 from public.orders where customer_id = v_c) then
    raise exception 'CASE 8 FAILED: a refused call left an order behind';
  end if;
  -- Refused before place_order: no SM- number was drawn (a sequence is not
  -- rolled back, so a refusal after the insert would leave a gap).
  if (select last_value || '/' || is_called from public.order_number_seq) is distinct from v_seq then
    raise exception 'CASE 8 FAILED: a refused online call drew an SM- order number';
  end if;
  raise notice 'CASE 8 ok: an online order cannot be placed through place_customer_order';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 9 — a call with no method that would resolve to online is refused too
-- ---------------------------------------------------------------------------
do $$
declare
  v_c uuid := pg_temp.new_customer('966500009109');
  r   text;
begin
  update public.app_settings set default_payment_method = 'online' where id = true;
  r := pg_temp.place_as(v_c, null);
  update public.app_settings set default_payment_method = 'cash' where id = true;
  if r is distinct from 'P0001 online_orders_use_checkout' then
    raise exception 'CASE 9 FAILED: a method-less call resolving to online answered "%"', r;
  end if;
  if exists (select 1 from public.orders where customer_id = v_c) then
    raise exception 'CASE 9 FAILED: the refused order was not rolled back';
  end if;
  raise notice 'CASE 9 ok: the resolved method is checked as well as the requested one';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 10 — honest: cash, and a method-less cash default, still place
-- ---------------------------------------------------------------------------
do $$
declare
  v_c uuid := pg_temp.new_customer('966500009110');
  r   text;
  o   public.orders;
begin
  r := pg_temp.place_as(v_c, 'cash', gen_random_uuid());
  if r not like 'OK %' then raise exception 'CASE 10 FAILED: a cash order was refused: %', r; end if;
  select * into o from public.orders where id = substr(r, 4)::uuid;
  if o.payment_method <> 'cash' or o.lazywait_sync_state <> 'pending' then
    raise exception 'CASE 10 FAILED: the cash order is % / %', o.payment_method, o.lazywait_sync_state;
  end if;

  r := pg_temp.place_as(v_c, null, gen_random_uuid());
  if r not like 'OK %' then raise exception 'CASE 10 FAILED: a method-less call with the cash default was refused: %', r; end if;
  if (select payment_method from public.orders where id = substr(r, 4)::uuid) <> 'cash' then
    raise exception 'CASE 10 FAILED: the method-less order did not resolve to cash';
  end if;
  raise notice 'CASE 10 ok: cash orders place as before';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 11 — begin_payment_attempt opens and reuses nothing for a cancelled order
-- ---------------------------------------------------------------------------
do $$
declare
  v_fresh  uuid := pg_temp.new_order(null, 'cancelled', 'online', 'pending', 'awaiting_payment');
  v_live   uuid := pg_temp.new_order(null, 'cancelled', 'online', 'pending', 'awaiting_payment');
  v_id     uuid;
  v_code   text;
  v_msg    text;
begin
  -- An attempt opened before the order was cancelled, still live, invoice stored.
  insert into public.payment_records (order_id, provider, status, amount, currency, mode,
                                      reference_transaction, reference_order, initiated_at, expires_at,
                                      checkout_url, provider_checkout_ref)
  values (v_live, 'moyasar', 'initiated', 25, 'SAR', 'live', 'sm_cancelledguard', 'ORD-cancelledgd',
          now(), now() + interval '20 minutes', 'https://checkout.moyasar.com/invoices/inv_cg', 'inv_cg');

  foreach v_id in array array[v_fresh, v_live] loop
    v_code := 'none';
    begin
      perform public.begin_payment_attempt(v_id, 'moyasar', 'live', 30);
    exception when others then
      v_code := sqlstate; v_msg := sqlerrm;
    end;
    if v_code is distinct from 'P0001' or v_msg is distinct from 'Order is cancelled' then
      raise exception 'CASE 11 FAILED: begin_payment_attempt on a cancelled order answered % %', v_code, coalesce(v_msg, '');
    end if;
  end loop;
  if exists (select 1 from public.payment_records where order_id = v_fresh) then
    raise exception 'CASE 11 FAILED: an attempt was opened for a cancelled order';
  end if;
  if (select count(*) from public.payment_records where order_id = v_live) <> 1 then
    raise exception 'CASE 11 FAILED: the existing attempt was multiplied';
  end if;
  raise notice 'CASE 11 ok: a cancelled order cannot be invoiced, new or reused';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 12 — honest: the order flow still serves an unpaid online order, and
-- the session flow the app uses is untouched
-- ---------------------------------------------------------------------------
do $$
declare
  v_c       uuid := pg_temp.new_customer();
  v_order   uuid := pg_temp.new_order(null, 'received', 'online', 'pending', 'awaiting_payment');
  v_session uuid;
  a         record;
  b         record;
begin
  select * into a from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);
  select * into b from public.begin_payment_attempt(v_order, 'moyasar', 'test', 30);
  if a.attempt_id is null or a.reused or not b.reused or b.attempt_id <> a.attempt_id then
    raise exception 'CASE 12 FAILED: the order flow no longer opens and reuses one attempt';
  end if;
  -- Later statuses too, so a guard that also refused them fails here.
  declare v_st public.order_status; v_o uuid;
  begin
    foreach v_st in array array['preparing', 'ready', 'out_for_delivery']::public.order_status[] loop
      v_o := pg_temp.new_order(null, v_st, 'online', 'pending', 'awaiting_payment');
      select * into a from public.begin_payment_attempt(v_o, 'moyasar', 'test', 30);
      if a.attempt_id is null or a.reused then
        raise exception 'CASE 12 FAILED: no attempt was opened for an unpaid online % order', v_st;
      end if;
    end loop;
  end;

  insert into public.checkout_sessions (customer_id, order_type, branch_id, snapshot, subtotal, total)
    values (v_c, 'pickup', (select fx_id from t_fx where k = 'branch'), '{}'::jsonb, 25, 25)
    returning id into v_session;
  select * into a from public.begin_session_attempt(v_session, 'moyasar', 'test', 30);
  if a.attempt_id is null or a.reused or a.amount <> 25 then
    raise exception 'CASE 12 FAILED: begin_session_attempt no longer opens an attempt';
  end if;
  raise notice 'CASE 12 ok: both payment-attempt paths work as before for an order that is not cancelled';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 13 — the gap's story, end to end
-- ---------------------------------------------------------------------------
-- A paid card order never reached the branch. The customer calls to cancel, an
-- administrator cancels it in the console. The app still offered Resend; before
-- 20261012120000 three taps printed a ticket and, after three failures, queued
-- an automatic refund on top of the hand refund staff made then.
--
-- CHANGED DELIBERATELY for 20261018120000 (the owner's decision of 2026-11-19,
-- "do the auto refund"): the hand refund is retired, and the cancellation
-- itself now enrols exactly one automatic refund, reason 'order_cancelled'.
-- The fixture therefore carries the captured payment a real card order has,
-- and the case asserts that one refund and that the POS failures add nothing.
do $$
declare
  v_c     uuid := pg_temp.new_customer();
  v_admin uuid := gen_random_uuid();
  v_id    uuid;
  v_res   jsonb;
  v_n     int;
  i       int;
begin
  insert into auth.users (id, email) values (v_admin, 'cancelled-guard-admin@x');
  update public.profiles set role = 'admin' where id = v_admin;
  v_id := pg_temp.new_order(v_c, 'received', 'online', 'paid', 'failed');
  insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode, confirmed_at)
    values (v_id, 'moyasar', 'cog_pay_' || replace(v_id::text, '-', ''), 'paid', 25, 'SAR', 'test', now());

  perform set_config('test.auth_uid', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform public.admin_set_order_status(v_id, 'cancelled');
  perform pg_temp.as_nobody();
  if (select status from public.orders where id = v_id) <> 'cancelled' then
    raise exception 'CASE 13 FAILED: the fixture was not cancelled';
  end if;
  if (select refund_state from public.orders where id = v_id) <> 'pending'
     or (select count(*) from public.order_refunds where order_id = v_id) <> 1
     or (select reason from public.order_refunds where order_id = v_id) is distinct from 'order_cancelled' then
    raise exception 'CASE 13 FAILED: the cancellation did not enrol exactly one order_cancelled refund';
  end if;

  for i in 1..3 loop
    v_res := pg_temp.resend_as(v_c, v_id);
    if v_res->>'outcome' is distinct from 'unavailable' then
      raise exception 'CASE 13 FAILED: resend % of a cancelled order was accepted', i;
    end if;
    select count(*) into v_n from public.claim_lazywait_sync_one(v_id);
    if v_n <> 0 then
      raise exception 'CASE 13 FAILED: the worker claimed the cancelled order after resend %', i;
    end if;
  end loop;

  -- Even if something else re-queued it, the worker would not send it.
  update public.orders set lazywait_sync_state = 'pending', sync_next_attempt_at = now() - interval '1 minute' where id = v_id;
  select count(*) into v_n from public.claim_lazywait_sync_batch(100) where id = v_id;
  if v_n <> 0 then raise exception 'CASE 13 FAILED: the batch claim took the re-queued cancelled order'; end if;

  -- And when its POS failures run out, no second refund is queued on top of
  -- the cancellation refund.
  update public.orders set lazywait_sync_state = 'failed', pos_customer_retry_count = 3, sync_last_error = 'http_500'
   where id = v_id;
  if (select count(*) from public.order_refunds where order_id = v_id) <> 1
     or (select reason from public.order_refunds where order_id = v_id) is distinct from 'order_cancelled' then
    raise exception 'CASE 13 FAILED: a second automatic refund was queued for a cancelled order';
  end if;
  raise notice 'CASE 13 ok: once cancelled, the order is never resent or sent, and is refunded exactly once';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 14 — the money path, and grants
-- ---------------------------------------------------------------------------
do $$
declare
  r     record;
  v_sig text;
begin
  if (select md5(pg_get_functiondef('public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)'::regprocedure)))
       is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'CASE 14 FAILED: place_order moved';
  end if;
  if (select md5(pg_get_functiondef('public.compute_order_snapshot(uuid, uuid, public.order_type, jsonb, uuid, text, integer)'::regprocedure)))
       is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'CASE 14 FAILED: compute_order_snapshot moved';
  end if;

  for r in
    select * from (values
      ('public.request_customer_pos_resend(uuid)', true),
      ('public.claim_lazywait_sync_one(uuid)', false),
      ('public.claim_lazywait_sync_batch(integer)', false),
      ('public.set_order_refund_enrollment()', false),
      ('public.place_customer_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)', true),
      ('public.begin_payment_attempt(uuid, text, text, integer)', false)
    ) as t(sig, authed)
  loop
    if has_function_privilege('anon', r.sig, 'execute') then
      raise exception 'CASE 14 FAILED: anon can execute %', r.sig;
    end if;
    if has_function_privilege('authenticated', r.sig, 'execute') is distinct from r.authed then
      raise exception 'CASE 14 FAILED: authenticated EXECUTE on % should be %', r.sig, r.authed;
    end if;
  end loop;
  foreach v_sig in array array['public.claim_lazywait_sync_one(uuid)', 'public.claim_lazywait_sync_batch(integer)',
                                'public.begin_payment_attempt(uuid, text, text, integer)'] loop
    if not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception 'CASE 14 FAILED: service_role lost %', v_sig;
    end if;
  end loop;
  raise notice 'CASE 14 ok: money path unchanged; anon executes none of the six; the app keeps its two';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 15 — honest: a cancelled order is "not found" to a customer who does
-- not own it
-- ---------------------------------------------------------------------------
-- Passes before and after the migration. It pins the ORDER of the new
-- refusal: placed ahead of the ownership test, it would tell another customer
-- that this order exists and was cancelled, and write a log row against it.
do $$
declare
  v_owner uuid := pg_temp.new_customer();
  v_other uuid := pg_temp.new_customer();
  v_id    uuid;
  v_res   jsonb;
begin
  v_id := pg_temp.new_order(v_owner, 'cancelled', 'cash', 'pending', 'failed');
  v_res := pg_temp.resend_as(v_other, v_id);
  if v_res->>'error' is distinct from 'P0002' or v_res->>'message' is distinct from 'Order not found' then
    raise exception 'CASE 15 FAILED: another customer was told more than "not found": %', v_res;
  end if;
  if exists (select 1 from public.integration_sync_logs where order_id = v_id) then
    raise exception 'CASE 15 FAILED: another customer''s call wrote a sync log row on this order';
  end if;
  raise notice 'CASE 15 ok: a cancelled order is "not found" to a customer who does not own it';
end $$;

rollback;
