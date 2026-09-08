-- ============================================================================
-- Loyalty is PICKUP ONLY -- earning and redemption both.
--
-- Covers 20260907120000_loyalty_pickup_only.sql.
--
-- WHAT THIS FILE IS REALLY FOR. The rule is two lines of SQL; the risk is that
-- it lands in only ONE of the two functions that must agree.
-- `compute_order_snapshot` is what the checkout screen shows the customer and
-- `place_order` is what actually happens. If the gate were added to
-- `place_order` alone, the app would promise points on a delivery order and
-- then not grant them -- the checkout lying about the price, which is the
-- failure mode this repository has been bitten by before. Section 4 asserts
-- preview and actual agree, on BOTH channels, for the SAME cart. It is the
-- reason this file exists.
--
-- Seed fixtures (supabase/seed.sql): branch 001 (delivery_fee 15,
-- min_delivery_order 40), product 001 at 32.00. VAT is INCLUSIVE -- extracted
-- from the total rather than added to it -- so a 2 x 32.00 pickup cart is
-- payable 64.00 and the same cart delivered is 79.00.
--
-- psql does not interpolate :variables inside dollar-quoted bodies, so the
-- fixture ids are repeated literally inside every do-block. They are declared
-- once below so a reader can see them in one place.
--
-- Runs against a throwaway chain-applied Postgres. Every case raises on
-- failure, so the script aborts non-zero; a clean run prints the final notice
-- and commits nothing.
-- ============================================================================
begin;

\set eater   '''0e000000-0000-0000-0000-000000000001'''
\set addr    '''0e000000-0000-0000-0000-0000000ad001'''
\set branch  '''b0000000-0000-0000-0000-000000000001'''
\set beef    '''a0000000-0000-0000-0000-000000000001'''

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, email) values (:eater, 'pickup-eater@x');

-- handle_new_user() created the profile from the insert above. 500 points is
-- comfortably over the redemption floor, so a refusal below is the CHANNEL rule
-- rather than an insufficient balance.
insert into public.profiles (id, role, full_name, phone_number, loyalty_points) values
  (:eater, 'customer', 'Pickup Eater', '+966500000101', 500)
on conflict (id) do update set role = excluded.role,
  full_name = excluded.full_name, phone_number = excluded.phone_number,
  loyalty_points = excluded.loyalty_points;

-- Cash only, so an order settles without a payment attempt; min_points_to_redeem
-- 0 keeps the arithmetic below about the channel rather than the floor.
update public.app_settings
   set loyalty_enabled = true,
       min_points_to_redeem = 0,
       cash_payment_enabled = true,
       online_payment_enabled = false,
       default_payment_method = 'cash',
       loyalty_pickup_only = true
 where id = true;

-- A real zone around the seeded Riyadh branch, plus an address inside it, so
-- place_order's PostGIS check passes and the delivery cases are about the
-- channel rule rather than about geometry.
insert into public.branch_delivery_zones (branch_id, name, zone_geojson, zone_polygon, is_active)
values (
  :branch, 'test box',
  '{"type":"MultiPolygon","coordinates":[[[[46.6,24.6],[46.8,24.6],[46.8,24.8],[46.6,24.8],[46.6,24.6]]]]}'::jsonb,
  extensions.ST_GeomFromText(
    'MULTIPOLYGON(((46.6 24.6, 46.8 24.6, 46.8 24.8, 46.6 24.8, 46.6 24.6)))', 4326),
  true);

insert into public.addresses (id, customer_id, label, latitude, longitude, description)
values (:addr, :eater, 'Home', 24.7136, 46.6753, 'Second floor, blue door');

-- ============================================================================
-- 1. The setting exists, defaults TRUE, and both functions carry the gate
-- ============================================================================
do $$
declare v_place integer; v_snap integer; v_default text;
begin
  select column_default into v_default from information_schema.columns
   where table_schema = 'public' and table_name = 'app_settings'
     and column_name = 'loyalty_pickup_only';
  if v_default is null then
    raise exception 'FAIL 1: app_settings.loyalty_pickup_only is missing or has no default';
  end if;
  -- Defaulting TRUE is the point: a database that has never been configured is
  -- already pickup-only, rather than open until somebody remembers.
  if v_default not like 'true%' then
    raise exception 'FAIL 1: loyalty_pickup_only defaults to %, expected true', v_default;
  end if;

  -- Parity of the gate itself. Four references per function: declared, derived,
  -- and used by the redeem and the earn branch.
  select count(*) into v_place from regexp_matches(
    (select prosrc from pg_proc where proname = 'place_order'), 'v_loyalty_channel_ok', 'g');
  select count(*) into v_snap from regexp_matches(
    (select prosrc from pg_proc where proname = 'compute_order_snapshot'), 'v_loyalty_channel_ok', 'g');
  if v_place <> 4 or v_snap <> 4 then
    raise exception 'FAIL 1: gate parity is place_order=% snapshot=% (expected 4 each)', v_place, v_snap;
  end if;

  raise notice 'case 1 ok -- setting present, defaults true, both functions gated';
end $$;

-- ============================================================================
-- 2. PICKUP earns, and may redeem
-- ============================================================================
select set_config('test.auth_uid', :eater, true);
select set_config('test.is_admin', 'false', true);

do $$
declare o public.orders;
begin
  -- 2 x 32.00 = 64.00 payable, no delivery fee on pickup. points_per_riyal
  -- defaults to 1, so the order earns 64.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb);

  if o.total <> 64.00 then
    raise exception 'FAIL 2: pickup total is %, expected 64.00', o.total;
  end if;
  if o.loyalty_points_earned <> 64 then
    raise exception 'FAIL 2: pickup earned %, expected 64', o.loyalty_points_earned;
  end if;

  -- And the LEDGER recorded it, rather than only the order column.
  if not exists (select 1 from public.loyalty_transactions
                 where order_id = o.id and type = 'earn' and points = 64) then
    raise exception 'FAIL 2: no earn ledger row for the pickup order';
  end if;

  raise notice 'case 2 ok -- a pickup order earns, and the ledger says so';
end $$;

do $$
declare o public.orders;
begin
  -- Redeem 100 points => 10.00 off at the default 0.10/point, leaving 54.00
  -- payable, which then earns 54.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        null, null, null, 100);

  if o.loyalty_points_redeemed <> 100 then
    raise exception 'FAIL 2b: pickup redeemed %, expected 100', o.loyalty_points_redeemed;
  end if;
  if o.loyalty_discount_amount <> 10.00 then
    raise exception 'FAIL 2b: pickup loyalty discount is %, expected 10.00', o.loyalty_discount_amount;
  end if;
  if o.total <> 54.00 then
    raise exception 'FAIL 2b: pickup total is %, expected 54.00', o.total;
  end if;
  if not exists (select 1 from public.loyalty_transactions
                 where order_id = o.id and type = 'redeem' and points = -100) then
    raise exception 'FAIL 2b: no redeem ledger row for the pickup order';
  end if;

  raise notice 'case 2b ok -- a pickup order may spend points';
end $$;

-- ============================================================================
-- 3. DELIVERY earns nothing, and cannot redeem
--    The order still SUCCEEDS -- the rule withholds points, it does not refuse
--    the customer's dinner.
-- ============================================================================
do $$
declare o public.orders; v_bal_before integer; v_bal_after integer;
begin
  select loyalty_points into v_bal_before from public.profiles
   where id = '0e000000-0000-0000-0000-000000000001'::uuid;

  -- Subtotal 64.00 clears the branch minimum of 40; the 15.00 fee applies.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        '0e000000-0000-0000-0000-0000000ad001'::uuid,
        null, null, 100);   -- asks to redeem 100, and must be refused

  if o.loyalty_points_earned <> 0 then
    raise exception 'FAIL 3: a delivery order earned % points, expected 0', o.loyalty_points_earned;
  end if;
  if o.loyalty_points_redeemed <> 0 then
    raise exception 'FAIL 3: a delivery order redeemed %, expected 0', o.loyalty_points_redeemed;
  end if;
  if o.loyalty_discount_amount <> 0 then
    raise exception 'FAIL 3: a delivery order took % off, expected 0', o.loyalty_discount_amount;
  end if;

  -- The customer pays the whole amount: 64.00 goods + 15.00 delivery.
  if o.total <> 79.00 then
    raise exception 'FAIL 3: delivery total is %, expected 79.00', o.total;
  end if;
  -- ...and nothing is stamped as awarded.
  if o.loyalty_awarded_at is not null then
    raise exception 'FAIL 3: a delivery order stamped loyalty_awarded_at';
  end if;

  -- THE BALANCE IS UNTOUCHED. Not merely "no points added" -- no points TAKEN
  -- either, which is what a half-applied gate would do: refuse the earn but
  -- still burn the 100 the customer asked to spend.
  select loyalty_points into v_bal_after from public.profiles
   where id = '0e000000-0000-0000-0000-000000000001'::uuid;
  if v_bal_after <> v_bal_before then
    raise exception 'FAIL 3: balance moved % -> % on a delivery order', v_bal_before, v_bal_after;
  end if;

  -- And nothing was written to the ledger for it.
  if exists (select 1 from public.loyalty_transactions where order_id = o.id) then
    raise exception 'FAIL 3: a delivery order wrote a loyalty ledger row';
  end if;

  raise notice 'case 3 ok -- delivery earns 0, redeems 0, and the balance never moves';
end $$;

-- ============================================================================
-- 4. PREVIEW AND ACTUAL AGREE -- the reason this file exists
--    Same cart, both channels: compute_order_snapshot must promise exactly what
--    place_order delivers. A gate applied to only one function fails here.
-- ============================================================================
do $$
declare snap jsonb; o public.orders;
begin
  -- PICKUP. The preview is taken first, then the order placed against the same
  -- balance, so the two are comparable.
  snap := public.compute_order_snapshot(
            '0e000000-0000-0000-0000-000000000001'::uuid,
            'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
            '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
            null, null, 100);
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        null, null, null, 100);

  if (snap ->> 'loyalty_points_earned')::int <> o.loyalty_points_earned then
    raise exception 'FAIL 4: pickup preview promised % earned, order gave %',
      snap ->> 'loyalty_points_earned', o.loyalty_points_earned;
  end if;
  if (snap ->> 'loyalty_points_redeemed')::int <> o.loyalty_points_redeemed then
    raise exception 'FAIL 4: pickup preview promised % redeemed, order took %',
      snap ->> 'loyalty_points_redeemed', o.loyalty_points_redeemed;
  end if;
  if (snap ->> 'total')::numeric <> o.total then
    raise exception 'FAIL 4: pickup preview total % <> order total %',
      snap ->> 'total', o.total;
  end if;
  -- Guard against a vacuous pass: the pickup leg must actually be moving points,
  -- or "preview matches actual" is only two zeroes agreeing.
  if o.loyalty_points_redeemed = 0 then
    raise exception 'FAIL 4: the pickup leg redeemed nothing, so it proves nothing';
  end if;

  -- DELIVERY -- both must say zero, and say the SAME zero.
  snap := public.compute_order_snapshot(
            '0e000000-0000-0000-0000-000000000001'::uuid,
            'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
            '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
            '0e000000-0000-0000-0000-0000000ad001'::uuid, null, 100);
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        '0e000000-0000-0000-0000-0000000ad001'::uuid, null, null, 100);

  if (snap ->> 'loyalty_points_earned')::int <> 0
     or o.loyalty_points_earned <> 0 then
    raise exception 'FAIL 4: delivery preview/order earned %/%, expected 0/0',
      snap ->> 'loyalty_points_earned', o.loyalty_points_earned;
  end if;
  if (snap ->> 'loyalty_points_redeemed')::int <> 0
     or o.loyalty_points_redeemed <> 0 then
    raise exception 'FAIL 4: delivery preview/order redeemed %/%, expected 0/0',
      snap ->> 'loyalty_points_redeemed', o.loyalty_points_redeemed;
  end if;
  if (snap ->> 'loyalty_discount_amount')::numeric <> 0 then
    raise exception 'FAIL 4: delivery preview offered a loyalty discount of %',
      snap ->> 'loyalty_discount_amount';
  end if;
  if (snap ->> 'total')::numeric <> o.total then
    raise exception 'FAIL 4: delivery preview total % <> order total %',
      snap ->> 'total', o.total;
  end if;

  raise notice 'case 4 ok -- the checkout preview and the placed order agree on both channels';
end $$;

-- ============================================================================
-- 5. The setting is REAL: turning it off restores delivery earning
--    Without this, `loyalty_pickup_only` could be ignored by both functions and
--    every case above would still pass.
-- ============================================================================
do $$
declare o public.orders; snap jsonb;
begin
  update public.app_settings set loyalty_pickup_only = false where id = true;

  snap := public.compute_order_snapshot(
            '0e000000-0000-0000-0000-000000000001'::uuid,
            'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
            '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
            '0e000000-0000-0000-0000-0000000ad001'::uuid);
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        '0e000000-0000-0000-0000-0000000ad001'::uuid);

  -- 64.00 of goods earns 64. The customer still pays 79.00 -- 64.00 of food plus
  -- the 15.00 delivery fee -- but the FEE DOES NOT EARN.
  --
  -- This figure was 79 until 20260908120000, which moved earning from the
  -- payable total to an eligible LINE base. The delivery fee is not a line, so
  -- it left the base structurally. That is the owner's decision of 2026-09-07
  -- (docs/LOYALTY.md section 3), and this is the ONE configuration in which it
  -- is observable: with pickup_only ON, an earning order is a pickup order and
  -- its fee is 0.
  --
  -- The assertion's PURPOSE is unchanged and still sharp: it proves the setting
  -- is live, because delivery earns something here and nothing when the setting
  -- is on. Only the arithmetic moved.
  if o.loyalty_points_earned <> 64 then
    raise exception 'FAIL 5: with pickup_only off, delivery earned %, expected 64 (the 15.00 fee must not earn)',
      o.loyalty_points_earned;
  end if;
  if o.total <> 79.00 then
    raise exception 'FAIL 5: delivery total is %, expected 79.00 -- the fee is still CHARGED', o.total;
  end if;
  -- The preview follows the setting too, not just the order.
  if (snap ->> 'loyalty_points_earned')::int <> 64 then
    raise exception 'FAIL 5: with pickup_only off, the delivery preview promised %, expected 64',
      snap ->> 'loyalty_points_earned';
  end if;

  update public.app_settings set loyalty_pickup_only = true where id = true;
end $$;

-- ...and switching it back on bites again, in the same transaction, so the
-- setting is read per call rather than cached.
do $$
declare o public.orders;
begin
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        '0e000000-0000-0000-0000-0000000ad001'::uuid);
  if o.loyalty_points_earned <> 0 then
    raise exception 'FAIL 5b: pickup_only back on, delivery still earned %', o.loyalty_points_earned;
  end if;

  raise notice 'case 5 ok -- the setting is live in both directions, in both functions';
end $$;

-- ============================================================================
-- 6. A comped order still earns nothing, on either channel
--    The comp rule and the channel rule must compose rather than fight.
-- ============================================================================
do $$
declare o public.orders;
begin
  insert into public.comp_members (profile_id, phone_e164, is_active, note)
  values ('0e000000-0000-0000-0000-000000000001'::uuid, '+966500000101', true,
          'loyalty channel test');

  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        null, null, null, 100);

  if not o.is_comped then
    raise exception 'FAIL 6: expected a comped order';
  end if;
  -- floor(0 * rate) = 0: a free order grants nothing, and the comp branch
  -- already refuses the redemption, so nothing is burnt either.
  if o.loyalty_points_earned <> 0 or o.loyalty_points_redeemed <> 0 then
    raise exception 'FAIL 6: comped PICKUP order earned %/redeemed %, expected 0/0',
      o.loyalty_points_earned, o.loyalty_points_redeemed;
  end if;

  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        '0e000000-0000-0000-0000-0000000ad001'::uuid, null, null, 100);
  if o.loyalty_points_earned <> 0 or o.loyalty_points_redeemed <> 0 then
    raise exception 'FAIL 6: comped DELIVERY order earned %/redeemed %, expected 0/0',
      o.loyalty_points_earned, o.loyalty_points_redeemed;
  end if;

  raise notice 'case 6 ok -- comp and channel compose, on both channels';
end $$;

do $$ begin
  raise notice 'LOYALTY PICKUP-ONLY OK (earn + redeem gated, preview matches actual, setting is live)';
end $$;

rollback;
