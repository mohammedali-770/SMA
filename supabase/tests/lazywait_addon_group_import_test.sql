-- ============================================================================
-- import_lazywait_addon_groups — Lazywait add-on groups become app options
--
-- Written from the shape the 2026-08-26 07:18 pull actually returned, not from
-- the shape the API documentation implies. Two facts from that pull drive the
-- whole design and are pinned here because getting either wrong produces a
-- silent empty result rather than an error:
--
--   * every add-on's own `addons_group_id` is NULL (0 of 10 non-empty), so
--     membership can only be read from the GROUP's `addons_ids`;
--   * one add-on may belong to several groups, while `modifiers.group_id` is
--     NOT NULL — hence one modifier row per (group, add-on) pair.
--
-- Seed fixtures (supabase/seed.sql): product 001 "Spicy Double Beef" already
-- carries a hand-made REQUIRED heat-level group. It is used here to prove the
-- importer never touches what it does not own.
-- ============================================================================
begin;

\set beef '''a0000000-0000-0000-0000-000000000001'''

-- Map the seeded product to a Lazywait item id, then cache a catalog that
-- mirrors the real one: one referenced group, one unreferenced group, and an
-- add-on that belongs to both.
update public.products set lazywait_item_id = 'LW_ITEM_BEEF' where id = :beef;

insert into public.lazywait_catalog_items (entity_type, lazywait_id, name_en, name_ar, prices, active, raw)
values
  ('addon', 'LW_ADDON_MANGO', 'Mango juice', 'عصير مانجو',
   '[{"price_excl_vat": 0, "price_with_vat": null}]'::jsonb, true, '{}'::jsonb),
  ('addon', 'LW_ADDON_COLA', 'Cola', 'كولا',
   '[{"price_excl_vat": 10, "price_with_vat": null}]'::jsonb, true, '{}'::jsonb),
  ('addon', 'LW_ADDON_GROSS', 'Stated gross', 'سعر شامل',
   '[{"price_excl_vat": 10, "price_with_vat": 11.5}]'::jsonb, true, '{}'::jsonb),
  ('addon', 'LW_ADDON_NEG', 'Negative', 'سالب',
   '[{"price_excl_vat": -5, "price_with_vat": null}]'::jsonb, true, '{}'::jsonb);

-- The referenced group. name_en deliberately NULL, as Lazywait sent it.
insert into public.lazywait_catalog_items
  (entity_type, lazywait_id, name_en, name_ar, min_selection, max_selection, multi_max, active, raw)
values
  ('addon_group', 'LW_GROUP_DRINK', null, 'مشروب الوجبة', 1, 1, 1, true,
   '{"addons_ids": ["LW_ADDON_MANGO", "LW_ADDON_COLA", "LW_ADDON_GROSS", "LW_ADDON_NEG", "LW_ADDON_GHOST"]}'::jsonb),
  -- Referenced by nothing: the stray "Test" group from the real catalog.
  ('addon_group', 'LW_GROUP_ORPHAN', null, 'Test', null, null, null, true,
   '{"addons_ids": ["LW_ADDON_MANGO"]}'::jsonb);

insert into public.lazywait_catalog_items (entity_type, lazywait_id, name_en, name_ar, raw)
values ('item', 'LW_ITEM_BEEF', 'Spicy Double Beef', 'لحم حار',
        '{"addons_groups_ids": ["LW_GROUP_DRINK"]}'::jsonb);

do $$
declare
  v_res jsonb;
  v_gid uuid; v_n int; v_max int; v_price numeric; v_txt text;
  v_seed_group_links int;
begin
  select count(*) into v_seed_group_links from public.product_modifier_groups;

  v_res := public.import_lazywait_addon_groups();

  -- ------------------------------------------------------------------ 1.
  -- The unreferenced group is skipped. This is what keeps a stray group out of
  -- every customer's menu, and it is a rule, not a name-match.
  if (v_res->'groups'->>'created')::int <> 1 then
    raise exception 'FAIL 1: expected exactly one group created, got %', v_res->'groups'->>'created';
  end if;
  if (v_res->'groups'->>'skipped_unreferenced')::int <> 1 then
    raise exception 'FAIL 1: expected one unreferenced group skipped, got %',
      v_res->'groups'->>'skipped_unreferenced';
  end if;
  if exists (select 1 from public.modifier_groups where lazywait_group_id = 'LW_GROUP_ORPHAN') then
    raise exception 'FAIL 1: the unreferenced group was imported';
  end if;

  select id into v_gid from public.modifier_groups where lazywait_group_id = 'LW_GROUP_DRINK';
  if v_gid is null then raise exception 'FAIL 1: the referenced group was not created'; end if;

  -- ------------------------------------------------------------------ 2.
  -- name_en was NULL in the catalog and the column is NOT NULL. Falling back to
  -- Arabic is what stops an English-locale customer reading a blank heading.
  select name_en into v_txt from public.modifier_groups where id = v_gid;
  if coalesce(v_txt,'') = '' then
    raise exception 'FAIL 2: group name_en is blank — the locale fallback did not fire';
  end if;
  if v_txt <> 'مشروب الوجبة' then
    raise exception 'FAIL 2: expected name_en to fall back to the Arabic name, got %', v_txt;
  end if;

  -- ------------------------------------------------------------------ 3.
  -- min 1 / max 1 becomes a required single-select.
  select is_required::text, min_select, max_select into v_txt, v_n, v_max
    from public.modifier_groups where id = v_gid;
  if v_txt <> 'true' then raise exception 'FAIL 3: min_selection 1 must mark the group required'; end if;
  if v_n <> 1 then raise exception 'FAIL 3: min_select is %, expected 1', v_n; end if;
  if v_max <> 1 then raise exception 'FAIL 3: max_select is %, expected 1', v_max; end if;

  -- ------------------------------------------------------------------ 4.
  -- Four real add-ons imported; the fifth is named by the group but absent from
  -- the cache, so it is counted and skipped rather than invented.
  select count(*) into v_n from public.modifiers where group_id = v_gid;
  if v_n <> 4 then raise exception 'FAIL 4: expected 4 options in the group, got %', v_n; end if;
  if (v_res->'modifiers'->>'missing_from_cache')::int <> 1 then
    raise exception 'FAIL 4: the add-on missing from the cache was not counted, got %',
      v_res->'modifiers'->>'missing_from_cache';
  end if;

  -- ------------------------------------------------------------------ 5.
  -- Prices follow the same rule as products and variants: a stated gross wins,
  -- otherwise the net is grossed up, and nothing is ever negative.
  select price into v_price from public.modifiers
    where group_id = v_gid and lazywait_addon_id = 'LW_ADDON_MANGO';
  if v_price <> 0 then raise exception 'FAIL 5: a 0 add-on priced %, expected 0', v_price; end if;

  select price into v_price from public.modifiers
    where group_id = v_gid and lazywait_addon_id = 'LW_ADDON_GROSS';
  if v_price <> 11.50 then
    raise exception 'FAIL 5: a stated gross must be used verbatim, got %', v_price;
  end if;

  select price into v_price from public.modifiers
    where group_id = v_gid and lazywait_addon_id = 'LW_ADDON_COLA';
  if v_price <= 10 then
    raise exception 'FAIL 5: a net-only add-on must be grossed up by VAT, got %', v_price;
  end if;

  select price into v_price from public.modifiers
    where group_id = v_gid and lazywait_addon_id = 'LW_ADDON_NEG';
  if v_price <> 0 then
    raise exception 'FAIL 5: a negative price must clamp to 0, got %', v_price;
  end if;

  -- ------------------------------------------------------------------ 6.
  -- The group is attached to the mapped product, and the seeded hand-made link
  -- is untouched.
  if not exists (
    select 1 from public.product_modifier_groups
    where product_id = 'a0000000-0000-0000-0000-000000000001' and group_id = v_gid
  ) then
    raise exception 'FAIL 6: the group was not attached to the mapped product';
  end if;
  select count(*) into v_n from public.product_modifier_groups;
  if v_n <> v_seed_group_links + 1 then
    raise exception 'FAIL 6: link count moved from % to %, expected exactly one new link',
      v_seed_group_links, v_n;
  end if;

  raise notice 'lazywait_addon_group_import_test (import): all assertions passed';
end $$;

-- ---------------------------------------------------------------------------
-- 7. An add-on in TWO groups gets one modifier row per group.
--
--    modifiers.group_id is NOT NULL, so a single row cannot serve both. This
--    is the reason lazywait_addon_id is deliberately NOT unique across the
--    table, and the reason the unique index is on (group_id, lazywait_addon_id).
-- ---------------------------------------------------------------------------
do $$
declare v_res jsonb; v_n int;
begin
  -- Reference the orphan group from the item too, so both groups now apply.
  update public.lazywait_catalog_items
     set raw = '{"addons_groups_ids": ["LW_GROUP_DRINK", "LW_GROUP_ORPHAN"]}'::jsonb
   where entity_type = 'item' and lazywait_id = 'LW_ITEM_BEEF';

  v_res := public.import_lazywait_addon_groups();

  select count(*) into v_n from public.modifiers where lazywait_addon_id = 'LW_ADDON_MANGO';
  if v_n <> 2 then
    raise exception 'FAIL 7: an add-on in two groups needs one row per group, got %', v_n;
  end if;
  select count(distinct group_id) into v_n from public.modifiers where lazywait_addon_id = 'LW_ADDON_MANGO';
  if v_n <> 2 then raise exception 'FAIL 7: the two rows are not in distinct groups'; end if;

  raise notice 'lazywait_addon_group_import_test (multi-group): all assertions passed';
end $$;

-- ---------------------------------------------------------------------------
-- 8. Re-running imports nothing new, and a dropped add-on is DEACTIVATED, not
--    deleted — an order_item_modifiers row references it for the life of the
--    order.
-- ---------------------------------------------------------------------------
do $$
declare v_res jsonb; v_before int; v_n int; v_act boolean;
begin
  select count(*) into v_before from public.modifiers;

  v_res := public.import_lazywait_addon_groups();
  if (v_res->'groups'->>'created')::int <> 0 or (v_res->'modifiers'->>'created')::int <> 0 then
    raise exception 'FAIL 8: a repeat import created rows — groups %, modifiers %',
      v_res->'groups'->>'created', v_res->'modifiers'->>'created';
  end if;
  select count(*) into v_n from public.modifiers;
  if v_n <> v_before then
    raise exception 'FAIL 8: modifier count moved from % to % on a repeat import', v_before, v_n;
  end if;

  -- Drop Cola from the group in the catalog and re-import.
  update public.lazywait_catalog_items
     set raw = '{"addons_ids": ["LW_ADDON_MANGO", "LW_ADDON_GROSS", "LW_ADDON_NEG"]}'::jsonb
   where entity_type = 'addon_group' and lazywait_id = 'LW_GROUP_DRINK';

  v_res := public.import_lazywait_addon_groups();

  select count(*) into v_n from public.modifiers where lazywait_addon_id = 'LW_ADDON_COLA';
  if v_n <> 1 then raise exception 'FAIL 8: the dropped option was deleted, not deactivated'; end if;
  select is_active into v_act from public.modifiers where lazywait_addon_id = 'LW_ADDON_COLA';
  if v_act then raise exception 'FAIL 8: the dropped option is still active'; end if;
  if (v_res->'modifiers'->>'deactivated')::int < 1 then
    raise exception 'FAIL 8: the deactivation was not counted';
  end if;

  raise notice 'lazywait_addon_group_import_test (idempotence + removal): all assertions passed';
end $$;

-- ---------------------------------------------------------------------------
-- 9. Detaching the group in Lazywait removes the product link.
-- ---------------------------------------------------------------------------
do $$
declare v_res jsonb; v_gid uuid;
begin
  select id into v_gid from public.modifier_groups where lazywait_group_id = 'LW_GROUP_DRINK';

  update public.lazywait_catalog_items
     set raw = '{"addons_groups_ids": ["LW_GROUP_ORPHAN"]}'::jsonb
   where entity_type = 'item' and lazywait_id = 'LW_ITEM_BEEF';

  v_res := public.import_lazywait_addon_groups();

  if exists (select 1 from public.product_modifier_groups where group_id = v_gid) then
    raise exception 'FAIL 9: the group stayed attached after Lazywait dropped it';
  end if;
  if (v_res->'links'->>'removed')::int < 1 then
    raise exception 'FAIL 9: the detachment was not counted';
  end if;

  -- The hand-made seed link must have survived every pass above.
  if not exists (
    select 1 from public.product_modifier_groups pmg
    join public.modifier_groups g on g.id = pmg.group_id
    where g.lazywait_group_id is null
  ) then
    raise exception 'FAIL 9: a hand-made group link was destroyed by the importer';
  end if;

  raise notice 'lazywait_addon_group_import_test (detach): all assertions passed';
end $$;

-- ---------------------------------------------------------------------------
-- 10. A cache with no items must NOT be read as "Lazywait dropped everything".
--
--     The detach pass runs over every Lazywait-owned group, not just the ones
--     an item still references — that is what makes case 9 work. The cost of
--     that reach is that an empty or partial cache would otherwise strip every
--     option from the menu in one import, which is the same failure the catalog
--     pull guards against by refusing to prune on an empty response.
-- ---------------------------------------------------------------------------
do $$
declare v_res jsonb; v_links_before int; v_links_after int;
begin
  select count(*) into v_links_before from public.product_modifier_groups;
  if v_links_before = 0 then
    raise exception 'FAIL 10: the fixture left no links, so this case would pass vacuously';
  end if;

  delete from public.lazywait_catalog_items where entity_type = 'item';
  v_res := public.import_lazywait_addon_groups();

  select count(*) into v_links_after from public.product_modifier_groups;
  if v_links_after <> v_links_before then
    raise exception 'FAIL 10: an item-less cache stripped % link(s) — the guard did not hold',
      v_links_before - v_links_after;
  end if;
  if (v_res->'links'->>'removed')::int <> 0 then
    raise exception 'FAIL 10: the detach pass ran against an empty cache';
  end if;

  raise notice 'lazywait_addon_group_import_test (empty-cache guard): all assertions passed';
end $$;

rollback;
