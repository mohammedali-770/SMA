-- ============================================================================
-- Spicy Meal — import_lazywait_catalog(): make Lazywait the CATALOG source.
--
-- Reads the pulled cache (lazywait_catalog_items) and writes the local menu
-- (categories + products; branch NAMES only) so the admin maintains the menu in
-- Lazywait and just Pulls → Imports. "Replace" semantics: anything not present
-- in the latest pull is DEACTIVATED (is_active=false), never deleted — reversible
-- and it preserves order-history FKs. Mapping ids are set automatically.
--
-- Supabase stays the RUNTIME source of truth: place_order still recomputes every
-- total server-side from these imported prices. Admin-only (SECURITY DEFINER +
-- is_admin() check + pinned search_path). Idempotent (re-run on every Pull).
--
-- Safety: a Lazywait item with no usable price_with_vat is imported INACTIVE
-- (price 0, hidden) so nothing is ever accidentally orderable for free.
-- Phase 1 = categories + products (+ branch names). Modifiers/add-ons and
-- product↔modifier links are a follow-up.
-- ============================================================================

create or replace function public.import_lazywait_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.lazywait_catalog_items;
  v_cat_created int := 0; v_cat_updated int := 0; v_cat_deactivated int := 0;
  v_prod_created int := 0; v_prod_updated int := 0; v_prod_deactivated int := 0;
  v_branch_updated int := 0; v_branch_created int := 0;
  v_local_cat_id uuid;
  v_fallback_cat_id uuid;
  v_cat_lwid text;
  v_price numeric(10,2);
  v_active boolean;
  v_name_en text; v_name_ar text;
  v_hit int;
begin
  if not public.is_admin() then
    raise exception 'Only admins may import the Lazywait catalog' using errcode = '42501';
  end if;

  -- ---- 1. CATEGORIES (upsert by lazywait_category_id) ----------------------
  for v_row in select * from public.lazywait_catalog_items where entity_type = 'category'
  loop
    v_name_en := coalesce(nullif(btrim(v_row.name_en), ''), nullif(btrim(v_row.name_other), ''), 'Category');
    v_name_ar := coalesce(nullif(btrim(v_row.name_ar), ''), nullif(btrim(v_row.name_other), ''), v_name_en);

    update public.categories set
      name_en    = v_name_en,
      name_ar    = v_name_ar,
      sort_order = coalesce((v_row.raw->>'sort_id')::int, sort_order),
      is_active  = coalesce((v_row.raw->>'active')::boolean, true),
      updated_at = now()
    where lazywait_category_id = v_row.lazywait_id;
    get diagnostics v_hit = row_count;
    if v_hit > 0 then
      v_cat_updated := v_cat_updated + 1;
    else
      insert into public.categories (name_en, name_ar, sort_order, is_active, lazywait_category_id)
      values (v_name_en, v_name_ar, coalesce((v_row.raw->>'sort_id')::int, 0),
              coalesce((v_row.raw->>'active')::boolean, true), v_row.lazywait_id);
      v_cat_created := v_cat_created + 1;
    end if;
  end loop;

  -- ---- 2. PRODUCTS (upsert by lazywait_item_id) ----------------------------
  for v_row in select * from public.lazywait_catalog_items where entity_type = 'item'
  loop
    -- Resolve the local category from the Lazywait category id (parent_id or
    -- raw.menu_category_id); fall back to a single "Uncategorized" bucket so no
    -- item is lost to the NOT NULL category_id.
    v_cat_lwid := coalesce(nullif(btrim(v_row.parent_id), ''), nullif(v_row.raw->>'menu_category_id', ''));
    select id into v_local_cat_id from public.categories where lazywait_category_id = v_cat_lwid;
    if v_local_cat_id is null then
      if v_fallback_cat_id is null then
        select id into v_fallback_cat_id from public.categories where lazywait_category_id = '__lw_uncategorized__';
        if v_fallback_cat_id is null then
          insert into public.categories (name_en, name_ar, sort_order, is_active, lazywait_category_id)
          values ('Uncategorized', 'غير مصنّف', 9999, true, '__lw_uncategorized__')
          returning id into v_fallback_cat_id;
          v_cat_created := v_cat_created + 1;
        end if;
      end if;
      v_local_cat_id := v_fallback_cat_id;
    end if;

    v_name_en := coalesce(nullif(btrim(v_row.name_en), ''), nullif(btrim(v_row.name_other), ''), 'Item');
    v_name_ar := coalesce(nullif(btrim(v_row.name_ar), ''), nullif(btrim(v_row.name_other), ''), v_name_en);
    v_price   := coalesce(round((v_row.prices->0->>'price_with_vat')::numeric, 2), 0);
    if v_price < 0 then v_price := 0; end if;
    -- A priceless item is imported hidden so it can never be ordered for free.
    v_active  := coalesce((v_row.raw->>'active')::boolean, true) and v_price > 0;

    update public.products set
      category_id        = v_local_cat_id,
      name_en            = v_name_en,
      name_ar            = v_name_ar,
      price              = v_price,
      image_url          = coalesce(nullif(v_row.raw->>'photo', ''), image_url),
      is_active          = v_active,
      sort_order         = coalesce((v_row.raw->>'sort_id')::int, sort_order),
      lazywait_price_id  = v_row.prices->0->>'price_id',
      lazywait_price_ref = v_row.prices->0,
      updated_at         = now()
    where lazywait_item_id = v_row.lazywait_id;
    get diagnostics v_hit = row_count;
    if v_hit > 0 then
      v_prod_updated := v_prod_updated + 1;
    else
      insert into public.products (category_id, name_en, name_ar, price, image_url, is_active, sort_order,
                                   lazywait_item_id, lazywait_price_id, lazywait_price_ref)
      values (v_local_cat_id, v_name_en, v_name_ar, v_price, nullif(v_row.raw->>'photo', ''),
              v_active, coalesce((v_row.raw->>'sort_id')::int, 0),
              v_row.lazywait_id, v_row.prices->0->>'price_id', v_row.prices->0);
      v_prod_created := v_prod_created + 1;
    end if;
  end loop;

  -- ---- 3. BRANCHES — sync NAMES only; delivery fee / min-order / GPS stay
  --         locally managed. New Lazywait branches are created INACTIVE so they
  --         never affect ordering until an admin sets their delivery config.
  for v_row in select * from public.lazywait_catalog_items where entity_type = 'branch'
  loop
    v_name_en := coalesce(nullif(btrim(v_row.name_en), ''), nullif(btrim(v_row.name_other), ''), 'Branch');
    v_name_ar := coalesce(nullif(btrim(v_row.name_ar), ''), nullif(btrim(v_row.name_other), ''), v_name_en);
    update public.branches set name_en = v_name_en, name_ar = v_name_ar, updated_at = now()
    where lazywait_branch_id = v_row.lazywait_id;
    get diagnostics v_hit = row_count;
    if v_hit > 0 then
      v_branch_updated := v_branch_updated + 1;
    else
      insert into public.branches (name_en, name_ar, is_active, lazywait_branch_id)
      values (v_name_en, v_name_ar, false, v_row.lazywait_id);
      v_branch_created := v_branch_created + 1;
    end if;
  end loop;

  -- ---- 4. REPLACE: deactivate local rows not sourced from this pull ---------
  -- (seed rows with no lazywait id, or Lazywait rows removed upstream). Never
  -- deletes — deactivating keeps order-history FKs intact and is reversible.
  update public.products set is_active = false, updated_at = now()
  where is_active = true
    and (lazywait_item_id is null
         or lazywait_item_id not in (select lazywait_id from public.lazywait_catalog_items where entity_type = 'item'));
  get diagnostics v_prod_deactivated = row_count;

  update public.categories set is_active = false, updated_at = now()
  where is_active = true
    and lazywait_category_id is distinct from '__lw_uncategorized__'
    and (lazywait_category_id is null
         or lazywait_category_id not in (select lazywait_id from public.lazywait_catalog_items where entity_type = 'category'));
  get diagnostics v_cat_deactivated = row_count;

  return jsonb_build_object(
    'categories', jsonb_build_object('created', v_cat_created, 'updated', v_cat_updated, 'deactivated', v_cat_deactivated),
    'products',   jsonb_build_object('created', v_prod_created, 'updated', v_prod_updated, 'deactivated', v_prod_deactivated),
    'branches',   jsonb_build_object('created', v_branch_created, 'updated', v_branch_updated)
  );
end $$;

revoke all on function public.import_lazywait_catalog() from public, anon;
grant execute on function public.import_lazywait_catalog() to authenticated;
