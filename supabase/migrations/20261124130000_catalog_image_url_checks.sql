-- 20261124130000_catalog_image_url_checks.sql
--
-- WHAT: three changes for audit finding F-X10-002 (low), all on the catalog's
-- image and banner-action columns:
--
--   1. a pure helper, public.is_https_image_url(text), the single definition of
--      "a URL we will store as an image";
--   2. CHECK constraints on products.image_url,
--      homepage_banners.image_url and homepage_banners.action_value;
--   3. import_lazywait_catalog() stops overwriting an image an administrator
--      set, and ignores a POS `photo` that is not a plain https URL.
--
-- WHY. Nothing at the database looked at these strings. `products.image_url`
-- and the banner's `image_url` took any text (a `javascript:` or `data:` URL, a
-- megabyte of text, a plain-http host), every customer device then fetched it,
-- and `homepage_banners.action_value` -- which the mobile app turned straight
-- into a route -- took anything at all. The POS catalog import compounded it:
-- `image_url = coalesce(nullif(raw->>'photo',''), image_url)` PREFERRED the POS
-- value, so a re-import replaced an image an administrator had uploaded to the
-- project's own bucket (the old object stays in the bucket, unreferenced).
--
-- FINDING VERIFIED AGAINST CURRENT CODE, and one part of it was wrong:
--   * `categories` has NO image column (supabase/migrations/20260707120200_
--     catalog.sql; no later migration adds one). The finding names "both
--     image_url columns" on products and categories; only products and
--     homepage_banners carry one, so only those are constrained here.
--   * the importer's overwrite is real and was still live in the newest
--     definition, 20260826080000 (lines 419 and 432 there).
--   * the banner tap really did build `/product/${actionValue}` from the stored
--     string (apps/mobile BannerCarousel.tsx); that half is fixed in the app
--     (features/menu/bannerRoute.ts), not here.
--
-- WHAT THE CHECKS ACCEPT.
--   products.image_url        NULL, '' (the console writes '' for "no image"),
--                             or an https URL of at most 2048 characters.
--   homepage_banners.image_url  an https URL of at most 2048 characters (the
--                             column is NOT NULL).
--   homepage_banners.action_value  NULL, or at most 200 characters; and when
--                             action_type = 'product', a UUID (a product id).
-- "https URL" is: the scheme https, a host that is not empty and carries no
-- userinfo, no whitespace or control character anywhere, no backslash in the
-- host. It is deliberately NOT an allow-list of hosts: `image_url` has always
-- been allowed to hold a hand-pasted external URL and that is unchanged.
--
-- WHY THE APPLY COUNTS FIRST, AND WHY THE CHECKS ARE VALIDATED. The author of
-- this file had no Production read, so what the live rows hold is unknown. A
-- constraint added NOT VALID would be enforced on every later INSERT and UPDATE
-- of a row (any column) while never having looked at the rows already there: a
-- legacy row holding a value the constraint rejects would then make EVERY update
-- of that row fail, including the importer's own "deactivate what the pull did
-- not return" pass, which would abort the whole catalog import. And this
-- repository's own existing-data check (.github/sql-ci/existing-data.sh) treats a
-- NOT VALID constraint as a check that existing rows were never held to. So the
-- file counts offending rows FIRST and refuses to apply if there is any (it
-- reports a COUNT per table, never a value), and only then adds the constraints
-- validated, a scan of two small tables. Nothing is lost by refusing: an apply is
-- transactional, and the owner can then read the rows read-only and fix them.
-- If the owner would rather land the constraints NOT VALID and validate later,
-- add `not valid` to the three `add constraint` statements; the guard stays.
--
-- THE IMPORTER'S RULE, decided from the code, not from a column: nothing records
-- where an image came from (an upload to the product-images bucket, a pasted
-- URL, or an earlier POS import all look alike), so "keep what is an
-- administrator's" cannot be told from "replace what the POS set". The rule that
-- is always safe is: the POS `photo` fills an EMPTY image and never replaces one.
-- TRADE-OFF, stated: a later change of a photo in the POS no longer reaches a
-- product that already has an image; an administrator clears the image to take
-- the POS's. Measured 2026-08-27 (migration 20260827140000's header): every
-- cached `photo` value was null, so this changes no live row today.
--
-- WHAT DOES NOT CHANGE: no row is written; no money-path function is touched
-- (`place_order`, `compute_order_snapshot` and every order function keep their
-- hashes); signature, grants and the admin gate of import_lazywait_catalog are
-- unchanged. NO DEPLOY IMPLIED: the SQL function binds by name; the customer
-- app half ships in the next EAS build and degrades safely before it.
--
-- BODY FIDELITY: the importer below is the body from
-- 20260826080000_import_lazywait_addon_groups.sql (the newest definition) with
-- exactly two statement edits, each asserted to match once when this file was
-- generated; everything else is byte-for-byte that body.
--
-- LOCAL DEVELOPMENT NOTE: the https-only rule also applies to a local Supabase
-- stack, whose storage URLs are http://127.0.0.1:...; image uploads saved from a
-- local console are refused by design. Paste an https URL when testing locally.

-- ---------------------------------------------------------------------------
-- 0. Refuse to apply onto a body this file was not derived from
-- ---------------------------------------------------------------------------
-- Redefining a function from a stale pre-image would silently drop whatever a
-- newer definition added. The expected pre-image is the 20260826080000 body
-- (the old overwrite literal, and the add-on helper call it ends with) -- or this
-- file's own result, so a replay of the chain is a no-op rather than a refusal.
do $$
declare
  v_src text;
  v_n   integer;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_lazywait_catalog';
  if v_n <> 1 then
    raise exception 'expected exactly one import_lazywait_catalog, found %', v_n;
  end if;
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_lazywait_catalog';
  if v_src not like '%v_addons := public.import_lazywait_addon_groups();%' then
    raise exception 'import_lazywait_catalog is not the add-on-aware body: apply 20260826080000 first';
  end if;
  if v_src not like '%coalesce(nullif(v_row.raw->>''photo'', ''''), image_url)%'
     and v_src not like '%public.is_https_image_url(btrim(v_row.raw->>''photo''))%' then
    raise exception 'import_lazywait_catalog is neither the expected pre-image nor this file''s result';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The helper -- one definition of "an image URL we store"
-- ---------------------------------------------------------------------------
-- IMMUTABLE and pure, so a CHECK may call it. search_path is pinned to empty:
-- it names only pg_catalog operators. It is NOT strict on purpose -- NULL gives
-- false -- so every caller states for itself whether NULL or '' is allowed.
create or replace function public.is_https_image_url(p_url text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    pg_catalog.length(p_url) between 9 and 2048
    and p_url ~* '^https://[^[:space:][:cntrl:]/?#@\\]+([/?#][^[:space:][:cntrl:]]*)?$',
    false)
$$;

comment on function public.is_https_image_url(text) is
  'True for an https URL of at most 2048 characters with a non-empty host, no userinfo, and no whitespace or control character. NULL and the empty string are false. Used by the image_url CHECKs and by import_lazywait_catalog. F-X10-002.';

-- ---------------------------------------------------------------------------
-- 2. Refuse if any existing row would fail the new CHECKs
-- ---------------------------------------------------------------------------
do $$
declare
  v_products integer;
  v_images   integer;
  v_actions  integer;
begin
  select count(*) into v_products from public.products
   where not (image_url is null or image_url = '' or public.is_https_image_url(image_url));
  select count(*) into v_images from public.homepage_banners
   where not public.is_https_image_url(image_url);
  select count(*) into v_actions from public.homepage_banners
   where not (action_value is null
              or (pg_catalog.length(action_value) <= 200
                  and (action_type <> 'product'
                       or action_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')));
  if v_products + v_images + v_actions > 0 then
    raise exception
      'existing rows would fail the new CHECKs (products.image_url: %, homepage_banners.image_url: %, homepage_banners.action_value: %). Read them read-only, fix them, then apply this file. Nothing was changed.',
      v_products, v_images, v_actions;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The constraints (validated; section 2 has just shown no row can fail them)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.products'::regclass and conname = 'products_image_url_safe') then
    alter table public.products
      add constraint products_image_url_safe
      check (image_url is null or image_url = '' or public.is_https_image_url(image_url));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.homepage_banners'::regclass and conname = 'homepage_banners_image_url_safe') then
    alter table public.homepage_banners
      add constraint homepage_banners_image_url_safe
      check (public.is_https_image_url(image_url));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.homepage_banners'::regclass and conname = 'homepage_banners_action_value_safe') then
    alter table public.homepage_banners
      add constraint homepage_banners_action_value_safe
      check (action_value is null
             or (pg_catalog.length(action_value) <= 200
                 and (action_type <> 'product'
                      or action_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. import_lazywait_catalog -- never replace an existing image
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
      -- An image already on the product is NEVER replaced by the POS's `photo`:
      -- it is an administrator's (an upload, or a URL they pasted), and there
      -- is no record of where an image came from to tell it from an earlier
      -- import. The POS value fills an EMPTY image only, and only when it is a
      -- plain https URL (public.is_https_image_url), so one odd `photo` cannot
      -- abort the whole catalog import on the column's CHECK.
      image_url      = case
                         when nullif(btrim(image_url), '') is null
                          and public.is_https_image_url(btrim(v_row.raw->>'photo'))
                         then btrim(v_row.raw->>'photo')
                         else image_url
                       end,
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
              0, case when public.is_https_image_url(btrim(v_row.raw->>'photo'))
                      then btrim(v_row.raw->>'photo') end, false,
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

-- Re-stated, unchanged from 20260824120000 (create or replace keeps the ACL; this
-- makes the intended ACL readable in the file that last redefined the function).
revoke all on function public.import_lazywait_catalog() from public, anon;
grant execute on function public.import_lazywait_catalog() to authenticated;

-- The helper is pure and returns only a boolean for the text it is given.
-- A CHECK runs as the writing role, so that role needs EXECUTE; the project's
-- default privileges grant it to anon, authenticated and service_role already,
-- which is what is wanted here, and nothing is revoked.

-- ---------------------------------------------------------------------------
-- 5. Self-verification
-- ---------------------------------------------------------------------------
-- Asserts outcomes, not statements: the helper is CALLED on both sides of every
-- rule, the constraints are read back with their validation state, and the
-- importer body is checked at the edit sites. Every comparison is written so a
-- NULL fails rather than passes (`is distinct from`).
do $$
declare
  v_src  text;
  v_n    integer;
  v_def  text;
  v_good text[] := array[
    'https://example.test/a.jpg',
    'https://abc.supabase.co/storage/v1/object/public/product-images/products/1-2.webp',
    'HTTPS://EXAMPLE.TEST/A.JPG',
    'https://example.test',
    'https://example.test:8443/a?x=1#y',
    'https://cdn.example.test/a%20b.png'];
  v_bad  text[] := array[
    'http://example.test/a.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '//example.test/a.jpg',
    'ftp://example.test/a.jpg',
    'https://',
    'https:///a.jpg',
    'https://user@example.test/a.jpg',
    'https://user:pw@example.test/a.jpg',
    'https://exa mple.test/a.jpg',
    'https://example.test/a b.jpg',
    E'https://example.test/a\n.jpg',
    E'https://example.test/a\t.jpg',
    'https://example.test\\evil.test/a.jpg',
    ' https://example.test/a.jpg',
    'https://example.test/a.jpg ',
    '',
    'x'];
  v_s text;
begin
  -- 5.1 The helper: one overload, the right volatility, a pinned search_path.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_https_image_url';
  if v_n <> 1 then raise exception '5.1 expected one is_https_image_url, found %', v_n; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'is_https_image_url'
                    and p.provolatile = 'i' and p.proconfig is not null
                    and 'search_path=""' = any (p.proconfig)) then
    raise exception '5.1 is_https_image_url must be immutable with search_path pinned to empty';
  end if;

  -- 5.2 It accepts and refuses by outcome.
  foreach v_s in array v_good loop
    if public.is_https_image_url(v_s) is distinct from true then
      raise exception '5.2 is_https_image_url must accept %', v_s;
    end if;
  end loop;
  foreach v_s in array v_bad loop
    if public.is_https_image_url(v_s) is distinct from false then
      raise exception '5.2 is_https_image_url must refuse %', v_s;
    end if;
  end loop;
  if public.is_https_image_url(null) is distinct from false then
    raise exception '5.2 is_https_image_url(NULL) must be false, not NULL';
  end if;
  if public.is_https_image_url('https://example.test/' || repeat('a', 2027)) is distinct from true then
    raise exception '5.2 a 2048-character URL must be accepted';
  end if;
  if public.is_https_image_url('https://example.test/' || repeat('a', 2028)) is distinct from false then
    raise exception '5.2 a 2049-character URL must be refused';
  end if;

  -- 5.3 The three constraints exist, are validated, and call the helper.
  select pg_get_constraintdef(oid), 1 into v_def, v_n from pg_constraint
   where conrelid = 'public.products'::regclass and conname = 'products_image_url_safe'
     and contype = 'c' and convalidated;
  if v_n is distinct from 1 or v_def not like '%is_https_image_url%' then
    raise exception '5.3 products_image_url_safe missing, not validated, or not calling the helper';
  end if;
  select pg_get_constraintdef(oid), 1 into v_def, v_n from pg_constraint
   where conrelid = 'public.homepage_banners'::regclass and conname = 'homepage_banners_image_url_safe'
     and contype = 'c' and convalidated;
  if v_n is distinct from 1 or v_def not like '%is_https_image_url%' then
    raise exception '5.3 homepage_banners_image_url_safe missing, not validated, or not calling the helper';
  end if;
  select pg_get_constraintdef(oid), 1 into v_def, v_n from pg_constraint
   where conrelid = 'public.homepage_banners'::regclass and conname = 'homepage_banners_action_value_safe'
     and contype = 'c' and convalidated;
  if v_n is distinct from 1 or v_def not like '%action_type%' or v_def not like '%<= 200%' then
    raise exception '5.3 homepage_banners_action_value_safe missing, not validated, or without its length and product rules';
  end if;

  -- 5.4 The importer: one overload, the overwrite gone, both edits present,
  --     everything it already did still there.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_lazywait_catalog';
  if v_n <> 1 then raise exception '5.4 expected one import_lazywait_catalog, found %', v_n; end if;
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_lazywait_catalog';
  if v_src like '%coalesce(nullif(v_row.raw->>''photo'', ''''), image_url)%' then
    raise exception '5.4 the importer still prefers the POS photo over the stored image';
  end if;
  if v_src not like '%when nullif(btrim(image_url), '''') is null%'
     or v_src not like '%and public.is_https_image_url(btrim(v_row.raw->>''photo''))%'
     or v_src not like '%else image_url%' then
    raise exception '5.4 the importer does not fill an empty image only';
  end if;
  if v_src not like '%0, case when public.is_https_image_url(btrim(v_row.raw->>''photo''))%' then
    raise exception '5.4 the importer insert does not validate the photo';
  end if;
  if (length(v_src) - length(replace(v_src, 'is_https_image_url(btrim(', '')))
       / length('is_https_image_url(btrim(') <> 2 then
    raise exception '5.4 expected exactly two is_https_image_url call sites in the importer';
  end if;
  if v_src not like '%Only admins may import the Lazywait catalog%'
     or v_src not like '%v_addons := public.import_lazywait_addon_groups();%' then
    raise exception '5.4 the importer lost its admin gate or its add-on call';
  end if;

  -- 5.5 Grants: anon cannot call the importer, authenticated can.
  if has_function_privilege('anon', 'public.import_lazywait_catalog()', 'execute') then
    raise exception '5.5 anon can execute import_lazywait_catalog';
  end if;
  if not has_function_privilege('authenticated', 'public.import_lazywait_catalog()', 'execute') then
    raise exception '5.5 authenticated lost execute on import_lazywait_catalog';
  end if;

  -- 5.6 Money path untouched: neither function mentions anything from this file.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('place_order', 'compute_order_snapshot')
     and (p.prosrc like '%is_https_image_url%' or p.prosrc like '%homepage_banners%');
  if v_n <> 0 then raise exception '5.6 a money-path function references this file''s objects'; end if;
end $$;
