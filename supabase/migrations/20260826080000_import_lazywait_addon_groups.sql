-- ===========================================================================
-- Import Lazywait add-on groups into the app's option model
-- ===========================================================================
--
-- Evidence this exists for. On 2026-08-26 the owner added an add-on group to
-- one product in Lazywait and asked to see it in the app. It could not appear:
-- `import_lazywait_catalog` wrote categories, products, variants and branches
-- and mentioned modifiers nowhere, so `product_modifier_groups` held ZERO rows
-- in Production and no product offered an option of any kind. The catalog pull
-- of 2026-08-26 07:18 cached the group correctly - the first pull ever to
-- report `addon_groups` non-zero, after the parser fix in PR #251 - and then
-- nothing consumed it.
--
-- This migration adds the consumer. Two objects and one two-line edit:
--
--   * two partial unique indexes, so a second import cannot duplicate what the
--     first created;
--   * public.import_lazywait_addon_groups(), the importer;
--   * import_lazywait_catalog() calls it last and returns its counts.
--
-- Read the header on each half below for the reasoning; the parts worth
-- knowing up front are that membership is read from the GROUP because every
-- add-on's own group id is null, and that a modifier row exists per
-- (group, add-on) pair because Lazywait allows one add-on in several groups
-- while `modifiers.group_id` is NOT NULL.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- import_lazywait_addon_groups - turn cached add-on groups into app options
-- ---------------------------------------------------------------------------
--
-- Until now the importer created categories, products, variants and branches
-- and stopped. Nothing turned a Lazywait add-on into something a customer can
-- choose, so `product_modifier_groups` held ZERO rows in Production and no
-- product offered an option of any kind.
--
-- WHY MEMBERSHIP IS READ FROM THE GROUP, NOT THE ADD-ON. Every add-on row
-- carries an `addons_group_id` key and every one of them is null - verified on
-- the 2026-08-26 pull, 0 of 10 non-empty. The only usable link is the group's
-- own `addons_ids` array. Reading it the other way round, which is the obvious
-- way, silently produces zero members.
--
-- WHY ONE MODIFIER ROW PER (GROUP, ADD-ON) PAIR. `modifiers.group_id` is NOT
-- NULL, so a modifier belongs to exactly one group - but Lazywait lets one
-- add-on sit in several. On the 2026-08-26 pull Mango juice belongs to both
-- "Test" and "مشروب الوجبة". A row per pair is therefore the only shape that
-- fits both models, and `lazywait_addon_id` is deliberately NOT unique across
-- the table. `lazywait-sync` is unaffected: it maps a modifier to its add-on
-- id, and many local rows resolving to one Lazywait add-on is fine.
--
-- WHICH GROUPS ARE IMPORTED. Only those at least one cached item references
-- through `addons_groups_ids`. That is a rule, not a special case, and it is
-- what skips the stray "Test" group (0 items) without naming it.
--
-- WHAT IS DELIBERATELY IGNORED. An item's own `addons_ids` - Coral lists Mango
-- juice directly as well as through the group. This model has no concept of an
-- add-on outside a group, and importing it separately would show Mango juice
-- twice on the product screen. Groups are the only source of options here.
--
-- NAMES. Lazywait sent `name_en = null` for both groups on 2026-08-26, and
-- `modifier_groups.name_en` is NOT NULL. The app renders `pick(nameEn, nameAr)`
-- by locale, so without a fallback an English-locale customer would read a
-- blank heading. Each name falls back to the other language, then to a literal.
--
-- PRICE. Identical rule to products and variants, deliberately: prefer a gross
-- figure Lazywait stated, otherwise gross the net one up with the configured
-- VAT, otherwise 0; never negative. On the 2026-08-26 pull every add-on is 0.
--
-- REMOVAL IS DEACTIVATION, NEVER DELETION. An `order_item_modifiers` row
-- references a modifier for the life of the order.
-- ---------------------------------------------------------------------------

-- Idempotency guards. Without them a second import creates a second copy of
-- every group and option - the same defect `branches.lazywait_branch_id` still
-- has, where two rows can hold one Lazywait id and the importer writes to both
-- (docs/OWNER_ACTIONS.md section 19). Partial, so hand-made rows carrying no
-- Lazywait id are unaffected.
create unique index if not exists modifier_groups_lazywait_group_id_key
  on public.modifier_groups (lazywait_group_id)
  where lazywait_group_id is not null;

create unique index if not exists modifiers_group_lazywait_addon_key
  on public.modifiers (group_id, lazywait_addon_id)
  where lazywait_addon_id is not null;

create or replace function public.import_lazywait_addon_groups()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g            public.lazywait_catalog_items;
  a            public.lazywait_catalog_items;
  v_vat        numeric;
  v_group_id   uuid;
  v_gname_en   text; v_gname_ar text;
  v_min        integer; v_max integer; v_required boolean;
  v_mname_en   text; v_mname_ar text;
  v_price      jsonb; v_net numeric; v_gross numeric; v_amount numeric(10,2);
  v_mod_id     uuid;
  v_addon_id   text;
  v_ord        integer;
  v_seen       uuid[];
  v_hit        integer;
  v_g_created  integer := 0; v_g_updated integer := 0; v_g_skipped integer := 0;
  v_m_created  integer := 0; v_m_updated integer := 0; v_m_deactivated integer := 0;
  v_m_missing  integer := 0;
  v_l_created  integer := 0; v_l_removed integer := 0;
begin
  select coalesce(vat_percentage, 15) into v_vat from public.app_settings where id = true;
  v_vat := coalesce(v_vat, 15);

  select count(*) into v_g_skipped
  from public.lazywait_catalog_items ci
  where ci.entity_type = 'addon_group'
    and not exists (
      select 1 from public.lazywait_catalog_items it
      where it.entity_type = 'item'
        and jsonb_typeof(it.raw -> 'addons_groups_ids') = 'array'
        and (it.raw -> 'addons_groups_ids') ? ci.lazywait_id);

  for g in
    select ci.* from public.lazywait_catalog_items ci
    where ci.entity_type = 'addon_group'
      and exists (
        select 1 from public.lazywait_catalog_items it
        where it.entity_type = 'item'
          and jsonb_typeof(it.raw -> 'addons_groups_ids') = 'array'
          and (it.raw -> 'addons_groups_ids') ? ci.lazywait_id)
    order by ci.lazywait_id
  loop
    v_gname_en := coalesce(nullif(btrim(g.name_en), ''), nullif(btrim(g.name_ar), ''), 'Options');
    v_gname_ar := coalesce(nullif(btrim(g.name_ar), ''), v_gname_en);
    v_min      := greatest(0, coalesce(g.min_selection, 0));
    -- max_selection first, multi_max as Lazywait's alternate spelling; 0 or
    -- absent means "no cap", which this model expresses as null.
    v_max      := nullif(greatest(coalesce(g.max_selection, g.multi_max, 0), 0), 0);
    v_required := v_min >= 1;

    select id into v_group_id from public.modifier_groups
      where lazywait_group_id = g.lazywait_id;
    if found then
      update public.modifier_groups
         set name_en = v_gname_en, name_ar = v_gname_ar,
             min_select = v_min, max_select = v_max, is_required = v_required,
             updated_at = now()
       where id = v_group_id;
      v_g_updated := v_g_updated + 1;
    else
      insert into public.modifier_groups
        (name_en, name_ar, min_select, max_select, is_required, lazywait_group_id)
      values (v_gname_en, v_gname_ar, v_min, v_max, v_required, g.lazywait_id)
      returning id into v_group_id;
      v_g_created := v_g_created + 1;
    end if;

    v_seen := '{}';
    v_ord  := 0;
    if jsonb_typeof(g.raw -> 'addons_ids') = 'array' then
      for v_addon_id in
        select value from jsonb_array_elements_text(g.raw -> 'addons_ids')
      loop
        v_ord := v_ord + 1;
        select * into a from public.lazywait_catalog_items
          where entity_type = 'addon' and lazywait_id = v_addon_id;
        if not found then
          -- The group names an add-on the /menu/addons endpoint did not return.
          -- Counted and skipped rather than invented.
          v_m_missing := v_m_missing + 1;
          continue;
        end if;

        v_price  := case when jsonb_typeof(a.prices) = 'array' and jsonb_array_length(a.prices) > 0
                         then a.prices -> 0 else null end;
        v_net    := nullif(v_price ->> 'price_excl_vat', '')::numeric;
        v_gross  := nullif(v_price ->> 'price_with_vat', '')::numeric;
        v_amount := round(coalesce(v_gross, v_net * (1 + v_vat / 100.0), 0), 2);
        if v_amount < 0 then v_amount := 0; end if;

        v_mname_en := coalesce(nullif(btrim(a.name_en), ''), nullif(btrim(a.name_ar), ''), 'Option');
        v_mname_ar := coalesce(nullif(btrim(a.name_ar), ''), v_mname_en);

        select id into v_mod_id from public.modifiers
          where group_id = v_group_id and lazywait_addon_id = a.lazywait_id;
        if found then
          update public.modifiers
             set name_en = v_mname_en, name_ar = v_mname_ar, price = v_amount,
                 sort_order = v_ord, is_active = coalesce(a.active, true),
                 updated_at = now()
           where id = v_mod_id;
          v_m_updated := v_m_updated + 1;
        else
          insert into public.modifiers
            (group_id, name_en, name_ar, price, sort_order, is_active, lazywait_addon_id)
          values (v_group_id, v_mname_en, v_mname_ar, v_amount, v_ord,
                  coalesce(a.active, true), a.lazywait_id)
          returning id into v_mod_id;
          v_m_created := v_m_created + 1;
        end if;
        v_seen := v_seen || v_mod_id;
      end loop;
    end if;

    -- Dropped from the group in Lazywait -> inactive here. Only rows this
    -- importer owns are touched; a hand-made option in the same group keeps
    -- its state because its lazywait_addon_id is null.
    update public.modifiers
       set is_active = false, updated_at = now()
     where group_id = v_group_id
       and lazywait_addon_id is not null
       and not (id = any(v_seen))
       and is_active;
    get diagnostics v_hit = row_count;
    v_m_deactivated := v_m_deactivated + v_hit;

    -- Attach the group to every mapped product whose item lists it.
    insert into public.product_modifier_groups (product_id, group_id, sort_order)
    select p.id, v_group_id, 0
    from public.lazywait_catalog_items it
    join public.products p on p.lazywait_item_id = it.lazywait_id
    where it.entity_type = 'item'
      and jsonb_typeof(it.raw -> 'addons_groups_ids') = 'array'
      and (it.raw -> 'addons_groups_ids') ? g.lazywait_id
    on conflict (product_id, group_id) do nothing;
    get diagnostics v_hit = row_count;
    v_l_created := v_l_created + v_hit;

  end loop;

  -- Detach every Lazywait-owned group from products whose item no longer lists
  -- it. This runs OUTSIDE the loop above, and that is the whole point: the loop
  -- only visits groups some item still references, so a group dropped from the
  -- LAST item referencing it would never be visited and would stay attached
  -- forever - customers still asked to choose from a group Lazywait no longer
  -- offers on that product, and, if it is required, still blocked from ordering
  -- without one. Caught by the suite before this ever ran anywhere.
  --
  -- Scoped to groups carrying a lazywait_group_id, so a hand-made group's links
  -- are unreachable from here.
  --
  -- Guarded on the cache holding at least one item, for the same reason the
  -- catalog pull refuses to prune on an empty response: a failed or partial
  -- pull must never be read as "Lazywait dropped everything" and strip every
  -- option from the menu.
  if exists (select 1 from public.lazywait_catalog_items where entity_type = 'item') then
    delete from public.product_modifier_groups pmg
    using public.modifier_groups mg
    where mg.id = pmg.group_id
      and mg.lazywait_group_id is not null
      and not exists (
        select 1
        from public.lazywait_catalog_items it
        join public.products p on p.lazywait_item_id = it.lazywait_id
        where it.entity_type = 'item'
          and p.id = pmg.product_id
          and jsonb_typeof(it.raw -> 'addons_groups_ids') = 'array'
          and (it.raw -> 'addons_groups_ids') ? mg.lazywait_group_id);
    get diagnostics v_hit = row_count;
    v_l_removed := v_l_removed + v_hit;
  end if;

  return jsonb_build_object(
    'groups',    jsonb_build_object('created', v_g_created, 'updated', v_g_updated,
                                    'skipped_unreferenced', v_g_skipped),
    'modifiers', jsonb_build_object('created', v_m_created, 'updated', v_m_updated,
                                    'deactivated', v_m_deactivated,
                                    'missing_from_cache', v_m_missing),
    'links',     jsonb_build_object('created', v_l_created, 'removed', v_l_removed)
  );
end $$;

-- Not callable directly. import_lazywait_catalog() is the entry point and it
-- is the thing that checks is_admin().
revoke all on function public.import_lazywait_addon_groups() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- import_lazywait_catalog - call the add-on importer at the end
-- ---------------------------------------------------------------------------
--
-- Two changes only: a declaration, and a call plus its counts in the result.
-- Reproduced verbatim from 20260824120000_product_variants.sql otherwise, whose
-- body was confirmed byte-identical to the live definition before generating
-- this file (prosrc md5 58d2b732f11c17d442350b393db3928c, 14387 chars).
--
-- The call is the LAST thing before the return, deliberately. The helper links
-- groups to products through products.lazywait_item_id, so it has to run after
-- this function has created the products for this pull - otherwise a first
-- import would create every group and attach it to nothing.
--
-- No existing behaviour changed: no category, product, variant or branch rule
-- was touched, and the admin gate at the top is unchanged.
-- ---------------------------------------------------------------------------

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
  v_var_created int := 0; v_var_updated int := 0; v_var_deactivated int := 0;
  v_branch_updated int := 0; v_branch_created int := 0;
  v_local_cat_id uuid;
  v_fallback_cat_id uuid;
  v_cat_lwid text;
  v_cat_active boolean;
  v_product_id uuid;
  v_active boolean;
  v_name_en text; v_name_ar text;
  v_desc_en text; v_desc_ar text;
  v_hit int;
  v_vat numeric;
  v_price jsonb;
  v_ord int;
  v_price_id text;
  v_amount numeric(10,2);
  v_net numeric;
  v_gross numeric;
  v_var_name_en text; v_var_name_ar text;
  v_var_visible boolean;
  v_var_id uuid;
  v_min_price numeric(10,2);
  v_min_price_id text;
  v_min_price_ref jsonb;
  v_visible_variants int;
  -- Add-on groups, imported by the helper below once the products they attach
  -- to exist. Its counts ride back in this function's result.
  v_addons jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins may import the Lazywait catalog' using errcode = '42501';
  end if;

  -- The single home of the VAT rate. Lazywait sends NET money; the local
  -- catalog stores GROSS. Never hardcode the percentage.
  select coalesce(vat_percentage, 15) into v_vat from public.app_settings where id = true;
  v_vat := coalesce(v_vat, 15);

  -- ---- 1. CATEGORIES (upsert by lazywait_category_id) ----------------------
  for v_row in select * from public.lazywait_catalog_items where entity_type = 'category'
  loop
    v_name_en := coalesce(nullif(btrim(v_row.name_en), ''), nullif(btrim(v_row.name_other), ''), 'Category');
    v_name_ar := coalesce(nullif(btrim(v_row.name_ar), ''), nullif(btrim(v_row.name_other), ''), v_name_en);

    -- Visible only when Lazywait says BOTH active and online. The column is
    -- read first and the raw payload is the fallback, so a cache row written
    -- before this migration still resolves correctly.
    v_active := coalesce(v_row.active,      (v_row.raw->>'active')::boolean,      true)
            and coalesce(v_row.show_online, (v_row.raw->>'show_online')::boolean, true);

    update public.categories set
      name_en    = v_name_en,
      name_ar    = v_name_ar,
      sort_order = coalesce((v_row.raw->>'sort_id')::int, sort_order),
      is_active  = v_active,
      updated_at = now()
    where lazywait_category_id = v_row.lazywait_id;
    get diagnostics v_hit = row_count;
    if v_hit > 0 then
      v_cat_updated := v_cat_updated + 1;
    else
      insert into public.categories (name_en, name_ar, sort_order, is_active, lazywait_category_id)
      values (v_name_en, v_name_ar, coalesce((v_row.raw->>'sort_id')::int, 0),
              v_active, v_row.lazywait_id);
      v_cat_created := v_cat_created + 1;
    end if;
  end loop;

  -- ---- 2. ITEMS -> products, PRICES -> product_variants --------------------
  for v_row in select * from public.lazywait_catalog_items where entity_type = 'item'
  loop
    -- Resolve the local category. `parent_id` is now populated by the parser
    -- (it reads `menu_category_id`); the raw fallback stays for cache rows
    -- written before that fix.
    v_cat_lwid := coalesce(nullif(btrim(v_row.parent_id), ''), nullif(v_row.raw->>'menu_category_id', ''));
    select id, is_active into v_local_cat_id, v_cat_active
      from public.categories where lazywait_category_id = v_cat_lwid;

    if v_local_cat_id is null then
      -- An item whose category the pull did not return. It is NOT dropped, but
      -- it lands in a bucket that is INACTIVE by design: an orphan must never
      -- appear on the customer menu on its own, and an admin decides where it
      -- belongs. ("Macaroni Béchamel" is exactly this case in Production.)
      if v_fallback_cat_id is null then
        select id into v_fallback_cat_id from public.categories where lazywait_category_id = '__lw_uncategorized__';
        if v_fallback_cat_id is null then
          insert into public.categories (name_en, name_ar, sort_order, is_active, lazywait_category_id)
          values ('Uncategorized', 'غير مصنّف', 9999, false, '__lw_uncategorized__')
          returning id into v_fallback_cat_id;
          v_cat_created := v_cat_created + 1;
        end if;
      end if;
      v_local_cat_id := v_fallback_cat_id;
      v_cat_active   := false;
    end if;

    v_name_en := coalesce(nullif(btrim(v_row.name_en), ''), nullif(btrim(v_row.name_other), ''), 'Item');
    v_name_ar := coalesce(nullif(btrim(v_row.name_ar), ''), nullif(btrim(v_row.name_other), ''), v_name_en);
    v_desc_en := nullif(btrim(coalesce(v_row.description_en, v_row.raw->'details'->>'en')), '');
    v_desc_ar := nullif(btrim(coalesce(v_row.description_ar, v_row.raw->'details'->>'ar')), '');

    -- Visibility is INHERITED: a hidden category hides its items.
    v_active := coalesce(v_row.active,      (v_row.raw->>'active')::boolean,      true)
            and coalesce(v_row.show_online, (v_row.raw->>'show_online')::boolean, true)
            and v_cat_active;

    -- Upsert the product. `price` and `is_active` are settled AFTER the
    -- variants are known, so they are deliberately not written here.
    update public.products set
      category_id    = v_local_cat_id,
      name_en        = v_name_en,
      name_ar        = v_name_ar,
      description_en = coalesce(v_desc_en, description_en),
      description_ar = coalesce(v_desc_ar, description_ar),
      image_url      = coalesce(nullif(v_row.raw->>'photo', ''), image_url),
      sort_order     = coalesce((v_row.raw->>'sort_id')::int, sort_order),
      updated_at     = now()
    where lazywait_item_id = v_row.lazywait_id
    returning id into v_product_id;
    get diagnostics v_hit = row_count;

    if v_hit > 0 then
      v_prod_updated := v_prod_updated + 1;
    else
      insert into public.products (category_id, name_en, name_ar, description_en, description_ar,
                                   price, image_url, is_active, sort_order, lazywait_item_id)
      values (v_local_cat_id, v_name_en, v_name_ar, v_desc_en, v_desc_ar,
              0, nullif(v_row.raw->>'photo', ''), false,
              coalesce((v_row.raw->>'sort_id')::int, 0), v_row.lazywait_id)
      returning id into v_product_id;
      v_prod_created := v_prod_created + 1;
    end if;

    -- ---- 2b. one variant per price row -----------------------------------
    v_min_price := null; v_min_price_id := null; v_min_price_ref := null;
    v_visible_variants := 0;

    for v_price, v_ord in
      select value, ordinality
      from jsonb_array_elements(coalesce(v_row.prices, '[]'::jsonb)) with ordinality
    loop
      v_price_id := nullif(btrim(v_price->>'price_id'), '');
      v_net      := nullif(v_price->>'price_excl_vat', '')::numeric;
      v_gross    := nullif(v_price->>'price_with_vat', '')::numeric;

      -- Prefer a gross figure Lazywait actually stated; otherwise gross the net
      -- one up. A row with neither is priced 0 and therefore never orderable.
      v_amount := round(coalesce(v_gross, v_net * (1 + v_vat / 100.0), 0), 2);
      if v_amount < 0 then v_amount := 0; end if;

      -- A single unnamed price is the item itself (many sauces are like this),
      -- so the tier borrows the product's name and never renders blank.
      v_var_name_en := coalesce(nullif(btrim(v_price->>'name'), ''), v_name_en);
      v_var_name_ar := coalesce(nullif(btrim(v_price->>'name_ar'), ''), v_var_name_en);

      v_var_visible := coalesce((v_price->>'active')::boolean, true)
                   and coalesce((v_price->>'show_online')::boolean, true)
                   and v_amount > 0;

      -- Match an existing tier by its Lazywait price id, or — for a price row
      -- that carries no id — by name within this product.
      v_var_id := null;
      if v_price_id is not null then
        select id into v_var_id from public.product_variants
          where lazywait_price_id = v_price_id;
      else
        select id into v_var_id from public.product_variants
          where product_id = v_product_id and lazywait_price_id is null and name_en = v_var_name_en
          limit 1;
      end if;

      if v_var_id is not null then
        update public.product_variants set
          product_id         = v_product_id,
          name_en            = v_var_name_en,
          name_ar            = v_var_name_ar,
          price              = v_amount,
          calories           = nullif(v_price->>'calories', '')::int,
          sort_order         = v_ord,
          is_active          = v_var_visible,
          lazywait_price_ref = v_price,
          updated_at         = now()
        where id = v_var_id;
        v_var_updated := v_var_updated + 1;
      else
        insert into public.product_variants (product_id, name_en, name_ar, price, calories,
                                             sort_order, is_active, lazywait_price_id, lazywait_price_ref)
        values (v_product_id, v_var_name_en, v_var_name_ar, v_amount,
                nullif(v_price->>'calories', '')::int, v_ord, v_var_visible, v_price_id, v_price)
        returning id into v_var_id;
        v_var_created := v_var_created + 1;
      end if;

      if v_var_visible then
        v_visible_variants := v_visible_variants + 1;
        if v_min_price is null or v_amount < v_min_price then
          v_min_price     := v_amount;
          v_min_price_id  := v_price_id;
          v_min_price_ref := v_price;
        end if;
      end if;
    end loop;

    -- ---- 2c. settle the product from its variants -------------------------
    -- `price` is the cheapest orderable tier — the "from" price on a menu card.
    -- A product with no orderable tier is imported INACTIVE at 0, so nothing is
    -- ever purchasable for free. `lazywait_price_id` keeps pointing at that
    -- cheapest tier so any reader that has not moved to variants still sends a
    -- real, valid price id.
    update public.products set
      price              = coalesce(v_min_price, 0),
      is_active          = v_active and v_visible_variants > 0,
      lazywait_price_id  = v_min_price_id,
      lazywait_price_ref = v_min_price_ref,
      updated_at         = now()
    where id = v_product_id;
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
  -- Never deletes — deactivating keeps order-history FKs intact and is
  -- reversible. Variants go first so a product is judged on live tiers only.
  update public.product_variants set is_active = false, updated_at = now()
  where is_active = true
    and (lazywait_price_id is null
         or lazywait_price_id not in (
           select p->>'price_id'
           from public.lazywait_catalog_items i,
                lateral jsonb_array_elements(coalesce(i.prices, '[]'::jsonb)) p
           where i.entity_type = 'item' and nullif(btrim(p->>'price_id'), '') is not null));
  get diagnostics v_var_deactivated = row_count;

  update public.products set is_active = false, updated_at = now()
  where is_active = true
    and (lazywait_item_id is null
         or lazywait_item_id not in (select lazywait_id from public.lazywait_catalog_items where entity_type = 'item'));
  get diagnostics v_prod_deactivated = row_count;

  -- ---- 4b. RECOMPUTE a tiered product whose tiers have all gone inactive ----
  -- The variant pass above deactivates every row with a NULL lazywait_price_id.
  -- That includes id-less price rows THIS RUN created as visible and counted
  -- towards making the parent product active (a price row without a `price_id`
  -- is a shape the parser deliberately preserves). Without this pass such a
  -- product stays active holding ZERO active tiers, and place_order then reads
  -- it as UNTIERED: it accepts the line, prices it from products.price, and
  -- sends products.lazywait_price_id — which for that product is null. The POS
  -- receives an order it cannot attribute to any price.
  --
  -- The rule is simply: a product that HAS tiers but none orderable is not
  -- itself orderable. Deactivating is reversible and never deletes, so the next
  -- pull that returns a usable price_id brings it straight back.
  update public.products p set is_active = false, updated_at = now()
  where p.is_active = true
    and exists (select 1 from public.product_variants v where v.product_id = p.id)
    and not exists (select 1 from public.product_variants v
                    where v.product_id = p.id and v.is_active = true);
  get diagnostics v_hit = row_count;
  v_prod_deactivated := v_prod_deactivated + v_hit;

  update public.categories set is_active = false, updated_at = now()
  where is_active = true
    and lazywait_category_id is distinct from '__lw_uncategorized__'
    and (lazywait_category_id is null
         or lazywait_category_id not in (select lazywait_id from public.lazywait_catalog_items where entity_type = 'category'));
  get diagnostics v_cat_deactivated = row_count;

  -- LAST, and that ordering is load-bearing: the helper attaches groups to
  -- products by joining products.lazywait_item_id, so every product this run
  -- created must already exist.
  v_addons := public.import_lazywait_addon_groups();

  return jsonb_build_object(
    'categories', jsonb_build_object('created', v_cat_created, 'updated', v_cat_updated, 'deactivated', v_cat_deactivated),
    'products',   jsonb_build_object('created', v_prod_created, 'updated', v_prod_updated, 'deactivated', v_prod_deactivated),
    'variants',   jsonb_build_object('created', v_var_created, 'updated', v_var_updated, 'deactivated', v_var_deactivated),
    'branches',   jsonb_build_object('created', v_branch_created, 'updated', v_branch_updated),
    'addons',     v_addons
  );
end $$;
