-- ============================================================================
-- Ordering a price tier: place_order, the checkout snapshot, and the ticket.
--
-- `product_variants` only earns its keep if the money and the POS price_id
-- follow the tier the customer actually chose. This suite pins that on every
-- path that writes an order line, and pins the refusals that stop a line being
-- priced from a tier nobody selected.
--
-- Seed fixtures (supabase/seed.sql): branch 001, product 001 "Spicy Double
-- Beef" at 32.00 carrying the REQUIRED heat-level group (Volcano at +2.00),
-- and product 004 "Cola" at 6.00 with no modifier groups.
-- ============================================================================
begin;

\set branch  '''b0000000-0000-0000-0000-000000000001'''
\set beef    '''a0000000-0000-0000-0000-000000000001'''
\set cola    '''a0000000-0000-0000-0000-000000000004'''
\set mild    '''80000000-0000-0000-0000-000000000001'''

do $$
declare v_cust uuid := '01000000-0000-0000-0000-000000000001';
begin
  insert into auth.users(id) values (v_cust) on conflict (id) do nothing;
  insert into public.profiles(id, full_name, role) values (v_cust,'Tier Customer','customer')
    on conflict (id) do update set role = excluded.role;
end $$;

-- Two tiers on the beef: Small at 32.00 (the product's own price) and Large at
-- 45.00, plus a retired tier that must never be orderable.
insert into public.product_variants (id, product_id, name_en, name_ar, price, is_active, sort_order, lazywait_price_id)
values
  ('c0000000-0000-0000-0000-000000000001', :beef, 'Small', 'صغير', 32.00, true,  1, 'LW_PRICE_SMALL'),
  ('c0000000-0000-0000-0000-000000000002', :beef, 'Large', 'كبير', 45.00, true,  2, 'LW_PRICE_LARGE'),
  ('c0000000-0000-0000-0000-000000000003', :beef, 'Retired', 'ملغي', 99.00, false, 3, 'LW_PRICE_DEAD');

-- Place a cash pickup order for one product/tier. Returns SQLSTATE, or null on
-- success; the created order id is left in pg_temp.last_order.
create table pg_temp.last_order (id uuid);

create or replace function pg_temp.order_tier(p_product uuid, p_variant uuid, p_modifier uuid default null)
returns text language plpgsql as $$
declare v_state text; v_prev text; v_item jsonb; v_o public.orders;
begin
  v_prev := coalesce(current_setting('request.jwt.claim.sub', true), '');
  perform set_config('request.jwt.claim.sub','01000000-0000-0000-0000-000000000001',true);
  v_item := jsonb_build_object('product_id', p_product, 'quantity', 1);
  if p_variant is not null then v_item := v_item || jsonb_build_object('variant_id', p_variant); end if;
  if p_modifier is not null then
    v_item := v_item || jsonb_build_object('modifier_ids', jsonb_build_array(p_modifier::text));
  end if;
  begin
    v_o := public.place_order(
      'b0000000-0000-0000-0000-000000000001'::uuid, 'pickup'::public.order_type,
      jsonb_build_array(v_item), null, null, null, 0, null, 'cash');
    delete from pg_temp.last_order;
    insert into pg_temp.last_order values (v_o.id);
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  perform set_config('request.jwt.claim.sub', v_prev, true);
  return v_state;
end $$;

select set_config('request.jwt.claim.sub','01000000-0000-0000-0000-000000000001',true);

do $$
declare
  v_state text;
  v_price numeric; v_total numeric; v_txt text; v_uuid uuid; v_n int;
begin
  -- ------------------------------------------------------------------ 1.
  -- The whole point: the line is priced from the TIER, not products.price.
  v_state := pg_temp.order_tier('a0000000-0000-0000-0000-000000000001',
                                'c0000000-0000-0000-0000-000000000002',
                                '80000000-0000-0000-0000-000000000001');
  if v_state is not null then raise exception 'ordering the Large tier failed: %', v_state; end if;

  select i.unit_price, i.variant_id, i.variant_name_en
    into v_price, v_uuid, v_txt
    from public.order_items i where i.order_id = (select id from pg_temp.last_order);
  if v_price <> 45.00 then
    raise exception 'Large tier should price the line at 45.00, got % (products.price is 32.00)', v_price;
  end if;
  if v_uuid <> 'c0000000-0000-0000-0000-000000000002' then
    raise exception 'order line did not record the tier it was priced from';
  end if;
  if v_txt <> 'Large' then raise exception 'tier name not snapshotted, got %', v_txt; end if;

  -- ...and the order total is recomputed from it (45.00, no delivery fee).
  select total into v_total from public.orders where id = (select id from pg_temp.last_order);
  if v_total <> 45.00 then raise exception 'order total should follow the tier, got %', v_total; end if;

  -- ------------------------------------------------------------------ 2.
  -- Modifiers still stack ON TOP of the tier price, not on products.price.
  v_state := pg_temp.order_tier('a0000000-0000-0000-0000-000000000001',
                                'c0000000-0000-0000-0000-000000000002',
                                '80000000-0000-0000-0000-000000000003');  -- Volcano +2.00
  if v_state is not null then raise exception 'Large + Volcano failed: %', v_state; end if;
  select unit_price into v_price from public.order_items
    where order_id = (select id from pg_temp.last_order);
  if v_price <> 47.00 then raise exception 'Large(45) + Volcano(2) should be 47.00, got %', v_price; end if;

  -- ------------------------------------------------------------------ 3.
  -- A product that HAS tiers, ordered without one, is REFUSED. Guessing would
  -- charge a price the customer never saw.
  v_state := pg_temp.order_tier('a0000000-0000-0000-0000-000000000001', null,
                                '80000000-0000-0000-0000-000000000001');
  if v_state is null then
    raise exception 'ordering a tiered product with no tier must be refused, it succeeded';
  end if;

  -- ------------------------------------------------------------------ 4.
  -- An inactive tier is not orderable, even by id.
  v_state := pg_temp.order_tier('a0000000-0000-0000-0000-000000000001',
                                'c0000000-0000-0000-0000-000000000003',
                                '80000000-0000-0000-0000-000000000001');
  if v_state is null then raise exception 'a retired tier must not be orderable'; end if;

  -- ------------------------------------------------------------------ 5.
  -- A tier belonging to a DIFFERENT product is refused — this is the one that
  -- would otherwise let a client pay 32.00 for a 45.00 line.
  insert into public.product_variants (id, product_id, name_en, name_ar, price, is_active)
  values ('c0000000-0000-0000-0000-000000000009',
          'a0000000-0000-0000-0000-000000000004', 'Cheap', 'رخيص', 1.00, true);
  v_state := pg_temp.order_tier('a0000000-0000-0000-0000-000000000001',
                                'c0000000-0000-0000-0000-000000000009',
                                '80000000-0000-0000-0000-000000000001');
  if v_state is null then
    raise exception 'a tier from another product must be refused, it succeeded';
  end if;
  delete from public.product_variants where id = 'c0000000-0000-0000-0000-000000000009';

  -- ------------------------------------------------------------------ 6.
  -- BACKWARDS COMPATIBILITY: a product with no tiers prices from
  -- products.price exactly as it did before variants existed.
  v_state := pg_temp.order_tier('a0000000-0000-0000-0000-000000000004', null, null);
  if v_state is not null then raise exception 'an untiered product must still be orderable: %', v_state; end if;
  select unit_price, variant_id into v_price, v_uuid from public.order_items
    where order_id = (select id from pg_temp.last_order);
  if v_price <> 6.00 then raise exception 'untiered Cola should price at 6.00, got %', v_price; end if;
  if v_uuid is not null then raise exception 'an untiered line must record no tier'; end if;

  -- ------------------------------------------------------------------ 7.
  -- The kitchen can READ the tier. A ticket that says "Spicy Double Beef" when
  -- the customer chose Large is a wrong order, not a cosmetic gap.
  perform set_config('test.is_staff', 'true', true);
  select count(*) into v_n
  from jsonb_array_elements(public.admin_list_orders_with_items(50)) o,
       jsonb_array_elements(o->'order_items') i
  where i->>'variant_name_en' = 'Large';
  if v_n < 1 then raise exception 'admin_list_orders_with_items does not project the tier'; end if;
  perform set_config('test.is_staff', '', true);

  raise notice 'place_order_variants_test: all assertions passed';
end $$;

-- ---------------------------------------------------------------------------
-- 8. The ONLINE path must agree with the cash path: the snapshot carries the
--    tier, and the row written after payment is priced from the snapshot.
-- ---------------------------------------------------------------------------
do $$
declare
  v_snap jsonb; v_order public.orders; v_price numeric; v_txt text;
begin
  v_snap := public.compute_order_snapshot(
    '01000000-0000-0000-0000-000000000001'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid,
    'pickup'::public.order_type,
    jsonb_build_array(jsonb_build_object(
      'product_id','a0000000-0000-0000-0000-000000000001',
      'variant_id','c0000000-0000-0000-0000-000000000002',
      'quantity',1,
      'modifier_ids', jsonb_build_array('80000000-0000-0000-0000-000000000001'))),
    null, null, 0);

  if (v_snap->'items'->0->>'unit_price')::numeric <> 45.00 then
    raise exception 'snapshot priced the line at %, expected the 45.00 tier',
      v_snap->'items'->0->>'unit_price';
  end if;
  if v_snap->'items'->0->>'variant_name_en' <> 'Large' then
    raise exception 'snapshot did not carry the tier name';
  end if;

  v_order := public.insert_order_from_snapshot(
    '01000000-0000-0000-0000-000000000001'::uuid, v_snap, 'online', 'paid', null);

  select unit_price, variant_name_en into v_price, v_txt
    from public.order_items where order_id = v_order.id;
  if v_price <> 45.00 then raise exception 'paid order line priced at %, expected 45.00', v_price; end if;
  if v_txt <> 'Large' then raise exception 'paid order line lost the tier name, got %', v_txt; end if;

  -- A tiered product sent with no tier must be refused on this path too.
  begin
    perform public.compute_order_snapshot(
      '01000000-0000-0000-0000-000000000001'::uuid,
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'pickup'::public.order_type,
      jsonb_build_array(jsonb_build_object(
        'product_id','a0000000-0000-0000-0000-000000000001', 'quantity',1,
        'modifier_ids', jsonb_build_array('80000000-0000-0000-0000-000000000001'))),
      null, null, 0);
    raise exception 'the snapshot path accepted a tiered product with no tier';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like '%accepted a tiered product%' then raise; end if;
  end;

  raise notice 'place_order_variants_test (online path): all assertions passed';
end $$;

rollback;
