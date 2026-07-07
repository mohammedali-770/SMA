-- ============================================================================
-- Spicy Meal — loyalty: server-authoritative earning + redemption.
--
-- Supersedes the earlier place_order (which left loyalty out of scope). This
-- migration:
--   * redefines place_order() with a p_loyalty_points argument. The server
--     validates the request against the customer's real balance and the
--     app_settings thresholds, caps the discount so the total can't go
--     negative, then atomically deducts the redeemed points and credits the
--     points earned on the payable total.
--   * adds adjust_loyalty_points() for admin point management (the ledger UI).
--
-- Both run SECURITY DEFINER (as the table owner), so they can write the
-- loyalty_points column that a column-level GRANT hides from clients — the only
-- sanctioned path to change a balance.
-- ============================================================================

-- Drop the previous 6-argument signature so there is exactly one place_order.
drop function if exists public.place_order(uuid, public.order_type, jsonb, uuid, text, text);

create or replace function public.place_order(
  p_branch_id      uuid,
  p_order_type     public.order_type,
  p_items          jsonb,
  p_address_id     uuid    default null,
  p_coupon_code    text    default null,
  p_notes          text    default null,
  p_loyalty_points integer default 0
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer     uuid := auth.uid();
  v_profile      public.profiles;
  v_branch       public.branches;
  v_settings     public.app_settings;
  v_address      public.addresses;
  v_item         jsonb;
  v_product      public.products;
  v_modifier     public.modifiers;
  v_qty          integer;
  v_unit_price   numeric(10,2);
  v_mod_id       uuid;
  v_subtotal     numeric(10,2) := 0;
  v_delivery_fee numeric(10,2) := 0;
  v_discount     numeric(10,2) := 0;
  v_vat          numeric(10,2) := 0;
  v_total        numeric(10,2);
  v_coupon       record;
  v_order        public.orders;
  v_item_id      uuid;
  -- loyalty
  v_loyalty_req      integer := greatest(0, coalesce(p_loyalty_points, 0));
  v_loyalty_redeemed integer := 0;
  v_loyalty_discount numeric(10,2) := 0;
  v_points_earned    integer := 0;
  v_pre_loyalty      numeric(10,2);
  v_per_point        numeric(10,4);
  v_per_riyal        numeric(10,2);
  v_loyalty_on       boolean;
begin
  if v_customer is null then
    raise exception 'Authentication is required to place an order' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cannot place an order with an empty cart';
  end if;

  select * into v_profile  from public.profiles    where id = v_customer;
  select * into v_settings from public.app_settings where id = true;

  select * into v_branch from public.branches where id = p_branch_id;
  if not found or not v_branch.is_active then
    raise exception 'The selected branch is not available';
  end if;

  -- Delivery requires an address that belongs to the customer.
  if p_order_type = 'delivery' then
    if p_address_id is null then
      raise exception 'A delivery address is required for delivery orders';
    end if;
    select * into v_address from public.addresses
      where id = p_address_id and customer_id = v_customer;
    if not found then
      raise exception 'Delivery address not found for this customer';
    end if;
    v_delivery_fee := v_branch.delivery_fee;
  end if;

  -- ---- Pass 1: validate items and compute the merchandise subtotal ---------
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item ->> 'quantity')::int, 0);
    if v_qty <= 0 then
      raise exception 'Invalid item quantity';
    end if;

    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid;
    if not found or not v_product.is_active then
      raise exception 'A product in your cart is no longer on the menu';
    end if;

    if exists (
      select 1 from public.branch_product_availability bpa
      where bpa.branch_id = p_branch_id
        and bpa.product_id = v_product.id
        and bpa.is_available = false
    ) then
      raise exception 'A product in your cart is not available at the selected branch';
    end if;

    v_unit_price := v_product.price;

    if v_item ? 'modifier_ids' and jsonb_typeof(v_item -> 'modifier_ids') = 'array' then
      for v_mod_id in
        select mid::uuid from jsonb_array_elements_text(v_item -> 'modifier_ids') as t(mid)
      loop
        select m.* into v_modifier
        from public.modifiers m
        join public.product_modifier_groups pmg on pmg.group_id = m.group_id
        where m.id = v_mod_id and m.is_active and pmg.product_id = v_product.id;
        if not found then
          raise exception 'An invalid modifier was supplied for a product';
        end if;
        v_unit_price := v_unit_price + v_modifier.price;
      end loop;
    end if;

    v_subtotal := v_subtotal + (v_unit_price * v_qty);
  end loop;

  -- ---- Coupon (server-validated) -------------------------------------------
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select * into v_coupon from public.validate_coupon(p_coupon_code, v_subtotal);
    if not v_coupon.valid then
      raise exception 'Coupon rejected: %', v_coupon.message;
    end if;
    v_discount := v_coupon.discount_amount;
  end if;

  -- ---- Delivery minimum (on merchandise subtotal) --------------------------
  if p_order_type = 'delivery' and v_subtotal < v_branch.min_delivery_order then
    raise exception 'Order subtotal is below the branch delivery minimum of %',
      v_branch.min_delivery_order;
  end if;

  -- ---- Loyalty redemption (server-authoritative) ---------------------------
  -- Amount the order can absorb before any loyalty discount.
  v_pre_loyalty := greatest(0, v_subtotal + v_delivery_fee - v_discount);
  v_per_point   := coalesce(v_settings.discount_per_point, 0.10);
  v_per_riyal   := coalesce(v_settings.points_per_riyal, 1);
  v_loyalty_on  := coalesce(v_settings.loyalty_enabled, false);

  if v_loyalty_on and v_loyalty_req > 0 and v_per_point > 0 then
    -- Cap the requested points to the real balance and to what the order can
    -- absorb, so no points are spent on discount the order can't hold.
    v_loyalty_redeemed := least(
      v_loyalty_req,
      coalesce(v_profile.loyalty_points, 0),
      floor(v_pre_loyalty / v_per_point)::int
    );
    -- Enforce the configured minimum; below it, redeem nothing.
    if v_loyalty_redeemed < coalesce(v_settings.min_points_to_redeem, 0) then
      v_loyalty_redeemed := 0;
    end if;
    v_loyalty_discount := least(round(v_loyalty_redeemed * v_per_point, 2), v_pre_loyalty);
  end if;

  v_total := greatest(0, v_subtotal + v_delivery_fee - v_discount - v_loyalty_discount);
  -- VAT is inclusive in KSA: extract the VAT portion of the payable total.
  v_vat := round(
    v_total - (v_total / (1 + coalesce(v_settings.vat_percentage, 15) / 100.0)), 2);

  -- Points are earned on the payable total (after every discount).
  if v_loyalty_on then
    v_points_earned := floor(v_total * v_per_riyal)::int;
  end if;

  -- ---- Create the order (payment stays pending) ----------------------------
  insert into public.orders (
    customer_id, customer_name, customer_phone,
    branch_id, branch_name_en, branch_name_ar,
    status, order_type, subtotal, delivery_fee, discount_amount,
    loyalty_discount_amount, vat_amount, total, payment_status,
    coupon_code, notes, address_id, address_snapshot
  ) values (
    v_customer, v_profile.full_name, v_profile.phone_number,
    v_branch.id, v_branch.name_en, v_branch.name_ar,
    'received', p_order_type, v_subtotal, v_delivery_fee, v_discount,
    v_loyalty_discount, v_vat, v_total, 'pending',
    case when v_discount > 0 then upper(trim(p_coupon_code)) else null end,
    p_notes, v_address.id,
    case when v_address.id is not null then to_jsonb(v_address) else null end
  )
  returning * into v_order;

  -- ---- Pass 2: persist items + their modifiers -----------------------------
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item ->> 'quantity')::int;
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid;

    insert into public.order_items (order_id, product_id, name_en, name_ar, unit_price, quantity, line_total)
    values (v_order.id, v_product.id, v_product.name_en, v_product.name_ar, v_product.price, v_qty, 0)
    returning id into v_item_id;

    v_unit_price := v_product.price;
    if v_item ? 'modifier_ids' and jsonb_typeof(v_item -> 'modifier_ids') = 'array' then
      for v_mod_id in
        select mid::uuid from jsonb_array_elements_text(v_item -> 'modifier_ids') as t(mid)
      loop
        select m.* into v_modifier
        from public.modifiers m
        join public.product_modifier_groups pmg on pmg.group_id = m.group_id
        where m.id = v_mod_id and m.is_active and pmg.product_id = v_product.id;
        insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
        values (v_item_id, v_modifier.id, v_modifier.name_en, v_modifier.name_ar, v_modifier.price);
        v_unit_price := v_unit_price + v_modifier.price;
      end loop;
    end if;

    update public.order_items
      set unit_price = v_unit_price, line_total = v_unit_price * v_qty
      where id = v_item_id;
  end loop;

  -- ---- Count coupon usage atomically ---------------------------------------
  if v_discount > 0 and p_coupon_code is not null then
    update public.coupons
      set usage_count = usage_count + 1
      where code = upper(trim(p_coupon_code));
  end if;

  -- ---- Apply the loyalty balance change atomically -------------------------
  if v_loyalty_on and (v_loyalty_redeemed > 0 or v_points_earned > 0) then
    update public.profiles
      set loyalty_points = greatest(0, coalesce(loyalty_points, 0) - v_loyalty_redeemed + v_points_earned)
      where id = v_customer;
  end if;

  return v_order;
end $$;

revoke all on function public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer)
  from public, anon;
grant execute on function public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- adjust_loyalty_points: admin-only manual point management (ledger UI).
-- Adds p_delta (may be negative) to a customer's balance, floored at 0.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_loyalty_points(p_customer_id uuid, p_delta integer)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Only admins may adjust loyalty points' using errcode = '42501';
  end if;
  update public.profiles
    set loyalty_points = greatest(0, coalesce(loyalty_points, 0) + coalesce(p_delta, 0))
    where id = p_customer_id
    returning * into v_profile;
  if not found then
    raise exception 'Customer not found';
  end if;
  return v_profile;
end $$;

revoke all on function public.adjust_loyalty_points(uuid, integer) from public, anon;
grant execute on function public.adjust_loyalty_points(uuid, integer) to authenticated;
