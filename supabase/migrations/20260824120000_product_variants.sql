-- ============================================================================
-- Spicy Meal — product_variants: the price tier, made first-class.
--
-- WHAT THIS CLOSES. Lazywait models a menu in three levels:
--
--     category  ->  item  ->  price     (a NAMED tier with its own price_id)
--
-- "Chicken Wings" is one item with two prices, Small and Large. "Coral" is one
-- item with ELEVEN — Spicy Fillet, Regular Zinger, Spicy Fillet + Spicy Zinger,
-- and so on, from 20 to 29 SAR. The local schema had only two of those levels:
-- `categories -> products`, one row, one `price`, one `lazywait_price_id`.
--
-- `import_lazywait_catalog()` bridged the gap by reading `prices->0` and
-- dropping the rest. Measured against the Production catalog cache on
-- 2026-08-24: 61 items carry 147 price rows, so 86 of them — 59% of everything
-- the restaurant sells — could not be ordered, and WHICH one survived was
-- array order. Coral imported at 29.00 with its 20.00 zinger unreachable.
--
-- Worse than hiding them, it mis-tickets the POS. `order_items[].price_id` is
-- how Lazywait knows which tier was sold, and it came from a single column on
-- `products`, so every Coral ever synced would claim to be the same tier.
--
-- This migration adds the missing level as `product_variants`, so the local
-- catalog is shaped exactly like the source it is imported from.
--
-- WHAT STAYS THE SAME.
--   * `products.price` still exists and still means a VAT-INCLUSIVE price. For
--     a product WITH variants it is now the "from" price — the cheapest
--     orderable tier — so every existing reader (menu cards, admin lists,
--     reports) keeps working and simply shows the entry price.
--   * A product with NO variants behaves exactly as it does today and is
--     priced from `products.price`. Nothing about manually-authored products
--     changes.
--   * Supabase stays the runtime source of truth. `place_order` still
--     recomputes every total server-side; a variant is another server-held
--     price, never a client-supplied one.
--
-- NOT APPLIED TO PRODUCTION BY THIS CHANGE. Applying a migration is an owner
-- action (CLAUDE.md §5/§8); this file only defines it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catalog cache — carry the fields the parser now extracts.
--
-- `lazywaitCatalog.ts` learned to read item descriptions (`details{en,ar}`) and
-- the online/active flags that decide whether a record is customer-facing.
-- Without somewhere to put them the pull would keep discarding them.
-- ---------------------------------------------------------------------------
alter table public.lazywait_catalog_items
  add column if not exists description_en text,
  add column if not exists description_ar text,
  add column if not exists show_online    boolean,
  add column if not exists active         boolean;

comment on column public.lazywait_catalog_items.show_online is
  'Lazywait `show_online`. NULL = not stated (treated as visible). FALSE means '
  'POS-only: the record must never reach a customer.';

-- ---------------------------------------------------------------------------
-- 2. product_variants — one row per Lazywait price.
--
-- `price` is VAT-INCLUSIVE, matching `products.price`. The catalog delivers a
-- NET figure (`price_excl_vat`); the importer below grosses it up using
-- `app_settings.vat_percentage`, so the VAT rate has exactly one home.
-- ---------------------------------------------------------------------------
create table if not exists public.product_variants (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references public.products(id) on delete cascade,
  name_en            text not null,
  name_ar            text not null,
  price              numeric(10,2) not null check (price >= 0),  -- VAT-INCLUSIVE
  calories           integer check (calories is null or calories >= 0),
  sort_order         integer not null default 0,
  is_active          boolean not null default true,
  -- Mapping to the Lazywait price this tier came from. This is the id that
  -- MUST reach `order_items[].price_id` in Create Order.
  lazywait_price_id  text,
  lazywait_price_ref jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists product_variants_product_id_idx
  on public.product_variants(product_id);

-- One local variant per Lazywait price, so a re-import updates in place rather
-- than accumulating duplicates. Partial: hand-authored variants carry no
-- Lazywait id and must not collide with each other.
create unique index if not exists product_variants_lazywait_price_id_key
  on public.product_variants(lazywait_price_id)
  where lazywait_price_id is not null;

drop trigger if exists set_product_variants_updated_at on public.product_variants;
create trigger set_product_variants_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

-- RLS: identical posture to `products` — everyone reads active rows, staff read
-- everything, only admins write.
alter table public.product_variants enable row level security;
grant select on public.product_variants to anon, authenticated;
grant insert, update, delete on public.product_variants to authenticated;

drop policy if exists product_variants_admin_write on public.product_variants;
create policy product_variants_admin_write on public.product_variants
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists product_variants_select_public on public.product_variants;
create policy product_variants_select_public on public.product_variants
  for select to anon, authenticated
  using (is_active or public.is_staff());

comment on table public.product_variants is
  'A named price tier of a product — the local mirror of a Lazywait item price '
  '(Small/Large, Spicy/Regular). `price` is VAT-inclusive. `lazywait_price_id` '
  'is what Create Order sends as order_items[].price_id.';

-- ---------------------------------------------------------------------------
-- 3. order_items — record WHICH tier was sold.
--
-- Names are snapshots for the same reason `name_en` already is: a receipt must
-- keep reading "Chicken Wings — Large" after the menu is re-imported. The id
-- is a reference (set null on delete) exactly like `product_id`.
-- ---------------------------------------------------------------------------
alter table public.order_items
  add column if not exists variant_id      uuid references public.product_variants(id) on delete set null,
  add column if not exists variant_name_en text,
  add column if not exists variant_name_ar text;

create index if not exists order_items_variant_id_idx
  on public.order_items(variant_id);

comment on column public.order_items.variant_id is
  'The product_variants row this line was priced from, when the product has '
  'tiers. NULL for a product with no variants — that line is priced from '
  'products.price, exactly as before variants existed.';

-- The customer-facing read grant must cover the new snapshot columns, or a
-- customer reading their own order sees the line without its tier.
grant select (variant_id, variant_name_en, variant_name_ar)
  on public.order_items to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Mapping RPCs learn the `variant` entity.
--
-- An admin can now confirm/clear the Lazywait price behind one tier, the same
-- way they already do for a branch, category, product, group or add-on. Still
-- admin-only, still writes ONLY the id columns — never a local name or price.
-- ---------------------------------------------------------------------------
create or replace function public.set_lazywait_mapping(
  p_entity     text,
  p_local_id   uuid,
  p_lazywait_id text,
  p_price_ref  jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   text := nullif(btrim(p_lazywait_id), '');
  v_hit  boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit Lazywait mappings' using errcode = '42501';
  end if;
  if v_id is null then
    raise exception 'lazywait id must not be empty' using errcode = '22023';
  end if;

  if p_entity = 'branch' then
    update public.branches set lazywait_branch_id = v_id where id = p_local_id;
  elsif p_entity = 'category' then
    update public.categories set lazywait_category_id = v_id where id = p_local_id;
  elsif p_entity = 'product' then
    update public.products set
      lazywait_item_id  = v_id,
      lazywait_price_id = case when p_price_ref is not null
                               then nullif(p_price_ref->>'price_id', '')
                               else lazywait_price_id end,
      lazywait_price_ref = case when p_price_ref is not null
                               then p_price_ref else lazywait_price_ref end
    where id = p_local_id;
  elsif p_entity = 'variant' then
    update public.product_variants set
      lazywait_price_id  = v_id,
      lazywait_price_ref = coalesce(p_price_ref, lazywait_price_ref)
    where id = p_local_id;
  elsif p_entity = 'modifier_group' then
    update public.modifier_groups set lazywait_group_id = v_id where id = p_local_id;
  elsif p_entity = 'modifier' then
    update public.modifiers set lazywait_addon_id = v_id where id = p_local_id;
  else
    raise exception 'unknown mapping entity: %', p_entity using errcode = '22023';
  end if;

  get diagnostics v_hit = row_count;
  if not v_hit then
    raise exception 'local % record not found: %', p_entity, p_local_id using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.set_lazywait_mapping(text, uuid, text, jsonb) from public, anon;
grant execute on function public.set_lazywait_mapping(text, uuid, text, jsonb) to authenticated;

create or replace function public.clear_lazywait_mapping(
  p_entity   text,
  p_local_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit Lazywait mappings' using errcode = '42501';
  end if;

  if p_entity = 'branch' then
    update public.branches set lazywait_branch_id = null where id = p_local_id;
  elsif p_entity = 'category' then
    update public.categories set lazywait_category_id = null where id = p_local_id;
  elsif p_entity = 'product' then
    update public.products set lazywait_item_id = null, lazywait_price_id = null,
      lazywait_price_ref = null where id = p_local_id;
  elsif p_entity = 'variant' then
    update public.product_variants set lazywait_price_id = null,
      lazywait_price_ref = null where id = p_local_id;
  elsif p_entity = 'modifier_group' then
    update public.modifier_groups set lazywait_group_id = null where id = p_local_id;
  elsif p_entity = 'modifier' then
    update public.modifiers set lazywait_addon_id = null where id = p_local_id;
  else
    raise exception 'unknown mapping entity: %', p_entity using errcode = '22023';
  end if;
end $$;

revoke all on function public.clear_lazywait_mapping(text, uuid) from public, anon;
grant execute on function public.clear_lazywait_mapping(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. import_lazywait_catalog() — rewritten for the three-level shape.
--
-- Per Lazywait item: ONE product, and ONE product_variant per price row. The
-- product's own `price` becomes the cheapest orderable tier, so a menu card
-- reads as a "from" price and every existing consumer of `products.price`
-- keeps working untouched.
--
-- FOUR THINGS THE OLD VERSION GOT WRONG, all fixed here:
--
--   a. It read `prices->0->>'price_with_vat'`. Spreadsheet-sourced items — 126
--      of the 147 Production price rows — do not carry that key at all, so the
--      price resolved to 0 and `v_active := ... and v_price > 0` made EVERY
--      product inactive. That is why the menu would not import. The money is in
--      `price_excl_vat` (Lazywait's `price`), and it is NET, so it is grossed
--      up here with `app_settings.vat_percentage` rather than a literal 1.15.
--   b. It kept only the first price. Now every price becomes a variant.
--   c. It ignored `show_online`. Lazywait marks POS-only records — the "Offers"
--      category, "Extra Bread", "Ranch Sauce", the "Change to Wedgez" upgrade —
--      and those must never reach a customer. Visibility is inherited:
--      category -> item -> price, and anything hidden upstream is hidden here.
--   d. It never read `details{en,ar}`, so every imported product had an empty
--      description even though the POS held one.
--
-- Still "replace" semantics: anything absent from the latest pull is
-- DEACTIVATED, never deleted, so order-history FKs survive and the change is
-- reversible. Still admin-only, SECURITY DEFINER, pinned search_path.
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

  update public.categories set is_active = false, updated_at = now()
  where is_active = true
    and lazywait_category_id is distinct from '__lw_uncategorized__'
    and (lazywait_category_id is null
         or lazywait_category_id not in (select lazywait_id from public.lazywait_catalog_items where entity_type = 'category'));
  get diagnostics v_cat_deactivated = row_count;

  return jsonb_build_object(
    'categories', jsonb_build_object('created', v_cat_created, 'updated', v_cat_updated, 'deactivated', v_cat_deactivated),
    'products',   jsonb_build_object('created', v_prod_created, 'updated', v_prod_updated, 'deactivated', v_prod_deactivated),
    'variants',   jsonb_build_object('created', v_var_created, 'updated', v_var_updated, 'deactivated', v_var_deactivated),
    'branches',   jsonb_build_object('created', v_branch_created, 'updated', v_branch_updated)
  );
end $$;

revoke all on function public.import_lazywait_catalog() from public, anon;
grant execute on function public.import_lazywait_catalog() to authenticated;
