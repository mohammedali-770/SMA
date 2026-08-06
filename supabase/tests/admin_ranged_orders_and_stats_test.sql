-- ============================================================================
-- Bounded admin order reads (migration 20260806130000).
--
-- WHAT THIS PINS. The console used to call `admin_list_orders_with_items(null)`
-- — the unbounded arm — on every staff sign-in, because ReportsPanel and
-- StatsPanel both read the entire in-memory order list. The two replacements
-- have to hold three properties or the fix is worse than the bug:
--
--   * the range is HALF-OPEN, so day boundaries neither drop nor double-count
--     an order sitting exactly on midnight;
--   * an over-large range REFUSES rather than truncating, because a silently
--     truncated financial report is a wrong VAT figure that looks right;
--   * the aggregate figures equal what the client used to compute in memory,
--     so a performance change does not quietly move a number on the dashboard.
--
-- Plus the access contract: staff-only, and no customer PII in the projection.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- Run a statement as a role with a given identity and report the SQLSTATE.
-- Returns null when the statement succeeded. Same shape as the helper in
-- order_read_contracts_test.sql.
create or replace function pg_temp.err_as(
  p_role text, p_uid uuid, p_staff text, p_admin text, p_sql text
) returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('test.auth_uid', coalesce(p_uid::text, ''), true);
  perform set_config('test.is_staff', coalesce(p_staff, ''), true);
  perform set_config('test.is_admin', coalesce(p_admin, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  return v_state;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Two branches. Riyadh is UTC+3 with no DST, so a Riyadh calendar day
-- 2026-03-10 is exactly [2026-03-09T21:00Z, 2026-03-10T21:00Z). The boundary
-- orders below sit on those two instants deliberately.
create temporary table t_ctx (branch_a uuid, branch_b uuid, staff uuid, cust uuid)
  on commit drop;

do $$
declare
  v_a     uuid := gen_random_uuid();
  v_b     uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_cust  uuid := gen_random_uuid();
  v_ord   uuid;
begin
  insert into auth.users (id) values (v_staff), (v_cust) on conflict (id) do nothing;
  insert into public.profiles (id, full_name, phone_number, role)
    values (v_staff, 'Staff', '+966500000041', 'admin'),
           (v_cust,  'Cust',  '+966500000042', 'customer')
  on conflict (id) do update set role = excluded.role;

  insert into public.branches (id, name_en, name_ar)
  values (v_a, 'Range A', 'المدى أ'), (v_b, 'Range B', 'المدى ب')
  on conflict (id) do nothing;

  -- IN RANGE, branch A, delivered, 100. Sits exactly ON the lower bound.
  insert into public.orders (id, customer_id, branch_id, order_type, status,
                             subtotal, delivery_fee, discount_amount, total,
                             coupon_code, payment_method, payment_status,
                             customer_name, customer_phone, notes, created_at)
  values (gen_random_uuid(), v_cust, v_a, 'delivery', 'delivered',
          90, 10, 0, 100, 'SAVE10', 'cash', 'pending',
          'Ranged Customer', '+966500000042', 'no onions',
          '2026-03-09T21:00:00Z');

  -- IN RANGE, branch B, cancelled, 40. Cancelled counts toward total_amount but
  -- not toward delivered_revenue or active_orders — that asymmetry is the point.
  insert into public.orders (id, customer_id, branch_id, order_type, status,
                             subtotal, delivery_fee, discount_amount, total,
                             payment_method, payment_status, created_at)
  values (gen_random_uuid(), v_cust, v_b, 'pickup', 'cancelled',
          40, 0, 0, 40, 'cash', 'pending', '2026-03-10T08:00:00Z');

  -- IN RANGE, branch A, received (active), 25, WITH a line item.
  v_ord := gen_random_uuid();
  insert into public.orders (id, customer_id, branch_id, order_type, status,
                             subtotal, delivery_fee, discount_amount, total,
                             payment_method, payment_status, created_at)
  values (v_ord, v_cust, v_a, 'pickup', 'received',
          25, 0, 0, 25, 'cash', 'pending', '2026-03-10T12:00:00Z');
  insert into public.order_items (order_id, product_id, name_en, name_ar, unit_price, quantity, line_total)
  values (v_ord, null, 'Spicy Burger', 'برجر حار', 25, 1, 25);

  -- OUT OF RANGE by exactly one instant: sits ON the upper bound. A closed
  -- interval would wrongly include this in the 2026-03-10 report AND again in
  -- the 2026-03-11 one.
  insert into public.orders (id, customer_id, branch_id, order_type, status,
                             subtotal, delivery_fee, discount_amount, total,
                             payment_method, payment_status, created_at)
  values (gen_random_uuid(), v_cust, v_a, 'pickup', 'delivered',
          70, 0, 0, 70, 'cash', 'pending', '2026-03-10T21:00:00Z');

  insert into t_ctx values (v_a, v_b, v_staff, v_cust);
  raise notice 'FIXTURE ok: 4 orders across 2 branches';
end $$;

-- ---- CASE 1: staff-only, and anon holds no EXECUTE ------------------------
do $$
declare c record; v_state text;
begin
  select * into c from t_ctx;

  v_state := pg_temp.err_as('authenticated', c.cust, 'false', 'false',
    format('select public.admin_list_orders_for_range(%L, %L)',
           '2026-03-09T21:00:00Z', '2026-03-10T21:00:00Z'));
  if v_state is distinct from '42501' then
    raise exception 'FAIL(1): a customer calling the range feed got % (expected 42501)', coalesce(v_state, 'SUCCESS');
  end if;

  v_state := pg_temp.err_as('authenticated', c.cust, 'false', 'false',
    'select public.admin_order_stats()');
  if v_state is distinct from '42501' then
    raise exception 'FAIL(1): a customer calling order stats got % (expected 42501)', coalesce(v_state, 'SUCCESS');
  end if;

  if has_function_privilege('anon',
       'public.admin_list_orders_for_range(timestamptz, timestamptz, uuid, integer)', 'execute') then
    raise exception 'FAIL(1): anon can execute the range feed';
  end if;
  if has_function_privilege('anon', 'public.admin_order_stats()', 'execute') then
    raise exception 'FAIL(1): anon can execute order stats';
  end if;
  raise notice 'CASE 1 ok: staff-gated, anon has no execute';
end $$;

-- ---- CASE 2: the window is HALF-OPEN --------------------------------------
do $$
declare
  c        record;
  v_res    jsonb;
  v_totals numeric;
begin
  select * into c from t_ctx;
  perform set_config('test.is_staff', 'true', true);

  v_res := public.admin_list_orders_for_range('2026-03-09T21:00:00Z', '2026-03-10T21:00:00Z');

  -- 3 of the 4 fixture orders. The lower-bound order is IN, the upper-bound one
  -- is OUT.
  if (v_res ->> 'row_count')::int <> 3 then
    raise exception 'FAIL(2): row_count is %, expected 3 — the interval is not half-open', v_res ->> 'row_count';
  end if;
  if jsonb_array_length(v_res -> 'orders') <> 3 then
    raise exception 'FAIL(2): returned % orders, expected 3', jsonb_array_length(v_res -> 'orders');
  end if;

  -- The 70-riyal boundary order must be absent; its presence would show up as a
  -- total of 235 rather than 165.
  select sum((o ->> 'total')::numeric) into v_totals
    from jsonb_array_elements(v_res -> 'orders') o;
  if v_totals <> 165 then
    raise exception 'FAIL(2): totals sum to %, expected 165 (the upper-bound order leaked in)', v_totals;
  end if;

  -- And the boundary order IS in the next day's window — not lost by both.
  v_res := public.admin_list_orders_for_range('2026-03-10T21:00:00Z', '2026-03-11T21:00:00Z');
  if (v_res ->> 'row_count')::int <> 1 then
    raise exception 'FAIL(2): the boundary order is in neither window (next day row_count=%)', v_res ->> 'row_count';
  end if;
  raise notice 'CASE 2 ok: [from, to) — no order dropped and none double-counted';
end $$;

-- ---- CASE 3: the branch filter isolates, and null means all ----------------
do $$
declare c record; v_res jsonb;
begin
  select * into c from t_ctx;
  perform set_config('test.is_staff', 'true', true);

  v_res := public.admin_list_orders_for_range('2026-03-09T21:00:00Z', '2026-03-10T21:00:00Z', c.branch_a);
  if (v_res ->> 'row_count')::int <> 2 then
    raise exception 'FAIL(3): branch A window returned %, expected 2', v_res ->> 'row_count';
  end if;

  v_res := public.admin_list_orders_for_range('2026-03-09T21:00:00Z', '2026-03-10T21:00:00Z', c.branch_b);
  if (v_res ->> 'row_count')::int <> 1 then
    raise exception 'FAIL(3): branch B window returned %, expected 1', v_res ->> 'row_count';
  end if;

  v_res := public.admin_list_orders_for_range('2026-03-09T21:00:00Z', '2026-03-10T21:00:00Z', null);
  if (v_res ->> 'row_count')::int <> 3 then
    raise exception 'FAIL(3): a null branch must mean ALL branches, got %', v_res ->> 'row_count';
  end if;
  raise notice 'CASE 3 ok: branch filter isolates; null means all';
end $$;

-- ---- CASE 4: an over-large range REFUSES, it does not truncate -------------
-- This is the property that matters most. A truncated financial report is a
-- wrong number that looks right; an empty one with `limit_exceeded` is a
-- question the operator can answer by narrowing the range.
do $$
declare v_res jsonb;
begin
  perform set_config('test.is_staff', 'true', true);

  v_res := public.admin_list_orders_for_range(
    '2026-03-09T21:00:00Z', '2026-03-10T21:00:00Z', null, 2);   -- 3 rows, ceiling 2

  if (v_res ->> 'limit_exceeded')::boolean is not true then
    raise exception 'FAIL(4): 3 rows against a ceiling of 2 did not set limit_exceeded';
  end if;
  if jsonb_array_length(v_res -> 'orders') <> 0 then
    raise exception 'FAIL(4): an exceeded range returned % orders — it must return NONE, not the first N',
      jsonb_array_length(v_res -> 'orders');
  end if;
  -- The honest count still comes back, so the console can say how far over it is.
  if (v_res ->> 'row_count')::int <> 3 then
    raise exception 'FAIL(4): row_count is % on an exceeded range, expected the true 3', v_res ->> 'row_count';
  end if;

  -- Exactly AT the ceiling is not exceeded.
  v_res := public.admin_list_orders_for_range(
    '2026-03-09T21:00:00Z', '2026-03-10T21:00:00Z', null, 3);
  if (v_res ->> 'limit_exceeded')::boolean is not false then
    raise exception 'FAIL(4): a count exactly equal to the ceiling was refused';
  end if;

  -- The ceiling can be lowered but never raised past the hard maximum.
  v_res := public.admin_list_orders_for_range(
    '2026-03-09T21:00:00Z', '2026-03-10T21:00:00Z', null, 999999);
  if (v_res ->> 'max_rows')::int <> 10000 then
    raise exception 'FAIL(4): p_max_rows raised the ceiling to % — it must clamp to 10000', v_res ->> 'max_rows';
  end if;
  raise notice 'CASE 4 ok: refuses rather than truncating; ceiling clamps';
end $$;

-- ---- CASE 5: a bad window is rejected, not silently reinterpreted ----------
do $$
declare v_state text;
begin
  v_state := pg_temp.err_as('authenticated', null, 'true', 'true',
    $q$select public.admin_list_orders_for_range(null, '2026-03-10T21:00:00Z')$q$);
  if v_state is distinct from '22004' then
    raise exception 'FAIL(5): a null p_from got % (expected 22004)', coalesce(v_state, 'SUCCESS');
  end if;

  v_state := pg_temp.err_as('authenticated', null, 'true', 'true',
    $q$select public.admin_list_orders_for_range('2026-03-10T21:00:00Z', '2026-03-09T21:00:00Z')$q$);
  if v_state is distinct from '22023' then
    raise exception 'FAIL(5): an inverted window got % (expected 22023)', coalesce(v_state, 'SUCCESS');
  end if;
  raise notice 'CASE 5 ok: null and inverted windows are rejected';
end $$;

-- ---- CASE 6: the projection carries NO customer PII ------------------------
-- Running a financial report must not pull customer names, phones, free-text
-- notes or address snapshots into a browser. The fixture order deliberately has
-- all of them populated.
do $$
declare
  v_res      jsonb;
  v_first    jsonb;
  v_banned   text[] := array['customer_name','customer_phone','notes','address_snapshot',
                             'customer_id','pos_create_attempt_token'];
  k          text;
begin
  perform set_config('test.is_staff', 'true', true);
  v_res  := public.admin_list_orders_for_range('2026-03-09T21:00:00Z', '2026-03-10T21:00:00Z');
  v_first := v_res -> 'orders' -> 0;

  foreach k in array v_banned loop
    if v_first ? k then
      raise exception 'FAIL(6): the report projection exposes %', k;
    end if;
  end loop;

  -- It must still carry what the reports actually read.
  foreach k in array array['id','order_number','branch_id','status','order_type',
                           'subtotal','delivery_fee','discount_amount','total',
                           'coupon_code','created_at','sync_status','order_items'] loop
    if not (v_first ? k) then
      raise exception 'FAIL(6): the report projection is missing %', k;
    end if;
  end loop;

  -- Items carry no modifiers — the reports never read them.
  if exists (
    select 1 from jsonb_array_elements(v_res -> 'orders') o,
                  jsonb_array_elements(o -> 'order_items') i
     where i ? 'order_item_modifiers'
  ) then
    raise exception 'FAIL(6): item modifiers are still in the report projection';
  end if;
  raise notice 'CASE 6 ok: no customer PII, no modifiers, all report fields present';
end $$;

-- ---- CASE 7: the aggregate equals the in-memory computation it replaces ----
-- Computed against the SAME predicates StatsPanel used, over the same rows, so
-- a drift here means a dashboard number moved.
do $$
declare
  v_res       jsonb;
  v_exp_total numeric;
  v_exp_deliv numeric;
  v_exp_active integer;
  v_exp_count integer;
begin
  perform set_config('test.is_staff', 'true', true);
  v_res := public.admin_order_stats();

  -- LITERAL expectations, not a re-derivation of the same query — otherwise this
  -- case would pass no matter what the function computed. The fixture is
  -- 100 delivered + 40 cancelled + 25 received + 70 delivered.
  v_exp_count  := 4;
  v_exp_total  := 235;   -- every status, including the cancelled 40
  v_exp_deliv  := 170;   -- 100 + 70
  v_exp_active := 1;     -- the 'received' one only

  -- Cross-check that the fixture is what this case thinks it is, so a future
  -- edit to the fixture fails here loudly instead of silently weakening CASE 7.
  if (select count(*) from public.orders) <> v_exp_count then
    raise exception 'FAIL(7): fixture drift — % orders in the table, this case assumes %',
      (select count(*) from public.orders), v_exp_count;
  end if;

  if (v_res ->> 'total_orders')::int <> v_exp_count then
    raise exception 'FAIL(7): total_orders % <> %', v_res ->> 'total_orders', v_exp_count;
  end if;
  if (v_res ->> 'total_amount')::numeric <> v_exp_total then
    raise exception 'FAIL(7): total_amount % <> %', v_res ->> 'total_amount', v_exp_total;
  end if;
  if (v_res ->> 'delivered_revenue')::numeric <> v_exp_deliv then
    raise exception 'FAIL(7): delivered_revenue % <> %', v_res ->> 'delivered_revenue', v_exp_deliv;
  end if;
  if (v_res ->> 'active_orders')::int <> v_exp_active then
    raise exception 'FAIL(7): active_orders % <> %', v_res ->> 'active_orders', v_exp_active;
  end if;

  -- The cancelled 40 must be inside total_amount but outside delivered_revenue.
  -- If someone "tidies" the aggregate to exclude cancelled, the average-ticket
  -- tile changes value and this catches it.
  if (v_res ->> 'total_amount')::numeric <= (v_res ->> 'delivered_revenue')::numeric then
    raise exception 'FAIL(7): total_amount must span cancelled orders too (% vs %)',
      v_res ->> 'total_amount', v_res ->> 'delivered_revenue';
  end if;
  raise notice 'CASE 7 ok: aggregate matches the previous in-memory computation';
end $$;

-- ---- CASE 8: per-branch rollup sums to the whole ---------------------------
do $$
declare
  c           record;
  v_res       jsonb;
  v_sum       numeric;
  v_count_sum integer;
  v_a_sales   numeric;
begin
  select * into c from t_ctx;
  perform set_config('test.is_staff', 'true', true);
  v_res := public.admin_order_stats();

  select coalesce(sum((b ->> 'sales')::numeric), 0),
         coalesce(sum((b ->> 'order_count')::int), 0)
    into v_sum, v_count_sum
    from jsonb_array_elements(v_res -> 'branches') b;

  if v_sum <> (v_res ->> 'total_amount')::numeric then
    raise exception 'FAIL(8): branch sales sum to % but total_amount is %', v_sum, v_res ->> 'total_amount';
  end if;
  if v_count_sum <> (v_res ->> 'total_orders')::int then
    raise exception 'FAIL(8): branch counts sum to % but total_orders is %', v_count_sum, v_res ->> 'total_orders';
  end if;

  -- Branch A holds the 100, the 25 and the 70 = 195 across every status.
  select (b ->> 'sales')::numeric into v_a_sales
    from jsonb_array_elements(v_res -> 'branches') b
   where (b ->> 'branch_id')::uuid = c.branch_a;
  if v_a_sales <> 195 then
    raise exception 'FAIL(8): branch A sales are %, expected 195', v_a_sales;
  end if;
  raise notice 'CASE 8 ok: per-branch rollup reconciles with the totals';
end $$;

-- ---- CASE 9: the bounded live feed never hides outstanding work -------------
-- Bounding the console fetch introduced a way to lose an order: the p_limit most
-- RECENT orders drops an older one regardless of status, so an order stuck in
-- `received` or `preparing` would vanish from the kitchen's board once enough
-- newer orders existed — unrecoverable, because the row was never fetched.
-- The window is status-aware: recent PLUS everything unsettled, however old.
do $$
declare
  v_rows      jsonb;
  v_unsettled integer;
begin
  perform set_config('test.is_staff', 'true', true);

  -- A limit of 1 would, chronologically, return only the newest order (the
  -- delivered 70 at 21:00). The 'received' 25 from 12:00 is older and must come
  -- back anyway, because it is still owed to a customer.
  v_rows := public.admin_list_orders_with_items(1);

  if jsonb_array_length(v_rows) <> 2 then
    raise exception 'FAIL(9): limit 1 returned % orders, expected 2 (newest + the unsettled one)',
      jsonb_array_length(v_rows);
  end if;

  select count(*) into v_unsettled
    from jsonb_array_elements(v_rows) o
   where o ->> 'status' not in ('delivered', 'cancelled');
  if v_unsettled <> 1 then
    raise exception 'FAIL(9): % unsettled orders in the window, expected 1', v_unsettled;
  end if;

  -- Newest-first ordering is preserved when the two arms are combined.
  if ((v_rows -> 0 ->> 'created_at')::timestamptz)
     < ((v_rows -> 1 ->> 'created_at')::timestamptz) then
    raise exception 'FAIL(9): the combined window is not newest-first';
  end if;

  -- A null limit is unchanged: still every order.
  v_rows := public.admin_list_orders_with_items(null);
  if jsonb_array_length(v_rows) <> 4 then
    raise exception 'FAIL(9): a null limit returned %, expected all 4', jsonb_array_length(v_rows);
  end if;

  -- And a limit large enough for everything returns everything exactly once —
  -- the two arms must not duplicate an order that satisfies both.
  v_rows := public.admin_list_orders_with_items(100);
  if jsonb_array_length(v_rows) <> 4 then
    raise exception 'FAIL(9): limit 100 returned % orders, expected 4 with no duplicates',
      jsonb_array_length(v_rows);
  end if;
  raise notice 'CASE 9 ok: the bounded live feed keeps every unsettled order';
end $$;

do $$ begin
  raise notice 'admin_ranged_orders_and_stats_test: ALL CASES PASSED';
end $$;

rollback;
