-- ============================================================================
-- Menu display order — reorder_categories / reorder_products.
--
-- Covers 20260827150000_menu_display_order.sql.
--
-- WHAT THESE FUNCTIONS ARE FOR. `categories.sort_order` and
-- `products.sort_order` were already honoured on the read side long before
-- anything could write them: both catalog fetches `.order('sort_order')` and
-- buildMenuSections sorts categories by it. Every product sat at 0, so item
-- order within a category was whatever Postgres returned for a tied sort — not
-- stable between queries. These two RPCs are the missing write side.
--
-- THE PROPERTY THAT MATTERS, and why it is an RPC at all: reordering is a
-- whole-list operation, so it must be ONE statement in ONE transaction. Ranks
-- come from ARRAY POSITION (`with ordinality`), never from a client-supplied
-- integer, which is what makes gaps and duplicate ranks impossible rather than
-- merely unlikely. Case 3 and case 6 are the ones that would catch a rewrite
-- back to per-row client updates.
--
-- BOTH ARE SECURITY DEFINER, so the internal `is_admin()` gate is the only
-- thing standing between any authenticated customer and the ability to
-- rearrange the restaurant's menu. Case 2 is therefore not a formality.
--
-- Runs against a throwaway chain-applied Postgres. Every case raises on
-- failure, so the script aborts non-zero; a clean run prints the final notice
-- and commits nothing.
-- ============================================================================
begin;

\set admin    '''00000000-0000-0000-0000-0000000d0001'''
\set customer '''00000000-0000-0000-0000-0000000d0002'''

\set cat_a '''c0000000-0000-0000-0000-0000000000a1'''
\set cat_b '''c0000000-0000-0000-0000-0000000000b1'''
\set cat_c '''c0000000-0000-0000-0000-0000000000c1'''

\set p_a1 '''d0000000-0000-0000-0000-0000000000a1'''
\set p_a2 '''d0000000-0000-0000-0000-0000000000a2'''
\set p_a3 '''d0000000-0000-0000-0000-0000000000a3'''
\set p_b1 '''d0000000-0000-0000-0000-0000000000b1'''

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, email) values (:admin, 'admin@x'), (:customer, 'cust@x');

insert into public.profiles (id, role, full_name, phone_number) values
  (:admin,    'admin',    'Admin',    '+966500000001'),
  (:customer, 'customer', 'Customer', '+966500000002')
on conflict (id) do update set role = excluded.role;

-- Every category and product starts at sort_order 0 — the exact live shape
-- this feature exists to fix (55 of 55 active products measured at 0).
insert into public.categories (id, name_en, name_ar, sort_order, is_active) values
  (:cat_a, 'Sides',      'أطباق جانبية', 0, true),
  (:cat_b, 'Sandwiches', 'ساندويتش',     0, true),
  (:cat_c, 'Meals',      'وجبات',        0, true);

insert into public.products (id, category_id, name_en, name_ar, price, sort_order, is_active) values
  (:p_a1, :cat_a, 'Fries',        'بطاطس',        7.00, 0, true),
  (:p_a2, :cat_a, 'Wings',        'أجنحة',        7.00, 0, true),
  (:p_a3, :cat_a, 'Cheese fries', 'بطاطس بالجبن', 7.00, 0, true),
  (:p_b1, :cat_b, 'Burger',       'برجر',        23.00, 7, true);

-- ---- 1. The functions exist with the expected signatures -------------------
do $$
declare v_missing text;
begin
  select string_agg(x, ', ') into v_missing from (
    select unnest(array['reorder_categories', 'reorder_products']) as x
    except
    select p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  ) t;
  if v_missing is not null then
    raise exception 'FAIL 1: missing function(s): %', v_missing;
  end if;
end $$;

-- ---- 2. THE GATE: a non-admin cannot rearrange the menu --------------------
-- Both are SECURITY DEFINER and granted to `authenticated`, so without the
-- internal is_admin() check any signed-in customer could reorder the menu.
select set_config('test.auth_uid', :customer, true);
select set_config('test.is_admin', 'false', true);

do $$
begin
  perform public.reorder_categories(array['c0000000-0000-0000-0000-0000000000a1']::uuid[]);
  raise exception 'FAIL 2: a non-admin was allowed to reorder categories';
exception
  when insufficient_privilege then null;  -- expected
end $$;

do $$
begin
  perform public.reorder_products(
    'c0000000-0000-0000-0000-0000000000a1'::uuid,
    array['d0000000-0000-0000-0000-0000000000a1']::uuid[]);
  raise exception 'FAIL 2: a non-admin was allowed to reorder products';
exception
  when insufficient_privilege then null;  -- expected
end $$;

-- Nothing moved.
do $$
declare v_n int;
begin
  -- Scoped to THIS suite's fixtures: seed.sql ships its own categories with
  -- non-zero sort_order, and counting those would fail a correct function.
  select count(*) into v_n from public.categories
   where id in ('c0000000-0000-0000-0000-0000000000a1'::uuid,
                'c0000000-0000-0000-0000-0000000000b1'::uuid,
                'c0000000-0000-0000-0000-0000000000c1'::uuid)
     and sort_order <> 0;
  if v_n <> 0 then
    raise exception 'FAIL 2: a refused call still wrote % categor(y/ies)', v_n;
  end if;
end $$;

-- ---- 3. Admin reorder assigns 1..N BY ARRAY POSITION -----------------------
select set_config('test.auth_uid', :admin, true);
select set_config('test.is_admin', 'true', true);

select public.reorder_categories(array[
  'c0000000-0000-0000-0000-0000000000c1',
  'c0000000-0000-0000-0000-0000000000a1',
  'c0000000-0000-0000-0000-0000000000b1']::uuid[]);

do $$
declare v_got text;
begin
  select string_agg(name_en || '=' || sort_order, ',' order by sort_order)
    into v_got from public.categories
   where id in ('c0000000-0000-0000-0000-0000000000a1'::uuid,
                'c0000000-0000-0000-0000-0000000000b1'::uuid,
                'c0000000-0000-0000-0000-0000000000c1'::uuid);
  if v_got <> 'Meals=1,Sides=2,Sandwiches=3' then
    raise exception 'FAIL 3: expected Meals=1,Sides=2,Sandwiches=3 got %', v_got;
  end if;
end $$;

-- ---- 4. Products reorder, scoped to one category ---------------------------
select public.reorder_products(
  'c0000000-0000-0000-0000-0000000000a1'::uuid,
  array['d0000000-0000-0000-0000-0000000000a3',
        'd0000000-0000-0000-0000-0000000000a1',
        'd0000000-0000-0000-0000-0000000000a2']::uuid[]);

do $$
declare v_got text;
begin
  select string_agg(name_en || '=' || sort_order, ',' order by sort_order)
    into v_got from public.products
   where category_id = 'c0000000-0000-0000-0000-0000000000a1'::uuid;
  if v_got <> 'Cheese fries=1,Fries=2,Wings=3' then
    raise exception 'FAIL 4: expected Cheese fries=1,Fries=2,Wings=3 got %', v_got;
  end if;
end $$;

-- Another category is untouched — its product keeps the 7 it started with.
do $$
declare v_n int;
begin
  select sort_order into v_n from public.products
   where id = 'd0000000-0000-0000-0000-0000000000b1'::uuid;
  if v_n <> 7 then
    raise exception 'FAIL 4: a scoped reorder changed another category (Burger=%)', v_n;
  end if;
end $$;

-- ---- 5. An id from ANOTHER category is refused, and writes NOTHING ---------
-- Fails loudly rather than reordering the subset that does match: a mismatch
-- means the dashboard's picture is stale (most likely the product was moved to
-- another category in another tab), and a partial write would bake that in.
do $$
begin
  perform public.reorder_products(
    'c0000000-0000-0000-0000-0000000000a1'::uuid,
    array['d0000000-0000-0000-0000-0000000000a1',
          'd0000000-0000-0000-0000-0000000000b1']::uuid[]);
  raise exception 'FAIL 5: a cross-category id was accepted';
exception
  when others then
    if sqlstate <> '22023' then
      raise exception 'FAIL 5: wrong error for cross-category id: % (%)', sqlerrm, sqlstate;
    end if;
end $$;

do $$
declare v_got text;
begin
  select string_agg(name_en || '=' || sort_order, ',' order by sort_order)
    into v_got from public.products
   where category_id = 'c0000000-0000-0000-0000-0000000000a1'::uuid;
  if v_got <> 'Cheese fries=1,Fries=2,Wings=3' then
    raise exception 'FAIL 5: the refused call still wrote (%)', v_got;
  end if;
end $$;

-- ---- 6. Duplicate ids are refused ------------------------------------------
-- A repeated id means the client's list is corrupt. Silently keeping the last
-- occurrence would persist an order the administrator never saw.
do $$
begin
  perform public.reorder_categories(array[
    'c0000000-0000-0000-0000-0000000000a1',
    'c0000000-0000-0000-0000-0000000000a1']::uuid[]);
  raise exception 'FAIL 6: duplicate category ids were accepted';
exception
  when others then
    if sqlstate <> '22023' then
      raise exception 'FAIL 6: wrong error for duplicates: % (%)', sqlerrm, sqlstate;
    end if;
end $$;

do $$
begin
  perform public.reorder_products(
    'c0000000-0000-0000-0000-0000000000a1'::uuid,
    array['d0000000-0000-0000-0000-0000000000a1',
          'd0000000-0000-0000-0000-0000000000a1']::uuid[]);
  raise exception 'FAIL 6: duplicate product ids were accepted';
exception
  when others then
    if sqlstate <> '22023' then
      raise exception 'FAIL 6: wrong error for duplicates: % (%)', sqlerrm, sqlstate;
    end if;
end $$;

-- ---- 7. Null and empty input are no-ops, not errors ------------------------
-- The dashboard can legitimately call these with an empty category.
select public.reorder_categories(null);
select public.reorder_categories(array[]::uuid[]);
select public.reorder_products('c0000000-0000-0000-0000-0000000000a1'::uuid, null);
select public.reorder_products('c0000000-0000-0000-0000-0000000000a1'::uuid, array[]::uuid[]);
select public.reorder_products(null, array['d0000000-0000-0000-0000-0000000000a1']::uuid[]);

do $$
declare v_got text;
begin
  select string_agg(name_en || '=' || sort_order, ',' order by sort_order)
    into v_got from public.products
   where category_id = 'c0000000-0000-0000-0000-0000000000a1'::uuid;
  if v_got <> 'Cheese fries=1,Fries=2,Wings=3' then
    raise exception 'FAIL 7: a no-op call changed the order (%)', v_got;
  end if;
end $$;

-- ---- 8. A partial list reorders only what it names -------------------------
-- Ids absent from the array are LEFT ALONE rather than pushed to the end, so a
-- stale tab cannot silently demote categories it has not heard of.
select public.reorder_categories(array[
  'c0000000-0000-0000-0000-0000000000b1',
  'c0000000-0000-0000-0000-0000000000c1']::uuid[]);

do $$
declare v_sides int;
begin
  select sort_order into v_sides from public.categories
   where id = 'c0000000-0000-0000-0000-0000000000a1'::uuid;
  if v_sides <> 2 then
    raise exception 'FAIL 8: an unnamed category moved (Sides=%)', v_sides;
  end if;
end $$;

-- ---- 9. anon cannot execute either function --------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.reorder_categories(uuid[])', 'execute') then
    raise exception 'FAIL 9: anon can execute reorder_categories';
  end if;
  if has_function_privilege('anon', 'public.reorder_products(uuid, uuid[])', 'execute') then
    raise exception 'FAIL 9: anon can execute reorder_products';
  end if;
  if not has_function_privilege('authenticated', 'public.reorder_categories(uuid[])', 'execute') then
    raise exception 'FAIL 9: authenticated cannot execute reorder_categories';
  end if;
end $$;

do $$ begin raise notice 'menu_display_order_test: ALL CASES PASSED'; end $$;

rollback;
