-- ---------------------------------------------------------------------------
-- place_order - resolve each line once, write from that decision
-- ---------------------------------------------------------------------------
--
-- place_order walks the cart twice: pass 1 validates and prices it, pass 2
-- writes order_items after the orders row exists. Until now pass 2 re-queried
-- everything pass 1 had already resolved - the product, the tier (including the
-- cheapest-tier fallback added by 20260826050000) and each modifier - on the
-- assumption that applying the same rules would reach the same answer.
--
-- Under READ COMMITTED it does not. Each statement takes its own snapshot, so a
-- catalog write committed between the two passes can change the answer. An
-- `import_lazywait_catalog` run is exactly such a write, and it can change tier
-- prices, flip is_active, insert a cheaper tier, or change a product's price
-- and names. When that happens the order's subtotal, discount, VAT and total
-- come from pass 1 while order_items - and therefore the receipt and the POS
-- ticket's price_id - come from pass 2. The customer is charged one thing and
-- the kitchen makes another.
--
-- The window is narrow. It needs a catalog write to commit inside a single
-- order transaction, and for the tier half it only opens for a cart line that
-- names no variant_id, which today means a pre-picker install. It is still a
-- money bug, and it is not one that fails loudly.
--
-- The fix is to stop resolving twice. Pass 1 now records what it decided for
-- each line - product id and names, quantity, the final unit price including
-- modifiers, the normalised note, the tier id and names, and the modifier list
-- with its prices - and pass 2 writes from that record and issues no query of
-- its own. This mirrors what compute_order_snapshot has always done on the
-- online path.
--
-- Locking was rejected: `for share` on the chosen tier blocks an update of that
-- row but not the insert of a cheaper one, so it closes half the window, and it
-- buys a lock-ordering hazard with the importer.
--
-- Two behavioural notes, both intentional and neither a pricing change:
--
--   * order_items is now inserted once with its final unit_price and
--     line_total. The old code inserted the base price with line_total 0 and
--     updated both a few statements later. Nothing reads unit_price on insert:
--     the only BEFORE trigger on the table validates `note`, and the two
--     modifier-contract triggers are AFTER INSERT and DEFERRABLE INITIALLY
--     DEFERRED, so they fire at commit and cannot see the intermediate state.
--   * the modifier rows are written from the snapshot in the same order pass 1
--     validated them.
--
-- No refusal, validation or availability rule changed. Every raise in pass 1 is
-- untouched, and pass 2 never had any. No money arithmetic changed: pass 1
-- already computed the unit price that pass 2 used to recompute, and v_subtotal
-- is still summed from it in pass 1.
--
-- Everything else in the function is reproduced verbatim from
-- 20260826050000_place_order_variant_fallback.sql, whose body was confirmed
-- byte-identical to the live definition before generating this file
-- (prosrc md5 080be48e558798e0c393936d486fc738, 16915 chars).
--
-- `create or replace` keeps the signature, so the existing ACL survives.
--
-- Raised by review on PR #263. Detail: docs/MIGRATIONS.md section 34.
-- ---------------------------------------------------------------------------

create or replace function public.place_order(
  p_branch_id      uuid,
  p_order_type     public.order_type,
  p_items          jsonb,
  p_address_id     uuid    default null,
  p_coupon_code    text    default null,
  p_notes          text    default null,
  p_loyalty_points integer default 0,
  p_idempotency_key uuid   default null,
  p_payment_method text    default null
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
  v_variant      public.product_variants;
  v_modifier     public.modifiers;
  -- The line snapshot pass 1 builds and pass 2 replays. See the note above the
  -- second loop: the two passes must not resolve anything independently.
  v_lines        jsonb := '[]'::jsonb;
  v_line         jsonb;
  v_mods         jsonb;
  v_mod          jsonb;
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
  v_existing     public.orders;
  v_item_id      uuid;
  v_loyalty_req      integer := greatest(0, coalesce(p_loyalty_points, 0));
  v_loyalty_redeemed integer := 0;
  v_loyalty_discount numeric(10,2) := 0;
  v_points_earned    integer := 0;
  v_pre_loyalty      numeric(10,2);
  v_per_point        numeric(10,4);
  v_per_riyal        numeric(10,2);
  v_loyalty_on       boolean;
  v_bal_start        integer;
  v_bal_new          integer;
  -- payment method
  v_online_on    boolean;
  v_cash_on      boolean;
  v_pay_method   text;
begin
  if v_customer is null then
    raise exception 'Authentication is required to place an order' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cannot place an order with an empty cart';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.orders
      where customer_id = v_customer and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_profile  from public.profiles    where id = v_customer for update;
  select * into v_settings from public.app_settings where id = true;

  -- ---- Resolve + validate the payment method against admin settings ---------
  -- Server-authoritative: a client can neither select a disabled method nor set
  -- payment_status (it is always forced to 'pending' below).
  v_online_on := coalesce(v_settings.online_payment_enabled, false);
  v_cash_on   := coalesce(v_settings.cash_payment_enabled, false);
  v_pay_method := lower(nullif(btrim(coalesce(p_payment_method, '')), ''));
  if v_pay_method is null then
    v_pay_method := case
      when coalesce(v_settings.default_payment_method, '') = 'online' and v_online_on then 'online'
      when coalesce(v_settings.default_payment_method, '') = 'cash'   and v_cash_on   then 'cash'
      when v_online_on then 'online'
      when v_cash_on   then 'cash'
      else null end;
  end if;
  if v_pay_method is null then
    raise exception 'No payment method is currently available' using errcode = 'P0001';
  end if;
  if v_pay_method not in ('online','cash') then
    raise exception 'Invalid payment method' using errcode = '22023';
  end if;
  if v_pay_method = 'online' and not v_online_on then
    raise exception 'Online payment is not available' using errcode = 'P0001';
  end if;
  if v_pay_method = 'cash' and not v_cash_on then
    raise exception 'Cash payment is not available' using errcode = 'P0001';
  end if;

  select * into v_branch from public.branches where id = p_branch_id;
  if not found or not v_branch.is_active then
    raise exception 'The selected branch is not available';
  end if;

  -- ---- Delivery-zone + channel enforcement (server-authoritative) -----------
  if p_order_type = 'delivery' then
    if not coalesce(v_branch.delivery_enabled, true)
       or coalesce(v_branch.delivery_temporarily_closed, false) then
      raise exception 'Delivery is currently closed for this branch.' using errcode = 'P0001';
    end if;
    if p_address_id is null then
      raise exception 'A delivery address is required for delivery orders';
    end if;
    select * into v_address from public.addresses
      where id = p_address_id and customer_id = v_customer;
    if not found then
      raise exception 'Delivery address not found for this customer';
    end if;
    -- Coordinates come from the map picker; required for a delivery order.
    if v_address.latitude is null or v_address.longitude is null then
      raise exception 'Please select your delivery location on the map.' using errcode = 'P0001';
    end if;
    -- The branch must have a configured active delivery zone...
    if not exists (
      select 1 from public.branch_delivery_zones z
      where z.branch_id = p_branch_id and z.is_active
    ) then
      raise exception 'Delivery area is not configured for this branch.' using errcode = 'P0001';
    end if;
    -- ...and the customer point must fall inside it (GiST-indexed, boundary-inclusive).
    if not public.point_in_active_delivery_zone(p_branch_id, v_address.latitude, v_address.longitude) then
      raise exception 'Your location is outside this branch delivery area.' using errcode = 'P0001';
    end if;
    v_delivery_fee := v_branch.delivery_fee;   -- UNCHANGED: branch-level flat fee authoritative
  elsif p_order_type = 'pickup' then
    if not coalesce(v_branch.pickup_enabled, true) then
      raise exception 'Pickup is currently closed for this branch.' using errcode = 'P0001';
    end if;
  end if;

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

    -- Lazy expiry: a snooze whose timer has passed is NOT a closure, even if the
    -- sweeper has not run yet. Without this a customer stays blocked for up to a
    -- tick after the item is genuinely back. An untimed closure (snoozed_until
    -- null) still blocks, which is the whole point of the distinction.
    if exists (
      select 1 from public.branch_product_availability bpa
      where bpa.branch_id = p_branch_id
        and bpa.product_id = v_product.id
        and bpa.is_available = false
        and (bpa.snoozed_until is null or bpa.snoozed_until > now())
    ) then
      raise exception 'A product in your cart is not available at the selected branch';
    end if;

    -- ---- Price tier -------------------------------------------------------
    -- Lazywait sells "Chicken Wings / Large", not "Chicken Wings", so a line is
    -- priced from the tier the customer chose. Server-authoritative like
    -- everything else in this function: the client sends an id, the money comes
    -- from the row. A product with no tiers behaves exactly as it did before
    -- variants existed, which is what keeps hand-authored products working.
    v_variant := null;
    if nullif(v_item ->> 'variant_id', '') is not null then
      select * into v_variant from public.product_variants
        where id = (v_item ->> 'variant_id')::uuid
          and product_id = v_product.id
          and is_active;
      if not found then
        raise exception 'The selected option is no longer available for a product in your cart';
      end if;
    else
      -- The cart named no tier. Fall back to the CHEAPEST active one.
      --
      -- This block used to `raise exception 'Please choose an option...'`, and
      -- that refusal took the whole app down: every one of the 55 active
      -- products carries at least one tier, and the client that sends
      -- `variant_id` shipped in the same commit as this requirement, so no
      -- build in a customer's hands could satisfy it. Ordering was impossible
      -- from 2026-08-25 06:15 UTC until this migration.
      --
      -- Cheapest is the safe pick, not an arbitrary one. `products.price` is
      -- maintained by the importer as the cheapest tier and is exactly what a
      -- pre-tier client displays, so charging it matches what the customer saw
      -- and preserves "the price charged may never exceed the price displayed".
      -- Ties break by `sort_order` then `id`, mirroring the client's
      -- `cheapestVariant`, so server and app agree on which tier that is.
      --
      -- This is NOT a substitute for the picker. An updated client always names
      -- a tier and never reaches here. It exists so that a stale install — of
      -- which there will be many for weeks after any release — degrades to the
      -- old, correct single-price behaviour instead of being unable to order.
      select * into v_variant from public.product_variants
        where product_id = v_product.id and is_active
        order by price asc, sort_order asc, id asc
        limit 1;
    end if;

    v_unit_price := coalesce(v_variant.price, v_product.price);
    v_mods := '[]'::jsonb;

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
        -- Per-branch modifier availability. Nothing else enforces this: the
        -- deferred modifier-contract trigger checks cardinality, not stock, and
        -- returns early for anything that is not a cash order. Same lazy-expiry
        -- rule as products.
        if exists (
          select 1 from public.branch_modifier_availability bma
          where bma.branch_id = p_branch_id
            and bma.modifier_id = v_modifier.id
            and bma.is_available = false
            and (bma.snoozed_until is null or bma.snoozed_until > now())
        ) then
          raise exception 'An option in your cart is not available at the selected branch';
        end if;
        v_unit_price := v_unit_price + v_modifier.price;
        v_mods := v_mods || jsonb_build_object(
          'modifier_id', v_modifier.id,
          'name_en',     v_modifier.name_en,
          'name_ar',     v_modifier.name_ar,
          'price',       v_modifier.price);
      end loop;
    end if;

    v_subtotal := v_subtotal + (v_unit_price * v_qty);

    -- Everything this pass decided, recorded. Pass 2 writes from this and
    -- resolves nothing of its own.
    v_lines := v_lines || jsonb_build_object(
      'product_id',      v_product.id,
      'name_en',         v_product.name_en,
      'name_ar',         v_product.name_ar,
      'quantity',        v_qty,
      'unit_price',      v_unit_price,
      'note',            public.order_note_normalized(v_item ->> 'note'),
      'variant_id',      v_variant.id,
      'variant_name_en', v_variant.name_en,
      'variant_name_ar', v_variant.name_ar,
      'modifiers',       v_mods);
  end loop;

  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select * into v_coupon from public.validate_coupon(p_coupon_code, v_subtotal);
    if not v_coupon.valid then
      raise exception 'Coupon rejected: %', v_coupon.message;
    end if;
    v_discount := v_coupon.discount_amount;
  end if;

  if p_order_type = 'delivery' and v_subtotal < v_branch.min_delivery_order then
    raise exception 'Order subtotal is below the branch delivery minimum of %',
      v_branch.min_delivery_order;
  end if;

  v_pre_loyalty := greatest(0, v_subtotal + v_delivery_fee - v_discount);
  v_per_point   := coalesce(v_settings.discount_per_point, 0.10);
  v_per_riyal   := coalesce(v_settings.points_per_riyal, 1);
  v_loyalty_on  := coalesce(v_settings.loyalty_enabled, false);
  v_bal_start   := coalesce(v_profile.loyalty_points, 0);

  if v_loyalty_on and v_loyalty_req > 0 and v_per_point > 0 then
    v_loyalty_redeemed := least(
      v_loyalty_req,
      v_bal_start,
      floor(v_pre_loyalty / v_per_point)::int
    );
    if v_loyalty_redeemed < coalesce(v_settings.min_points_to_redeem, 0) then
      v_loyalty_redeemed := 0;
    end if;
    v_loyalty_discount := least(round(v_loyalty_redeemed * v_per_point, 2), v_pre_loyalty);
  end if;

  v_total := greatest(0, v_subtotal + v_delivery_fee - v_discount - v_loyalty_discount);
  v_vat := round(
    v_total - (v_total / (1 + coalesce(v_settings.vat_percentage, 15) / 100.0)), 2);

  if v_loyalty_on then
    v_points_earned := floor(v_total * v_per_riyal)::int;
  end if;

  begin
    insert into public.orders (
      customer_id, customer_name, customer_phone,
      branch_id, branch_name_en, branch_name_ar,
      status, order_type, subtotal, delivery_fee, discount_amount,
      loyalty_discount_amount, vat_amount, total, payment_status, payment_method,
      coupon_code, notes, address_id, address_snapshot,
      loyalty_points_earned, loyalty_points_redeemed, loyalty_awarded_at,
      idempotency_key
    ) values (
      v_customer, v_profile.full_name, v_profile.phone_number,
      v_branch.id, v_branch.name_en, v_branch.name_ar,
      'received', p_order_type, v_subtotal, v_delivery_fee, v_discount,
      v_loyalty_discount, v_vat, v_total, 'pending', v_pay_method,
      case when v_discount > 0 then upper(trim(p_coupon_code)) else null end,
      p_notes, v_address.id,
      case when v_address.id is not null then to_jsonb(v_address) else null end,
      v_points_earned, v_loyalty_redeemed,
      case when v_loyalty_on and (v_loyalty_redeemed > 0 or v_points_earned > 0) then now() else null end,
      p_idempotency_key
    )
    returning * into v_order;
  exception when unique_violation then
    select * into v_existing from public.orders
      where customer_id = v_customer and idempotency_key = p_idempotency_key;
    return v_existing;
  end;

  -- WRITE PASS. This loop queries nothing. Every value it stores was decided by
  -- the pass above and carried here in v_lines.
  --
  -- It used to re-run the product lookup, the tier resolution and the modifier
  -- lookups against the live catalog, on the assumption that repeating the same
  -- rules would repeat the same answer. Under READ COMMITTED it does not: each
  -- statement takes a fresh snapshot, so a catalog write committed between the
  -- two passes -- an `import_lazywait_catalog` run is exactly such a write --
  -- could price a line from one row here and store another. The order totals
  -- came from the first answer; order_items, the receipt and the POS ticket's
  -- price_id came from the second. Identical `order by` clauses do not make two
  -- independent queries atomic.
  --
  -- Writing from the snapshot removes the window rather than narrowing it.
  -- Locking would only narrow it: `for share` on the chosen tier blocks an
  -- update of that row but not the insert of a cheaper one, and it buys a
  -- lock-ordering hazard with the importer.
  --
  -- unit_price here already includes the modifiers, so the insert is final and
  -- the old insert-then-update of line_total is gone. Raised by review on
  -- PR #263; detail in docs/MIGRATIONS.md section 34.
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_qty        := (v_line ->> 'quantity')::int;
    v_unit_price := (v_line ->> 'unit_price')::numeric;

    insert into public.order_items (order_id, product_id, name_en, name_ar, unit_price, quantity, line_total, note,
                                    variant_id, variant_name_en, variant_name_ar)
    values (v_order.id,
            (v_line ->> 'product_id')::uuid,
            v_line ->> 'name_en',
            v_line ->> 'name_ar',
            v_unit_price, v_qty, v_unit_price * v_qty,
            v_line ->> 'note',
            (v_line ->> 'variant_id')::uuid,
            v_line ->> 'variant_name_en',
            v_line ->> 'variant_name_ar')
    returning id into v_item_id;

    for v_mod in select value from jsonb_array_elements(v_line -> 'modifiers')
    loop
      insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
      values (v_item_id,
              (v_mod ->> 'modifier_id')::uuid,
              v_mod ->> 'name_en',
              v_mod ->> 'name_ar',
              (v_mod ->> 'price')::numeric);
    end loop;
  end loop;

  if v_discount > 0 and p_coupon_code is not null then
    update public.coupons
      set usage_count = usage_count + 1
      where code = upper(trim(p_coupon_code))
        and (usage_limit is null or usage_count < usage_limit);
    if not found then
      raise exception 'Coupon usage limit reached' using errcode = 'P0001';
    end if;
  end if;

  if v_loyalty_on and (v_loyalty_redeemed > 0 or v_points_earned > 0) then
    update public.profiles
      set loyalty_points = greatest(0, v_bal_start - v_loyalty_redeemed + v_points_earned)
      where id = v_customer
      returning loyalty_points into v_bal_new;

    if v_loyalty_redeemed > 0 then
      insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
      values (v_customer, v_order.id, 'redeem', -v_loyalty_redeemed, v_bal_new - v_points_earned,
              'Redeemed on order ' || v_order.order_number, v_customer);
    end if;
    if v_points_earned > 0 then
      insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
      values (v_customer, v_order.id, 'earn', v_points_earned, v_bal_new,
              'Earned on order ' || v_order.order_number, v_customer);
    end if;
  end if;

  return v_order;
end $$;
