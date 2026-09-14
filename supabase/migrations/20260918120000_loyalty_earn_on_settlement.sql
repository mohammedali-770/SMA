-- 20260918120000_loyalty_earn_on_settlement.sql
--
-- WHAT: loyalty points stop being spendable the instant an order is CREATED.
-- They are recorded as `earn_pending` and promoted to a real `earn` when the
-- order is DELIVERED.
--
-- WHY. Security audit 2026-09-13, finding 1.1. `place_order` inserted the order
-- with `payment_status = 'pending'` and, in the SAME transaction, added the
-- earned points to `profiles.loyalty_points`. Nothing conditioned that on
-- payment. There IS a reversal when an order is cancelled, and that is exactly
-- where it broke:
--
--   v_earn_reversed := least(greatest(v_balance, 0), v_earn_requested);
--
-- It can only claw back points STILL IN THE BALANCE, and it logs a "shortfall"
-- when it cannot. So the attack was: place a large cash order, never collect it,
-- SPEND the points immediately on a real order, and let the fake one be
-- cancelled. The reversal recovers nothing. Repeat with a fresh idempotency key.
-- Each cycle turns an order nobody pays for into real discount on one they do.
--
-- Measured before writing this: of the 65 orders that have ever earned points,
-- 65 were unpaid at the time -- every one of the 8 654 points ever granted.
--
-- WHY DELIVERY IS THE SIGNAL. It is the settlement event this system actually
-- has. A cash order handed to a customer has been paid for; an online order that
-- was never paid never reaches `delivered`. Wiring this into payment
-- confirmation instead would mean editing the payment path, which is FROZEN
-- under CLAUDE.md §6. This migration touches no payment code.
--
-- WHAT DOES NOT CHANGE:
--   * REDEMPTION still debits at creation. The customer is spending points for a
--     discount on this order; deferring that would let the same points be spent
--     twice.
--   * Comped orders are unaffected -- they earn 0 (verified live: 4 comped
--     orders, 0 earned), because earning is clamped to the payable total.
--   * No existing row is rewritten. The 65 historical `earn` rows and the 8 654
--     points already in customer balances are left exactly as they are;
--     retroactively voiding them would take points real accounts hold.
--
-- SHAPE: widen one CHECK, redefine two functions. Derived from
-- `20260910120000_loyalty_multipliers.sql` (place_order) and
-- `20260810100000_order_status_cancellation_integrity.sql`
-- (admin_set_order_status) by anchored substitution, each anchor asserted to
-- match exactly once. Nothing retyped.
--
-- NO DEPLOY IMPLIED: both signatures are unchanged, so existing callers bind to
-- the new bodies.

-- ---------------------------------------------------------------------------
-- 1. The ledger admits a pending earn
-- ---------------------------------------------------------------------------
-- Widening a CHECK cannot invalidate an existing row. All 65 existing rows are
-- 'earn'/'redeem'/'adjustment' and remain valid; the closing block re-counts
-- them to prove it.
alter table public.loyalty_transactions
  drop constraint if exists loyalty_transactions_type_check;
alter table public.loyalty_transactions
  add constraint loyalty_transactions_type_check
  check (type in ('earn', 'redeem', 'adjustment', 'expire', 'earn_pending'));

comment on constraint loyalty_transactions_type_check on public.loyalty_transactions is
  'earn_pending is recorded at order creation and is NOT part of the spendable balance; admin_set_order_status promotes it to earn on delivery.';

-- ---------------------------------------------------------------------------
-- 2. place_order -- earning becomes a promise
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
  v_loyalty_channel_ok boolean;
  -- The merchandise that actually earns: the sum of lines whose product is
  -- not excluded. Accumulated in the SAME pass that builds v_subtotal, from
  -- the same resolved product row, so the two can never disagree about what
  -- was in the cart.
  v_eligible     numeric(10,2) := 0;
  -- The same eligible lines, each already multiplied by whatever campaign
  -- applies to it. Kept ALONGSIDE v_eligible rather than replacing it: the
  -- clamp below is computed from the unweighted figure, so a 2x campaign
  -- cannot be clipped by the order total it is supposed to exceed.
  v_weighted     numeric(12,2) := 0;
  v_multiplier   numeric(4,2);
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
      -- CAMPAIGN MULTIPLIER, resolved per line because a campaign may be scoped
      -- to one product or one category. Returns exactly 1 when nothing applies,
      -- which is what makes an order with no live campaign arithmetically
      -- identical to the previous step.
      v_multiplier := public.loyalty_multiplier_for(
        v_product.id, v_product.category_id, p_branch_id, now());
      v_weighted := v_weighted + (v_unit_price * v_qty * v_multiplier);
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
    -- The campaign is applied LAST, as a ratio, and that ordering is
    -- load-bearing. `v_earn_base` keeps every guarantee the previous step
    -- established -- a comped order is 0, the delivery fee is excluded, the
    -- clamp holds -- and the ratio then scales it by exactly the weighting
    -- the eligible lines earned. Multiplying BEFORE the clamp would let
    -- `least(..., v_total)` silently cancel the campaign, which is the bug
    -- this shape exists to avoid.
    --
    -- v_eligible = 0 cannot divide, and cannot matter: v_earn_base is 0 too.
    v_points_earned := floor(
      v_earn_base
      * (case when v_eligible > 0 then v_weighted / v_eligible else 1 end)
      * v_per_riyal)::int;
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
      -- EARNING NO LONGER CREDITS HERE. Redemption still does: the customer is
      -- spending points to get a discount on THIS order, so it must debit now or
      -- the same points could be spent twice. Earning is a promise until the
      -- order is actually collected -- see the 'earn_pending' row below.
      set loyalty_points = greatest(0, v_bal_start - v_loyalty_redeemed)
      where id = v_customer
      returning loyalty_points into v_bal_new;

    if v_loyalty_redeemed > 0 then
      insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
      -- v_bal_new no longer includes the earn, so it IS the post-redemption
      -- balance. Subtracting v_points_earned here would now double-count.
      values (v_customer, v_order.id, 'redeem', -v_loyalty_redeemed, v_bal_new,
              'Redeemed on order ' || v_order.order_number, v_customer);
    end if;
    if v_points_earned > 0 then
      insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
      -- 'earn_pending', not 'earn': recorded, visible, and NOT in the spendable
      -- balance. admin_set_order_status promotes it on delivery.
      values (v_customer, v_order.id, 'earn_pending', v_points_earned, v_bal_new,
              'Pending on order ' || v_order.order_number || ' (credited on delivery)', v_customer);
    end if;
  end if;

  return v_order;
end $$;

-- ---------------------------------------------------------------------------
-- 3. admin_set_order_status -- promote on delivery, reverse only what was given
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_order_status(
  p_order_id uuid,
  p_status   public.order_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order          public.orders;
  v_balance        integer;
  v_earn_requested integer := 0;
  v_earn_reversed  integer := 0;
  v_redeemed       integer := 0;
  v_allowed        boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Only admins may change order status' using errcode = '42501';
  end if;

  -- Serialize status changes for one order. This is also the idempotency fence
  -- for cancellation compensation: a concurrent second caller waits, then sees
  -- status=cancelled and returns without moving money/points again.
  select * into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  -- A no-op write is harmless and, importantly, must not replay cancellation
  -- compensation when a client retries after losing the response.
  if p_status = v_order.status then
    return;
  end if;

  -- Mirror src/context/AppContext.tsx ORDER_STATUS_TRANSITIONS on the server.
  -- The DB is the authority; the browser is only an early UX guard.
  v_allowed := case v_order.status
    when 'received' then p_status in ('preparing', 'cancelled')
    when 'preparing' then p_status in ('ready', 'cancelled')
    when 'ready' then p_status in ('out_for_delivery', 'delivered', 'cancelled')
    when 'out_for_delivery' then p_status in ('delivered', 'cancelled')
    when 'delivered' then false
    when 'cancelled' then false
    else false
  end;

  if not v_allowed then
    raise exception 'Invalid order status transition: % -> %', v_order.status, p_status
      using errcode = '22023';
  end if;

  if p_status = 'cancelled' then
    -- Reverse only what was ACTUALLY CREDITED, not what the order promised.
    -- orders.loyalty_points_earned is the promise; since the 2026-09-14 change
    -- that promise is not in the balance until delivery, so reversing it for a
    -- never-delivered order would deduct points the customer never received.
    select greatest(0, coalesce(sum(points), 0)) into v_earn_requested
      from public.loyalty_transactions
     where order_id = v_order.id and type = 'earn';
    v_redeemed       := greatest(0, coalesce(v_order.loyalty_points_redeemed, 0));

    if v_order.customer_id is not null and (v_earn_requested > 0 or v_redeemed > 0) then
      -- Lock the customer's current balance. Other loyalty mutations already
      -- lock this row, so cancellation composes safely with checkout/admin edits.
      select coalesce(loyalty_points, 0)
        into v_balance
        from public.profiles
       where id = v_order.customer_id
       for update;

      if found then
        -- Remove earned points FIRST, bounded by what still exists. If the
        -- customer has already spent some earned points, the business records
        -- the shortfall instead of allowing a negative balance.
        --
        -- The redemption refund is deliberately applied AFTER this clamp. That
        -- guarantees points the customer spent on a cancelled order are restored
        -- in full and can never be consumed to cover an earn-reversal shortfall.
        if v_earn_requested > 0 then
          v_earn_reversed := least(greatest(v_balance, 0), v_earn_requested);
          v_balance := greatest(0, v_balance - v_earn_reversed);

          update public.profiles
             set loyalty_points = v_balance
           where id = v_order.customer_id;

          -- Write even a zero-point row when there is a full shortfall. The
          -- reason is the audit evidence that a reversal was attempted and how
          -- much could actually be recovered without taking a balance negative.
          insert into public.loyalty_transactions
            (profile_id, order_id, type, points, balance_after, reason, created_by)
          values
            (v_order.customer_id, v_order.id, 'adjustment', -v_earn_reversed,
             v_balance,
             format(
               'Cancelled order earn reversal: requested=%s reversed=%s shortfall=%s',
               v_earn_requested, v_earn_reversed, v_earn_requested - v_earn_reversed
             ),
             auth.uid());
        end if;

        if v_redeemed > 0 then
          v_balance := v_balance + v_redeemed;

          update public.profiles
             set loyalty_points = v_balance
           where id = v_order.customer_id;

          insert into public.loyalty_transactions
            (profile_id, order_id, type, points, balance_after, reason, created_by)
          values
            (v_order.customer_id, v_order.id, 'adjustment', v_redeemed,
             v_balance,
             format('Cancelled order redemption refund: restored=%s', v_redeemed),
             auth.uid());
        end if;
      end if;
    end if;

    -- place_order consumes one coupon usage only when a real coupon discount was
    -- applied. Return that slot on cancellation, once, with a floor at zero.
    if v_order.coupon_code is not null and coalesce(v_order.discount_amount, 0) > 0 then
      update public.coupons
         set usage_count = greatest(0, usage_count - 1)
       where code = upper(trim(v_order.coupon_code));
    end if;
  end if;

  -- PROMOTION. Delivery is the settlement signal this system actually has: a
  -- cash order that is handed over has been paid for, and an online order that
  -- was never paid never reaches here. Deliberately NOT wired into the payment
  -- confirmation path, which is frozen under CLAUDE.md §6.
  if p_status = 'delivered' and v_order.customer_id is not null then
    select greatest(0, coalesce(sum(points), 0)) into v_earn_requested
      from public.loyalty_transactions
     where order_id = v_order.id and type = 'earn_pending';

    -- Idempotent by construction: if an 'earn' row already exists for this
    -- order the promotion has run, and a repeated delivery transition must not
    -- credit twice.
    if v_earn_requested > 0 and not exists (
      select 1 from public.loyalty_transactions
       where order_id = v_order.id and type = 'earn'
    ) then
      select coalesce(loyalty_points, 0) into v_balance
        from public.profiles where id = v_order.customer_id for update;

      if found then
        v_balance := v_balance + v_earn_requested;

        update public.profiles
           set loyalty_points = v_balance
         where id = v_order.customer_id;

        insert into public.loyalty_transactions
          (profile_id, order_id, type, points, balance_after, reason, created_by)
        values
          (v_order.customer_id, v_order.id, 'earn', v_earn_requested, v_balance,
           'Earned on order ' || v_order.order_number || ' (delivered)', auth.uid());
      end if;
    end if;
  end if;

  update public.orders
     set status = p_status,
         updated_at = now()
   where id = v_order.id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Self-verification
-- ---------------------------------------------------------------------------
-- A plpgsql body is not name-resolved at creation, so a clean apply proves only
-- that the text was stored. Every assertion below is written to be able to fail,
-- and each names a specific way this change could have gone wrong.
do $verify$
declare
  v_src   text;
  v_n     integer;
  v_before integer;
begin
  -- (a) The CHECK admits the new type and keeps every old one.
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.loyalty_transactions'::regclass
     and conname = 'loyalty_transactions_type_check'
     and pg_get_constraintdef(oid) like '%earn_pending%'
     and pg_get_constraintdef(oid) like '%earn%'
     and pg_get_constraintdef(oid) like '%redeem%'
     and pg_get_constraintdef(oid) like '%adjustment%'
     and pg_get_constraintdef(oid) like '%expire%';
  if v_n <> 1 then
    raise exception 'loyalty_transactions type CHECK was not widened correctly';
  end if;

  -- (b) place_order must no longer add the earn to the balance. This is THE
  --     defect; if this assertion passes vacuously the migration is pointless.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_src is null then
    raise exception 'place_order is missing';
  end if;
  if v_src like '%v_bal_start - v_loyalty_redeemed + v_points_earned%' then
    raise exception 'place_order still credits the earn at creation';
  end if;
  if v_src not like '%greatest(0, v_bal_start - v_loyalty_redeemed)%' then
    raise exception 'place_order lost the redemption debit';
  end if;
  if v_src not like '%''earn_pending''%' then
    raise exception 'place_order does not record a pending earn';
  end if;

  -- (c) Redemption must STILL debit at creation. Fixing the earn by removing
  --     the whole block would let points be spent twice.
  if v_src not like '%''redeem'', -v_loyalty_redeemed%' then
    raise exception 'place_order no longer debits redeemed points';
  end if;

  -- (d) The promotion exists, is idempotent, and reversal reads actual credits.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_set_order_status';
  if v_src is null then
    raise exception 'admin_set_order_status is missing';
  end if;
  if v_src not like '%p_status = ''delivered''%' then
    raise exception 'admin_set_order_status has no delivery promotion branch';
  end if;
  if v_src not like '%type = ''earn_pending''%' then
    raise exception 'the promotion does not read pending earns';
  end if;
  if v_src like '%coalesce(v_order.loyalty_points_earned, 0))%' then
    raise exception 'cancellation still reverses the PROMISE rather than the credit';
  end if;

  -- (e) Neither function may become client-reachable as a side effect.
  if has_function_privilege('authenticated',
       'public.place_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)', 'EXECUTE') then
    raise exception 'place_order became executable by authenticated';
  end if;

  -- (f) APPLYING THIS MUST MOVE NO CUSTOMER VALUE.
  --
  -- The first draft of this block additionally required the ledger to be
  -- NON-EMPTY, meaning to assert "existing rows were preserved". The local chain
  -- rejected it immediately, and rightly: on a fresh database the table IS empty,
  -- so the assertion encoded an environment assumption (Production, 65 rows) as
  -- though it were an invariant. A migration has to apply to both.
  --
  -- What is actually guaranteed needs no count at all. Neither statement above
  -- touches a row: widening a CHECK and replacing two function bodies cannot
  -- rewrite data. And `alter table ... add constraint` VALIDATES against every
  -- existing row as it runs, so if any stored type were outside the widened
  -- vocabulary this migration would already have failed before reaching here.
  -- The one thing left worth asserting is that this is a first apply.
  select count(*) into v_before from public.loyalty_transactions where type = 'earn_pending';
  if v_before <> 0 then
    raise exception 'earn_pending rows already exist (%), so this is not a first apply', v_before;
  end if;

  select count(*) into v_n from public.loyalty_transactions;
  raise notice 'loyalty earn deferred to settlement; % existing ledger row(s) revalidated and untouched', v_n;
end
$verify$;
