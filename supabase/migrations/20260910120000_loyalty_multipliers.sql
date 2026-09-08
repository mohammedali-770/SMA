-- ============================================================================
-- Loyalty v2, step 4 — CAMPAIGN MULTIPLIERS ("double points", "+50% points").
--
-- WHAT THE OWNER ASKED FOR
-- "fixability with campaign ideas, x2 points or x% more points".
--
-- A DELIBERATELY SEPARATE TABLE FROM `campaigns`, and the reason is not tidiness.
-- `campaigns` is DISCOUNT-shaped: its `type` CHECK admits only percentage /
-- fixed / free_delivery, `campaigns_percentage_range` caps a value at 100, and
-- `max_discount_amount` describes money off. A points multiplier is none of
-- those. More to the point, that whole feature is blocked on eight unanswered
-- business questions (docs/DISCOUNTS_CAMPAIGNS.md) and has no UI at all -- 0 rows
-- and unreachable from either app. Borrowing its SHAPE is free; inheriting its
-- blockage would mean this step could not ship either.
--
-- THE MULTIPLIER ONLY EVER BOOSTS: the CHECK is `between 1 and 10`.
--   * Below 1 would be a second, silent way to REDUCE earning, and step 2
--     already owns that question with `products.earns_loyalty_points`. Two
--     mechanisms for one outcome is how an item ends up mysteriously earning
--     nothing.
--   * Above 10 is almost certainly a typo. 2 and 1.5 are the real cases; the
--     ceiling turns a slipped decimal point into a rejected insert rather than a
--     very expensive weekend.
--
-- HOW IT COMPOSES WITH STEPS 1-3, WHICH IS THE WHOLE RISK
-- Earning already survived three rules: the pickup-only channel gate, the
-- per-item exclusion, and the clamp to the payable total. A multiplier applied
-- carelessly breaks the third: `least(v_earn_base, v_total)` exists to stop the
-- delivery fee and a comped order inflating the base, and a 2x campaign
-- LEGITIMATELY exceeds the order total -- so multiplying before the clamp would
-- let the clamp silently cancel the campaign.
--
-- So the multiplier is applied AFTER the clamp, as a RATIO:
--
--     eligible  = SUM(line_total)                         over earning lines
--     weighted  = SUM(line_total * multiplier_for_line)   over the same lines
--     earn_base = clamp(0, min(eligible - pro_rata_discounts, total))   [step 2]
--     points    = floor(earn_base * (weighted / eligible) * points_per_riyal)
--
-- Every guarantee from step 2 survives untouched: a comped order still has
-- earn_base 0, so it earns 0 whatever campaign is live; the delivery fee is
-- still absent from `eligible`; and a cart with no campaign has weighted =
-- eligible, a ratio of exactly 1, and therefore points ARITHMETICALLY IDENTICAL
-- to step 2. That last property is the most important thing in this file and the
-- suite asserts it directly.
--
-- WHY PER LINE RATHER THAN PER ORDER
-- "Double points on burgers this week" is the shape these campaigns actually
-- take, so the multiplier resolves per line against the product and its
-- category. An order-level multiplier would have been simpler and could not
-- express that.
--
-- WHICH CAMPAIGN WINS WHEN SEVERAL APPLY
-- Overlapping campaigns are ALLOWED -- a house-wide 1.5x plus a 2x on one
-- product is a reasonable thing to run -- so instead of forbidding overlap,
-- resolution is deterministic: most specific scope first (product beats
-- category beats branch beats house-wide), then the larger multiplier, then the
-- older row. Exactly one applies to any given line.
--
-- MONEY PATH: THE HASHES CHANGE A THIRD TIME. Same note as steps 1 and 2.
--
-- NOTHING IS LIVE ON APPLY. The table is created EMPTY, and an empty table
-- resolves to a multiplier of 1 for every line, so applying this file changes no
-- order's points. The self-verification asserts that rather than assuming it.
--
-- CHECKOUT NEEDS NO CHANGE, and that is step 2 paying off: the "You'll earn N
-- points" line is computed by `preview_loyalty_points`, which calls
-- `compute_order_snapshot`, so it shows the campaign figure automatically. Had
-- the client been given its own copy of the earning rule, this step would have
-- needed a fourth mirror.
--
-- EVIDENCE AND OPERATION: docs/LOYALTY.md section 5.
-- Coverage: supabase/tests/loyalty_multipliers_test.sql.
-- ============================================================================

-- ---- 1. The table -----------------------------------------------------------
create table if not exists public.loyalty_multipliers (
  id          uuid primary key default gen_random_uuid(),
  name_en     text not null,
  name_ar     text not null,
  -- Only ever boosts. See the header for why below 1 and above 10 are refused.
  multiplier  numeric(4,2) not null check (multiplier >= 1 and multiplier <= 10),
  -- NULL bound = open-ended in that direction.
  starts_at   timestamptz,
  ends_at     timestamptz,
  -- Scope. All three NULL = the whole menu, every branch.
  branch_id   uuid references public.branches(id)   on delete cascade,
  product_id  uuid references public.products(id)   on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  constraint loyalty_multipliers_window_ordered
    check (starts_at is null or ends_at is null or ends_at >= starts_at),
  -- A row targets a product OR a category, never both: "this product, but only
  -- when it is in that category" is not a rule anybody means, and allowing it
  -- would make the specificity ranking ambiguous.
  constraint loyalty_multipliers_one_scope
    check (product_id is null or category_id is null)
);

comment on table public.loyalty_multipliers is
  'Points-earning campaigns (x2 points, +50% points). Separate from `campaigns`, '
  'which is discount-shaped and blocked on open business questions. Multipliers '
  'only ever increase earning; per-item exclusion lives on products.earns_loyalty_points.';

create index if not exists loyalty_multipliers_live_idx
  on public.loyalty_multipliers (is_active, starts_at, ends_at);
create index if not exists loyalty_multipliers_scope_idx
  on public.loyalty_multipliers (product_id, category_id, branch_id);

drop trigger if exists set_loyalty_multipliers_updated_at on public.loyalty_multipliers;
create trigger set_loyalty_multipliers_updated_at
  before update on public.loyalty_multipliers
  for each row execute function public.set_updated_at();

alter table public.loyalty_multipliers enable row level security;

-- Customers never read this table. They see the RESULT -- through the points
-- figure at checkout and on the receipt -- which is computed by SECURITY DEFINER
-- functions that do not need a client-visible grant. Staff read; admins write.
revoke all on public.loyalty_multipliers from anon, authenticated;
grant select on public.loyalty_multipliers to authenticated;
grant insert, update, delete on public.loyalty_multipliers to authenticated;

drop policy if exists loyalty_multipliers_select_staff on public.loyalty_multipliers;
create policy loyalty_multipliers_select_staff on public.loyalty_multipliers
  for select to authenticated using (public.is_staff());

drop policy if exists loyalty_multipliers_admin_insert on public.loyalty_multipliers;
create policy loyalty_multipliers_admin_insert on public.loyalty_multipliers
  for insert to authenticated with check (public.is_admin());

drop policy if exists loyalty_multipliers_admin_update on public.loyalty_multipliers;
create policy loyalty_multipliers_admin_update on public.loyalty_multipliers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists loyalty_multipliers_admin_delete on public.loyalty_multipliers;
create policy loyalty_multipliers_admin_delete on public.loyalty_multipliers
  for delete to authenticated using (public.is_admin());

-- ---- 2. Which campaign applies to this line? --------------------------------
-- Returns 1 when nothing applies, so every caller can multiply unconditionally.
-- STABLE rather than immutable: it reads a table.
create or replace function public.loyalty_multiplier_for(
  p_product  uuid,
  p_category uuid,
  p_branch   uuid,
  p_at       timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.multiplier
       from public.loyalty_multipliers m
      where m.is_active
        and (m.starts_at is null or m.starts_at <= p_at)
        and (m.ends_at   is null or m.ends_at   >= p_at)
        and (m.branch_id   is null or m.branch_id   = p_branch)
        and (m.product_id  is null or m.product_id  = p_product)
        and (m.category_id is null or m.category_id = p_category)
      -- Most specific wins, and the weights make that ordering explicit rather
      -- than implied: a product rule beats a category rule beats a branch rule
      -- beats a house-wide one. Ties fall to the larger multiplier, then the
      -- older row, so the answer is stable across calls and across replicas.
      order by ((case when m.product_id  is not null then 4 else 0 end)
              + (case when m.category_id is not null then 2 else 0 end)
              + (case when m.branch_id   is not null then 1 else 0 end)) desc,
               m.multiplier desc,
               m.created_at asc,
               m.id asc
      limit 1),
    1);
$$;

-- NOT granted to `authenticated`, and that is the point rather than an oversight.
--
-- The table's select policy is `is_staff()`, so a customer cannot read the
-- campaign list. Granting this resolver to `authenticated` would have handed the
-- same information back through the front door: it takes `p_at`, so a customer
-- could ask "what is the multiplier on this product NEXT MONTH" and enumerate
-- targeted and not-yet-started campaigns one probe at a time. A protection the
-- policy provides and a helper undoes is not a protection. Review caught it on
-- #338.
--
-- Nothing legitimate loses access. `place_order`, `compute_order_snapshot` and
-- `preview_loyalty_points` are all `security definer` owned by the same role
-- that owns this function, so they call it as the owner and never through the
-- caller's grants -- which is why the customer still sees a correct
-- campaign-aware "you'll earn N points" figure. No client code calls it
-- directly, and case 11 asserts a customer session cannot.
revoke all on function public.loyalty_multiplier_for(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.loyalty_multiplier_for(uuid, uuid, uuid, timestamptz)
  to service_role;

-- ---- 3. The two money-path functions, changed identically -------------------
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
-- ---- 4. Self-verification ---------------------------------------------------
do $$
declare
  v_pw integer; v_sw integer; v_pm integer; v_sm integer;
  v_gate_p integer; v_gate_s integer; v_base_p integer; v_base_s integer;
  v_rows integer; v_anon boolean;
begin
  -- (a) Parity of the new weighting across the twin pricing functions.
  select count(*) into v_pw from regexp_matches(
    (select prosrc from pg_proc where proname='place_order'), 'v_weighted', 'g');
  select count(*) into v_sw from regexp_matches(
    (select prosrc from pg_proc where proname='compute_order_snapshot'), 'v_weighted', 'g');
  select count(*) into v_pm from regexp_matches(
    (select prosrc from pg_proc where proname='place_order'), 'loyalty_multiplier_for', 'g');
  select count(*) into v_sm from regexp_matches(
    (select prosrc from pg_proc where proname='compute_order_snapshot'), 'loyalty_multiplier_for', 'g');
  if v_pw <> v_sw or v_pm <> v_sm or v_pw < 3 or v_pm < 1 then
    raise exception 'multiplier parity failed: weighted %/%, resolver %/% (place/snapshot)',
      v_pw, v_sw, v_pm, v_sm;
  end if;

  -- (b) Steps 1 and 2 must still be present in BOTH. This file rewrites the same
  --     two bodies, so their guarantees are exactly what a careless rewrite loses.
  select count(*) into v_gate_p from regexp_matches(
    (select prosrc from pg_proc where proname='place_order'), 'v_loyalty_channel_ok', 'g');
  select count(*) into v_gate_s from regexp_matches(
    (select prosrc from pg_proc where proname='compute_order_snapshot'), 'v_loyalty_channel_ok', 'g');
  if v_gate_p <> 4 or v_gate_s <> 4 then
    raise exception 'the pickup-only gate was lost: %/% (expected 4 each)', v_gate_p, v_gate_s;
  end if;
  select count(*) into v_base_p from regexp_matches(
    (select prosrc from pg_proc where proname='place_order'), 'v_earn_base', 'g');
  select count(*) into v_base_s from regexp_matches(
    (select prosrc from pg_proc where proname='compute_order_snapshot'), 'v_earn_base', 'g');
  if v_base_p <> v_base_s or v_base_p < 5 then
    raise exception 'the eligible base was lost: %/%', v_base_p, v_base_s;
  end if;

  -- (c) THE CLAMP MUST STILL PRECEDE THE MULTIPLIER. Stated as a source check
  --     because it is an ORDERING property, and no value test can distinguish it
  --     until somebody runs a campaign big enough to hit the ceiling.
  if (select prosrc from pg_proc where proname='place_order')
       !~ 'greatest\(0, least\(v_earn_base, v_total\)\)' then
    raise exception 'place_order no longer clamps the base before the multiplier';
  end if;

  -- (d) NOTHING IS LIVE. An empty table resolves to 1 for every line.
  select count(*) into v_rows from public.loyalty_multipliers;
  if v_rows <> 0 then
    raise exception 'loyalty_multipliers is not empty after apply (% rows)', v_rows;
  end if;
  if public.loyalty_multiplier_for(null, null, null, now()) <> 1 then
    raise exception 'an empty multiplier table does not resolve to 1';
  end if;

  -- (e) The resolver is not reachable anonymously.
  select has_function_privilege('anon',
    'public.loyalty_multiplier_for(uuid, uuid, uuid, timestamptz)', 'execute') into v_anon;
  if v_anon then
    raise exception 'loyalty_multiplier_for must not be callable by anon';
  end if;

  raise notice 'LOYALTY MULTIPLIERS OK (table empty, resolver neutral, clamp still ahead of the ratio)';
end $$;
