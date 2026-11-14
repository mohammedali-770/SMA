-- ============================================================================
-- Checkout preview parity: the SERVER's half.
--
-- WHY THIS FILE EXISTS. The checkout summary in the customer app is worked out
-- on the phone, by `computePreviewTotals`
-- (apps/mobile/src/features/checkout/previewTotals.ts). What the customer is
-- actually charged is worked out here: by `compute_order_snapshot` for a card
-- payment and by `place_order` for cash. When the two disagree, the app shows
-- one total and charges another. Gap PG-31 (2026-11-14) is that: with points
-- on, a SAR 8.00 pickup order read 0.00 in the app, while the server used no
-- points at all and charged 8.00.
--
-- WHAT IT DOES. It runs the REAL functions over a fixed table of carts, then:
--   1. asserts that the card path (`compute_order_snapshot`) and the cash path
--      (`place_order`) agree on every amount, cart by cart;
--   2. reduces every input and answer to one md5 digest and compares it with
--      the digest set below.
--
-- The app's half is `previewParity.test.ts`, beside `previewTotals.ts`. It
-- feeds the same carts to `computePreviewTotals` and compares the answers with
-- `previewParity.fixture.json`, which `scripts/checkout-preview-parity.sh`
-- writes from this file. So a server change that moves any of these totals
-- fails HERE until the fixture is regenerated, and the regenerated fixture then
-- fails the app test until the preview matches the server again.
--
-- Regenerate (rewrites the fixture AND the digest line below):
--   bash scripts/checkout-preview-parity.sh
--
-- Seed fixtures used (supabase/seed.sql): branch b0000000-…-0001 (delivery fee
-- 15.00, delivery minimum 40.00) and coupon SEEDPCT15 (15%, no minimum, no cap:
-- the shape of the one live coupon on 2026-11-14). Everything else is created
-- below and rolled back. No phone number is used anywhere.
--
-- psql meta-commands: `\if :{?parity_emit}` switches between CHECK mode (the
-- default, and what CI runs) and EMIT mode (`psql -v parity_emit=1`, used only
-- by the regeneration script). Neither writes anything that survives: the file
-- ends in ROLLBACK.
-- ============================================================================
\set ON_ERROR_STOP on
\set parity_expected_digest '096d83735e2ff59d2a1fe9820dca8029'

begin;

-- ---- Fixtures --------------------------------------------------------------
-- Two customers: an ordinary one, and one who is comped.
insert into auth.users (id, email) values
  ('0f000000-0000-0000-0000-000000000001', 'parity-eater@x'),
  ('0f000000-0000-0000-0000-000000000002', 'parity-comped@x');

insert into public.profiles (id, role, full_name, loyalty_points) values
  ('0f000000-0000-0000-0000-000000000001', 'customer', 'Parity Eater', 0),
  ('0f000000-0000-0000-0000-000000000002', 'customer', 'Parity Comped', 0)
on conflict (id) do update set role = excluded.role,
  full_name = excluded.full_name, loyalty_points = excluded.loyalty_points;

insert into public.comp_members (profile_id, is_active)
values ('0f000000-0000-0000-0000-000000000002', true);

-- Products priced to put totals exactly where the points rules have edges:
-- under, at and just over SAR 10.00 (100 points at 0.10), and the prices that
-- leave a remainder of 0.01 to 0.99.
insert into public.categories (id, name_en, name_ar, sort_order)
values ('c0f00000-0000-0000-0000-000000000001', 'Parity', 'Parity', 99);

create temp table parity_product (
  key   text primary key,
  id    uuid not null unique,
  price numeric(10,2) not null
) on commit drop;

insert into parity_product (key, id, price) values
  ('p030',  'a0f00000-0000-0000-0000-000000000030', 0.30),
  ('p175',  'a0f00000-0000-0000-0000-000000000175', 1.75),
  ('p333',  'a0f00000-0000-0000-0000-000000000333', 3.33),
  ('p415',  'a0f00000-0000-0000-0000-000000000415', 4.15),
  ('p800',  'a0f00000-0000-0000-0000-000000000800', 8.00),
  ('p995',  'a0f00000-0000-0000-0000-000000000995', 9.95),
  ('p1000', 'a0f00000-0000-0000-0000-000000001000', 10.00),
  ('p1005', 'a0f00000-0000-0000-0000-000000001005', 10.05),
  ('p1050', 'a0f00000-0000-0000-0000-000000001050', 10.50),
  ('p1100', 'a0f00000-0000-0000-0000-000000001100', 11.00),
  ('p1295', 'a0f00000-0000-0000-0000-000000001295', 12.95),
  ('p2500', 'a0f00000-0000-0000-0000-000000002500', 25.00),
  ('p3200', 'a0f00000-0000-0000-0000-000000003200', 32.00),
  ('p4000', 'a0f00000-0000-0000-0000-000000004000', 40.00);

insert into public.products (id, category_id, name_en, name_ar, price, is_active, sort_order)
select id, 'c0f00000-0000-0000-0000-000000000001', 'Parity ' || key, 'Parity ' || key, price, true, 99
  from parity_product;

-- A delivery zone around the seeded Riyadh branch and an address inside it, so
-- the delivery carts are about the points rules rather than about geometry.
insert into public.branch_delivery_zones (branch_id, name, zone_geojson, zone_polygon, is_active)
values (
  'b0000000-0000-0000-0000-000000000001', 'parity box',
  '{"type":"MultiPolygon","coordinates":[[[[46.6,24.6],[46.8,24.6],[46.8,24.8],[46.6,24.8],[46.6,24.6]]]]}'::jsonb,
  extensions.ST_GeomFromText(
    'MULTIPOLYGON(((46.6 24.6, 46.8 24.6, 46.8 24.8, 46.6 24.8, 46.6 24.6)))', 4326),
  true);

insert into public.addresses (id, customer_id, label, latitude, longitude, description)
values ('0f000000-0000-0000-0000-0000000ad001', '0f000000-0000-0000-0000-000000000001',
        'Home', 24.7136, 46.6753, 'Second floor, blue door');

-- ---- The carts ---------------------------------------------------------------
-- `requested` is what the app sends as p_loyalty_points: the WHOLE balance
-- with the points switch on, 0 with it off. The app has no way to ask for part
-- of a balance (LoyaltyToggle is on or off), so every "on" row asks for exactly
-- `balance`.
--
-- Settings default to the live values read 2026-11-14 (min_points_to_redeem
-- 100, discount_per_point 0.10, loyalty_pickup_only true); a row that changes
-- one says why in its name.
create temp table parity_case (
  n           int primary key,
  name        text not null,
  customer    text not null default 'eater' check (customer in ('eater', 'comped')),
  order_type  public.order_type not null default 'pickup',
  lines       jsonb not null,
  coupon      text,
  requested   int not null,
  balance     int not null,
  min_points  int not null default 100,
  per_point   numeric(10,4) not null default 0.10,
  pickup_only boolean not null default true
) on commit drop;

insert into parity_case (n, name, customer, order_type, lines, coupon, requested, balance, min_points, per_point, pickup_only) values
  ( 1, 'points off, SAR 8.00 pickup',
       'eater',  'pickup',   '[["p800",1]]',            null,        0,   150, 100, 0.10,   true),
  ( 2, 'points on, SAR 8.00 pickup: 80 points fit, under the 100 minimum, so none are used (PG-31)',
       'eater',  'pickup',   '[["p800",1]]',            null,      150,   150, 100, 0.10,   true),
  ( 3, 'points on, SAR 9.95: 99 points fit, none used',
       'eater',  'pickup',   '[["p995",1]]',            null,      150,   150, 100, 0.10,   true),
  ( 4, 'points on, SAR 10.00: exactly 100 points fit, nothing left to pay',
       'eater',  'pickup',   '[["p1000",1]]',           null,      150,   150, 100, 0.10,   true),
  ( 5, 'points on, SAR 10.05: 100 points used, 0.05 left',
       'eater',  'pickup',   '[["p1005",1]]',           null,      150,   150, 100, 0.10,   true),
  ( 6, 'points on, SAR 10.50: 105 points used, nothing left',
       'eater',  'pickup',   '[["p1050",1]]',           null,      150,   150, 100, 0.10,   true),
  ( 7, 'points on, SAR 10.50, balance exactly 100: 100 used, 0.50 left',
       'eater',  'pickup',   '[["p1050",1]]',           null,      100,   100, 100, 0.10,   true),
  ( 8, 'points on, balance 99, under the minimum: none used',
       'eater',  'pickup',   '[["p1050",1]]',           null,       99,    99, 100, 0.10,   true),
  ( 9, 'points on, SAR 12.95 with 500 points: 129 used, 0.05 left',
       'eater',  'pickup',   '[["p1295",1]]',           null,      500,   500, 100, 0.10,   true),
  (10, 'points on, two lines (2 x 4.15 + 1.75 = 10.05): 100 used, 0.05 left',
       'eater',  'pickup',   '[["p415",2],["p175",1]]', null,      150,   150, 100, 0.10,   true),
  (11, '15% coupon, points off: 25.00 less 3.75 is 21.25',
       'eater',  'pickup',   '[["p2500",1]]',           'SEEDPCT15',  0,  300, 100, 0.10,   true),
  (12, '15% coupon, points on: 212 whole points fit 21.25, 0.05 left (the PG-05 remainder)',
       'eater',  'pickup',   '[["p2500",1]]',           'SEEDPCT15', 300, 300, 100, 0.10,   true),
  (13, '15% coupon takes SAR 11.00 to 9.35: 93 points fit, none used',
       'eater',  'pickup',   '[["p1100",1]]',           'SEEDPCT15', 150, 150, 100, 0.10,   true),
  (14, 'points on, SAR 64.00 with 500 points: all 500 used, 14.00 left',
       'eater',  'pickup',   '[["p3200",2]]',           null,      500,   500, 100, 0.10,   true),
  (15, 'delivery while points are pickup only: no points',
       'eater',  'delivery', '[["p4000",1]]',           null,      500,   500, 100, 0.10,   true),
  (16, 'delivery with pickup-only off: the points also cover the 15.00 delivery fee',
       'eater',  'delivery', '[["p4000",1]]',           null,      600,   600, 100, 0.10,   false),
  (17, 'delivery with pickup-only off, 300 points: 25.00 left',
       'eater',  'delivery', '[["p4000",1]]',           null,      300,   300, 100, 0.10,   false),
  (18, 'comped customer: the coupon and the points are ignored, everything is comped',
       'comped', 'pickup',   '[["p2500",1]]',           'SEEDPCT15', 300, 300, 100, 0.10,   true),
  (19, 'minimum 0, SAR 0.30: exactly 3 points (0.30 / 0.10 is 2.9999... in binary floating point)',
       'eater',  'pickup',   '[["p030",1]]',            null,      150,   150,   0, 0.10,   true),
  (20, 'minimum 0, SAR 3.33: 33 points, 0.03 left',
       'eater',  'pickup',   '[["p333",1]]',            null,      150,   150,   0, 0.10,   true),
  (21, 'point value 0.0333, minimum 0, SAR 10.00 with 1000 points: 300 used, worth 9.99, 0.01 left',
       'eater',  'pickup',   '[["p1000",1]]',           null,     1000,  1000,   0, 0.0333, true),
  (22, 'point value 0.0333, minimum 0, 15 points: 0.4995 rounds to 0.50',
       'eater',  'pickup',   '[["p1000",1]]',           null,       15,    15,   0, 0.0333, true),
  (23, 'point value 0.05: the minimum is worth 5.00, so SAR 8.00 takes all 150 points, 0.50 left',
       'eater',  'pickup',   '[["p800",1]]',            null,      150,   150, 100, 0.05,   true);

-- ---- Run every cart through both server paths -------------------------------
create temp table parity_result (
  n                       int primary key,
  subtotal                numeric not null,
  delivery_fee            numeric not null,
  coupon_discount         numeric,          -- validate_coupon, as the app calls it
  discount_amount         numeric not null,
  loyalty_points_redeemed int     not null,
  loyalty_discount_amount numeric not null,
  total                   numeric not null,
  comp_discount_amount    numeric not null,
  is_comped               boolean not null
) on commit drop;

do $$
declare
  c         parity_case;
  v_cust    uuid;
  v_items   jsonb;
  v_snap    jsonb;
  v_order   public.orders;
  v_coupon  numeric;
  v_addr    uuid;
begin
  for c in select * from parity_case order by n loop
    v_cust := case c.customer
                when 'comped' then '0f000000-0000-0000-0000-000000000002'::uuid
                else '0f000000-0000-0000-0000-000000000001'::uuid end;
    v_addr := case when c.order_type = 'delivery'
                then '0f000000-0000-0000-0000-0000000ad001'::uuid end;

    select jsonb_agg(jsonb_build_object('product_id', pp.id, 'quantity', (l.value ->> 1)::int)
                     order by l.ordinality)
      into v_items
      from jsonb_array_elements(c.lines) with ordinality as l(value, ordinality)
      join parity_product pp on pp.key = l.value ->> 0;
    if v_items is null or jsonb_array_length(v_items) <> jsonb_array_length(c.lines) then
      raise exception 'case %: a line names a product that is not in parity_product', c.n;
    end if;

    -- Cash on and online off, so place_order settles without a payment attempt.
    update public.app_settings
       set loyalty_enabled        = true,
           points_per_riyal       = 1,
           min_points_to_redeem   = c.min_points,
           discount_per_point     = c.per_point,
           loyalty_pickup_only    = c.pickup_only,
           cash_payment_enabled   = true,
           online_payment_enabled = false,
           default_payment_method = 'cash'
     where id = true;
    update public.profiles set loyalty_points = c.balance where id = v_cust;

    -- The CARD path: what begin_checkout_session prices the session with.
    v_snap := public.compute_order_snapshot(
      v_cust, 'b0000000-0000-0000-0000-000000000001'::uuid, c.order_type,
      v_items, v_addr, c.coupon, c.requested);

    -- What the app passes to the preview as `couponDiscount`: validate_coupon
    -- called with the cart subtotal (services/api.ts, coupons.validate).
    v_coupon := null;
    if c.coupon is not null then
      select vc.discount_amount into v_coupon
        from public.validate_coupon(c.coupon, (v_snap ->> 'subtotal')::numeric) vc;
    end if;

    -- The CASH path: place_order as the customer. Its balance is reset first,
    -- because the call above did not move it and this one is measured from it.
    update public.profiles set loyalty_points = c.balance where id = v_cust;
    perform set_config('test.auth_uid', v_cust::text, true);
    perform set_config('test.is_admin', 'false', true);
    v_order := public.place_order(
      'b0000000-0000-0000-0000-000000000001'::uuid, c.order_type,
      v_items, v_addr, c.coupon, null, c.requested, null, 'cash');
    perform set_config('test.auth_uid', '', true);

    if v_order.subtotal                is distinct from (v_snap ->> 'subtotal')::numeric
       or v_order.delivery_fee         is distinct from (v_snap ->> 'delivery_fee')::numeric
       or v_order.discount_amount      is distinct from (v_snap ->> 'discount_amount')::numeric
       or v_order.loyalty_points_redeemed is distinct from (v_snap ->> 'loyalty_points_redeemed')::int
       or v_order.loyalty_discount_amount is distinct from (v_snap ->> 'loyalty_discount_amount')::numeric
       or v_order.total                is distinct from (v_snap ->> 'total')::numeric
       or v_order.comp_discount_amount is distinct from (v_snap ->> 'comp_discount_amount')::numeric then
      raise exception 'FAIL case % (%): the card and cash paths disagree. snapshot % / order subtotal % fee % discount % points % loyalty % total % comp %',
        c.n, c.name, v_snap - 'items' - 'address_snapshot',
        v_order.subtotal, v_order.delivery_fee, v_order.discount_amount,
        v_order.loyalty_points_redeemed, v_order.loyalty_discount_amount,
        v_order.total, v_order.comp_discount_amount;
    end if;

    insert into parity_result values (
      c.n,
      (v_snap ->> 'subtotal')::numeric,
      (v_snap ->> 'delivery_fee')::numeric,
      v_coupon,
      (v_snap ->> 'discount_amount')::numeric,
      (v_snap ->> 'loyalty_points_redeemed')::int,
      (v_snap ->> 'loyalty_discount_amount')::numeric,
      (v_snap ->> 'total')::numeric,
      (v_snap ->> 'comp_discount_amount')::numeric,
      (v_snap ->> 'is_comped')::boolean);
  end loop;
end $$;

-- ---- Sanity: the carts that state the PG-31 and PG-05 shapes really do ------
-- If one of these fails, the case table no longer tests what its name says.
do $$
declare r parity_result;
begin
  select * into r from parity_result where n = 2;
  if r.loyalty_points_redeemed <> 0 or r.total <> 8.00 then
    raise exception 'FAIL: case 2 (PG-31) used % points and totals %, expected 0 and 8.00',
      r.loyalty_points_redeemed, r.total;
  end if;
  select * into r from parity_result where n = 12;
  if r.loyalty_points_redeemed <> 212 or r.total <> 0.05 then
    raise exception 'FAIL: case 12 (PG-05) used % points and totals %, expected 212 and 0.05',
      r.loyalty_points_redeemed, r.total;
  end if;
  raise notice 'parity: % carts priced, card and cash paths agree on every one',
    (select count(*) from parity_result);
end $$;

-- ---- One digest over every input and every answer -----------------------------
-- Numbers are compared as numeric text, so 10.00 and 10.0 would differ: both
-- modes run this same statement on the same functions, so they always agree
-- with each other, and a change in how the server rounds is exactly what this
-- should notice.
select md5(string_agg(concat_ws('|',
         c.n, c.customer, c.order_type, c.lines::text, coalesce(c.coupon, '-'),
         c.requested, c.balance, c.min_points, c.per_point, c.pickup_only,
         r.subtotal, r.delivery_fee, coalesce(r.coupon_discount::text, '-'),
         r.discount_amount, r.loyalty_points_redeemed, r.loyalty_discount_amount,
         r.total, r.comp_discount_amount, r.is_comped),
       E'\n' order by c.n)) as parity_digest
  from parity_case c join parity_result r using (n)
\gset

\if :{?parity_emit}
-- EMIT mode: one JSON document on stdout, for scripts/checkout-preview-parity.sh.
select json_build_object(
  'digest', :'parity_digest',
  'functions', json_build_object(
    'compute_order_snapshot', (select md5(pg_get_functiondef(p.oid)) from pg_proc p
                                 join pg_namespace s on s.oid = p.pronamespace
                                where s.nspname = 'public' and p.proname = 'compute_order_snapshot'),
    'place_order',            (select md5(pg_get_functiondef(p.oid)) from pg_proc p
                                 join pg_namespace s on s.oid = p.pronamespace
                                where s.nspname = 'public' and p.proname = 'place_order')),
  'branch', (select json_build_object('deliveryFee', b.delivery_fee, 'minDeliveryOrder', b.min_delivery_order)
               from public.branches b where b.id = 'b0000000-0000-0000-0000-000000000001'),
  'cases', (select json_agg(json_build_object(
      'n', c.n,
      'name', c.name,
      'orderType', c.order_type,
      'comped', c.customer = 'comped',
      'lines', (select json_agg(json_build_object(
                         'product', l.value ->> 0,
                         'unitPrice', pp.price,
                         'quantity', (l.value ->> 1)::int) order by l.ordinality)
                  from jsonb_array_elements(c.lines) with ordinality as l(value, ordinality)
                  join parity_product pp on pp.key = l.value ->> 0),
      'coupon', c.coupon,
      'requestedPoints', c.requested,
      'balance', c.balance,
      'settings', json_build_object(
        'minPointsToRedeem', c.min_points,
        'discountPerPoint', c.per_point,
        'pickupOnly', c.pickup_only),
      'server', json_build_object(
        'subtotal', r.subtotal,
        'deliveryFee', r.delivery_fee,
        'couponDiscount', r.coupon_discount,
        'discountAmount', r.discount_amount,
        'loyaltyPointsRedeemed', r.loyalty_points_redeemed,
        'loyaltyDiscountAmount', r.loyalty_discount_amount,
        'total', r.total,
        'compDiscountAmount', r.comp_discount_amount,
        'isComped', r.is_comped)
    ) order by c.n)
    from parity_case c join parity_result r using (n))
);
\else
-- CHECK mode (CI): the answers must be the ones the fixture was generated from.
select set_config('parity.expected', :'parity_expected_digest', true),
       set_config('parity.actual', :'parity_digest', true) \gset parity_cfg_
do $$
begin
  if current_setting('parity.actual') is distinct from current_setting('parity.expected') then
    raise exception 'FAIL: the server''s answers for the checkout parity carts changed (digest % , fixture %). Regenerate with `bash scripts/checkout-preview-parity.sh`, then make computePreviewTotals match: apps/mobile/src/features/checkout/previewParity.test.ts will say where it does not.',
      current_setting('parity.actual'), current_setting('parity.expected');
  end if;
  raise notice 'parity: the server still gives the answers the fixture records';
end $$;
\endif

rollback;
