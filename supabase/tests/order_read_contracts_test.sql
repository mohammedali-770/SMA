-- ============================================================================
-- Customer / staff order READ CONTRACTS (migration 20260724200000).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied. Each
-- case RAISES EXCEPTION on failure; a clean run prints NOTICEs and commits
-- nothing (wrapped in a rollback).
--
-- The governing requirement: no customer-readable database, RPC or realtime
-- structure may expose `order_number`, `pos_create_attempt_token`, or any string
-- matching the internal SM-… shape. These cases prove that BY EXECUTION as the
-- actual roles (anon / customer / staff / admin), not by reading the migration.
-- ============================================================================
begin;

-- The generated shape of the internal id: SM-<4-digit year>-<6+ digits>.
create or replace function pg_temp.has_sm_number(p text)
returns boolean language sql immutable as $$
  select p is not null and p ~ 'SM-[0-9]{4}-[0-9]{4,}';
$$;

-- Run a statement as a role with a given identity and report the SQLSTATE.
-- Returns null when the statement succeeded.
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

-- Count rows a role can actually see.
create or replace function pg_temp.count_as(
  p_role text, p_uid uuid, p_staff text, p_admin text, p_sql text
) returns integer language plpgsql as $$
declare v_n integer;
begin
  perform set_config('test.auth_uid', coalesce(p_uid::text, ''), true);
  perform set_config('test.is_staff', coalesce(p_staff, ''), true);
  perform set_config('test.is_admin', coalesce(p_admin, ''), true);
  execute format('set local role %I', p_role);
  execute p_sql into v_n;
  reset role;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: one customer with one order, plus an unrelated second customer.
-- ---------------------------------------------------------------------------
create temporary table t_ctx (cust uuid, other uuid, staff uuid, ord uuid, ord_number text)
  on commit drop;

do $$
declare
  v_cust uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_ord uuid := gen_random_uuid();
  v_num text;
begin
  -- profiles.id references auth.users(id), so the auth user must exist first;
  -- handle_new_user() then creates the profile row, which is why the insert
  -- below upserts rather than plain-inserts.
  insert into auth.users (id) values (v_cust), (v_other), (v_staff)
  on conflict (id) do nothing;
  insert into public.profiles (id, full_name, phone_number, role)
    values (v_cust, 'Cust', '+966500000031', 'customer'),
           (v_other, 'Other', '+966500000032', 'customer'),
           (v_staff, 'Staff', '+966500000033', 'admin')
  on conflict (id) do update set full_name = excluded.full_name,
    phone_number = excluded.phone_number, role = excluded.role;

  -- orders.branch_id is a real FK; v_branch had no row behind it.
  insert into public.branches (id, name_en, name_ar)
  values (v_branch, 'Contract Branch', 'فرع العقود') on conflict (id) do nothing;
  insert into public.orders (id, customer_id, branch_id, order_type, subtotal, total,
                             payment_method, payment_status,
                             pos_create_attempt_token, notes, customer_phone)
    values (v_ord, v_cust, v_branch, 'pickup', 50, 50, 'cash', 'pending',
            'FENCE-TOKEN-XYZ', 'internal staff note', '+966500000031');

  select order_number into v_num from public.orders where id = v_ord;
  if not pg_temp.has_sm_number(v_num) then
    raise exception 'FIXTURE FAILED: order_number is not an SM-… value (%)', v_num;
  end if;

  insert into t_ctx values (v_cust, v_other, v_staff, v_ord, v_num);
  raise notice 'FIXTURE ok: order % with internal number %', v_ord, v_num;
end $$;

-- ---- CASE 1: the customer GRANT is exactly the safe column set --------------
do $$
declare
  -- The customer-readable column set, pinned EXACTLY. Adding to this list is a
  -- deliberate act, not a formality: PostgREST rejects a whole select that names
  -- an ungranted column, so a column reaching the customer selector without its
  -- grant breaks every order read — and a column granted without being wanted
  -- here is a quiet widening of the customer surface. Both directions fail below.
  --
  -- `notes` was added by 20260821170000_order_item_notes.sql. It is the
  -- customer's OWN kitchen note, typed by them at checkout on their own
  -- RLS-scoped order, and the receipt shows it back to them. The read-contracts
  -- comment filed it under "staff notes", but nothing writes a staff note there:
  -- place_order fills it from the customer's own p_notes.
  v_expected text[] := array[
    'id','status','order_type','created_at','branch_id','branch_name_en',
    'branch_name_ar','subtotal','delivery_fee','discount_amount',
    'loyalty_discount_amount','vat_amount','total','loyalty_points_earned',
    'payment_status','payment_method','notes','lazywait_order_number',
    'lazywait_sync_state','lazywait_ref','sync_blocked_reason',
    'sync_next_attempt_at','pos_create_attempted_at','pos_customer_retry_count',
    'refund_state'];
  v_actual text[];
  v_extra  text[];
  v_missing text[];
begin
  select array_agg(column_name order by column_name) into v_actual
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'orders'
     and grantee = 'authenticated' and privilege_type = 'SELECT';

  select array_agg(x order by x) into v_extra
    from unnest(v_actual) x where x <> all(v_expected);
  select array_agg(x order by x) into v_missing
    from unnest(v_expected) x where x <> all(coalesce(v_actual, '{}'));

  if v_extra is not null then
    raise exception 'CASE 1 FAILED: customer may read UNEXPECTED columns: %', v_extra;
  end if;
  if v_missing is not null then
    raise exception 'CASE 1 FAILED: customer lost required columns: %', v_missing;
  end if;

  -- And NO table-wide privilege remains (that is what made RLS column-blind).
  if has_table_privilege('authenticated', 'public.orders', 'select') then
    raise exception 'CASE 1 FAILED: table-wide SELECT on orders is still granted';
  end if;
  if has_table_privilege('authenticated', 'public.orders', 'update') then
    raise exception 'CASE 1 FAILED: table-wide UPDATE on orders is still granted';
  end if;
  raise notice 'CASE 1 ok: customer grant is exactly the 25 safe columns, no table-wide privilege';
end $$;

-- ---- CASE 2: excluded columns are UNREADABLE by explicit selection ----------
do $$
declare
  v_c uuid; v_state text; v_col text;
  v_excluded text[] := array[
    'order_number','pos_create_attempt_token','customer_id','customer_name',
    'customer_phone','notes','coupon_code','address_snapshot','address_id',
    'idempotency_key','payment_provider','paid_at','loyalty_points_redeemed',
    'loyalty_awarded_at','sync_status','sync_attempt_count','sync_last_error',
    'synced_at','lazywait_order_id','lazywait_status','first_pos_sync_failure_at',
    'pos_sync_started_at','pos_sync_deadline_at','pos_confirmation_reason',
    'pos_customer_retry_last_at','refund_required_at','refund_completed_at',
    'refund_failure_code','updated_at'];
begin
  select cust into v_c from t_ctx;
  foreach v_col in array v_excluded loop
    v_state := pg_temp.err_as('authenticated', v_c, '', '',
                 format('select %I from public.orders', v_col));
    if v_state is distinct from '42501' then
      raise exception 'CASE 2 FAILED: customer could select %s (sqlstate %s)',
                      v_col, coalesce(v_state, 'SUCCESS');
    end if;
  end loop;
  raise notice 'CASE 2 ok: all % excluded columns rejected with insufficient_privilege',
               array_length(v_excluded, 1);
end $$;

-- ---- CASE 3: select('*') fails; the safe projection succeeds ----------------
do $$
declare v_c uuid; v_state text; v_n integer;
begin
  select cust into v_c from t_ctx;

  -- `select *` expands to every column, including ones with no privilege.
  v_state := pg_temp.err_as('authenticated', v_c, '', '', 'select * from public.orders');
  if v_state is distinct from '42501' then
    raise exception 'CASE 3 FAILED: select * succeeded for a customer (%)',
                    coalesce(v_state, 'SUCCESS');
  end if;

  -- The supported customer projection still works and returns the owned row.
  v_n := pg_temp.count_as('authenticated', v_c, '', '',
          'select count(*)::int from (select id, status, total, lazywait_order_number,
             lazywait_sync_state, refund_state from public.orders) s');
  if v_n <> 1 then
    raise exception 'CASE 3 FAILED: customer safe projection returned % rows (expected 1)', v_n;
  end if;
  raise notice 'CASE 3 ok: select * denied, safe projection returns the owned row';
end $$;

-- ---- CASE 4: row ownership (RLS) survives losing the customer_id grant ------
-- The policy compares customer_id = auth.uid(); policy expressions are evaluated
-- by the system and need no column privilege. Prove another customer sees none.
do $$
declare v_o uuid; v_n integer;
begin
  select other into v_o from t_ctx;
  v_n := pg_temp.count_as('authenticated', v_o, '', '',
          'select count(*)::int from (select id from public.orders) s');
  if v_n <> 0 then
    raise exception 'CASE 4 FAILED: a different customer saw % order rows', v_n;
  end if;
  raise notice 'CASE 4 ok: RLS ownership still enforced without a customer_id grant';
end $$;

-- ---- CASE 5: anon sees nothing at all --------------------------------------
do $$
declare v_state text;
begin
  v_state := pg_temp.err_as('anon', null, '', '', 'select id from public.orders');
  if v_state is distinct from '42501' then
    raise exception 'CASE 5 FAILED: anon could read orders (%)', coalesce(v_state, 'SUCCESS');
  end if;
  if has_table_privilege('anon', 'public.orders', 'select') then
    raise exception 'CASE 5 FAILED: anon holds SELECT on orders';
  end if;
  raise notice 'CASE 5 ok: anon has no access to orders';
end $$;

-- ---- CASE 6: nested/embedded relations leak nothing -------------------------
-- PostgREST embedding compiles to a join over order_items / order_item_modifiers.
-- Those policies reference orders.customer_id, so they must still scope rows —
-- and must not become a side channel back to the parent's internal columns.
do $$
declare v_c uuid; v_o uuid; v_state text; v_n integer;
begin
  select cust, other into v_c, v_o from t_ctx;

  -- The owner may read their lines.
  v_n := pg_temp.count_as('authenticated', v_c, '', '',
          'select count(*)::int from public.order_items');
  if v_n is null then raise exception 'CASE 6 FAILED: owner could not read order_items'; end if;

  -- A different customer may not.
  v_n := pg_temp.count_as('authenticated', v_o, '', '',
          'select count(*)::int from public.order_items');
  if v_n <> 0 then
    raise exception 'CASE 6 FAILED: a different customer saw % order_items', v_n;
  end if;

  -- A join back to the parent cannot surface an ungranted column.
  v_state := pg_temp.err_as('authenticated', v_c, '', '',
    'select o.order_number from public.order_items i join public.orders o on o.id = i.order_id');
  if v_state is distinct from '42501' then
    raise exception 'CASE 6 FAILED: order_number reachable through a join (%)',
                    coalesce(v_state, 'SUCCESS');
  end if;
  raise notice 'CASE 6 ok: embedded relations scoped, no join path to internal columns';
end $$;

-- ---- CASE 7: staff RPCs — authorization, and no fencing token --------------
do $$
declare
  v_c uuid; v_s uuid; v_state text; v_json jsonb; v_txt text;
begin
  select cust, staff into v_c, v_s from t_ctx;

  -- A customer must NOT be able to call the staff feeds.
  foreach v_txt in array array['admin_list_orders', 'admin_list_orders_with_items'] loop
    v_state := pg_temp.err_as('authenticated', v_c, 'false', 'false',
                 format('select public.%I(null::integer)', v_txt));
    if v_state is distinct from '42501' then
      raise exception 'CASE 7 FAILED: customer could call %s (%s)', v_txt,
                      coalesce(v_state, 'SUCCESS');
    end if;
  end loop;

  -- anon must not even hold EXECUTE.
  if has_function_privilege('anon', 'public.admin_list_orders(integer)', 'execute')
     or has_function_privilege('anon', 'public.admin_list_orders_with_items(integer)', 'execute')
     or has_function_privilege('anon', 'public.admin_set_order_status(uuid, public.order_status)', 'execute') then
    raise exception 'CASE 7 FAILED: anon holds EXECUTE on a staff RPC';
  end if;

  -- Staff CAN call it, and it returns the order including staff-only columns.
  perform set_config('test.auth_uid', v_s::text, true);
  perform set_config('test.is_staff', 'true', true);
  perform set_config('test.is_admin', 'true', true);
  set local role authenticated;
  v_json := public.admin_list_orders_with_items(null);
  reset role;

  if jsonb_array_length(v_json) < 1 then
    raise exception 'CASE 7 FAILED: staff feed returned no orders';
  end if;
  if not (v_json -> 0 ? 'order_number') then
    raise exception 'CASE 7 FAILED: staff feed lost order_number (staff need it)';
  end if;
  if v_json -> 0 ? 'pos_create_attempt_token' then
    raise exception 'CASE 7 FAILED: staff feed exposed pos_create_attempt_token';
  end if;
  if not (v_json -> 0 ? 'order_items') then
    raise exception 'CASE 7 FAILED: staff feed lost its embedded items';
  end if;
  raise notice 'CASE 7 ok: staff RPCs gated, carry order_number, never the fencing token';
end $$;

-- ---- CASE 8: admin_set_order_status is ADMIN-only ---------------------------
do $$
declare v_c uuid; v_s uuid; v_o uuid; v_state text; v_status text;
begin
  select cust, staff, ord into v_c, v_s, v_o from t_ctx;

  -- Customer: denied.
  v_state := pg_temp.err_as('authenticated', v_c, 'false', 'false',
               format('select public.admin_set_order_status(%L::uuid, %L::public.order_status)',
                      v_o, 'preparing'));
  if v_state is distinct from '42501' then
    raise exception 'CASE 8 FAILED: customer changed order status (%)', coalesce(v_state, 'SUCCESS');
  end if;

  -- Non-admin staff (accountant-like: staff yes, admin no): denied.
  v_state := pg_temp.err_as('authenticated', v_s, 'true', 'false',
               format('select public.admin_set_order_status(%L::uuid, %L::public.order_status)',
                      v_o, 'preparing'));
  if v_state is distinct from '42501' then
    raise exception 'CASE 8 FAILED: non-admin staff changed order status (%)',
                    coalesce(v_state, 'SUCCESS');
  end if;

  -- Admin: allowed.
  v_state := pg_temp.err_as('authenticated', v_s, 'true', 'true',
               format('select public.admin_set_order_status(%L::uuid, %L::public.order_status)',
                      v_o, 'preparing'));
  if v_state is not null then
    raise exception 'CASE 8 FAILED: admin could NOT change order status (%)', v_state;
  end if;
  select status::text into v_status from public.orders where id = v_o;
  if v_status <> 'preparing' then
    raise exception 'CASE 8 FAILED: status did not change (%)', v_status;
  end if;
  raise notice 'CASE 8 ok: status write is admin-only and effective';
end $$;

-- ---- CASE 9: place_order is unreachable; the wrapper is safe ---------------
do $$
declare v_c uuid; v_state text;
begin
  select cust into v_c from t_ctx;
  if has_function_privilege('authenticated',
       'public.place_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)',
       'execute') then
    raise exception 'CASE 9 FAILED: authenticated still holds EXECUTE on place_order';
  end if;
  if has_function_privilege('anon',
       'public.place_customer_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)',
       'execute') then
    raise exception 'CASE 9 FAILED: anon holds EXECUTE on place_customer_order';
  end if;
  -- The wrapper is granted to authenticated (customers call it).
  if not has_function_privilege('authenticated',
       'public.place_customer_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)',
       'execute') then
    raise exception 'CASE 9 FAILED: authenticated cannot call place_customer_order';
  end if;
  -- place_order is still reachable by the internal wrapper: it is SECURITY
  -- DEFINER owned by the table owner, which holds EXECUTE regardless of the
  -- revoke. CASE 10 proves that path works end to end (identity, pricing,
  -- idempotency), which is a stronger check than any grant assertion here.
  raise notice 'CASE 9 ok: place_order revoked from customers; wrapper is the only client path';
end $$;

-- ---- CASE 10: the wrapper preserves identity, pricing and idempotency -------
do $$
declare
  v_cust  uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_cat   uuid := gen_random_uuid();
  v_prod  uuid := gen_random_uuid();
  v_items jsonb;
  v_key   uuid := gen_random_uuid();
  v_a     jsonb;
  v_b     jsonb;
  v_direct public.orders;
  v_owner uuid;
  v_k     text;
begin
  set local session_replication_role = replica;
  -- profiles.id references auth.users(id), so the auth user must exist first;
  -- handle_new_user() then creates the profile row, which is why the insert
  -- below upserts rather than plain-inserts.
  insert into auth.users (id) values (v_cust) on conflict (id) do nothing;
  insert into public.profiles (id, full_name, phone_number, role, loyalty_points)
    values (v_cust, 'Wrapper', '+966500000034', 'customer', 0)
  on conflict (id) do update set full_name = excluded.full_name,
    phone_number = excluded.phone_number, role = excluded.role,
    loyalty_points = excluded.loyalty_points;
  insert into public.branches (id, name_en, name_ar, address_en, address_ar, phone,
                               latitude, longitude, delivery_fee, min_delivery_order, is_active)
    values (v_branch, 'B', 'ب', 'A', 'ع', '+966500000000', 24.7, 46.7, 15, 40, true);
  insert into public.categories (id, name_en, name_ar, sort_order) values (v_cat, 'C', 'ك', 1);
  insert into public.products (id, category_id, name_en, name_ar, price, is_active, sort_order)
    values (v_prod, v_cat, 'P', 'م', 100, true, 1);
  set local session_replication_role = origin;

  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2));

  -- Call the wrapper AS THE CUSTOMER, through the authenticated role.
  perform set_config('test.auth_uid', v_cust::text, true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.is_admin', 'false', true);
  set local role authenticated;
  v_a := public.place_customer_order(v_branch, 'pickup', v_items, null, null, null, 0, v_key, 'cash');
  reset role;

  -- (a) IDENTITY: auth.uid() survived the SECURITY DEFINER hop.
  select customer_id into v_owner from public.orders where id = (v_a->>'id')::uuid;
  if v_owner is distinct from v_cust then
    raise exception 'CASE 10 FAILED: order bound to %, expected %', v_owner, v_cust;
  end if;

  -- (b) PROJECTION: no internal field, and no SM-… value anywhere in the jsonb.
  foreach v_k in array array['order_number','pos_create_attempt_token','customer_id',
                             'customer_name','customer_phone','notes','coupon_code',
                             'idempotency_key','address_snapshot','payment_provider',
                             'loyalty_points_redeemed','sync_last_error'] loop
    if v_a ? v_k then
      raise exception 'CASE 10 FAILED: wrapper returned internal field %', v_k;
    end if;
  end loop;
  if exists (
    select 1 from jsonb_each_text(v_a) e where pg_temp.has_sm_number(e.value)
  ) then
    raise exception 'CASE 10 FAILED: wrapper result contains an SM-… value: %', v_a;
  end if;

  -- (c) PRICING is the server's, unchanged: compare with the row place_order wrote.
  select * into v_direct from public.orders where id = (v_a->>'id')::uuid;
  if (v_a->>'subtotal')::numeric is distinct from v_direct.subtotal
     or (v_a->>'delivery_fee')::numeric is distinct from v_direct.delivery_fee
     or (v_a->>'vat_amount')::numeric is distinct from v_direct.vat_amount
     or (v_a->>'total')::numeric is distinct from v_direct.total
     or (v_a->>'discount_amount')::numeric is distinct from v_direct.discount_amount
     or (v_a->>'loyalty_discount_amount')::numeric is distinct from v_direct.loyalty_discount_amount
     or (v_a->>'loyalty_points_earned')::integer is distinct from v_direct.loyalty_points_earned then
    raise exception 'CASE 10 FAILED: wrapper projection disagrees with the stored order';
  end if;
  if v_direct.total is null or v_direct.total <= 0 then
    raise exception 'CASE 10 FAILED: server total not computed (%)', v_direct.total;
  end if;

  -- (d) IDEMPOTENCY: the same key returns the SAME order, and creates no second one.
  perform set_config('test.auth_uid', v_cust::text, true);
  set local role authenticated;
  v_b := public.place_customer_order(v_branch, 'pickup', v_items, null, null, null, 0, v_key, 'cash');
  reset role;
  if (v_b->>'id') is distinct from (v_a->>'id') then
    raise exception 'CASE 10 FAILED: idempotency broken (% vs %)', v_b->>'id', v_a->>'id';
  end if;
  if (select count(*) from public.orders where customer_id = v_cust) <> 1 then
    raise exception 'CASE 10 FAILED: a duplicate order was created';
  end if;

  raise notice 'CASE 10 ok: identity, pricing, projection and idempotency all preserved';
end $$;

-- ---- CASE 11: Realtime — orders out, staff-only signal in -------------------
do $$
declare v_c uuid; v_s uuid; v_n integer; v_state text;
begin
  select cust, staff into v_c, v_s from t_ctx;

  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'CASE 11 PRECONDITION FAILED: no supabase_realtime publication to verify';
  end if;

  -- (a) public.orders must NOT be published any more.
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    raise exception 'CASE 11 FAILED: public.orders is still in supabase_realtime';
  end if;

  -- (b) the signal table IS published.
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'order_change_events'
  ) then
    raise exception 'CASE 11 FAILED: order_change_events is not published';
  end if;

  -- (c) events are actually emitted (the fixture + CASE 8 update wrote some).
  if (select count(*) from public.order_change_events) = 0 then
    raise exception 'CASE 11 FAILED: no change events were emitted';
  end if;

  -- (d) the payload carries no order contents: exactly these columns.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'order_change_events'
       and column_name not in ('id', 'order_id', 'event', 'created_at')
  ) then
    raise exception 'CASE 11 FAILED: order_change_events has unexpected columns';
  end if;

  -- (e) anon: no privilege at all.
  if has_table_privilege('anon', 'public.order_change_events', 'select') then
    raise exception 'CASE 11 FAILED: anon may read order_change_events';
  end if;

  -- (f) a CUSTOMER sees zero rows (RLS is what Realtime authorizes against).
  v_n := pg_temp.count_as('authenticated', v_c, 'false', 'false',
          'select count(*)::int from public.order_change_events');
  if v_n <> 0 then
    raise exception 'CASE 11 FAILED: a customer received % change events', v_n;
  end if;

  -- (g) STAFF do see them, so the dashboard still refreshes.
  v_n := pg_temp.count_as('authenticated', v_s, 'true', 'true',
          'select count(*)::int from public.order_change_events');
  if v_n = 0 then
    raise exception 'CASE 11 FAILED: staff received no change events (dashboard would stall)';
  end if;

  -- (h) no client role may write to the signal table.
  v_state := pg_temp.err_as('authenticated', v_s, 'true', 'true',
    format('insert into public.order_change_events (order_id, event) values (%L::uuid, %L)',
           (select ord from t_ctx), 'update'));
  if v_state is distinct from '42501' then
    raise exception 'CASE 11 FAILED: staff could forge a change event (%)',
                    coalesce(v_state, 'SUCCESS');
  end if;

  raise notice 'CASE 11 ok: orders unpublished, staff-only signal published and emitting';
end $$;

-- ---- CASE 12: recursive value scan of everything a customer can read -------
-- Walks every customer-readable column of orders by VALUE, so a future column
-- that starts carrying the identifier is caught even if nobody updates a list.
do $$
declare
  v_c uuid;
  v_cols text;
  v_bad integer;
begin
  select cust into v_c from t_ctx;

  select string_agg(format('coalesce(%I::text, %L)', column_name, ''), ' || '' | '' || ')
    into v_cols
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'orders'
     and grantee = 'authenticated' and privilege_type = 'SELECT';

  perform set_config('test.auth_uid', v_c::text, true);
  perform set_config('test.is_staff', 'false', true);
  perform set_config('test.is_admin', 'false', true);
  set local role authenticated;
  execute format(
    'select count(*)::int from public.orders where (%s) ~ ''SM-[0-9]{4}-[0-9]{4,}''', v_cols)
    into v_bad;
  reset role;

  if v_bad <> 0 then
    raise exception 'CASE 12 FAILED: % customer-readable rows contain an SM-… value', v_bad;
  end if;
  raise notice 'CASE 12 ok: no SM-… value in any customer-readable orders column';
end $$;

rollback;
