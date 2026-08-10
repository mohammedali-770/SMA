-- ============================================================================
-- Spicy Meal — server-side modifier selection contract
--
-- `place_order` validates each supplied modifier belongs to the product and is
-- active, but historically did not enforce modifier-group min/max/required
-- cardinality or duplicate modifier IDs. A forged client could therefore create
-- an order that the normal UI would never allow (for example, omit the required
-- Heat Level selection or send two Heat Level values where max_select=1).
--
-- This migration adds a DEFERRED constraint check on newly inserted order items
-- and modifier rows. It runs at transaction commit, after `place_order` has
-- inserted the item and all selected modifiers, so a violation rolls back the
-- entire order transaction (including coupon/loyalty side effects) without
-- changing checkout/payment code.
--
-- INSERT-only on purpose: historical order snapshots must remain readable even
-- if an admin later deactivates/deletes a menu modifier. Menu evolution therefore
-- never retroactively invalidates an old order.
-- ============================================================================

create or replace function public.assert_order_item_modifier_contract(p_order_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_group record;
  v_selected integer;
begin
  if p_order_item_id is null then
    raise exception 'order item id required' using errcode = '22004';
  end if;

  select oi.product_id into v_product_id
    from public.order_items oi
   where oi.id = p_order_item_id;

  if not found then
    raise exception 'order item not found' using errcode = 'P0002';
  end if;

  -- Historical/manual snapshot rows may legitimately have no product FK. There
  -- is no current menu contract to validate in that case.
  if v_product_id is null then
    return;
  end if;

  -- New order modifier rows must carry a live identity. `place_order` always
  -- does; null is only expected later if a historical modifier FK is SET NULL.
  if exists (
    select 1 from public.order_item_modifiers oim
     where oim.order_item_id = p_order_item_id
       and oim.modifier_id is null
  ) then
    raise exception 'A selected modifier is no longer valid for this product'
      using errcode = '22023';
  end if;

  -- A modifier may appear at most once for one order item. Duplicate IDs would
  -- otherwise inflate both price and group cardinality.
  if exists (
    select oim.modifier_id
      from public.order_item_modifiers oim
     where oim.order_item_id = p_order_item_id
       and oim.modifier_id is not null
     group by oim.modifier_id
    having count(*) > 1
  ) then
    raise exception 'The same modifier cannot be selected more than once'
      using errcode = '22023';
  end if;

  -- Every selected modifier must still be active and belong to a group linked
  -- to this product. This duplicates the current place_order membership check at
  -- the final DB boundary so alternate trusted writers cannot bypass it either.
  if exists (
    select 1
      from public.order_item_modifiers oim
      left join public.modifiers m on m.id = oim.modifier_id
      left join public.product_modifier_groups pmg
        on pmg.product_id = v_product_id and pmg.group_id = m.group_id
     where oim.order_item_id = p_order_item_id
       and (m.id is null or not m.is_active or pmg.product_id is null)
  ) then
    raise exception 'A selected modifier is not available for this product'
      using errcode = '22023';
  end if;

  -- Validate every group linked to the product, not only groups the caller sent.
  -- is_required=true implies at least one even if a misconfigured row has
  -- min_select=0; otherwise min_select is authoritative. NULL max means unbound.
  for v_group in
    select g.id, g.min_select, g.max_select, g.is_required
      from public.product_modifier_groups pmg
      join public.modifier_groups g on g.id = pmg.group_id
     where pmg.product_id = v_product_id
  loop
    select count(*)::integer into v_selected
      from public.order_item_modifiers oim
      join public.modifiers m on m.id = oim.modifier_id
     where oim.order_item_id = p_order_item_id
       and m.group_id = v_group.id;

    if v_selected < greatest(coalesce(v_group.min_select, 0), case when v_group.is_required then 1 else 0 end) then
      raise exception 'Required modifier selection is missing or below minimum'
        using errcode = '22023';
    end if;

    if v_group.max_select is not null and v_selected > v_group.max_select then
      raise exception 'Too many modifiers selected from one group'
        using errcode = '22023';
    end if;
  end loop;
end $$;

revoke all on function public.assert_order_item_modifier_contract(uuid)
  from public, anon, authenticated;
grant execute on function public.assert_order_item_modifier_contract(uuid) to service_role;

create or replace function public.enforce_new_order_item_modifier_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_item_id uuid;
begin
  v_order_item_id := case
    when tg_table_name = 'order_items' then new.id
    else new.order_item_id
  end;

  -- Deferred events survive until constraint time. If the item was inserted and
  -- then deleted again in the same transaction (for example a transaction that
  -- aborts/replaces a draft line), there is no committed row left to validate.
  if not exists (select 1 from public.order_items where id = v_order_item_id) then
    return null;
  end if;

  perform public.assert_order_item_modifier_contract(v_order_item_id);
  return null;
end $$;

revoke all on function public.enforce_new_order_item_modifier_contract()
  from public, anon, authenticated;
grant execute on function public.enforce_new_order_item_modifier_contract() to service_role;

-- Deferred + INSERT-only: see header rationale.
drop trigger if exists validate_new_order_item_modifiers_on_item on public.order_items;
create constraint trigger validate_new_order_item_modifiers_on_item
  after insert on public.order_items
  deferrable initially deferred
  for each row execute function public.enforce_new_order_item_modifier_contract();

drop trigger if exists validate_new_order_item_modifiers_on_modifier on public.order_item_modifiers;
create constraint trigger validate_new_order_item_modifiers_on_modifier
  after insert on public.order_item_modifiers
  deferrable initially deferred
  for each row execute function public.enforce_new_order_item_modifier_contract();

comment on function public.assert_order_item_modifier_contract(uuid) is
  'Validates the final modifier selection of a newly-created order item: selected modifiers are unique/active/linked and every linked group satisfies required/min/max cardinality. Called by deferred INSERT-only constraint triggers so violations roll back the order transaction without retroactively validating historical snapshots.';
