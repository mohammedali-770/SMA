-- ============================================================================
-- Order lifecycle + cancellation compensation (20260810100000).
--
-- Runs after the full migration chain in the SQL-CI throwaway database.
-- Every case raises on failure and the outer transaction rolls back all fixtures.
-- ============================================================================
begin;

create temporary table t_cancel_ctx (
  customer_id uuid,
  admin_id uuid,
  branch_id uuid,
  coupon_id uuid,
  order_id uuid
) on commit drop;

do $$
declare
  v_customer uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_coupon uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_customer), (v_admin)
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, phone_number, role, loyalty_points)
  values
    (v_customer, 'Cancel Customer', '+966500009901', 'customer', 70),
    (v_admin, 'Cancel Admin', '+966500009902', 'admin', 0)
  on conflict (id) do update set
    full_name = excluded.full_name,
    phone_number = excluded.phone_number,
    role = excluded.role,
    loyalty_points = excluded.loyalty_points;

  insert into public.branches (id, name_en, name_ar, is_active)
  values (v_branch, 'Cancel Test Branch', 'فرع اختبار الإلغاء', true);

  insert into public.coupons (
    id, code, type, value, is_active, min_order_amount, usage_limit, usage_count
  ) values (
    v_coupon, 'CANCELTEST', 'fixed', 10, true, 0, 100, 5
  );

  -- Represents an order whose starting balance was 100: 40 redeemed, 10 earned,
  -- therefore post-placement balance 70. Cancellation must restore it to 100.
  insert into public.orders (
    id, customer_id, customer_name, customer_phone,
    branch_id, branch_name_en, branch_name_ar,
    status, order_type, subtotal, delivery_fee, discount_amount,
    loyalty_discount_amount, vat_amount, total,
    payment_status, payment_method, coupon_code,
    loyalty_points_earned, loyalty_points_redeemed, loyalty_awarded_at
  ) values (
    v_order, v_customer, 'Cancel Customer', '+966500009901',
    v_branch, 'Cancel Test Branch', 'فرع اختبار الإلغاء',
    'received', 'pickup', 100, 0, 10,
    4, 11.22, 86,
    'pending', 'cash', 'CANCELTEST',
    10, 40, now()
  );

  insert into t_cancel_ctx values (v_customer, v_admin, v_branch, v_coupon, v_order);
end $$;

-- ---- CASE 1: a customer cannot mutate status --------------------------------
do $$
declare
  v_customer uuid; v_order uuid; v_state text;
begin
  select customer_id, order_id into v_customer, v_order from t_cancel_ctx;
  perform set_config('test.auth_uid', v_customer::text, true);
  perform set_config('test.is_admin', 'false', true);
  perform set_config('test.is_staff', 'false', true);
  set local role authenticated;
  begin
    perform public.admin_set_order_status(v_order, 'preparing');
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  if v_state is distinct from '42501' then
    raise exception 'CASE 1 FAILED: customer call SQLSTATE %, expected 42501', coalesce(v_state, 'SUCCESS');
  end if;
  raise notice 'CASE 1 ok: cancellation/status RPC remains admin-only';
end $$;

-- ---- CASE 2: invalid skips/backwards transitions are rejected ----------------
do $$
declare
  v_admin uuid; v_order uuid; v_state text; v_status public.order_status;
begin
  select admin_id, order_id into v_admin, v_order from t_cancel_ctx;
  perform set_config('test.auth_uid', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  set local role authenticated;
  begin
    perform public.admin_set_order_status(v_order, 'ready'); -- received -> ready skips preparing
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  reset role;

  if v_state is distinct from '22023' then
    raise exception 'CASE 2 FAILED: received -> ready SQLSTATE %, expected 22023', coalesce(v_state, 'SUCCESS');
  end if;
  select status into v_status from public.orders where id = v_order;
  if v_status <> 'received' then
    raise exception 'CASE 2 FAILED: rejected transition still changed status to %', v_status;
  end if;
  raise notice 'CASE 2 ok: server rejects a lifecycle skip';
end $$;

-- ---- CASE 3: normal forward transition still works ---------------------------
do $$
declare
  v_admin uuid; v_order uuid; v_status public.order_status;
begin
  select admin_id, order_id into v_admin, v_order from t_cancel_ctx;
  perform set_config('test.auth_uid', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  set local role authenticated;
  perform public.admin_set_order_status(v_order, 'preparing');
  reset role;

  select status into v_status from public.orders where id = v_order;
  if v_status <> 'preparing' then
    raise exception 'CASE 3 FAILED: expected preparing, got %', v_status;
  end if;
  raise notice 'CASE 3 ok: valid forward transition succeeds';
end $$;

-- ---- CASE 4: cancellation reverses loyalty + coupon in one transaction -------
do $$
declare
  v_admin uuid; v_customer uuid; v_order uuid;
  v_status public.order_status; v_balance integer; v_usage integer;
  v_rows integer; v_sum integer; v_last_balance integer;
begin
  select admin_id, customer_id, order_id into v_admin, v_customer, v_order from t_cancel_ctx;
  perform set_config('test.auth_uid', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  set local role authenticated;
  perform public.admin_set_order_status(v_order, 'cancelled');
  reset role;

  select status into v_status from public.orders where id = v_order;
  select loyalty_points into v_balance from public.profiles where id = v_customer;
  select usage_count into v_usage from public.coupons where code = 'CANCELTEST';

  if v_status <> 'cancelled' then
    raise exception 'CASE 4 FAILED: status %, expected cancelled', v_status;
  end if;
  if v_balance <> 100 then
    raise exception 'CASE 4 FAILED: loyalty balance %, expected 100 (70 - 10 + 40)', v_balance;
  end if;
  if v_usage <> 4 then
    raise exception 'CASE 4 FAILED: coupon usage %, expected 4', v_usage;
  end if;

  select count(*), coalesce(sum(points), 0)
    into v_rows, v_sum
    from public.loyalty_transactions
   where order_id = v_order and type = 'adjustment'
     and reason like 'Cancelled order%';
  if v_rows <> 2 or v_sum <> 30 then
    raise exception 'CASE 4 FAILED: expected two cancellation rows totalling +30, got rows=% sum=%', v_rows, v_sum;
  end if;

  select balance_after into v_last_balance
    from public.loyalty_transactions
   where order_id = v_order and type = 'adjustment' and reason like 'Cancelled order%'
   order by created_at desc, id desc limit 1;
  if v_last_balance <> 100 then
    raise exception 'CASE 4 FAILED: final ledger balance_after %, expected 100', v_last_balance;
  end if;
  raise notice 'CASE 4 ok: cancellation atomically restores redeemed points, reverses earn, returns coupon usage';
end $$;

-- ---- CASE 5: response-loss retry is idempotent -------------------------------
do $$
declare
  v_admin uuid; v_order uuid; v_rows_before integer; v_rows_after integer; v_usage integer; v_balance integer;
begin
  select admin_id, order_id into v_admin, v_order from t_cancel_ctx;
  select count(*) into v_rows_before from public.loyalty_transactions
   where order_id = v_order and reason like 'Cancelled order%';

  perform set_config('test.auth_uid', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  set local role authenticated;
  perform public.admin_set_order_status(v_order, 'cancelled');
  reset role;

  select count(*) into v_rows_after from public.loyalty_transactions
   where order_id = v_order and reason like 'Cancelled order%';
  select usage_count into v_usage from public.coupons where code = 'CANCELTEST';
  select loyalty_points into v_balance from public.profiles where id = (select customer_id from t_cancel_ctx);

  if v_rows_after <> v_rows_before or v_usage <> 4 or v_balance <> 100 then
    raise exception 'CASE 5 FAILED: retry replayed compensation rows %->%, usage %, balance %',
      v_rows_before, v_rows_after, v_usage, v_balance;
  end if;
  raise notice 'CASE 5 ok: repeated cancelled target is a no-op';
end $$;

-- ---- CASE 6: delivered is terminal and cannot be cancelled ------------------
do $$
declare
  v_customer uuid; v_admin uuid; v_branch uuid; v_order uuid := gen_random_uuid(); v_state text;
begin
  select customer_id, admin_id, branch_id into v_customer, v_admin, v_branch from t_cancel_ctx;
  insert into public.orders (
    id, customer_id, branch_id, status, order_type, subtotal, total,
    payment_status, payment_method, loyalty_points_earned, loyalty_points_redeemed
  ) values (v_order, v_customer, v_branch, 'delivered', 'pickup', 20, 20, 'pending', 'cash', 9, 12);

  perform set_config('test.auth_uid', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  set local role authenticated;
  begin
    perform public.admin_set_order_status(v_order, 'cancelled');
    v_state := null;
  exception when others then v_state := sqlstate;
  end;
  reset role;

  if v_state is distinct from '22023' then
    raise exception 'CASE 6 FAILED: delivered -> cancelled SQLSTATE %, expected 22023', coalesce(v_state, 'SUCCESS');
  end if;
  if exists (select 1 from public.loyalty_transactions where order_id = v_order and reason like 'Cancelled order%') then
    raise exception 'CASE 6 FAILED: rejected cancellation wrote loyalty compensation';
  end if;
  raise notice 'CASE 6 ok: delivered is terminal and rejected cancellation has no side effects';
end $$;

-- ---- CASE 7: earn shortfall never consumes the redemption refund ------------
do $$
declare
  v_customer uuid := gen_random_uuid(); v_admin uuid; v_branch uuid; v_order uuid := gen_random_uuid();
  v_balance integer; v_earn_row integer; v_refund_row integer; v_reason text;
begin
  select admin_id, branch_id into v_admin, v_branch from t_cancel_ctx;
  insert into auth.users (id) values (v_customer) on conflict (id) do nothing;
  insert into public.profiles (id, full_name, phone_number, role, loyalty_points)
  values (v_customer, 'Spent Earn Customer', '+966500009903', 'customer', 2)
  on conflict (id) do update set loyalty_points = 2, role = 'customer';

  insert into public.orders (
    id, customer_id, branch_id, status, order_type, subtotal, total,
    payment_status, payment_method, loyalty_points_earned, loyalty_points_redeemed
  ) values (v_order, v_customer, v_branch, 'received', 'pickup', 50, 50, 'pending', 'cash', 10, 40);

  perform set_config('test.auth_uid', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);
  perform set_config('test.is_staff', 'true', true);
  set local role authenticated;
  perform public.admin_set_order_status(v_order, 'cancelled');
  reset role;

  select loyalty_points into v_balance from public.profiles where id = v_customer;
  select points, reason into v_earn_row, v_reason
    from public.loyalty_transactions
   where order_id = v_order and reason like 'Cancelled order earn reversal:%';
  select points into v_refund_row
    from public.loyalty_transactions
   where order_id = v_order and reason like 'Cancelled order redemption refund:%';

  if v_balance <> 40 then
    raise exception 'CASE 7 FAILED: balance %, expected full 40-point redemption refund', v_balance;
  end if;
  if v_earn_row <> -2 or v_refund_row <> 40 then
    raise exception 'CASE 7 FAILED: earn/refund rows % / %, expected -2 / +40', v_earn_row, v_refund_row;
  end if;
  if v_reason not like '%shortfall=8%' then
    raise exception 'CASE 7 FAILED: earn shortfall not recorded in reason: %', v_reason;
  end if;
  raise notice 'CASE 7 ok: already-spent earned points clamp safely and full redeemed points are still restored';
end $$;

rollback;
