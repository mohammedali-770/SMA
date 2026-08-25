-- ============================================================================
-- Lazywait catalog import -> product_variants test.
--
-- Runs against a throwaway Postgres with all migrations applied. RAISES on any
-- failed assertion (script aborts non-zero).
--
-- Every fixture below is a REAL record shape taken from the Production catalog
-- cache on 2026-08-24, not an invented one. That matters: the bug this guards
-- against was invisible precisely because the invented fixtures used
-- `price_with_vat`, a key the live API does not send on a spreadsheet-sourced
-- item.
--
-- Covers:
--   * a multi-price item becomes one product + one variant per price;
--   * the money comes from `price_excl_vat` and is grossed up with
--     app_settings.vat_percentage (NOT a hardcoded 1.15);
--   * an explicitly supplied price_with_vat wins over grossing up;
--   * products.price is the CHEAPEST orderable tier ("from" price);
--   * show_online = false hides a tier, an item and (inherited) a category;
--   * an item whose category the pull did not return lands inactive;
--   * details{en,ar} become the product description;
--   * re-running the import is idempotent (no duplicate variants).
-- ============================================================================
begin;
set local session_replication_role = replica;  -- skip FK/triggers for fixtures

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_res   jsonb;
  v_n     int;
  v_price numeric;
  v_txt   text;
  v_bool  boolean;
  v_prod  uuid;
begin
  insert into auth.users(id, email) values (v_admin, 'a@x');
  insert into public.profiles(id, role) values (v_admin, 'admin');
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);

  -- VAT deliberately left at the app default so the arithmetic below is the
  -- product of app_settings, not of a literal in the migration.
  insert into public.app_settings(id, vat_percentage) values (true, 15)
    on conflict (id) do update set vat_percentage = 15;

  -- ---- Catalog cache fixtures (normalized shape the parser writes) --------

  -- Two visible categories and one Lazywait marks POS-only.
  insert into public.lazywait_catalog_items
    (entity_type, lazywait_id, name_en, name_ar, show_online, active, raw)
  values
    ('category', 'CAT_SIDES', 'Side dishes', 'أطباق جانبية', true,  true, '{"active":true,"show_online":true}'),
    ('category', 'CAT_MEALS', 'Meals',       'وجبات',        true,  true, '{"active":true,"show_online":true}'),
    ('category', 'CAT_OFFERS','Offers',      'العروض',       false, true, '{"active":true,"show_online":false}');

  -- Chicken Wings: two prices, `price` only — the exact shape that used to
  -- import as 0.00 and inactive.
  insert into public.lazywait_catalog_items
    (entity_type, lazywait_id, name_en, name_ar, parent_id,
     description_en, description_ar, show_online, active, prices, raw)
  values
    ('item', 'IT_WINGS', 'Chicken Wings', 'أجنحة الدجاج', 'CAT_SIDES',
     'Five or ten pieces of chicken wings.', 'خمس أو عشر قطع من اجنحة الدجاج', true, true,
     '[{"price_id":"PR_W_S","name":"Small","name_ar":"صغير","price_excl_vat":6.086956521739131,
        "price_with_vat":null,"show_online":true,"active":true,"calories":0},
       {"price_id":"PR_W_L","name":"Large","name_ar":"كبير","price_excl_vat":11.304347826086957,
        "price_with_vat":null,"show_online":true,"active":true,"calories":0}]'::jsonb,
     '{"active":true,"show_online":true}'),

  -- Wedgez Fries: three prices, one of them POS-only ("Change to Wedgez").
    ('item', 'IT_WEDGEZ', 'Wedgez Fries', 'بطاطس ودجز', 'CAT_SIDES',
     null, null, true, true,
     '[{"price_id":"PR_WZ_S","name":"Smal","name_ar":"صغير","price_excl_vat":6.9565217391304355,
        "price_with_vat":null,"show_online":true,"active":true,"calories":0},
       {"price_id":"PR_WZ_L","name":"Large","name_ar":"كبير","price_excl_vat":13.043478260869566,
        "price_with_vat":null,"show_online":true,"active":true,"calories":0},
       {"price_id":"PR_WZ_C","name":"Change to Wedgez","name_ar":"استبدال الى ودجز",
        "price_excl_vat":2.608695652173913,"price_with_vat":null,
        "show_online":false,"active":true,"calories":0}]'::jsonb,
     '{"active":true,"show_online":true}'),

  -- Extreme, sitting in the hidden Offers category: inherits invisibility.
    ('item', 'IT_EXTREME', 'Extreme', 'وجبة اكستريم', 'CAT_OFFERS',
     null, null, true, true,
     '[{"price_id":"PR_EX","name":"Spicy","name_ar":"سبايسي","price_excl_vat":21.73913043478261,
        "price_with_vat":25,"show_online":null,"active":true,"calories":null}]'::jsonb,
     '{"active":true,"show_online":true}'),

  -- Macaroni Béchamel: its category is not in this pull at all.
    ('item', 'IT_MAC', 'Macaroni Béchamel', 'مكرونة بشاميل', 'CAT_GONE',
     null, null, true, true,
     '[{"price_id":"PR_MAC","name":"piece","name_ar":null,"price_excl_vat":13.043478260869566,
        "price_with_vat":15,"show_online":null,"active":true,"calories":null}]'::jsonb,
     '{"active":true,"show_online":true}');

  -- ---- Run the import -----------------------------------------------------
  v_res := public.import_lazywait_catalog();

  -- 1. One variant per price row: 2 + 3 + 1 + 1 = 7.
  select count(*) into v_n from public.product_variants;
  if v_n <> 7 then
    raise exception 'expected 7 variants (one per price row), got %  [%]', v_n, v_res;
  end if;

  -- 2. Four products, one per item — never one per price. (Scoped to imported
  --    rows: supabase/seed.sql ships four demo products with no Lazywait id.)
  select count(*) into v_n from public.products where lazywait_item_id is not null;
  if v_n <> 4 then raise exception 'expected 4 imported products, got %', v_n; end if;

  -- 2b. "Replace" semantics: a local product the pull does not contain is
  --     DEACTIVATED, so the demo seed cannot linger on a Lazywait-sourced menu.
  select count(*) into v_n from public.products where lazywait_item_id is null and is_active;
  if v_n <> 0 then raise exception 'seed products should be deactivated by the import, % still active', v_n; end if;

  -- 3. The money: net x 1.15, rounded to the halala. This is the assertion the
  --    old importer could not have passed — it read 0 here.
  select price into v_price from public.product_variants where lazywait_price_id = 'PR_W_S';
  if v_price <> 7.00 then raise exception 'Wings/Small should gross up to 7.00, got %', v_price; end if;
  select price into v_price from public.product_variants where lazywait_price_id = 'PR_W_L';
  if v_price <> 13.00 then raise exception 'Wings/Large should gross up to 13.00, got %', v_price; end if;

  -- 4. An explicit price_with_vat is authoritative and is NOT grossed up again.
  select price into v_price from public.product_variants where lazywait_price_id = 'PR_EX';
  if v_price <> 25.00 then raise exception 'Extreme should use its stated 25.00, got %', v_price; end if;

  -- 5. products.price is the CHEAPEST orderable tier ("from" price).
  select price into v_price from public.products where lazywait_item_id = 'IT_WINGS';
  if v_price <> 7.00 then raise exception 'Wings product price should be the 7.00 tier, got %', v_price; end if;
  select price into v_price from public.products where lazywait_item_id = 'IT_WEDGEZ';
  if v_price <> 8.00 then raise exception 'Wedgez product price should be the 8.00 tier, got %', v_price; end if;

  -- 6. ...and the hidden 3.00 upgrade must NOT have become that "from" price.
  select is_active into v_bool from public.product_variants where lazywait_price_id = 'PR_WZ_C';
  if v_bool then raise exception 'a show_online=false tier must import inactive'; end if;
  select count(*) into v_n from public.product_variants v
    join public.products p on p.id = v.product_id
   where p.lazywait_item_id = 'IT_WEDGEZ' and v.is_active;
  if v_n <> 2 then raise exception 'Wedgez should have 2 orderable tiers, got %', v_n; end if;

  -- 7. Visibility is inherited: a hidden category hides its items.
  select is_active into v_bool from public.categories where lazywait_category_id = 'CAT_OFFERS';
  if v_bool then raise exception 'a show_online=false category must import inactive'; end if;
  select is_active into v_bool from public.products where lazywait_item_id = 'IT_EXTREME';
  if v_bool then raise exception 'an item in a hidden category must import inactive'; end if;

  -- 8. An item whose category the pull did not return is kept but hidden.
  select is_active into v_bool from public.products where lazywait_item_id = 'IT_MAC';
  if v_bool then raise exception 'an orphan item must import inactive, not onto the menu'; end if;
  select is_active into v_bool from public.categories where lazywait_category_id = '__lw_uncategorized__';
  if v_bool then raise exception 'the Uncategorized bucket must be inactive'; end if;

  -- 9. Descriptions arrive from details{en,ar}.
  select description_en into v_txt from public.products where lazywait_item_id = 'IT_WINGS';
  if v_txt is distinct from 'Five or ten pieces of chicken wings.' then
    raise exception 'item description not imported, got %', v_txt;
  end if;

  -- 10. products.lazywait_price_id points at a REAL price — the cheapest tier.
  select lazywait_price_id into v_txt from public.products where lazywait_item_id = 'IT_WINGS';
  if v_txt <> 'PR_W_S' then raise exception 'product price id should be the cheapest tier, got %', v_txt; end if;

  -- 11. Re-running is idempotent: no duplicated tiers, same prices.
  perform public.import_lazywait_catalog();
  select count(*) into v_n from public.product_variants;
  if v_n <> 7 then raise exception 're-import duplicated variants: %', v_n; end if;
  select count(*) into v_n from public.products where lazywait_item_id is not null;
  if v_n <> 4 then raise exception 're-import duplicated products: %', v_n; end if;
  select price into v_price from public.product_variants where lazywait_price_id = 'PR_W_L';
  if v_price <> 13.00 then raise exception 're-import changed a price: %', v_price; end if;

  -- 12. The VAT rate is app_settings', not a literal. Halve it and re-import.
  update public.app_settings set vat_percentage = 0 where id = true;
  perform public.import_lazywait_catalog();
  select price into v_price from public.product_variants where lazywait_price_id = 'PR_W_S';
  if v_price <> 6.09 then
    raise exception 'VAT must come from app_settings; at 0%% Wings/Small should be 6.09, got %', v_price;
  end if;
  -- ...while a stated gross price is unaffected by the rate.
  select price into v_price from public.product_variants where lazywait_price_id = 'PR_EX';
  if v_price <> 25.00 then raise exception 'a stated gross price must ignore the VAT rate, got %', v_price; end if;
  update public.app_settings set vat_percentage = 15 where id = true;

  -- 13. A tier that disappears from the pull is DEACTIVATED, never deleted, so
  --     an order that referenced it keeps its foreign key.
  update public.lazywait_catalog_items
     set prices = '[{"price_id":"PR_W_S","name":"Small","name_ar":"صغير",
                     "price_excl_vat":6.086956521739131,"price_with_vat":null,
                     "show_online":true,"active":true,"calories":0}]'::jsonb
   where lazywait_id = 'IT_WINGS';
  perform public.import_lazywait_catalog();
  select is_active into v_bool from public.product_variants where lazywait_price_id = 'PR_W_L';
  if v_bool is null then raise exception 'a withdrawn tier must be kept, not deleted'; end if;
  if v_bool then raise exception 'a withdrawn tier must be deactivated'; end if;

  raise notice 'lazywait_variant_import_test: all assertions passed';
end $$;

rollback;

-- ============================================================================
-- An id-less price row must not leave the product orderable.
--
-- Separate block so it gets its own catalog, rather than shifting every count
-- asserted above.
--
-- The shape: Lazywait returns a price row with NO `price_id`. The parser
-- deliberately preserves it, and the importer creates it visible and counts it
-- towards making the parent product active. The replace pass then deactivates
-- every variant whose lazywait_price_id is null -- including that one.
--
-- Before step 4b the product survived that with ZERO active tiers, and
-- place_order read it as UNTIERED: it accepted the line, priced it from
-- products.price and sent products.lazywait_price_id, which is null for such a
-- product. The POS got an order it could not attribute to any price.
-- ============================================================================
begin;
set local session_replication_role = replica;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_prod  uuid;
  v_bool  boolean;
  v_n     int;
begin
  insert into auth.users(id, email) values (v_admin, 'b@x');
  insert into public.profiles(id, role) values (v_admin, 'admin');
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);
  insert into public.app_settings(id, vat_percentage) values (true, 15)
    on conflict (id) do update set vat_percentage = 15;

  insert into public.lazywait_catalog_items
    (entity_type, lazywait_id, name_en, name_ar, show_online, active, raw)
  values
    ('category', 'CAT_X', 'Cat X', 'فئة', true, true, '{"active":true,"show_online":true}');

  -- Its ONLY price row carries no price_id.
  insert into public.lazywait_catalog_items
    (entity_type, lazywait_id, name_en, name_ar, parent_id, show_online, active, prices, raw)
  values
    ('item', 'IT_NOID', 'No Id Item', 'صنف بدون معرف', 'CAT_X', true, true,
     '[{"price_id":null,"name":"Regular","name_ar":"عادي","price_excl_vat":10,
        "price_with_vat":null,"show_online":true,"active":true,"calories":null}]'::jsonb,
     '{"active":true,"show_online":true}');

  perform public.import_lazywait_catalog();

  select id into v_prod from public.products where lazywait_item_id = 'IT_NOID';
  if v_prod is null then
    raise exception 'the id-less item should still create a product row';
  end if;

  -- The variant exists but is not active (the replace pass deactivates it).
  select count(*) into v_n from public.product_variants
   where product_id = v_prod and is_active = true;
  if v_n <> 0 then
    raise exception 'an id-less tier must not stay active, found %', v_n;
  end if;

  select count(*) into v_n from public.product_variants where product_id = v_prod;
  if v_n <> 1 then
    raise exception 'the tier must be kept (deactivated), not deleted; found %', v_n;
  end if;

  -- 4b: the parent must not be left orderable with no orderable tier.
  select is_active into v_bool from public.products where id = v_prod;
  if v_bool then
    raise exception
      'a product whose every tier is inactive must be deactivated, or place_order '
      'reads it as untiered and sends a null lazywait_price_id to the POS';
  end if;

  -- An UNTIERED product is untouched by 4b -- it has no variants at all, so the
  -- rule must not fire on it.
  insert into public.lazywait_catalog_items
    (entity_type, lazywait_id, name_en, name_ar, parent_id, show_online, active, prices, raw)
  values
    ('item', 'IT_FLAT', 'Flat Item', 'صنف', 'CAT_X', true, true,
     '[{"price_id":"PR_FLAT","name":"One","name_ar":"واحد","price_excl_vat":10,
        "price_with_vat":null,"show_online":true,"active":true,"calories":null}]'::jsonb,
     '{"active":true,"show_online":true}');
  perform public.import_lazywait_catalog();
  select is_active into v_bool from public.products where lazywait_item_id = 'IT_FLAT';
  if not v_bool then
    raise exception 'a product with a usable tier must stay active';
  end if;

  raise notice 'lazywait_variant_import_test (id-less prices): all assertions passed';
end $$;

rollback;
