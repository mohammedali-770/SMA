-- ============================================================================
-- Spicy Meal — server-side modifier selection contract for CASH orders
--
-- `place_order` validates each supplied modifier belongs to the product and is
-- active, but historically did not enforce modifier-group min/max/required
-- cardinality or duplicate modifier IDs. A forged cash-order client could
-- therefore create an order that the normal UI would never allow.
--
-- This migration adds a DEFERRED constraint check on newly inserted CASH order
-- items and modifier rows. It runs at transaction commit, after the order item and
-- all selected modifiers exist, so a violation rolls back the whole transaction.
--
-- IMPORTANT PAYMENT BOUNDARY: online checkout sessions are intentionally NOT
-- revalidated here. Their authorized snapshot may be finalized only after an
-- external payment has already been captured; re-checking that snapshot against
-- mutable live menu data (for example after an admin deactivates a modifier)
-- could leave a charged customer without an order. The payment/Tap path remains
-- frozen and unchanged.
--
-- INSERT-only on purpose: historical order snapshots must remain readable even
-- if menu configuration changes later.
-- ============================================================================

create or replace function public.assert_order_item_modifier_contract(p_order_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_payment_method text;
  v_group record;
  v_selected integer;
begin
  if p_order_item_id is null then
    raise exception 'order item id required' using errcode = '22004';
  end if;

  select oi.product_id, o.payment_method
    into v_product_id, v_payment_method
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.id = p_order_item_id;

  if not found then
    raise exception 'order item not found' using errcode = 'P0002';
  end if;

  -- Preserve the already-authorized online checkout snapshot contract. Online
  -- finalization must not fail after capture merely because mutable catalog data
  -- changed after the session was created/validated.
  if v_payment_method is distinct from 'cash' then
    return;
  end if;

  if v_product_id is null then
    return;
  end if;

  if exists (
    select 1 from public.order_item_modifiers oim
     where oim.order_item_id = p_order_item_id
       and oim.modifier_id is null
  ) then
    raise exception 'A selected modifier is no longer valid for this product'
      using errcode = '22023';
  end if;

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
  if tg_table_name = 'order_items' then
    v_order_item_id := new.id;
  elsif tg_table_name = 'order_item_modifiers' then
    v_order_item_id := new.order_item_id;
  else
    raise exception 'Unexpected modifier contract trigger table: %', tg_table_name
      using errcode = '55000';
  end if;

  if not exists (select 1 from public.order_items where id = v_order_item_id) then
    return null;
  end if;

  perform public.assert_order_item_modifier_contract(v_order_item_id);
  return null;
end $$;

revoke all on function public.enforce_new_order_item_modifier_contract()
  from public, anon, authenticated;
grant execute on function public.enforce_new_order_item_modifier_contract() to service_role;

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
  'For newly-created CASH order items only: validates unique/active/linked modifiers and required/min/max group cardinality. Online checkout snapshots are deliberately excluded so post-capture finalization is not revalidated against mutable menu data. Deferred INSERT-only triggers preserve transaction atomicity and historical snapshots (20260810132000).';
