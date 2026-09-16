-- ============================================================================
-- Spicy Meal — the order path refuses a CLOSED PRICE TIER
--
-- THE MONEY PATH. This is the file that makes `20260923120000` mean something.
-- That migration created `branch_variant_availability` and the RPCs that write
-- it, and deliberately stopped there: nothing read the table, so closing a tier
-- changed nothing. Here `place_order` and `compute_order_snapshot` learn to
-- refuse one, exactly as they already refuse a closed product and — in
-- `place_order` — a closed modifier.
--
-- Split from the table for the reason the 2026-08-20 modifier rollout gives in
-- its own header: "That re-emission is a separate migration so it can be
-- reviewed and reverted on its own."
--
-- BOTH MONEY-PATH HASHES MOVE. That is the intended effect of this work, not an
-- anomaly. Recorded before, from live on 2026-09-16:
--
--     place_order              pg_get_functiondef md5  bfd3f1f423e61c850ab6101e37431799
--     compute_order_snapshot   pg_get_functiondef md5  ca276a84424e403a98d34860817f815c
--
-- DERIVED, NOT RETYPED. Each body is the live body with ONE anchored insertion.
-- The anchor is `v_unit_price := coalesce(v_variant.price, v_product.price);`,
-- which occurs exactly once in each. The generator refuses to run unless the
-- pre-image it edits hashes to the text Production is executing:
--
--     place_order              prosrc md5 1c854febfa239dc93ee594e704fa18f1  24 827 chars
--     compute_order_snapshot   prosrc md5 52490fe4d9b692c4b8631a28977c3d73  15 398 chars
--
-- A line diff of old body vs new is ONE HUNK each, +26 lines, ZERO removed.
-- Resulting bodies:
--
--     place_order              prosrc md5 33468a7638e052d37970db54b4b1ec79  26,288 chars
--     compute_order_snapshot   prosrc md5 ca2c2a1c3a24809d16c45eb95aaa9aa1  16,859 chars
--
-- WHY `compute_order_snapshot` TOO, THOUGH IT HAS NEVER HAD THE MODIFIER CHECK.
-- That asymmetry is pre-existing and is not widened here. But this function
-- creates orders through `insert_order_from_snapshot`, so a gap in it is a real
-- gap the moment online payment is enabled — which is precisely how
-- `20260921120000` came to be written, after `20260918120000` fixed one of two
-- order-creation paths and was recorded as having fixed both. Enumerate every
-- implementation of a behaviour before declaring it closed.
--
-- NO DEPLOY IMPLIED. Both signatures are unchanged, so every existing caller
-- binds to the new body (ledger row 77's lesson).
--
-- APPLYING THIS CHANGES NOTHING TODAY, and that is by construction rather than
-- by luck: `branch_variant_availability` is empty, and the only things that can
-- write it are two RPCs no shipped client calls. The operator buttons are held
-- back until the customer app can read the table — otherwise a cashier closing
-- a size would give customers a bare "Something went wrong" at the payment
-- step, because no client checks tiers before submitting.
-- ============================================================================

-- ---- Refuse to apply out of order -------------------------------------------
-- `20260923120000` must already be in place. Without the table these bodies
-- would still be STORED — a plpgsql body is not name-resolved at creation — and
-- would then raise on the first real order. That failure would land on a
-- customer at checkout, so it is caught here instead.
do $$
declare
  v_missing text;
begin
  select string_agg(o, ', ') into v_missing
  from unnest(array[
    'table public.branch_variant_availability',
    'function public.set_variant_snooze',
    'function public.clear_variant_snooze',
    'column branch_availability_events.variant_id',
    'column branch_availability_runs.variants_reopened'
  ]) as o
  where case o
    when 'table public.branch_variant_availability'
      then to_regclass('public.branch_variant_availability') is null
    when 'function public.set_variant_snooze'
      then to_regprocedure('public.set_variant_snooze(uuid,uuid,integer,text,text)') is null
    when 'function public.clear_variant_snooze'
      then to_regprocedure('public.clear_variant_snooze(uuid,uuid)') is null
    when 'column branch_availability_events.variant_id'
      then not exists (select 1 from information_schema.columns
                       where table_schema='public' and table_name='branch_availability_events'
                         and column_name='variant_id')
    else not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='branch_availability_runs'
                       and column_name='variants_reopened')
  end;

  if v_missing is not null then
    raise exception
      'apply 20260923120000_branch_variant_availability first; missing: %', v_missing;
  end if;

  -- The sweeper must already reopen tiers. Without it a timed closure here
  -- would never expire, turning every snooze into a permanent delisting.
  if position('branch_variant_availability' in (
       select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='branch_availability_sweep')) = 0 then
    raise exception 'branch_availability_sweep does not reopen variants; apply 20260923120000 first';
  end if;
end $$;

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

    -- ---- Price tier availability ------------------------------------------
    -- Per-branch TIER availability. Nothing else enforces this: the tier was
    -- resolved above from `product_variants` alone, which knows whether a size
    -- exists but not whether this branch can sell it today.
    --
    -- Placed AFTER resolution and BEFORE the price, so it covers both arms —
    -- the tier the cart named, and the cheapest-tier fallback a stale client
    -- gets. Same lazy-expiry rule as products and modifiers: a timer that has
    -- run out is not a closure, an untimed closure still blocks.
    --
    -- THE FALLBACK IS REFUSED, NOT SUBSTITUTED, and that is deliberate. When
    -- the cheapest tier is closed this raises instead of promoting the order to
    -- the next cheapest, because `products.price` is what a pre-tier client
    -- displayed and charging above it would break the rule the block above
    -- states in its own words: the price charged may never exceed the price
    -- displayed. Refusing is the conservative direction.
    if v_variant.id is not null and exists (
      select 1 from public.branch_variant_availability bva
      where bva.branch_id = p_branch_id
        and bva.variant_id = v_variant.id
        and bva.is_available = false
        and (bva.snoozed_until is null or bva.snoozed_until > now())
    ) then
      raise exception 'A size in your cart is not available at the selected branch';
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
  -- The same eligible lines, each already multiplied by whatever campaign
  -- applies to it. Kept ALONGSIDE v_eligible rather than replacing it: the
  -- clamp below is computed from the unweighted figure, so a 2x campaign
  -- cannot be clipped by the order total it is supposed to exceed.
  v_weighted     numeric(12,2) := 0;
  v_multiplier   numeric(4,2);
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

    -- ---- Price tier availability ------------------------------------------
    -- Per-branch TIER availability. Nothing else enforces this: the tier was
    -- resolved above from `product_variants` alone, which knows whether a size
    -- exists but not whether this branch can sell it today.
    --
    -- Placed AFTER resolution and BEFORE the price, so it covers both arms —
    -- the tier the cart named, and the cheapest-tier fallback a stale client
    -- gets. Same lazy-expiry rule as products and modifiers: a timer that has
    -- run out is not a closure, an untimed closure still blocks.
    --
    -- THE FALLBACK IS REFUSED, NOT SUBSTITUTED, and that is deliberate. When
    -- the cheapest tier is closed this raises instead of promoting the order to
    -- the next cheapest, because `products.price` is what a pre-tier client
    -- displayed and charging above it would break the rule the block above
    -- states in its own words: the price charged may never exceed the price
    -- displayed. Refusing is the conservative direction.
    if v_variant.id is not null and exists (
      select 1 from public.branch_variant_availability bva
      where bva.branch_id = p_branch_id
        and bva.variant_id = v_variant.id
        and bva.is_available = false
        and (bva.snoozed_until is null or bva.snoozed_until > now())
    ) then
      raise exception 'A size in your cart is not available at the selected branch';
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
      -- CAMPAIGN MULTIPLIER, resolved per line because a campaign may be scoped
      -- to one product or one category. Returns exactly 1 when nothing applies,
      -- which is what makes an order with no live campaign arithmetically
      -- identical to the previous step.
      v_multiplier := public.loyalty_multiplier_for(
        v_product.id, v_product.category_id, p_branch_id, now());
      v_weighted := v_weighted + (v_unit_price * v_qty * v_multiplier);
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

-- ---- Self-verification -------------------------------------------------------
-- Asserts the exact property this file exists for, and the boundaries it must
-- not move. Every assertion is a value that can be false.
do $$
declare
  v_po  text;
  v_cos text;
  v_n   integer;
begin
  -- 0. CARDINALITY FIRST, and that ordering is the point rather than tidiness.
  --    Every assertion below reads a body with `select prosrc into`, which with
  --    two overloads present takes an arbitrary one -- so a stale sibling would
  --    be silently graded instead of the function this file wrote, and which
  --    assertion happened to fail would be luck. Mutation testing found exactly
  --    that: a planted overload was caught by the reference count rather than by
  --    the overload check, which therefore proved nothing. Count first, read
  --    second.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname in ('place_order','compute_order_snapshot');
  if v_n <> 2 then
    raise exception 'expected exactly one overload of each money-path function, found %', v_n;
  end if;

  select p.prosrc into v_po from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='place_order';
  select p.prosrc into v_cos from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='compute_order_snapshot';

  if v_po is null or v_cos is null then
    raise exception 'a money-path function is missing after this migration';
  end if;

  -- 1. BOTH carry the check, exactly once each. "Both" is the word
  --    `20260918120000` got wrong, and the gap it hid took another migration to
  --    close — so it is asserted here rather than assumed.
  if (length(v_po)  - length(replace(v_po,  'branch_variant_availability', ''))) / 27 <> 1 then
    raise exception 'place_order does not reference branch_variant_availability exactly once';
  end if;
  if (length(v_cos) - length(replace(v_cos, 'branch_variant_availability', ''))) / 27 <> 1 then
    raise exception 'compute_order_snapshot does not reference branch_variant_availability exactly once';
  end if;

  -- 2. The refusal a customer would meet, in both.
  if position('A size in your cart is not available at the selected branch' in v_po) = 0
     or position('A size in your cart is not available at the selected branch' in v_cos) = 0 then
    raise exception 'the size refusal is missing from a money-path function';
  end if;

  -- 3. THE LAZY-EXPIRY CLAUSE IS THE PART A CARELESS EDIT LOSES. Without it an
  --    elapsed timer keeps blocking until the sweeper runs, which is a customer
  --    refused for an item that is actually back.
  if position('bva.snoozed_until is null or bva.snoozed_until > now()' in v_po) = 0
     or position('bva.snoozed_until is null or bva.snoozed_until > now()' in v_cos) = 0 then
    raise exception 'the variant check lost its lazy-expiry clause';
  end if;

  -- 4. Everything the earlier money-path migrations installed is still there.
  --    Re-emitting a stale body is the one way this file could silently revert
  --    someone else's work, and no counter would show it.
  if position('v_loyalty_channel_ok' in v_po) = 0
     or position('v_loyalty_channel_ok' in v_cos) = 0 then
    raise exception 'the pickup-only loyalty gate (20260907120000) was lost';
  end if;
  if position('coalesce(v_product.earns_loyalty_points, true)' in v_po) = 0
     or position('coalesce(v_product.earns_loyalty_points, true)' in v_cos) = 0 then
    raise exception 'the per-item loyalty exclusion (20260908120000) was lost';
  end if;
  if position('loyalty_multiplier_for' in v_po) = 0
     or position('loyalty_multiplier_for' in v_cos) = 0 then
    raise exception 'the loyalty multiplier resolution (20260910120000) was lost';
  end if;
  -- THE STATEMENT, NOT THE WORD. This assertion first read
  -- `position('earn_pending' in v_po)`, and mutation testing killed it: the two
  -- comments immediately above the insert also say `earn_pending`, so an edit
  -- that changed only the written VALUE to 'earn' left the word in the body and
  -- the check passed. A check a comment can satisfy is not a check.
  if position(', ''earn_pending'', v_points_earned,' in v_po) = 0 then
    raise exception 'the deferred-earning rule (20260918120000) was lost from place_order';
  end if;

  -- 5. The cheapest-tier fallback survives. Removing it is how ordering broke
  --    for a whole day on 2026-08-25, and this file edits the block right above
  --    it.
  if position('order by price asc, sort_order asc, id asc' in v_po) = 0
     or position('order by price asc, sort_order asc, id asc' in v_cos) = 0 then
    raise exception 'the cheapest-tier fallback was lost';
  end if;

  -- 6. CONTAINMENT UNCHANGED. Both remain service_role-only; neither client
  --    role may call them. These functions take a caller-supplied customer id.
  if has_function_privilege('anon', 'public.place_order(uuid,order_type,jsonb,uuid,text,text,integer,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.place_order(uuid,order_type,jsonb,uuid,text,text,integer,uuid,text)', 'EXECUTE') then
    raise exception 'place_order became reachable by a client role';
  end if;
  if has_function_privilege('anon', 'public.compute_order_snapshot(uuid,uuid,order_type,jsonb,uuid,text,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.compute_order_snapshot(uuid,uuid,order_type,jsonb,uuid,text,integer)', 'EXECUTE') then
    raise exception 'compute_order_snapshot became reachable by a client role';
  end if;
end $$;
