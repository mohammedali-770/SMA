-- ---------------------------------------------------------------------------
-- Menu display order — two admin RPCs. NO table change.
--
-- WHY THIS EXISTS. `categories.sort_order` and `products.sort_order` have
-- existed all along and BOTH are already honoured on the read side: the mobile
-- and dashboard catalog fetches both `.order('sort_order')`, and
-- buildMenuSections sorts categories by it. What has never existed is any way
-- for an administrator to SET them. Measured 2026-08-27, read-only:
--
--   categories  5 active, 3 distinct sort_order values (0..4)  -- partly ordered
--   products   55 active, 1 distinct sort_order value  (all 0) -- NOT ordered
--
-- Every product sitting at 0 means the order items appear in within a category
-- is whatever Postgres happens to return for a tied sort. It is not stable
-- between queries, so today nobody — not even the database — decides what the
-- customer sees first.
--
-- WHY AN RPC RATHER THAN CLIENT-SIDE UPDATES. Reordering is inherently a
-- whole-list operation: moving one row changes the rank of every row after it.
-- Doing that as N separate PATCHes would be N round trips that can interleave
-- with another administrator's reorder and leave duplicate or gapped ranks,
-- with no point at which the list is consistent. Each function below writes the
-- entire ordering in ONE statement inside ONE transaction, from a single array,
-- so the list is never observable half-renumbered.
--
-- `with ordinality` is what makes that a single statement: it turns the client's
-- array — which already encodes the intended order by position — directly into
-- the rank, so the server never has to trust a client-computed integer.
-- ---------------------------------------------------------------------------

-- ---- Categories ------------------------------------------------------------
-- p_ids is the full ordered list of category ids. Ranks are assigned 1..N by
-- ARRAY POSITION, so gaps and duplicates are impossible by construction.
--
-- Ids not present in p_ids are left untouched rather than pushed to the end:
-- a partial list is treated as "reorder these", not "delete the rest from the
-- ordering". Callers send the whole list.
--
-- ASYMMETRY WITH reorder_products, deliberate rather than an oversight.
-- reorder_products REFUSES a partial list, because a product moved into a
-- category carries an arbitrary inherited rank and lands silently mid-list. A
-- category created concurrently instead takes the column default 0, so it sorts
-- to the FRONT, where it is immediately visible and one click from correct.
-- Categories are also a handful of rows changed rarely, by one person. If that
-- stops being true, make this symmetric with reorder_products.
create or replace function public.reorder_categories(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Role AND AAL2, the same predicate every other admin write uses. This is a
  -- SECURITY DEFINER function, so it MUST gate internally: without this line it
  -- would let any authenticated caller rearrange the menu.
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;

  -- Reject duplicates outright. A repeated id means the client's list is
  -- corrupt, and silently keeping the last occurrence would persist an order
  -- the administrator never saw.
  if (select count(*) from unnest(p_ids) x) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'duplicate_ids' using errcode = '22023';
  end if;

  update public.categories c
     set sort_order = o.ord,
         updated_at = now()
    from (select id, ordinality::int as ord from unnest(p_ids) with ordinality as t(id, ordinality)) o
   where c.id = o.id
     and c.sort_order is distinct from o.ord;
end $$;

revoke all on function public.reorder_categories(uuid[]) from public, anon;
grant execute on function public.reorder_categories(uuid[]) to authenticated;

-- ---- Products within ONE category -----------------------------------------
-- Scoped to a category on purpose. `products.sort_order` is only ever compared
-- against other products in the SAME category (buildMenuSections groups first,
-- then orders within the group), so a global renumber would be meaningless and
-- would let one category's reorder silently rewrite another's.
--
-- The category scope is also the safety property: the WHERE clause pins
-- category_id, so an id belonging to a different category cannot be moved even
-- if the client sends it.
create or replace function public.reorder_products(p_category_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matched int;
  v_sent    int;
  v_total   int;
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  if p_category_id is null or p_ids is null then
    return;
  end if;

  v_sent := coalesce(array_length(p_ids, 1), 0);

  if v_sent <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'duplicate_ids' using errcode = '22023';
  end if;

  -- Lock the category's rows for the rest of this transaction BEFORE counting.
  -- Without it, a concurrent insert or a product moved into this category
  -- between the count and the update would slip past both checks below.
  perform 1 from public.products
   where category_id = p_category_id
   for update;

  select count(*) into v_total
    from public.products
   where category_id = p_category_id;

  -- Fail LOUDLY when an id does not belong to this category, rather than
  -- silently reordering the subset that does. A mismatch means the dashboard's
  -- picture of the menu is stale — most likely the product was moved to another
  -- category in another tab — and writing a partial order would bake that stale
  -- picture in.
  select count(*) into v_matched
    from public.products p
   where p.category_id = p_category_id
     and p.id = any(p_ids);

  if v_matched <> v_sent then
    raise exception 'ids_not_in_category' using errcode = '22023';
  end if;

  -- The array must be the COMPLETE membership, not merely a valid subset.
  -- Checking only that every id belongs here is not enough: if another
  -- administrator moves a product INTO this category after this dashboard
  -- loaded, a stale reorder renumbers the rows it knows about while the moved
  -- product keeps the rank it inherited from its old category — so two products
  -- collide on one rank and the displayed sequence is decided by the name
  -- tie-break rather than by anybody's intent. Refusing sends the administrator
  -- back for a reload, which is the only way to order a list they can see.
  if v_sent <> v_total then
    raise exception 'incomplete_order' using errcode = '22023';
  end if;

  if v_sent = 0 then
    return;  -- an empty category, correctly described by an empty array
  end if;

  update public.products p
     set sort_order = o.ord,
         updated_at = now()
    from (select id, ordinality::int as ord from unnest(p_ids) with ordinality as t(id, ordinality)) o
   where p.id = o.id
     and p.category_id = p_category_id
     and p.sort_order is distinct from o.ord;
end $$;

revoke all on function public.reorder_products(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_products(uuid, uuid[]) to authenticated;
