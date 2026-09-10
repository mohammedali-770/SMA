-- ============================================================================
-- Points-earning campaign multipliers.
--
-- Covers 20260910120000_loyalty_multipliers.sql.
--
-- WHAT THIS FILE IS REALLY FOR. Two properties, and the first matters more than
-- every campaign case put together:
--
--   1. NO CAMPAIGN MEANS NO CHANGE. This is the fourth rewrite of the two
--      pricing functions. If an order with no live multiplier earns even one
--      point differently from before, the rewrite broke something. Section 2
--      pins the exact figures steps 1-3 produce.
--
--   2. THE CLAMP STILL COMES FIRST. `least(v_earn_base, v_total)` exists to stop
--      the delivery fee and a comped order inflating the base -- but a 2x
--      campaign is SUPPOSED to exceed the order total. Multiply before the clamp
--      and the clamp silently eats the campaign. Section 4 is the case that
--      catches it, and nothing else does.
--
-- Everything else -- specificity, ties, windows, bounds -- is ordinary coverage.
--
-- Seed fixtures (supabase/seed.sql): branch 001, product 001 "Spicy Double Beef"
-- 32.00, product 004 "Cola" 6.00. Prices are VAT-inclusive.
--
-- Runs against a throwaway chain-applied Postgres. Every case raises on failure.
-- ============================================================================
begin;

\set eater  '''0b000000-0000-0000-0000-00000000c001'''
\set branch '''b0000000-0000-0000-0000-000000000001'''
\set beef   '''a0000000-0000-0000-0000-000000000001'''
\set cola   '''a0000000-0000-0000-0000-000000000004'''

insert into auth.users (id, email) values (:eater, 'mult-eater@x');
insert into public.profiles (id, role, full_name, phone_number, loyalty_points) values
  (:eater, 'customer', 'Mult Eater', '+966500000901', 500)
on conflict (id) do update set loyalty_points = excluded.loyalty_points,
  role = excluded.role, full_name = excluded.full_name, phone_number = excluded.phone_number;

update public.app_settings
   set loyalty_enabled = true, min_points_to_redeem = 0, points_per_riyal = 1,
       discount_per_point = 0.10, cash_payment_enabled = true,
       online_payment_enabled = false, default_payment_method = 'cash',
       loyalty_pickup_only = true
 where id = true;

select set_config('test.auth_uid', :eater, true);
select set_config('test.is_admin', 'false', true);

-- ============================================================================
-- 1. An empty table is neutral, and the resolver says so
-- ============================================================================
do $$
begin
  if (select count(*) from public.loyalty_multipliers) <> 0 then
    raise exception 'FAIL 1: the migration created rows';
  end if;
  if public.loyalty_multiplier_for(
       'a0000000-0000-0000-0000-000000000001', null,
       'b0000000-0000-0000-0000-000000000001', now()) <> 1 then
    raise exception 'FAIL 1: an empty table does not resolve to 1';
  end if;
  raise notice 'case 1 ok -- nothing is live until somebody creates a campaign';
end $$;

-- ============================================================================
-- 2. NO CAMPAIGN = THE PREVIOUS STEP'S ARITHMETIC, EXACTLY
--    These figures are lifted from loyalty_item_exclusion_test.sql. If this
--    section fails, the rewrite changed earning for every order in the system.
-- ============================================================================
update public.products set earns_loyalty_points = false where id = :cola;

do $$
declare o public.orders;
begin
  -- 32.00 eligible + 6.00 excluded = 38.00 payable, 32 points (step 2).
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1},
          {"product_id":"a0000000-0000-0000-0000-000000000004","quantity":1}]'::jsonb);
  if o.total <> 38.00 or o.loyalty_points_earned <> 32 then
    raise exception 'FAIL 2: no-campaign order gave total %/points %, expected 38.00/32',
      o.total, o.loyalty_points_earned;
  end if;

  -- And the pro-rata coupon case, also from step 2: 100.00 subtotal, 64%
  -- eligible, SEEDPCT15 takes 15.00 => base 54.40 => 54.
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2},
          {"product_id":"a0000000-0000-0000-0000-000000000004","quantity":6}]'::jsonb,
        null, 'SEEDPCT15');
  if o.loyalty_points_earned <> 54 then
    raise exception 'FAIL 2: pro-rata order earned %, expected 54 -- step 2 arithmetic moved',
      o.loyalty_points_earned;
  end if;

  raise notice 'case 2 ok -- with no campaign live, earning is unchanged from step 2';
end $$;

-- ============================================================================
-- 3. A house-wide x2 doubles the eligible lines, and ONLY those
-- ============================================================================
insert into public.loyalty_multipliers (name_en, name_ar, multiplier, is_active)
values ('Double points', 'نقاط مضاعفة', 2.00, true);

do $$
declare o public.orders;
begin
  -- Same cart as case 2: 32.00 eligible (x2 = 64) + 6.00 excluded (still 0).
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1},
          {"product_id":"a0000000-0000-0000-0000-000000000004","quantity":1}]'::jsonb);
  if o.total <> 38.00 then
    raise exception 'FAIL 3: a POINTS campaign changed the PRICE (total %)', o.total;
  end if;
  if o.loyalty_points_earned <> 64 then
    raise exception 'FAIL 3: earned % under a x2 campaign, expected 64', o.loyalty_points_earned;
  end if;

  raise notice 'case 3 ok -- x2 doubles earning, leaves the excluded line and the price alone';
end $$;

-- ============================================================================
-- 4. THE CLAMP CASE. A campaign must be able to earn MORE than the order total.
--    If the multiplier were applied before `least(v_earn_base, v_total)`, this
--    order would earn 38 instead of 64 and nothing else in this file would
--    notice.
-- ============================================================================
do $$
declare o public.orders; v_expected int;
begin
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":1},
          {"product_id":"a0000000-0000-0000-0000-000000000004","quantity":1}]'::jsonb);
  v_expected := 64;
  if o.loyalty_points_earned <> v_expected then
    raise exception 'FAIL 4: earned %, expected % -- points must be allowed to exceed the total',
      o.loyalty_points_earned, v_expected;
  end if;
  if o.loyalty_points_earned <= o.total then
    raise exception 'FAIL 4: this case only proves something when points (%) exceed the total (%)',
      o.loyalty_points_earned, o.total;
  end if;

  raise notice 'case 4 ok -- a x2 campaign out-earns the order total, as it must';
end $$;

-- ============================================================================
-- 5. SPECIFICITY: product beats category beats branch beats house-wide
-- ============================================================================
do $$
declare v_cat uuid; v_m numeric;
begin
  select category_id into v_cat from public.products
   where id = 'a0000000-0000-0000-0000-000000000001';

  -- House-wide 2.00 already exists. Add a category 3.00 and a product 4.00.
  insert into public.loyalty_multipliers (name_en, name_ar, multiplier, category_id)
  values ('Category boost', 'تعزيز الفئة', 3.00, v_cat);
  insert into public.loyalty_multipliers (name_en, name_ar, multiplier, product_id)
  values ('Product boost', 'تعزيز الصنف', 4.00, 'a0000000-0000-0000-0000-000000000001');

  v_m := public.loyalty_multiplier_for('a0000000-0000-0000-0000-000000000001', v_cat,
                                       'b0000000-0000-0000-0000-000000000001', now());
  if v_m <> 4.00 then
    raise exception 'FAIL 5: the product rule should win, got %', v_m;
  end if;

  -- A different product in the same category falls to the category rule...
  v_m := public.loyalty_multiplier_for('a0000000-0000-0000-0000-000000000002', v_cat,
                                       'b0000000-0000-0000-0000-000000000001', now());
  if v_m <> 3.00 then
    raise exception 'FAIL 5: the category rule should win for a sibling product, got %', v_m;
  end if;

  -- ...and something in no targeted category falls to the house-wide rule.
  v_m := public.loyalty_multiplier_for('a0000000-0000-0000-0000-000000000009',
                                       '99999999-9999-9999-9999-999999999999',
                                       'b0000000-0000-0000-0000-000000000001', now());
  if v_m <> 2.00 then
    raise exception 'FAIL 5: the house-wide rule should apply, got %', v_m;
  end if;

  delete from public.loyalty_multipliers where name_en in ('Category boost', 'Product boost');
  raise notice 'case 5 ok -- the most specific campaign wins, deterministically';
end $$;

-- ============================================================================
-- 6. WINDOWS and is_active: an expired or unscheduled campaign is inert
-- ============================================================================
do $$
declare v_m numeric;
begin
  update public.loyalty_multipliers set is_active = false where name_en = 'Double points';
  if public.loyalty_multiplier_for(null, null, null, now()) <> 1 then
    raise exception 'FAIL 6: a deactivated campaign still applies';
  end if;
  update public.loyalty_multipliers set is_active = true where name_en = 'Double points';

  -- Ended yesterday.
  update public.loyalty_multipliers
     set starts_at = now() - interval '10 days', ends_at = now() - interval '1 day'
   where name_en = 'Double points';
  if public.loyalty_multiplier_for(null, null, null, now()) <> 1 then
    raise exception 'FAIL 6: an ENDED campaign still applies';
  end if;

  -- Starts tomorrow.
  update public.loyalty_multipliers
     set starts_at = now() + interval '1 day', ends_at = now() + interval '10 days'
   where name_en = 'Double points';
  if public.loyalty_multiplier_for(null, null, null, now()) <> 1 then
    raise exception 'FAIL 6: a FUTURE campaign already applies';
  end if;

  -- ...and inside the window it does.
  update public.loyalty_multipliers
     set starts_at = now() - interval '1 day', ends_at = now() + interval '1 day'
   where name_en = 'Double points';
  v_m := public.loyalty_multiplier_for(null, null, null, now());
  if v_m <> 2.00 then
    raise exception 'FAIL 6: an in-window campaign resolved to %', v_m;
  end if;

  raise notice 'case 6 ok -- windows and the active flag both gate the campaign';
end $$;

-- ============================================================================
-- 7. Branch scoping
-- ============================================================================
do $$
declare v_other uuid; v_m numeric;
begin
  select id into v_other from public.branches
   where id <> 'b0000000-0000-0000-0000-000000000001' limit 1;
  if v_other is null then
    raise notice 'case 7 skipped -- the seed has only one branch';
    return;
  end if;

  update public.loyalty_multipliers
     set branch_id = 'b0000000-0000-0000-0000-000000000001'
   where name_en = 'Double points';

  v_m := public.loyalty_multiplier_for(null, null, 'b0000000-0000-0000-0000-000000000001', now());
  if v_m <> 2.00 then raise exception 'FAIL 7: the scoped branch did not get it (%)', v_m; end if;
  v_m := public.loyalty_multiplier_for(null, null, v_other, now());
  if v_m <> 1 then raise exception 'FAIL 7: another branch got a branch-scoped campaign (%)', v_m; end if;

  update public.loyalty_multipliers set branch_id = null where name_en = 'Double points';
  raise notice 'case 7 ok -- a branch-scoped campaign stays at its branch';
end $$;

-- ============================================================================
-- 8. It composes with steps 1-3 rather than overriding them
-- ============================================================================
do $$
declare o public.orders;
begin
  -- DELIVERY still earns nothing, campaign or not: the channel gate runs first.
  insert into public.branch_delivery_zones (branch_id, name, zone_geojson, zone_polygon, is_active)
  values ('b0000000-0000-0000-0000-000000000001', 'box',
    '{"type":"MultiPolygon","coordinates":[[[[46.6,24.6],[46.8,24.6],[46.8,24.8],[46.6,24.8],[46.6,24.6]]]]}'::jsonb,
    extensions.ST_GeomFromText(
      'MULTIPOLYGON(((46.6 24.6, 46.8 24.6, 46.8 24.8, 46.6 24.8, 46.6 24.6)))', 4326), true);
  insert into public.addresses (id, customer_id, label, latitude, longitude, description)
  values ('0b000000-0000-0000-0000-0000000ad001', '0b000000-0000-0000-0000-00000000c001',
          'Home', 24.7136, 46.6753, 'Second floor, blue door');

  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'delivery',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
        '0b000000-0000-0000-0000-0000000ad001'::uuid);
  if o.loyalty_points_earned <> 0 then
    raise exception 'FAIL 8: a x2 campaign earned % on a DELIVERY order', o.loyalty_points_earned;
  end if;

  -- A COMPED order still earns nothing. Doubling zero is the easy half; the
  -- point is that the campaign is applied to a base the comp already zeroed.
  insert into public.comp_members (profile_id, phone_e164, is_active, note)
  values ('0b000000-0000-0000-0000-00000000c001'::uuid, '+966500000901', true, 'multiplier test');
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb);
  if not o.is_comped then raise exception 'FAIL 8: expected a comped order'; end if;
  if o.loyalty_points_earned <> 0 then
    raise exception 'FAIL 8: a COMPED order earned % under a campaign', o.loyalty_points_earned;
  end if;
  delete from public.comp_members where profile_id = '0b000000-0000-0000-0000-00000000c001';

  raise notice 'case 8 ok -- the channel gate and the comp both still win over a campaign';
end $$;

-- ============================================================================
-- 9. PREVIEW AND ACTUAL AGREE under a campaign
--    The checkout figure comes from preview_loyalty_points, so a campaign the
--    snapshot did not see would be promised and not granted.
-- ============================================================================
do $$
declare prev jsonb; o public.orders;
begin
  prev := public.preview_loyalty_points(
            'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
            '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb);
  o := public.place_order(
        'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup',
        '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb);

  if (prev ->> 'loyalty_points_earned')::int <> o.loyalty_points_earned then
    raise exception 'FAIL 9: preview promised %, the order gave %',
      prev ->> 'loyalty_points_earned', o.loyalty_points_earned;
  end if;
  if o.loyalty_points_earned <> 128 then
    raise exception 'FAIL 9: 64.00 of goods at x2 should earn 128, got %', o.loyalty_points_earned;
  end if;

  raise notice 'case 9 ok -- the checkout figure follows the campaign, with no client change';
end $$;

-- ============================================================================
-- 10. The bounds that stop a typo becoming an expensive weekend
-- ============================================================================
do $$
declare v_rejected boolean;
begin
  begin
    v_rejected := false;
    insert into public.loyalty_multipliers (name_en, name_ar, multiplier)
    values ('Typo', 'خطأ', 20.00);
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'FAIL 10: a 20x multiplier was accepted'; end if;

  -- Below 1 would be a SECOND way to reduce earning; step 2 already owns that.
  begin
    v_rejected := false;
    insert into public.loyalty_multipliers (name_en, name_ar, multiplier)
    values ('Halve', 'نصف', 0.50);
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'FAIL 10: a reducing multiplier was accepted'; end if;

  -- A row targets a product OR a category, never both.
  begin
    v_rejected := false;
    insert into public.loyalty_multipliers (name_en, name_ar, multiplier, product_id, category_id)
    values ('Both', 'كلاهما', 2.00,
            'a0000000-0000-0000-0000-000000000001',
            (select category_id from public.products where id = 'a0000000-0000-0000-0000-000000000001'));
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'FAIL 10: a row scoped to both a product and a category'; end if;

  -- A window must be ordered.
  begin
    v_rejected := false;
    insert into public.loyalty_multipliers (name_en, name_ar, multiplier, starts_at, ends_at)
    values ('Backwards', 'معكوس', 2.00, now(), now() - interval '1 day');
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'FAIL 10: a backwards window was accepted'; end if;

  raise notice 'case 10 ok -- the bounds refuse the mistakes that cost money';
end $$;

-- ============================================================================
-- 11. Customers cannot read the campaign table
-- ============================================================================
set local role authenticated;
do $$
declare v_n integer;
begin
  -- RLS: the select policy requires is_staff(), and this session is a customer.
  select count(*) into v_n from public.loyalty_multipliers;
  if v_n <> 0 then
    raise exception 'FAIL 11: a customer can read % campaign row(s)', v_n;
  end if;
  raise notice 'case 11 ok -- customers see the result, never the campaign list';
end $$;

-- ...and the same information must not be reachable through the RESOLVER, which
-- is the door review found open on #338. `loyalty_multiplier_for` takes `p_at`,
-- so a grant to `authenticated` would let a customer ask what the multiplier on
-- a given product will be NEXT MONTH and enumerate targeted, not-yet-started
-- campaigns a probe at a time -- handing back exactly what the select policy
-- above withholds. A protection one object provides and another undoes is not a
-- protection.
do $$
declare v_denied boolean := false; v_m numeric;
begin
  begin
    select public.loyalty_multiplier_for(null, null, null, now()) into v_m;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL 11b: a customer executed loyalty_multiplier_for directly (got %)', v_m;
  end if;
  raise notice 'case 11b ok -- the resolver is not callable by a customer';
end $$;
reset role;

do $$ begin
  raise notice 'LOYALTY MULTIPLIERS OK (neutral when empty, clamp-safe, specific, composed)';
end $$;

rollback;
