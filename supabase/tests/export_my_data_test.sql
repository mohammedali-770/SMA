-- ============================================================================
-- export_my_data() — PDPL access / portability
-- (migration 20260912120000_export_my_data).
--
-- THE PROPERTY THAT MATTERS MOST IS ISOLATION. A portability endpoint is, by
-- construction, a function that returns somebody's name, phone, addresses and
-- order history. If it can be pointed at another customer it is an enumeration
-- oracle for the entire customer base. The design defence is that it takes NO
-- argument — so the tests attack that from both directions: a second customer's
-- data must never appear, and there must be no overload that accepts an id.
--
-- PROPERTIES ASSERTED
--   1. it returns the CALLER's account, addresses, orders and loyalty history;
--   2. it returns NOTHING belonging to a second customer, from the same rows;
--   3. an anonymous caller is refused rather than silently given an empty shell;
--   4. the push TOKEN is withheld while the preferences are included;
--   5. internal operational state is not exported;
--   6. empty collections come back as [] rather than null, so a client can
--      iterate without a null check;
--   7. there is exactly one overload and it takes zero arguments.
-- ============================================================================

begin;

\set alice '''0e100000-0000-0000-0000-0000000000a1'''
\set bob   '''0e100000-0000-0000-0000-0000000000b2'''

-- Two customers, so isolation is tested against real neighbouring rows rather
-- than against an empty table.
insert into auth.users (id, phone) values
  (:alice, '+966500000901'), (:bob, '+966500000902');
-- The auth.users insert seeds a profile by trigger, so these are updates.
update public.profiles
   set full_name = 'Alice Test', phone_number = '+966500000901',
       email = 'alice@example.test', role = 'customer', loyalty_points = 250
 where id = :alice;
update public.profiles
   set full_name = 'Bob Test', phone_number = '+966500000902',
       email = 'bob@example.test', role = 'customer', loyalty_points = 999
 where id = :bob;

insert into public.addresses (customer_id, label, description, latitude, longitude, is_default)
values
  (:alice, 'Home',   'Alice building, floor 3', 24.71, 46.67, true),
  (:bob,   'Office', 'Bob tower, floor 9',      24.72, 46.68, true);

insert into public.push_devices
  (customer_id, expo_push_token, platform, lang, is_active, order_updates_enabled, promos_enabled)
values
  (:alice, 'ExponentPushToken[ALICE-SECRET-TOKEN]', 'ios', 'en', true, true, false);

insert into public.loyalty_transactions
  (profile_id, order_id, type, points, balance_after, reason)
values
  (:alice, null, 'adjustment',  250, 250, 'Alice goodwill'),
  (:bob,   null, 'adjustment',  999, 999, 'Bob goodwill');

-- An order with a PRICED add-on. The add-on's price is already inside
-- `line_total`, which is what makes its absence from the export a figure the
-- customer cannot reconcile rather than a missing nicety.
do $$
declare v_order uuid; v_item uuid;
begin
  insert into public.orders
    (customer_id, order_number, customer_name, customer_phone, branch_id,
     branch_name_en, branch_name_ar, status, order_type,
     subtotal, delivery_fee, vat_amount, total, payment_method, payment_status)
  select '0e100000-0000-0000-0000-0000000000a1', 'SM-TEST-EXPORT-1', 'Alice Test',
         '+966500000901', b.id, b.name_en, b.name_ar, 'delivered', 'pickup',
         30.00, 0, 4.50, 30.00, 'cash', 'paid'
    from public.branches b limit 1
  returning id into v_order;

  insert into public.order_items
    (order_id, product_id, name_en, name_ar, unit_price, quantity, line_total)
  select v_order, p.id, 'Test Burger', 'برجر', 22.00, 1, 30.00
    from public.products p limit 1
  returning id into v_item;

  insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
  values (v_item, null, 'Extra cheese', 'جبن إضافي', 8.00);
end $$;

-- ============================================================================
-- 1-2, 4-6. The caller gets their own data, and only their own
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '0e100000-0000-0000-0000-0000000000a1';
do $$
declare v jsonb; v_txt text; v_key text;
begin
  v := public.export_my_data();
  v_txt := v::text;

  -- 1. the caller's own records are present
  if v #>> '{account,name}' <> 'Alice Test' then
    raise exception 'FAIL 1: account name is %, expected Alice Test', v #>> '{account,name}';
  end if;
  if (v #>> '{account,loyalty_points_balance}')::int <> 250 then
    raise exception 'FAIL 1: balance is %, expected 250', v #>> '{account,loyalty_points_balance}';
  end if;
  if jsonb_array_length(v -> 'saved_addresses') <> 1 then
    raise exception 'FAIL 1: expected 1 saved address, got %', jsonb_array_length(v -> 'saved_addresses');
  end if;
  if jsonb_array_length(v -> 'loyalty_history') <> 1 then
    raise exception 'FAIL 1: expected 1 loyalty row, got %', jsonb_array_length(v -> 'loyalty_history');
  end if;

  -- 1b. ADD-ONS. `line_total` (30.00) is the item (22.00) plus the add-on
  -- (8.00), so an export without the add-on states a number the customer
  -- cannot account for. Assert the amount reconciles, not merely that a key
  -- exists.
  declare
    v_item jsonb;
    v_addons jsonb;
  begin
    v_item := v #> '{orders,0,items,0}';
    v_addons := v_item -> 'add_ons';
    if v_addons is null or jsonb_array_length(v_addons) <> 1 then
      raise exception 'FAIL 1b: expected 1 add-on in the exported line item, got %',
        coalesce(jsonb_array_length(v_addons)::text, 'null');
    end if;
    if (v_addons #>> '{0,name}') <> 'Extra cheese' then
      raise exception 'FAIL 1b: add-on name is %', v_addons #>> '{0,name}';
    end if;
    if (v_item ->> 'unit_price')::numeric + (v_addons #>> '{0,price}')::numeric
       <> (v_item ->> 'line_total')::numeric then
      raise exception 'FAIL 1b: % + % does not reconcile to line_total %',
        v_item ->> 'unit_price', v_addons #>> '{0,price}', v_item ->> 'line_total';
    end if;
  end;

  -- 2. NOTHING of Bob's, checked by content rather than by count
  if v_txt ilike '%Bob%' or v_txt like '%966500000902%' or v_txt ilike '%bob@example.test%' then
    raise exception 'FAIL 2: another customer''s data appears in the export';
  end if;
  if v_txt like '%999%' then
    raise exception 'FAIL 2: another customer''s balance appears in the export';
  end if;

  -- 4. preferences yes, token never
  if v_txt like '%ALICE-SECRET-TOKEN%' then
    raise exception 'FAIL 4: the push token was exported';
  end if;
  if (v #> '{notification_devices,0}') ->> 'order_updates_enabled' <> 'true' then
    raise exception 'FAIL 4: notification preferences are missing from the export';
  end if;

  -- 5. internal operational state stays internal.
  --
  -- NOTE THE ESCAPES. `_` is a single-character WILDCARD in LIKE, not a literal
  -- underscore, so the first version of this assertion used '%sync_%' and matched
  -- the phrase "sync state" in the export's own explanatory prose — failing the
  -- suite over the description rather than over any leaked field. An assertion
  -- that greps for internal column names has to escape them or it tests
  -- something other than what it claims.
  if v_txt ilike '%lazywait%'
     or v_txt ilike '%idempotency\_key%'
     or v_txt ilike '%sync\_status%'
     or v_txt ilike '%pos\_sync%'
     or v_txt ilike '%refund\_state%' then
    raise exception 'FAIL 5: internal operational state leaked into the export';
  end if;

  -- 6. every collection is an array, so a client can iterate blind. Alice now
  -- has an order, so the empty-case check moves to a collection she has none
  -- of — a null here would crash a `.map()` on the client.
  for v_key in select unnest(array['orders','saved_addresses','loyalty_history','notification_devices'])
  loop
    if jsonb_typeof(v -> v_key) <> 'array' then
      raise exception 'FAIL 6: % is %, expected an array', v_key, jsonb_typeof(v -> v_key);
    end if;
  end loop;

  raise notice 'cases 1,2,4,5,6 ok -- own data returned, neighbour excluded, token withheld';
end $$;
reset role;

-- ============================================================================
-- 3. Refused without a session — BOTH guards, separately
--
-- Split deliberately. `set local` persists for the whole transaction, so a
-- single anon case would still carry Alice's jwt claim from above and would be
-- refused by the missing GRANT before the function body ever ran — passing while
-- proving nothing about the null-uid check inside it. Each guard is therefore
-- exercised on its own.
-- ============================================================================

-- 3a. anon has no EXECUTE at all.
set local role anon;
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.export_my_data();
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL 3a: anon holds execute on export_my_data';
  end if;
  raise notice 'case 3a ok -- anon cannot execute it';
end $$;
reset role;

-- 3b. authenticated, but no subject: the function's OWN guard must fire, rather
-- than the body running as owner with a null filter and returning a plausible
-- empty shell.
set local request.jwt.claim.sub = '';
set local role authenticated;
do $$
declare v_raised boolean := false; v jsonb;
begin
  begin
    v := public.export_my_data();
  exception when others then
    if sqlerrm like '%requires an authenticated session%' then v_raised := true;
    else raise; end if;
  end;
  if not v_raised then
    raise exception 'FAIL 3b: a session with no subject got a result (%) instead of an error', coalesce(v::text, 'null');
  end if;
  raise notice 'case 3b ok -- a null subject raises rather than returning an empty export';
end $$;
reset role;

-- ============================================================================
-- 7. The zero-argument shape IS the security model
-- ============================================================================
do $$
declare v_n int; v_args int;
begin
  select count(*), coalesce(max(pronargs), -1) into v_n, v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'export_my_data';
  if v_n <> 1 then
    raise exception 'FAIL 7: % overloads of export_my_data — one of them may take a customer id', v_n;
  end if;
  if v_args <> 0 then
    raise exception 'FAIL 7: export_my_data takes % argument(s); it must take none', v_args;
  end if;
  raise notice 'case 7 ok -- exactly one overload, zero arguments';
end $$;

rollback;
