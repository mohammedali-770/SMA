-- ============================================================================
-- Per-item loyalty exclusion, and the eligible earning base.
--
-- Covers 20260908120000_loyalty_item_exclusion.sql.
--
-- WHAT THIS FILE IS REALLY FOR. Two things, and neither is "does the flag work".
--
--   1. THE COMP. Before this migration a comped order earned nothing FOR FREE,
--      because points were floor(v_total * rate) and v_total is zeroed for a
--      comp. An eligible base is built from line prices, which a comp does not
--      touch, so the old arithmetic no longer protects it. Section 5 pins that
--      a free order still earns nothing, on both channels.
--
--   2. PREVIEW/ACTUAL PARITY, again. `preview_loyalty_points` is what the
--      checkout screen shows before the customer commits; `place_order` is what
--      happens. Section 6 asserts they agree for the same cart. This is the
--      third mirror the design deliberately avoided creating in the client, and
--      the assertion that keeps the two that DO exist honest.
--
-- Seed fixtures (supabase/seed.sql): branch 001 (delivery_fee 15,
-- min_delivery_order 40), product 001 "Spicy Double Beef" 32.00,
-- product 004 "Cola" 6.00. Prices are VAT-INCLUSIVE, so a line total is what
-- the customer pays for that line.
--
-- psql does not interpolate :variables inside dollar-quoted bodies, so ids are
-- repeated literally inside every do-block.
--
-- Runs against a throwaway chain-applied Postgres. Every case raises on
-- failure; a clean run prints the final notice and commits nothing.
-- ============================================================================
begin;

\set eater  '''0f000000-0000-0000-0000-000000000001'''
\set addr   '''0f000000-0000-0000-0000-0000000ad001'''
\set branch '''b0000000-0000-0000-0000-000000000001'''
\set beef   '''a0000000-0000-0000-0000-000000000001'''
\set cola   '''a0000000-0000-0000-0000-000000000004'''

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, email) values (:eater, 'exclusion-eater@x');
insert into public.profiles (id, role, full_name, phone_number, loyalty_points) values
  (:eater, 'customer', 'Exclusion Eater', '+966500000777', 500)
on conflict (id) do update set role = excluded.role,
  full_name = excluded.full_name, phone_number = excluded.phone_number,
  loyalty_points = excluded.loyalty_points;

update public.app_settings
   set loyalty_enabled = true,
       min_points_to_redeem = 0,        -- keep the arithmetic about the BASE
       points_per_riyal = 1,
       discount_per_point = 0.10,
       cash_payment_enabled = true,
       online_payment_enabled = false,
       default_payment_method = 'cash',
       loyalty_pickup_only = true
 where id = true;

-- Cola is the excluded item throughout. Beef keeps earning.
update public.products set earns_loyalty_points = false where id = :cola;

-- A zone and an address, so the delivery cases are about the base rather than
-- about geometry.
insert into public.branch_delivery_zones (branch_id, name, zone_geojson, zone_polygon, is_active)
values (:branch, 'test box',
  '{"type":"MultiPolygon","coordinates":[[[[46.6,24.6],[46.8,24.6],[46.8,24.8],[46.6,24.8],[46.6,24.6]]]]}'::jsonb,
  extensions.ST_GeomFromText(
    'MULTIPOLYGON(((46.6 24.6, 46.8 24.6, 46.8 24.8, 46.6 24.8, 46.6 24.6)))', 4326), true);
insert into public.addresses (id, customer_id, label, latitude, longitude, description)
values (:addr, :eater, 'Home', 24.7136, 46.6753, 'Second floor, blue door');

select set_config('test.auth_uid', :eater, true);
select set_config('test.is_admin', 'false', true);

-- ============================================================================
-- 1. The column exists, defaults TRUE, and the base is wired into BOTH functions
-- ============================================================================
do $$
declare v_default text; v_pb int; v_sb int; v_pe int; v_se int;
begin
  select column_default into v_default from information_schema.columns
   where table_schema = 'public' and table_name = 'products'
     and column_name = 'earns_loyalty_points';
  if v_default is null or v_default not like 'true%' then
    raise exception 'FAIL 1: earns_loyalty_points missing or not defaulting true (%)',
      coalesce(v_default, '<absent>');
  end if;

  -- Defaulting TRUE is the point: applying the migration excludes nothing.
  if exists (select 1 from public.products where earns_loyalty_points is not true
              and id <> 'a0000000-0000-0000-0000-000000000004') then
    raise exception 'FAIL 1: a seeded product was excluded by the migration itself';
  end if;

  select count(*) into v_pb from regexp_matches(
    (select prosrc from pg_proc where proname = 'place_order'), 'v_earn_base', 'g');
  select count(*) into v_sb from regexp_matches(
    (select prosrc from pg_proc where proname = 'compute_order_snapshot'), 'v_earn_base', 'g');
  select count(*) into v_pe from regexp_matches(
    (select prosrc from pg_proc where proname = 'place_order'), 'v_eligible', 'g');
  select count(*) into v_se from regexp_matches(
    (select prosrc from pg_proc where proname = 'compute_order_snapshot'), 'v_eligible', 'g');
  if v_pb <> v_sb or v_pe <> v_se or v_pb < 5 or v_pe < 5 then
    raise exception 'FAIL 1: base parity earn_base %/% eligible %/%', v_pb, v_sb, v_pe, v_se;
  end if;

  raise notice 'case 1 ok -- column present, defaults true, both functions carry the base';
end $$;

-- ============================================================================
-- 2. A mixed cart earns on the ELIGIBLE lines only
-- ============================================================================
do $$
declare o public.orders;
begin
  -- 32.00 beef (earns) + 6.00 cola (excluded) = 38.00 payable.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1},
          {"product_id":"a0000000-0000-0000-0000-000000000004","quantity":1}]'::jsonb);

  if o.total <> 38.00 then
    raise exception 'FAIL 2: total is %, expected 38.00 -- the price must not change', o.total;
  end if;
  if o.loyalty_points_earned <> 32 then
    raise exception 'FAIL 2: earned %, expected 32 (the beef only)', o.loyalty_points_earned;
  end if;
  -- And the ledger agrees with the order column.
  if not exists (select 1 from public.loyalty_transactions
                 where order_id = o.id and type = 'earn' and points = 32) then
    raise exception 'FAIL 2: no earn ledger row for 32 points';
  end if;

  raise notice 'case 2 ok -- the excluded line is charged for and earns nothing';
end $$;

-- ============================================================================
-- 3. EARN-SIDE ONLY: an all-excluded cart earns nothing but may still REDEEM
--    This is the owner's rule stated exactly: "ordering it will not give you
--    points" -- not "points cannot be spent on it".
-- ============================================================================
do $$
declare o public.orders; v_before int; v_after int;
begin
  select loyalty_points into v_before from public.profiles
   where id = '0f000000-0000-0000-0000-000000000001';

  -- 10 colas = 60.00, entirely excluded. Redeem 100 points => 10.00 off.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000004","quantity":10}]'::jsonb,
        null, null, null, 100);

  if o.loyalty_points_earned <> 0 then
    raise exception 'FAIL 3: an all-excluded cart earned %', o.loyalty_points_earned;
  end if;
  if o.loyalty_points_redeemed <> 100 then
    raise exception 'FAIL 3: redemption was refused (% redeemed) -- the rule is earn-side only',
      o.loyalty_points_redeemed;
  end if;
  if o.loyalty_discount_amount <> 10.00 then
    raise exception 'FAIL 3: discount is %, expected 10.00', o.loyalty_discount_amount;
  end if;
  if o.total <> 50.00 then
    raise exception 'FAIL 3: total is %, expected 50.00', o.total;
  end if;

  select loyalty_points into v_after from public.profiles
   where id = '0f000000-0000-0000-0000-000000000001';
  if v_after <> v_before - 100 then
    raise exception 'FAIL 3: balance went % -> %, expected -100 exactly', v_before, v_after;
  end if;

  raise notice 'case 3 ok -- excluded items are spendable-on, just not earnable-from';
end $$;

-- ============================================================================
-- 4. Order-level reductions are shared PRO-RATA
--    An excluded item must not absorb the whole coupon and shield the eligible
--    ones; an eligible item must not absorb it twice.
-- ============================================================================
do $$
declare o public.orders;
begin
  -- 2 beef (64.00, eligible) + 6 cola (36.00, excluded) = 100.00 subtotal.
  -- Eligible share = 64%. SEEDPCT15 takes 15% = 15.00, of which 9.60 is the
  -- eligible share, leaving a base of 54.40 => 54 points.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2},
          {"product_id":"a0000000-0000-0000-0000-000000000004","quantity":6}]'::jsonb,
        null, 'SEEDPCT15');

  if o.subtotal <> 100.00 then
    raise exception 'FAIL 4: subtotal is %, expected 100.00 (fixture drift)', o.subtotal;
  end if;
  if o.discount_amount <> 15.00 then
    raise exception 'FAIL 4: coupon gave %, expected 15.00', o.discount_amount;
  end if;
  if o.loyalty_points_earned <> 54 then
    raise exception 'FAIL 4: earned %, expected 54 (64.00 eligible less its 9.60 share)',
      o.loyalty_points_earned;
  end if;

  raise notice 'case 4 ok -- the coupon is split across the cart, not dumped on one side';
end $$;

-- ...and the same for a loyalty redemption, which reduces the base identically.
do $$
declare o public.orders;
begin
  -- Same cart, no coupon, redeem 100 points => 10.00 off. Eligible share 64%
  -- => 6.40, base 57.60 => 57 points.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2},
          {"product_id":"a0000000-0000-0000-0000-000000000004","quantity":6}]'::jsonb,
        null, null, null, 100);

  if o.loyalty_points_redeemed <> 100 then
    raise exception 'FAIL 4b: redeemed %, expected 100', o.loyalty_points_redeemed;
  end if;
  if o.loyalty_points_earned <> 57 then
    raise exception 'FAIL 4b: earned %, expected 57 (64.00 less its 6.40 share)',
      o.loyalty_points_earned;
  end if;

  raise notice 'case 4b ok -- a redemption reduces the base the same way a coupon does';
end $$;

-- ============================================================================
-- 5. THE COMP TRAP. A free order still earns nothing, on either channel.
--    Before this migration that held for free, because points came off a
--    zeroed v_total. It does not any more, and this is the case that proves the
--    replacement guard is real.
-- ============================================================================
do $$
declare o public.orders;
begin
  insert into public.comp_members (profile_id, phone_e164, is_active, note)
  values ('0f000000-0000-0000-0000-000000000001'::uuid, '+966500000777', true, 'exclusion test');

  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb);
  if not o.is_comped then raise exception 'FAIL 5: expected a comped order'; end if;
  if o.total <> 0 then raise exception 'FAIL 5: comped total is %', o.total; end if;
  if o.loyalty_points_earned <> 0 then
    raise exception 'FAIL 5: a COMPED PICKUP order earned % points on eligible lines',
      o.loyalty_points_earned;
  end if;

  -- Delivery too: 64.00 of eligible goods, comped, still zero.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        '0f000000-0000-0000-0000-0000000ad001'::uuid);
  if o.loyalty_points_earned <> 0 then
    raise exception 'FAIL 5: a COMPED DELIVERY order earned %', o.loyalty_points_earned;
  end if;

  delete from public.comp_members where profile_id = '0f000000-0000-0000-0000-000000000001';
  raise notice 'case 5 ok -- a free order earns nothing, and no longer does so by accident';
end $$;

-- ============================================================================
-- 6. PREVIEW AND ACTUAL AGREE -- and the preview leaks nothing
-- ============================================================================
do $$
declare prev jsonb; o public.orders; v_keys text;
begin
  prev := public.preview_loyalty_points(
            'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
            '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2},
              {"product_id":"a0000000-0000-0000-0000-000000000004","quantity":6}]'::jsonb,
            null, null, 100);
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2},
          {"product_id":"a0000000-0000-0000-0000-000000000004","quantity":6}]'::jsonb,
        null, null, null, 100);

  if (prev ->> 'loyalty_points_earned')::int <> o.loyalty_points_earned then
    raise exception 'FAIL 6: preview promised % earned, the order gave %',
      prev ->> 'loyalty_points_earned', o.loyalty_points_earned;
  end if;
  if (prev ->> 'loyalty_points_redeemed')::int <> o.loyalty_points_redeemed then
    raise exception 'FAIL 6: preview promised % redeemed, the order took %',
      prev ->> 'loyalty_points_redeemed', o.loyalty_points_redeemed;
  end if;
  if (prev ->> 'total')::numeric <> o.total then
    raise exception 'FAIL 6: preview total % <> order total %', prev ->> 'total', o.total;
  end if;
  -- Not a vacuous pass: this cart must actually be earning AND redeeming.
  if o.loyalty_points_earned = 0 or o.loyalty_points_redeemed = 0 then
    raise exception 'FAIL 6: the parity leg moved nothing, so it proves nothing';
  end if;

  -- THE SECURITY POINT. compute_order_snapshot returns the customer's name,
  -- phone and address snapshot; the wrapper must return four keys and no more.
  select string_agg(k, ',' order by k) into v_keys from jsonb_object_keys(prev) k;
  if v_keys <> 'loyalty_discount_amount,loyalty_points_earned,loyalty_points_redeemed,total' then
    raise exception 'FAIL 6: preview returned unexpected keys: %', v_keys;
  end if;

  raise notice 'case 6 ok -- preview matches the order, and carries no personal data';
end $$;

-- The snapshot it wraps must stay shut to the client, or the wrapper was pointless.
do $$
begin
  if has_function_privilege('authenticated',
       'public.compute_order_snapshot(uuid, uuid, public.order_type, jsonb, uuid, text, integer)',
       'execute') then
    raise exception 'FAIL 6b: compute_order_snapshot is reachable by authenticated';
  end if;
  if has_function_privilege('anon',
       'public.preview_loyalty_points(uuid, public.order_type, jsonb, uuid, text, integer)',
       'execute') then
    raise exception 'FAIL 6b: preview_loyalty_points is reachable by anon';
  end if;
  if not has_function_privilege('authenticated',
       'public.preview_loyalty_points(uuid, public.order_type, jsonb, uuid, text, integer)',
       'execute') then
    raise exception 'FAIL 6b: a signed-in customer cannot call the preview';
  end if;
  raise notice 'case 6b ok -- the PII boundary the wrapper exists for still holds';
end $$;

-- ============================================================================
-- 7. The DELIVERY FEE never earns
--    A line-based base excludes it structurally. Proven with pickup-only OFF,
--    which is the only configuration where the difference is observable.
-- ============================================================================
do $$
declare o public.orders;
begin
  update public.app_settings set loyalty_pickup_only = false where id = true;

  -- 2 beef = 64.00 eligible, + 15.00 delivery fee = 79.00 payable.
  -- Old rule: floor(79) = 79. New rule: the fee is not merchandise => 64.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        '0f000000-0000-0000-0000-0000000ad001'::uuid);

  if o.total <> 79.00 then
    raise exception 'FAIL 7: total is %, expected 79.00 -- the customer still pays the fee', o.total;
  end if;
  if o.delivery_fee <> 15.00 then
    raise exception 'FAIL 7: delivery_fee is %, expected 15.00', o.delivery_fee;
  end if;
  if o.loyalty_points_earned <> 64 then
    raise exception 'FAIL 7: earned %, expected 64 -- the 15.00 fee must not earn',
      o.loyalty_points_earned;
  end if;

  update public.app_settings set loyalty_pickup_only = true where id = true;
  raise notice 'case 7 ok -- the courier is charged for and earns nothing';
end $$;

-- ============================================================================
-- 8. A Lazywait re-import must not silently undo an administrator's choice
--    The importer updates products with an EXPLICIT column list that does not
--    name this column. That is true today by construction rather than by
--    intent, so it is pinned here.
-- ============================================================================
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where proname = 'import_lazywait_catalog';
  if v_src is null then
    raise exception 'FAIL 8: import_lazywait_catalog is missing (fixture drift)';
  end if;
  if v_src ~* 'earns_loyalty_points' then
    raise exception 'FAIL 8: the importer now writes earns_loyalty_points -- a menu '
                    'refresh would overwrite the administrator''s per-item choice';
  end if;
  -- And it really does write products, so the check above is not vacuous.
  if v_src !~* 'update public\.products set' then
    raise exception 'FAIL 8: the importer no longer updates products; re-check this guard';
  end if;

  raise notice 'case 8 ok -- a catalog re-import leaves the exclusion alone';
end $$;

do $$ begin
  raise notice 'LOYALTY ITEM EXCLUSION OK (eligible base, pro-rata, comp safe, preview scoped)';
end $$;

rollback;
