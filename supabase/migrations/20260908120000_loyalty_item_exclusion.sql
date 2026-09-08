-- ============================================================================
-- Loyalty v2, step 2 — PER-ITEM EXCLUSION, and an honest checkout figure.
--
-- WHAT THE OWNER ASKED FOR
-- "ability to force an item to be 0 point", clarified as: "when letting the
-- item = 0 points that means ordering it will not give you points". EARN-side
-- only. Points may still be SPENT on an excluded item.
--
-- THIS IS THE CHANGE THAT MOVES THE EARNING BASE, and that is the whole risk.
-- Until now both functions earned on `v_total`:
--
--     v_points_earned := floor(v_total * v_per_riyal)
--
-- one number covering the whole payable amount. Once an individual item can be
-- excluded, that number cannot answer the question any more. Earning now comes
-- off an ELIGIBLE BASE: the sum of lines whose product still earns, reduced by
-- the pro-rata share of any order-level coupon and loyalty redemption, clamped
-- to what is actually payable.
--
-- THE COMP IS THE TRAP HERE, AND IT IS NEW.
-- A comped order earned nothing before FOR FREE: `v_total` is zeroed a few lines
-- above the earning rule, so floor(0 * rate) fell out at 0 with no special case.
-- An eligible base has no such property -- it is built from line prices, which a
-- comp does not touch -- so without a guard a free order would start earning.
-- Both a `not v_is_comp` condition AND the `least(..., v_total)` clamp are
-- present, deliberately: they protect different mistakes, and the suite pins
-- each one separately.
--
-- THE DELIVERY FEE STOPS EARNING, and the owner accepted that on 2026-09-07.
-- The fee is not a line, so it is never in `v_eligible`; it remains in `v_total`
-- and therefore can only ever LOWER the clamp, never raise the base. While
-- `loyalty_pickup_only` is on this is a no-op -- an earning order is a pickup
-- order and its fee is 0 -- so the change is only observable if that setting is
-- later turned off. VAT is NOT removed: prices here are VAT-inclusive, so the
-- line totals carry it exactly as `v_total` did.
--
-- BOTH FUNCTIONS MOVE TOGETHER. Same discipline as 20260907120000: both bodies
-- are derived from that file by line span, the identical anchored substitution
-- applied to each, every anchor asserted to occur exactly once per function
-- before substituting. Nothing was retyped, and section 4 verifies parity.
--
-- WHY THERE IS A NEW RPC HERE AT ALL
-- The owner asked that checkout "tell the customer how much points they will get
-- when they complete the order, but never the breakdown". The client cannot
-- compute that honestly: it would be a THIRD copy of the earning rule, and PR1
-- exists because two copies are already the top hazard in this area -- one that
-- would also have to absorb expiry (step 3) and multipliers (step 4).
--
-- It also cannot call `compute_order_snapshot`, and that boundary is deliberate:
-- 20260712160000 revokes it from anon/authenticated and grants it to
-- service_role alone, because it takes `p_customer` as an argument with NO
-- caller check -- exposing it would let anyone read another customer's name,
-- phone and address snapshot.
--
-- `preview_loyalty_points` is the narrow way through: SECURITY DEFINER, the
-- customer taken from `auth.uid()` and never from the caller, returning ONLY the
-- four loyalty/total figures and no personal data at all. The number the
-- customer is shown is therefore produced by the same code that will grant the
-- points, and steps 3 and 4 improve it for free.
--
-- MONEY PATH: THE HASHES CHANGE AGAIN, DELIBERATELY. Same note as 20260907120000
-- -- record the new ones at apply time rather than reporting a surprise.
--
-- WHAT IS NOT TOUCHED: the earn rate, the redemption rate, the minimum, the
-- channel gate, the comp path, coupons, VAT, delivery fees, or any existing
-- order. Nothing is excluded until an administrator excludes it: the column
-- defaults TRUE, so applying this migration alone changes no order's points.
--
-- EVIDENCE AND OPERATION: docs/LOYALTY.md section 3.
-- Coverage: supabase/tests/loyalty_item_exclusion_test.sql.
-- ============================================================================

-- ---- 1. The column --------------------------------------------------------
-- Defaults TRUE: an existing menu keeps earning exactly as it does today, and a
-- newly imported product earns until somebody says otherwise. The Lazywait
-- importer (20260709130000) updates and inserts products with EXPLICIT column
-- lists that do not name this one, so a menu re-import cannot silently undo an
-- administrator's choice. The suite pins that rather than trusting it.
alter table public.products
  add column if not exists earns_loyalty_points boolean not null default true;

comment on column public.products.earns_loyalty_points is
  'Earn-side only. FALSE means ordering this item grants no loyalty points; '
  'points may still be REDEEMED against an order containing it.';

-- ---- 2. The two money-path functions, changed identically -------------------
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
  v_loyalty_channel_ok boolean;
  -- The merchandise that actually earns: the sum of lines whose product is
  -- not excluded. Accumulated in the SAME pass that builds v_subtotal, from
  -- the same resolved product row, so the two can never disagree about what
  -- was in the cart.
  v_eligible     numeric(10,2) := 0;
  v_earn_base    numeric(10,2) := 0;
  v_bal_start        integer;
  v_bal_new          integer;
  -- Comped customers (public.comp_members). Resolved EARLY, next to the
  -- profile, because payment_status is written at the insert far below and a
  -- comped order must land 'paid' - see the note there.
  v_is_comp      boolean := false;
  v_comp_amount  numeric(10,2) := 0;
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

  select cm.is_active into v_is_comp
    from public.comp_members cm where cm.profile_id = v_customer;
  v_is_comp := coalesce(v_is_comp, false);

  -- ---- Resolve + validate the payment method against admin settings ---------
  -- Server-authoritative: a client can neither select a disabled method nor set
  -- payment_status. It is decided at the insert below and takes exactly two
  -- values - 'paid' for a comped customer, 'pending' for everyone else.
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
    -- PER-ITEM EXCLUSION. `earns_loyalty_points` is EARN-side only: points
    -- may still be SPENT on an excluded item, which is the owner's decision
    -- of 2026-09-07. coalesce() because a pre-migration row reads null and
    -- the safe direction is to keep earning, not to silently stop it.
    if coalesce(v_product.earns_loyalty_points, true) then
      v_eligible := v_eligible + (v_unit_price * v_qty);
    end if;

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

  -- A comped order skips the coupon entirely. Applying one would burn a limited
  -- code's usage_count on an order that is free anyway, and a mistyped code
  -- would raise at a customer who owes nothing either way.
  if not v_is_comp and p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
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
  -- CHANNEL GATE. Loyalty is a PICKUP incentive: while `loyalty_pickup_only`
  -- is on, a delivery order neither earns nor may redeem. Derived once and
  -- used by both branches below, so the two can never disagree.
  v_loyalty_channel_ok := (not coalesce(v_settings.loyalty_pickup_only, true))
                          or p_order_type = 'pickup';
  v_bal_start   := coalesce(v_profile.loyalty_points, 0);

  -- ...and never burns loyalty points against an order that is already free.
  if not v_is_comp and v_loyalty_on and v_loyalty_channel_ok
     and v_loyalty_req > 0 and v_per_point > 0 then
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

  -- THE COMP. Zeroed here, BEFORE the VAT line, and that ordering is
  -- load-bearing: v_vat is derived from v_total, so zeroing first makes VAT
  -- fall out at 0 with no second rule to keep in step. v_points_earned needs no
  -- special case either - floor(0 * rate) is 0.
  if v_is_comp then
    v_comp_amount := v_total;
    v_total       := 0;
  end if;
  v_vat := round(
    v_total - (v_total / (1 + coalesce(v_settings.vat_percentage, 15) / 100.0)), 2);

  -- EARNING IS NOW LINE-BASED, not total-based.
  --
  -- `not v_is_comp` is LOAD-BEARING and did not need to be here before. The
  -- old rule was floor(v_total * rate), and v_total is zeroed for a comped
  -- order a few lines above, so a free order earned nothing FOR FREE. An
  -- eligible base has no such property: without this guard a comped order
  -- would earn on its lines. The least(..., v_total) clamp below would also
  -- catch it; both are kept, because the two protect different mistakes.
  if v_loyalty_on and v_loyalty_channel_ok and not v_is_comp then
    -- The coupon and the redemption are ORDER-level reductions, so the
    -- eligible lines carry their PRO-RATA share of both. An excluded item
    -- must not absorb the whole discount and shield the eligible ones, and
    -- an eligible item must not absorb it twice.
    v_earn_base := v_eligible;
    if v_subtotal > 0 then
      v_earn_base := v_eligible
                   - round((v_discount + v_loyalty_discount)
                           * (v_eligible / v_subtotal), 2);
    end if;
    -- Clamped to what is actually payable. This is also what silently keeps
    -- a comped order at zero, and what stops the DELIVERY FEE earning: the
    -- fee is in v_total but never in v_eligible, so it can only ever lower
    -- the base, never raise it.
    v_earn_base := greatest(0, least(v_earn_base, v_total));
    v_points_earned := floor(v_earn_base * v_per_riyal)::int;
  end if;

  begin
    insert into public.orders (
      customer_id, customer_name, customer_phone,
      branch_id, branch_name_en, branch_name_ar,
      status, order_type, subtotal, delivery_fee, discount_amount,
      loyalty_discount_amount, vat_amount, total, payment_status, payment_method,
      paid_at,
      coupon_code, notes, address_id, address_snapshot,
      loyalty_points_earned, loyalty_points_redeemed, loyalty_awarded_at,
      idempotency_key, is_comped, comp_discount_amount
    ) values (
      v_customer, v_profile.full_name, v_profile.phone_number,
      v_branch.id, v_branch.name_en, v_branch.name_ar,
      'received', p_order_type, v_subtotal, v_delivery_fee, v_discount,
      v_loyalty_discount, v_vat, v_total,
      -- A comped order owes nothing, so it is settled on arrival. Leaving it
      -- 'pending' would be worse than untidy: set_lazywait_initial_sync parks a
      -- non-paid ONLINE order at 'awaiting_payment', and begin_payment_attempt
      -- refuses a total of 0 - so the order would never reach the kitchen and
      -- could never be paid. Precedent: begin_checkout_session already writes
      -- 'paid' for a zero total.
      (case when v_is_comp then 'paid' else 'pending' end)::public.payment_status, v_pay_method,
      -- paid_at matches payment_status, as insert_order_from_snapshot already
      -- does for the online path. It is not decoration: watchdog rule R1
      -- (PAID_ORDER_NOT_SYNCED, 20260721170000:361) requires `paid_at is not
      -- null`, so a comped pickup order left with a null timestamp would be
      -- invisible to the alert that exists to catch a paid order the kitchen
      -- never received.
      case when v_is_comp then now() else null end,
      case when v_discount > 0 then upper(trim(p_coupon_code)) else null end,
      p_notes, v_address.id,
      case when v_address.id is not null then to_jsonb(v_address) else null end,
      v_points_earned, v_loyalty_redeemed,
      case when v_loyalty_on and (v_loyalty_redeemed > 0 or v_points_earned > 0) then now() else null end,
      p_idempotency_key, v_is_comp, v_comp_amount
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
create or replace function public.compute_order_snapshot(
  p_customer       uuid,
  p_branch_id      uuid,
  p_order_type     public.order_type,
  p_items          jsonb,
  p_address_id     uuid    default null,
  p_coupon_code    text    default null,
  p_loyalty_points integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile      public.profiles;
  v_branch       public.branches;
  v_settings     public.app_settings;
  v_address      public.addresses;
  v_item         jsonb;
  v_product      public.products;
  v_variant      public.product_variants;
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
  v_loyalty_req      integer := greatest(0, coalesce(p_loyalty_points, 0));
  v_loyalty_redeemed integer := 0;
  v_loyalty_discount numeric(10,2) := 0;
  v_points_earned    integer := 0;
  v_pre_loyalty      numeric(10,2);
  v_per_point        numeric(10,4);
  v_per_riyal        numeric(10,2);
  v_loyalty_on       boolean;
  v_loyalty_channel_ok boolean;
  -- The merchandise that actually earns: the sum of lines whose product is
  -- not excluded. Accumulated in the SAME pass that builds v_subtotal, from
  -- the same resolved product row, so the two can never disagree about what
  -- was in the cart.
  v_eligible     numeric(10,2) := 0;
  v_earn_base    numeric(10,2) := 0;
  v_bal_start        integer;
  v_items_out    jsonb := '[]'::jsonb;
  v_is_comp      boolean := false;
  v_comp_amount  numeric(10,2) := 0;
  v_mods_out     jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cannot place an order with an empty cart';
  end if;

  select * into v_profile  from public.profiles    where id = p_customer;
  select * into v_settings from public.app_settings where id = true;

  select cm.is_active into v_is_comp
    from public.comp_members cm where cm.profile_id = p_customer;
  v_is_comp := coalesce(v_is_comp, false);

  select * into v_branch from public.branches where id = p_branch_id;
  if not found or not v_branch.is_active then
    raise exception 'The selected branch is not available';
  end if;

  if p_order_type = 'delivery' then
    if not coalesce(v_branch.delivery_enabled, true)
       or coalesce(v_branch.delivery_temporarily_closed, false) then
      raise exception 'Delivery is currently closed for this branch.' using errcode = 'P0001';
    end if;
    if p_address_id is null then
      raise exception 'A delivery address is required for delivery orders';
    end if;
    select * into v_address from public.addresses
      where id = p_address_id and customer_id = p_customer;
    if not found then
      raise exception 'Delivery address not found for this customer';
    end if;
    if v_address.latitude is null or v_address.longitude is null then
      raise exception 'Please select your delivery location on the map.' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.branch_delivery_zones z
      where z.branch_id = p_branch_id and z.is_active
    ) then
      raise exception 'Delivery area is not configured for this branch.' using errcode = 'P0001';
    end if;
    if not public.point_in_active_delivery_zone(p_branch_id, v_address.latitude, v_address.longitude) then
      raise exception 'Your location is outside this branch delivery area.' using errcode = 'P0001';
    end if;
    v_delivery_fee := v_branch.delivery_fee;
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

    if exists (
      select 1 from public.branch_product_availability bpa
      where bpa.branch_id = p_branch_id
        and bpa.product_id = v_product.id
        and bpa.is_available = false
    ) then
      raise exception 'A product in your cart is not available at the selected branch';
    end if;

    -- Same tier rules as place_order. The online path MUST agree with the cash
    -- path here: this snapshot is what the customer pays against, so a tier
    -- resolved differently would charge one price and ticket another. That
    -- agreement is the whole reason this block changed: 20260826050000 replaced
    -- the refusal in place_order and left this copy raising, so the two paths
    -- disagreed for a day.
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
      -- The cart named no tier. Fall back to the CHEAPEST active one, exactly
      -- as place_order does.
      --
      -- This block used to `raise exception 'Please choose an option...'`. In
      -- place_order that refusal made ordering impossible for every product,
      -- because all 55 active ones carry a tier and the client that sends
      -- `variant_id` shipped in the same commit as the requirement. The cash
      -- path was fixed on 2026-08-26; this copy was missed. It has not bitten
      -- anyone only because begin_checkout_session refuses on
      -- app_settings.online_payment_enabled before it ever gets here — see the
      -- header of this migration.
      --
      -- Cheapest is the safe pick, not an arbitrary one. `products.price` is
      -- maintained by the importer as the cheapest tier and is exactly what a
      -- pre-tier client displays, so charging it matches what the customer saw
      -- and preserves "the price charged may never exceed the price displayed".
      -- Ties break by `sort_order` then `id`, mirroring the client's
      -- `cheapestVariant` and place_order, so all three agree on which tier
      -- "cheapest" means.
      --
      -- Unlike place_order this function resolves each line ONCE and carries
      -- the tier inside the snapshot, so there is no second pass to disagree
      -- with — see the note further down where variant_id is written out.
      select * into v_variant from public.product_variants
        where product_id = v_product.id and is_active
        order by price asc, sort_order asc, id asc
        limit 1;
    end if;

    v_unit_price := coalesce(v_variant.price, v_product.price);
    v_mods_out := '[]'::jsonb;

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
        v_mods_out := v_mods_out || jsonb_build_object(
          'modifier_id', v_modifier.id, 'name_en', v_modifier.name_en,
          'name_ar', v_modifier.name_ar, 'price', v_modifier.price);
      end loop;
    end if;

    v_subtotal := v_subtotal + (v_unit_price * v_qty);
    -- PER-ITEM EXCLUSION. `earns_loyalty_points` is EARN-side only: points
    -- may still be SPENT on an excluded item, which is the owner's decision
    -- of 2026-09-07. coalesce() because a pre-migration row reads null and
    -- the safe direction is to keep earning, not to silently stop it.
    if coalesce(v_product.earns_loyalty_points, true) then
      v_eligible := v_eligible + (v_unit_price * v_qty);
    end if;
    v_items_out := v_items_out || jsonb_build_object(
      'product_id', v_product.id, 'name_en', v_product.name_en, 'name_ar', v_product.name_ar,
      'unit_price', v_unit_price, 'quantity', v_qty, 'line_total', v_unit_price * v_qty,
      'note', public.order_note_normalized(v_item ->> 'note'),
      -- The tier travels INSIDE the snapshot, so the row written after payment
      -- is the one that was priced, not one re-derived from a menu that may
      -- have been re-imported while the customer was paying.
      'variant_id', v_variant.id,
      'variant_name_en', v_variant.name_en,
      'variant_name_ar', v_variant.name_ar,
      'modifiers', v_mods_out);
  end loop;

  -- A comped order skips the coupon entirely. Applying one would burn a limited
  -- code's usage_count on an order that is free anyway, and a mistyped code
  -- would raise at a customer who owes nothing either way.
  if not v_is_comp and p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
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
  -- CHANNEL GATE. Loyalty is a PICKUP incentive: while `loyalty_pickup_only`
  -- is on, a delivery order neither earns nor may redeem. Derived once and
  -- used by both branches below, so the two can never disagree.
  v_loyalty_channel_ok := (not coalesce(v_settings.loyalty_pickup_only, true))
                          or p_order_type = 'pickup';
  v_bal_start   := coalesce(v_profile.loyalty_points, 0);

  -- ...and never burns loyalty points against an order that is already free.
  if not v_is_comp and v_loyalty_on and v_loyalty_channel_ok
     and v_loyalty_req > 0 and v_per_point > 0 then
    v_loyalty_redeemed := least(v_loyalty_req, v_bal_start, floor(v_pre_loyalty / v_per_point)::int);
    if v_loyalty_redeemed < coalesce(v_settings.min_points_to_redeem, 0) then
      v_loyalty_redeemed := 0;
    end if;
    v_loyalty_discount := least(round(v_loyalty_redeemed * v_per_point, 2), v_pre_loyalty);
  end if;

  v_total := greatest(0, v_subtotal + v_delivery_fee - v_discount - v_loyalty_discount);

  -- THE COMP. Zeroed here, BEFORE the VAT line, and that ordering is
  -- load-bearing: v_vat is derived from v_total, so zeroing first makes VAT
  -- fall out at 0 with no second rule to keep in step. v_points_earned needs no
  -- special case either - floor(0 * rate) is 0.
  if v_is_comp then
    v_comp_amount := v_total;
    v_total       := 0;
  end if;
  v_vat := round(v_total - (v_total / (1 + coalesce(v_settings.vat_percentage, 15) / 100.0)), 2);

  -- EARNING IS NOW LINE-BASED, not total-based.
  --
  -- `not v_is_comp` is LOAD-BEARING and did not need to be here before. The
  -- old rule was floor(v_total * rate), and v_total is zeroed for a comped
  -- order a few lines above, so a free order earned nothing FOR FREE. An
  -- eligible base has no such property: without this guard a comped order
  -- would earn on its lines. The least(..., v_total) clamp below would also
  -- catch it; both are kept, because the two protect different mistakes.
  if v_loyalty_on and v_loyalty_channel_ok and not v_is_comp then
    -- The coupon and the redemption are ORDER-level reductions, so the
    -- eligible lines carry their PRO-RATA share of both. An excluded item
    -- must not absorb the whole discount and shield the eligible ones, and
    -- an eligible item must not absorb it twice.
    v_earn_base := v_eligible;
    if v_subtotal > 0 then
      v_earn_base := v_eligible
                   - round((v_discount + v_loyalty_discount)
                           * (v_eligible / v_subtotal), 2);
    end if;
    -- Clamped to what is actually payable. This is also what silently keeps
    -- a comped order at zero, and what stops the DELIVERY FEE earning: the
    -- fee is in v_total but never in v_eligible, so it can only ever lower
    -- the base, never raise it.
    v_earn_base := greatest(0, least(v_earn_base, v_total));
    v_points_earned := floor(v_earn_base * v_per_riyal)::int;
  end if;

  return jsonb_build_object(
    'customer_name', v_profile.full_name,
    'customer_phone', v_profile.phone_number,
    'branch_id', v_branch.id, 'branch_name_en', v_branch.name_en, 'branch_name_ar', v_branch.name_ar,
    'order_type', p_order_type,
    'items', v_items_out,
    'subtotal', v_subtotal, 'delivery_fee', v_delivery_fee, 'discount_amount', v_discount,
    'loyalty_discount_amount', v_loyalty_discount, 'vat_amount', v_vat, 'total', v_total,
    'loyalty_points_earned', v_points_earned, 'loyalty_points_redeemed', v_loyalty_redeemed,
    'loyalty_on', v_loyalty_on,
    'coupon_code', case when v_discount > 0 then upper(trim(p_coupon_code)) else null end,
    'coupon_code_raw', p_coupon_code,
    'address_id', v_address.id,
    'address_snapshot', case when v_address.id is not null then to_jsonb(v_address) else null end,
    -- Carried INSIDE the snapshot so insert_order_from_snapshot writes the same
    -- comp the customer was shown, rather than re-deciding it after payment.
    'is_comped', v_is_comp,
    'comp_discount_amount', v_comp_amount
  );
end $$;
-- ---- 3. The checkout preview ------------------------------------------------
-- Deliberately narrow. `compute_order_snapshot` stays service_role-only because
-- it trusts a caller-supplied `p_customer`; this wrapper takes the customer from
-- `auth.uid()` instead, so there is no id to forge, and returns ONLY the loyalty
-- and total figures -- no name, phone, address snapshot, comp state or line
-- detail. The customer sees a number computed by the same code that will grant
-- the points, rather than a client-side guess that can drift from it.
--
-- It RAISES exactly as the snapshot does on an invalid cart (below the delivery
-- minimum, an unavailable product, a rejected coupon). That is intentional: the
-- caller treats any failure as "no estimate available" and shows nothing, the
-- same rule `refreshAvailability` already follows on the client. A preview must
-- never be able to block an order.
create or replace function public.preview_loyalty_points(
  p_branch_id      uuid,
  p_order_type     public.order_type,
  p_items          jsonb,
  p_address_id     uuid    default null,
  p_coupon_code    text    default null,
  p_loyalty_points integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid := auth.uid();
  v_snapshot jsonb;
begin
  if v_customer is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;

  v_snapshot := public.compute_order_snapshot(
    v_customer, p_branch_id, p_order_type, p_items,
    p_address_id, p_coupon_code, p_loyalty_points);

  -- Field-by-field rather than deleting keys from the snapshot: a future field
  -- added to compute_order_snapshot must be opted IN here, not leaked by
  -- default. This is the whole reason the wrapper exists.
  return jsonb_build_object(
    'loyalty_points_earned',   v_snapshot -> 'loyalty_points_earned',
    'loyalty_points_redeemed', v_snapshot -> 'loyalty_points_redeemed',
    'loyalty_discount_amount', v_snapshot -> 'loyalty_discount_amount',
    'total',                   v_snapshot -> 'total'
  );
end $$;

revoke all on function public.preview_loyalty_points(uuid, public.order_type, jsonb, uuid, text, integer)
  from public, anon;
grant execute on function public.preview_loyalty_points(uuid, public.order_type, jsonb, uuid, text, integer)
  to authenticated;

-- ---- 4. Self-verification ---------------------------------------------------
-- Refuses to apply rather than landing half-done. The parity check is the point:
-- an eligible base that reached only ONE of the twin pricing functions would let
-- the checkout promise points the order will not grant.
do $$
declare
  v_place_base   integer;  v_snap_base   integer;
  v_place_elig   integer;  v_snap_elig   integer;
  v_place_gate   integer;  v_snap_gate   integer;
  v_default      text;
  v_overloads    integer;
  v_anon_can     boolean;
  v_auth_can     boolean;
  v_is_definer   boolean;
begin
  -- (a) The column exists and defaults TRUE, so applying this alone excludes
  --     nothing and no existing order changes.
  select column_default into v_default from information_schema.columns
   where table_schema = 'public' and table_name = 'products'
     and column_name = 'earns_loyalty_points';
  if v_default is null or v_default not like 'true%' then
    raise exception 'products.earns_loyalty_points missing or not defaulting true (got %)',
      coalesce(v_default, '<absent>');
  end if;

  -- (b) PARITY. Counted rather than assumed, and compared to each other rather
  --     than to a hard-coded literal, so ordinary comment edits do not make this
  --     brittle while a one-sided change still fails.
  select count(*) into v_place_base from regexp_matches(
    (select prosrc from pg_proc where proname = 'place_order'), 'v_earn_base', 'g');
  select count(*) into v_snap_base from regexp_matches(
    (select prosrc from pg_proc where proname = 'compute_order_snapshot'), 'v_earn_base', 'g');
  select count(*) into v_place_elig from regexp_matches(
    (select prosrc from pg_proc where proname = 'place_order'), 'v_eligible', 'g');
  select count(*) into v_snap_elig from regexp_matches(
    (select prosrc from pg_proc where proname = 'compute_order_snapshot'), 'v_eligible', 'g');
  if v_place_base <> v_snap_base or v_place_elig <> v_snap_elig then
    raise exception 'eligible-base parity failed: earn_base %/%, eligible %/% (place/snapshot)',
      v_place_base, v_snap_base, v_place_elig, v_snap_elig;
  end if;
  if v_place_base < 5 or v_place_elig < 5 then
    raise exception 'the eligible base is not wired in: earn_base %, eligible %',
      v_place_base, v_place_elig;
  end if;

  -- (c) PR1's channel gate must still be present in both. A regression guard on
  --     the previous step, since this migration rewrites the same two bodies.
  select count(*) into v_place_gate from regexp_matches(
    (select prosrc from pg_proc where proname = 'place_order'), 'v_loyalty_channel_ok', 'g');
  select count(*) into v_snap_gate from regexp_matches(
    (select prosrc from pg_proc where proname = 'compute_order_snapshot'), 'v_loyalty_channel_ok', 'g');
  if v_place_gate <> 4 or v_snap_gate <> 4 then
    raise exception 'the pickup-only gate was lost: place % / snapshot % (expected 4 each)',
      v_place_gate, v_snap_gate;
  end if;

  -- (d) Exactly one of each pricing function; a stray overload would make which
  --     body runs a matter of argument coercion.
  select count(*) into v_overloads from pg_proc
   where proname in ('place_order', 'compute_order_snapshot');
  if v_overloads <> 2 then
    raise exception 'expected exactly one place_order and one compute_order_snapshot, found %',
      v_overloads;
  end if;

  -- (e) The preview exists, runs as definer, and is reachable by a signed-in
  --     customer but NOT by anon. The last clause is the security boundary: this
  --     function reaches a service_role-only function on the caller's behalf.
  select p.prosecdef into v_is_definer from pg_proc p
   where p.proname = 'preview_loyalty_points';
  if v_is_definer is null then
    raise exception 'preview_loyalty_points was not created';
  end if;
  if not v_is_definer then
    raise exception 'preview_loyalty_points must be SECURITY DEFINER to reach the snapshot';
  end if;
  select has_function_privilege('anon',
           'public.preview_loyalty_points(uuid, public.order_type, jsonb, uuid, text, integer)', 'execute')
    into v_anon_can;
  select has_function_privilege('authenticated',
           'public.preview_loyalty_points(uuid, public.order_type, jsonb, uuid, text, integer)', 'execute')
    into v_auth_can;
  if v_anon_can then
    raise exception 'preview_loyalty_points must not be executable by anon';
  end if;
  if not v_auth_can then
    raise exception 'preview_loyalty_points must be executable by authenticated';
  end if;

  -- (f) And the snapshot it wraps must STILL be closed to the client. If this
  --     ever passes by having opened compute_order_snapshot instead, the wrapper
  --     was pointless and a PII boundary is gone.
  if has_function_privilege('authenticated',
       'public.compute_order_snapshot(uuid, uuid, public.order_type, jsonb, uuid, text, integer)', 'execute') then
    raise exception 'compute_order_snapshot must remain service_role-only';
  end if;

  raise notice 'LOYALTY ITEM EXCLUSION OK (column defaults true, both functions in parity, preview scoped)';
end $$;
