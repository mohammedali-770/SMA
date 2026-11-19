-- ============================================================================
-- A cancelled paid card order is refunded automatically, in full
-- (migration 20261018120000_refund_cancelled_paid_orders.sql; the owner's
-- decision of 2026-11-19, "do the auto refund"; card-payment gap PG-13).
--
-- Every GUARD case fails on the chain before that migration and passes with
-- it. Every HONEST case passes on both: it is a flow the change must not
-- break or widen. Each raises 'CASE n FAILED: ...'. To see every case on an
-- older chain, run it with -v ON_ERROR_STOP=0 -v ON_ERROR_ROLLBACK=on.
--
--   CASE 1   guard   an administrator cancels a paid card order: exactly one
--                    order_refunds row, reason order_cancelled, the captured
--                    payment's amount, refund_state pending
--   CASE 2   guard   cancelling again, and any later write, opens nothing more
--   CASE 3   honest  a cash order, paid or not, is never refunded on cancel
--   CASE 4   honest  an unpaid card order is never refunded on cancel
--   CASE 5   honest  a comped order (total 0) is never refunded on cancel
--   CASE 6   honest  a paid order with no paid payment_records row is never
--                    sent to Moyasar on cancel
--   CASE 7   honest  an order already refunding (the POS-failure path), and
--                    one already refunded or failed, keeps exactly its refund
--                    and its reason when cancelled
--   CASE 8   honest  the POS-failure path still enrols with its own reason
--   CASE 9   honest  an order INSERTED cancelled and paid is never enrolled,
--                    then or on any later write (no backfill)
--   CASE 10  guard   a payment captured after the cancellation
--                    (confirm_order_payment) is refunded
--   CASE 11  g+h     grants, order_refund_due and the money path
-- ============================================================================
begin;

create function pg_temp.as_nobody() returns void language sql as $$
  select set_config('test.auth_uid', '', true),
         set_config('test.is_admin', '', true),
         set_config('test.is_staff', '', true);
$$;

-- An order, inserted with every trigger on, the way an order arrives.
create function pg_temp.new_order(
  p_status public.order_status,
  p_method text,
  p_pay    public.payment_status,
  p_total  numeric default 25,
  p_refund text    default 'none'
) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                             payment_method, payment_status, refund_state)
  values (v, 'RCX-' || replace(v::text, '-', ''), (select fx_id from t_fx where k = 'branch'),
          'pickup', p_status, p_total, p_total, p_method, p_pay, p_refund);
  return v;
end $$;

-- A payment record for an order; returns its id.
create function pg_temp.add_payment(p_order uuid, p_status text, p_amount numeric) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.payment_records (id, order_id, provider, provider_ref, status, amount, currency, mode, confirmed_at)
  values (v, p_order, 'moyasar', 'rcx_pay_' || replace(v::text, '-', ''), p_status, p_amount, 'SAR', 'test',
          case when p_status = 'paid' then now() end);
  return v;
end $$;

-- Cancel through the console's own RPC, as an administrator.
create function pg_temp.admin_cancel(p_order uuid) returns void language plpgsql as $$
begin
  perform set_config('test.auth_uid', (select fx_id from t_fx where k = 'admin')::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  perform public.admin_set_order_status(p_order, 'cancelled');
  perform pg_temp.as_nobody();
end $$;

create function pg_temp.refund_rows(p_order uuid) returns integer language sql as $$
  select count(*)::integer from public.order_refunds where order_id = p_order;
$$;

create temporary table t_fx (k text primary key, fx_id uuid);

do $$
declare
  v_branch uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
begin
  insert into public.branches (id, name_en, name_ar, is_active) values (v_branch, 'Refund on cancel', 'Refund on cancel', true);
  insert into auth.users (id, email) values (v_admin, 'refund-cancel-admin@x');
  update public.profiles set role = 'admin' where id = v_admin;
  insert into t_fx values ('branch', v_branch), ('admin', v_admin);
end $$;

-- ---------------------------------------------------------------------------
-- CASE 1 — guard: an administrator cancels a paid card order
-- ---------------------------------------------------------------------------
do $$
declare
  v_id  uuid := pg_temp.new_order('received', 'online', 'paid', 25);
  v_pay uuid;
  o     public.orders;
  rf    public.order_refunds;
begin
  -- An earlier failed attempt as well, which must never be the refund target.
  perform pg_temp.add_payment(v_id, 'failed', 25);
  v_pay := pg_temp.add_payment(v_id, 'paid', 25);
  if pg_temp.refund_rows(v_id) <> 0 then
    raise exception 'CASE 1 FAILED: a paid order was enrolled before it was cancelled';
  end if;

  perform pg_temp.admin_cancel(v_id);

  select * into o from public.orders where id = v_id;
  if o.status <> 'cancelled' then raise exception 'CASE 1 FAILED: the fixture was not cancelled'; end if;
  if o.refund_state is distinct from 'pending' or o.refund_required_at is null then
    raise exception 'CASE 1 FAILED: refund_state %, refund_required_at %, expected pending and a time',
      o.refund_state, o.refund_required_at;
  end if;
  if pg_temp.refund_rows(v_id) <> 1 then
    raise exception 'CASE 1 FAILED: % refund rows, expected exactly 1', pg_temp.refund_rows(v_id);
  end if;
  select * into rf from public.order_refunds where order_id = v_id;
  if rf.reason is distinct from 'order_cancelled' then
    raise exception 'CASE 1 FAILED: reason %, expected order_cancelled', rf.reason;
  end if;
  if rf.amount is distinct from 25.00::numeric or rf.currency is distinct from 'SAR'
     or rf.status is distinct from 'pending' or rf.provider is distinct from 'moyasar'
     or rf.payment_record_id is distinct from v_pay
     or rf.charge_ref is distinct from (select provider_ref from public.payment_records where id = v_pay)
     or rf.idempotency_key is distinct from 'refund_' || replace(v_id::text, '-', '') then
    raise exception 'CASE 1 FAILED: the refund row does not refund the captured payment in full: %', row_to_json(rf);
  end if;
  raise notice 'CASE 1 ok: a cancelled paid card order is refunded in full, reason order_cancelled';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — guard: cancelling again, and any later write, opens nothing more
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid := pg_temp.new_order('preparing', 'online', 'paid', 40);
begin
  perform pg_temp.add_payment(v_id, 'paid', 40);
  perform pg_temp.admin_cancel(v_id);
  if pg_temp.refund_rows(v_id) <> 1 then raise exception 'CASE 2 FAILED: the cancellation opened no refund'; end if;

  perform pg_temp.admin_cancel(v_id);                       -- the console's retry: a no-op
  update public.orders set status = 'cancelled', updated_at = now() where id = v_id;
  update public.orders set notes = 'later edit' where id = v_id;
  -- The worker's own transitions, then a release back to pending.
  update public.orders set refund_state = 'processing' where id = v_id;
  update public.orders set refund_state = 'pending' where id = v_id;
  update public.orders set notes = 'another edit' where id = v_id;
  if pg_temp.refund_rows(v_id) <> 1 then
    raise exception 'CASE 2 FAILED: % refund rows after later writes, expected 1', pg_temp.refund_rows(v_id);
  end if;
  raise notice 'CASE 2 ok: one cancellation, one refund';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — honest: a cash order is never refunded on cancel
-- ---------------------------------------------------------------------------
do $$
declare
  v_paid    uuid := pg_temp.new_order('received', 'cash', 'paid');
  v_pending uuid := pg_temp.new_order('received', 'cash', 'pending');
  v_id      uuid;
begin
  -- Even with a paid payment row beside it, a cash order is not sent to Moyasar.
  perform pg_temp.add_payment(v_paid, 'paid', 25);
  foreach v_id in array array[v_paid, v_pending] loop
    perform pg_temp.admin_cancel(v_id);
    if (select refund_state from public.orders where id = v_id) <> 'none' or pg_temp.refund_rows(v_id) <> 0 then
      raise exception 'CASE 3 FAILED: a cancelled cash order was enrolled for a refund';
    end if;
  end loop;
  raise notice 'CASE 3 ok: a cash order is never refunded on cancel';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4 — honest: an unpaid card order is never refunded on cancel
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid := pg_temp.new_order('received', 'online', 'pending');
begin
  perform pg_temp.add_payment(v_id, 'initiated', 25);
  perform pg_temp.admin_cancel(v_id);
  if (select refund_state from public.orders where id = v_id) <> 'none' or pg_temp.refund_rows(v_id) <> 0 then
    raise exception 'CASE 4 FAILED: an unpaid cancelled order was enrolled for a refund';
  end if;
  raise notice 'CASE 4 ok: an unpaid card order is never refunded on cancel';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5 — honest: a comped order (total 0) is never refunded on cancel
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid := pg_temp.new_order('received', 'online', 'paid', 0);
begin
  perform pg_temp.add_payment(v_id, 'paid', 0);
  perform pg_temp.admin_cancel(v_id);
  if (select refund_state from public.orders where id = v_id) <> 'none' or pg_temp.refund_rows(v_id) <> 0 then
    raise exception 'CASE 5 FAILED: a cancelled order with total 0 was enrolled for a refund';
  end if;
  raise notice 'CASE 5 ok: a comped order is never refunded on cancel';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 6 — honest: no paid payment row, no refund
-- ---------------------------------------------------------------------------
do $$
declare
  v_none     uuid := pg_temp.new_order('received', 'online', 'paid');
  v_failed   uuid := pg_temp.new_order('received', 'online', 'paid');
  v_refunded uuid := pg_temp.new_order('received', 'online', 'paid');
  v_id       uuid;
begin
  perform pg_temp.add_payment(v_failed, 'failed', 25);
  perform pg_temp.add_payment(v_refunded, 'refunded', 25);   -- already refunded at the provider
  foreach v_id in array array[v_none, v_failed, v_refunded] loop
    perform pg_temp.admin_cancel(v_id);
    if (select refund_state from public.orders where id = v_id) <> 'none' or pg_temp.refund_rows(v_id) <> 0 then
      raise exception 'CASE 6 FAILED: a cancelled order with no paid payment row was enrolled for a refund';
    end if;
  end loop;
  raise notice 'CASE 6 ok: a paid order with no paid payment row is never sent to Moyasar';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 7 — honest: an order already refunding, refunded or failed keeps it
-- ---------------------------------------------------------------------------
do $$
declare
  v_pos      uuid := pg_temp.new_order('received', 'online', 'paid');
  v_refunded uuid := pg_temp.new_order('ready', 'online', 'paid', 25, 'refunded');
  v_failed   uuid := pg_temp.new_order('ready', 'online', 'paid', 25, 'failed');
  v_id       uuid;
begin
  perform pg_temp.add_payment(v_pos, 'paid', 25);
  perform pg_temp.add_payment(v_refunded, 'paid', 25);
  perform pg_temp.add_payment(v_failed, 'paid', 25);

  -- The POS-failure path: proven not sent, three resends spent.
  update public.orders set lazywait_sync_state = 'dead_letter', pos_customer_retry_count = 3 where id = v_pos;
  if (select refund_state from public.orders where id = v_pos) <> 'pending' then
    raise exception 'CASE 7 FAILED: the POS-failure fixture was not enrolled';
  end if;
  perform pg_temp.admin_cancel(v_pos);
  if pg_temp.refund_rows(v_pos) <> 1
     or (select reason from public.order_refunds where order_id = v_pos) is distinct from 'pos_delivery_failed_after_customer_retries' then
    raise exception 'CASE 7 FAILED: cancelling an order already refunding changed its refund (% rows, reason %)',
      pg_temp.refund_rows(v_pos), (select string_agg(reason, ',') from public.order_refunds where order_id = v_pos);
  end if;

  foreach v_id in array array[v_refunded, v_failed] loop
    perform pg_temp.admin_cancel(v_id);
    if pg_temp.refund_rows(v_id) <> 0
       or (select refund_state from public.orders where id = v_id) not in ('refunded', 'failed') then
      raise exception 'CASE 7 FAILED: an order already % was enrolled again on cancel',
        (select refund_state from public.orders where id = v_id);
    end if;
  end loop;
  raise notice 'CASE 7 ok: a refund that exists stays the only refund, with its reason';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 8 — honest: the POS-failure path still enrols with its own reason
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid := pg_temp.new_order('received', 'online', 'paid');
begin
  perform pg_temp.add_payment(v_id, 'paid', 25);
  update public.orders set lazywait_sync_state = 'dead_letter', pos_customer_retry_count = 3 where id = v_id;
  if (select refund_state from public.orders where id = v_id) <> 'pending'
     or pg_temp.refund_rows(v_id) <> 1
     or (select reason from public.order_refunds where order_id = v_id) is distinct from 'pos_delivery_failed_after_customer_retries' then
    raise exception 'CASE 8 FAILED: the POS-failure path no longer enrols with its own reason';
  end if;
  raise notice 'CASE 8 ok: the POS-failure refund is unchanged';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 9 — honest: an order inserted cancelled and paid is never enrolled
-- ---------------------------------------------------------------------------
-- The shape of an order cancelled before the migration was applied: no write
-- after the apply may enrol it.
do $$
declare
  v_id uuid := pg_temp.new_order('cancelled', 'online', 'paid');
begin
  if (select refund_state from public.orders where id = v_id) <> 'none' or pg_temp.refund_rows(v_id) <> 0 then
    raise exception 'CASE 9 FAILED: an INSERT of a cancelled paid order enrolled a refund';
  end if;
  perform pg_temp.add_payment(v_id, 'paid', 25);
  update public.orders set notes = 'later edit' where id = v_id;
  update public.orders set status = 'cancelled', updated_at = now() where id = v_id;
  update public.orders set payment_status = 'paid' where id = v_id;
  if (select refund_state from public.orders where id = v_id) <> 'none' or pg_temp.refund_rows(v_id) <> 0 then
    raise exception 'CASE 9 FAILED: a later write enrolled an order that was already cancelled and paid';
  end if;
  raise notice 'CASE 9 ok: no backfill: an order already cancelled and paid is never enrolled';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 10 — guard: a payment captured after the cancellation is refunded
-- ---------------------------------------------------------------------------
-- begin_payment_attempt refuses a cancelled order, but an attempt opened
-- before the cancellation can still be paid, and confirm_order_payment records
-- any captured payment. That money is owed back too.
do $$
declare
  v_id uuid := pg_temp.new_order('received', 'online', 'pending', 30);
begin
  perform pg_temp.admin_cancel(v_id);
  if pg_temp.refund_rows(v_id) <> 0 then raise exception 'CASE 10 FAILED: an unpaid cancellation opened a refund'; end if;

  perform public.confirm_order_payment(v_id, 'moyasar', 'rcx_late_' || replace(v_id::text, '-', ''), 30, null);
  if (select payment_status::text from public.orders where id = v_id) <> 'paid' then
    raise exception 'CASE 10 FAILED: the fixture was not marked paid';
  end if;
  if (select refund_state from public.orders where id = v_id) <> 'pending'
     or pg_temp.refund_rows(v_id) <> 1
     or (select reason from public.order_refunds where order_id = v_id) is distinct from 'order_cancelled'
     or (select amount from public.order_refunds where order_id = v_id) is distinct from 30.00::numeric then
    raise exception 'CASE 10 FAILED: a payment captured after the cancellation was not refunded in full';
  end if;
  raise notice 'CASE 10 ok: a payment captured after the cancellation is refunded';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 11 — grants, order_refund_due and the money path
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array['public.set_order_refund_enrollment()', 'public.open_order_refund_record()'] loop
    if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'CASE 11 FAILED: a client role can execute %', v_sig;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.open_order_refund_record()', 'execute') then
    raise exception 'CASE 11 FAILED: service_role lost EXECUTE on open_order_refund_record()';
  end if;
  if has_table_privilege('authenticated', 'public.orders', 'update') or has_table_privilege('anon', 'public.orders', 'update') then
    raise exception 'CASE 11 FAILED: a client role can UPDATE orders directly';
  end if;
  -- order_refund_due as 20260724120000 wrote it, never redefined since.
  if (select md5(prosrc) from pg_proc where oid = 'public.order_refund_due(text, text, text, text, timestamptz, integer, text, numeric)'::regprocedure)
       is distinct from 'da53a4aaf041ac91036eaacfc8d58863' then
    raise exception 'CASE 11 FAILED: order_refund_due moved';
  end if;
  if (select md5(pg_get_functiondef('public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)'::regprocedure)))
       is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'CASE 11 FAILED: place_order moved';
  end if;
  if (select md5(pg_get_functiondef('public.compute_order_snapshot(uuid, uuid, public.order_type, jsonb, uuid, text, integer)'::regprocedure)))
       is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'CASE 11 FAILED: compute_order_snapshot moved';
  end if;
  raise notice 'CASE 11 ok: no client role executes either trigger; order_refund_due and the money path unchanged';
end $$;

rollback;
