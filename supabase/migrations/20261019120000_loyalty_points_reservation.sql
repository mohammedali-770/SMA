-- ============================================================================
-- 20261019120000_loyalty_points_reservation
--
-- Loyalty points promised to an open card checkout are RESERVED; a card order
-- records only the points it actually debited; cancelling refunds only what the
-- ledger says was taken.
--
-- WRITTEN, AWAITING APPROVAL. NOT APPLIED. A MONEY-PATH CHANGE: it redefines
-- place_order, so that function's md5(pg_get_functiondef) moves. That is the
-- intended effect. compute_order_snapshot, begin_checkout_session and
-- finalize_checkout_session are NOT touched.
--
-- Audit findings closed (docs/readiness/20261119-full-audit-plan, all high):
--   F-DBM-04-002  insert_order_from_snapshot keeps the loyalty discount when it
--                 cannot deduct the points (cash order during a card checkout).
--   F-DBM-18-001  the same, and cancelling the card order then mints the points.
--   F-DBM-27-001  a clamp to 0 left the snapshot's figure on the order row, and
--                 admin_set_order_status refunded that figure.
--   F-DBM-32-001  begin_session_attempt's guard stopped counting a session when
--                 its 30-minute window ended, although its attempt (up to 60
--                 minutes) could still be captured.
--
-- All four reproduced on a clone of the chain at fe53628 before this file was
-- written: 100 points bought two 10.00 SAR discounts (cash + card, and card +
-- card), and a card order whose points were never debited refunded 100 points on
-- cancellation.
--
-- ---- 1. The reservation ----------------------------------------------------
-- public.loyalty_points_reserved(customer, exclude_session) sums the snapshot
-- redemption of every checkout session of that customer whose payment can still
-- be captured. "Can still be captured" is read from the same columns
-- finalize_checkout_session and begin_session_attempt act on:
--   * the session is unconsumed (order_id is null) and in a status finalize
--     accepts ('pending_payment' or 'expired' -- finalize refuses 'cancelled'
--     and 'consumed');
--   * its total is above zero (a zero-total session is settled inside
--     begin_checkout_session and never reaches an attempt). loyalty_on is NOT
--     required: compute_order_snapshot redeems nothing when loyalty is off, and
--     begin_session_attempt's guard has never read it either;
--   * AND one of:
--       - it is 'pending_payment' inside its own window (expires_at > now()):
--         begin_session_attempt will still open an attempt for it;
--       - it has an 'initiated' attempt whose expires_at is in the future (or
--         null, which begin_session_attempt's own reuse test also treats as
--         live). payment-initiate bounds the Moyasar invoice by this column
--         (_shared/moyasar.ts invoiceExpiryForAttempt), not by the session's;
--       - it has an 'initiated' attempt that already carries provider_ref. The
--         confirm path stamps provider_ref only on a paid, binding-valid Moyasar
--         payment (_shared/moyasarVerify.ts stampPaymentRef), so such a row is a
--         captured payment whose finalize has not landed yet -- expired or not;
--       - it has an 'authorized' attempt (funds held at the provider).
-- 'paid', 'failed' and 'refunded' attempts reserve nothing: a paid attempt has
-- consumed its session (finalize sets order_id), the other two cannot capture.
--
-- Who honours it:
--   * place_order (the cash path, through place_customer_order). A redemption
--     larger than balance minus reserved is REFUSED, P0001, hint
--     'loyalty_points_reserved'. Without reserved points nothing changes: the
--     redemption is clamped to the balance exactly as before.
--   * begin_session_attempt. Its multi-spend guard now sums
--     loyalty_points_reserved for the customer's OTHER sessions instead of only
--     'pending_payment' sessions inside their window -- which is F-DBM-32-001.
--     Its error text is unchanged.
--   * insert_order_from_snapshot, for an order with nothing charged (the
--     zero-total session begin_checkout_session settles inline). Nothing was
--     captured, so it can still refuse, and it does, with place_order's error.
--     Without this the points-covered checkout is a third way round the
--     reservation, measured before this file was written.
-- begin_payment_attempt is not changed: it opens an attempt for an EXISTING
-- order, whose points place_order already debited when the order was written.
--
-- ---- 2. insert_order_from_snapshot settles before it writes ----------------
-- The profile row is locked and the redemption is decided BEFORE the order row
-- is inserted (the same lock order place_order uses), and the order is written
-- with the points actually debited. When a CHARGED order's live balance no
-- longer covers the snapshot (a residual race the reservation cannot close: an
-- admin adjustment, a loyalty expiry run, or a capture whose finalize lands
-- after its attempt expired and the points were spent), the payment has been
-- taken and must not be refused (finalize_checkout_session's own rule). So it
-- debits what is there, writes that figure to orders.loyalty_points_redeemed and
-- the 'redeem' ledger row, and records the difference in
-- public.loyalty_redemption_shortfalls. The discount and the total stay as
-- charged; the shortfall row is what staff review.
--
-- WHY A NEW TABLE AND NOT order_integrity_incidents. That table is owned by
-- order_integrity_watchdog, whose clean pass resolves any active incident it did
-- not itself detect this run after two scans ("auto_two_consecutive_clean_scans"
-- for every rule not disabled in rule_enabled). A row written here would be
-- auto-resolved within minutes, before its warning alert became eligible (15
-- minutes). Teaching the watchdog a LOYALTY_REDEMPTION_SHORTFALL rule means
-- redefining order_integrity_watchdog, which this change may not do. The table
-- is append-only and readable by admins under RLS; a watchdog rule over it is a
-- follow-up.
--
-- ---- 3. Cancellation reads the ledger --------------------------------------
-- admin_set_order_status now refunds the points the order's 'redeem' ledger rows
-- took, net of any earlier 'Cancelled order redemption refund:' adjustment for
-- the same order -- mirroring how the earn reversal already reads 'earn' rows.
-- orders.loyalty_points_redeemed is no longer read. The order-row lock and the
-- terminal 'cancelled' status remain the idempotency fence; the netting makes
-- the arithmetic idempotent as well.
--
-- WHAT DOES NOT CHANGE: cash-only behaviour, pickup-only loyalty, per-item
-- exclusion, multipliers, comp members and the earn_pending/promotion flow. The
-- earn side of every function is untouched, and the existing loyalty suites are
-- the evidence.
--
-- Bodies DERIVED from their last definitions by anchored substitutions, each
-- asserted to match exactly once by the generator:
--   place_order                 20260924120000_place_order_variant_availability.sql
--   begin_session_attempt       20261003120000_moyasar_only_payments.sql
--   insert_order_from_snapshot  20260921120000_loyalty_earn_snapshot_path.sql
--   admin_set_order_status      20260918120000_loyalty_earn_on_settlement.sql
-- No deploy implied: every signature is unchanged, so callers bind to the new
-- bodies. The app gains copy for the new refusal (next EAS build); until then
-- the customer sees the generic apology.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. The shortfall record
-- ---------------------------------------------------------------------------
-- Every create in this file is guarded, so the file re-applies cleanly: the
-- SQL CI replays the whole chain, which puts every earlier body back, and this
-- file must then land again to restore its own.
create table if not exists public.loyalty_redemption_shortfalls (
  id                      uuid primary key default gen_random_uuid(),
  -- No foreign key, on the order_status_audit precedent (20261007120000): an
  -- append-only row must neither block nor vanish with the row it describes.
  order_id                uuid not null,
  snapshot_points         integer not null check (snapshot_points > 0),
  debited_points          integer not null check (debited_points >= 0),
  shortfall_points        integer not null check (shortfall_points > 0),
  balance_at_settlement   integer,
  loyalty_discount_amount numeric(10,2) not null default 0,
  created_at              timestamptz not null default now(),
  constraint loyalty_redemption_shortfalls_sum_ck
    check (shortfall_points = snapshot_points - debited_points),
  constraint loyalty_redemption_shortfalls_one_per_order unique (order_id)
);

comment on table public.loyalty_redemption_shortfalls is
  'A paid card order whose snapshot redeemed more loyalty points than the live balance held when the order was written (20261019120000). The discount was kept, because the payment was already captured; only debited_points left the balance and only they are refunded on cancellation. One row per order, append-only, admin-readable. Staff review: decide whether to recover the difference.';

alter table public.loyalty_redemption_shortfalls enable row level security;

drop policy if exists loyalty_redemption_shortfalls_admin_read on public.loyalty_redemption_shortfalls;
create policy loyalty_redemption_shortfalls_admin_read
  on public.loyalty_redemption_shortfalls
  for select to authenticated
  using ((select public.is_admin()));

-- TRUNCATE ignores RLS, and this project's default privileges grant every
-- client role full table rights, so the grants are stated, not inherited.
revoke all on table public.loyalty_redemption_shortfalls from public, anon, authenticated;
grant select on table public.loyalty_redemption_shortfalls to authenticated;
grant all on table public.loyalty_redemption_shortfalls to service_role;

drop trigger if exists append_only_rows on public.loyalty_redemption_shortfalls;
create trigger append_only_rows
  before update or delete on public.loyalty_redemption_shortfalls
  for each row execute function public.audit_rows_are_append_only();
drop trigger if exists append_only_truncate on public.loyalty_redemption_shortfalls;
create trigger append_only_truncate
  before truncate on public.loyalty_redemption_shortfalls
  for each statement execute function public.audit_rows_are_append_only();

-- ---------------------------------------------------------------------------
-- 1. The reservation
-- ---------------------------------------------------------------------------
create or replace function public.loyalty_points_reserved(
  p_customer        uuid,
  p_exclude_session uuid default null
)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(sum(greatest(0, coalesce((s.snapshot->>'loyalty_points_redeemed')::int, 0))), 0)::int
    from public.checkout_sessions s
   where s.customer_id = p_customer
     and s.id is distinct from p_exclude_session
     and s.order_id is null
     and s.status in ('pending_payment', 'expired')
     and coalesce(s.total, 0) > 0
     and (
       (s.status = 'pending_payment' and s.expires_at > now())
       or exists (
         select 1 from public.payment_records pr
          where pr.checkout_session_id = s.id
            and (   pr.status = 'authorized'
                 or (pr.status = 'initiated'
                     and (pr.expires_at is null
                          or pr.expires_at > now()
                          or pr.provider_ref is not null)))
       )
     );
$$;

-- Called only from the SECURITY DEFINER money-path functions below, which run
-- as the owner. Not a client RPC: a customer-callable count of held points is a
-- probe into open payments, and nothing in the apps needs it.
revoke all on function public.loyalty_points_reserved(uuid, uuid) from public, anon, authenticated;
grant execute on function public.loyalty_points_reserved(uuid, uuid) to service_role;

comment on function public.loyalty_points_reserved(uuid, uuid) is
  'Loyalty points promised to the customer''s card checkouts whose payment can still be captured (20261019120000): unconsumed, payable sessions inside their window, or with a live, stamped or authorized attempt. place_order, begin_session_attempt and the zero-total arm of insert_order_from_snapshot refuse a redemption that would dip into them.';

-- ---------------------------------------------------------------------------
-- 2. place_order -- refuses points held by an open card checkout
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
  -- Points promised to the customer's open card checkouts (20261019120000).
  v_loyalty_reserved integer := 0;
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
    -- RESERVATION (20261019120000). Points an open card checkout will debit
    -- when its payment is captured are not available here. The profile row is
    -- already locked (above), and begin_session_attempt takes the same lock, so
    -- the two cannot interleave. Refused rather than clamped: a cash order
    -- quietly given a smaller discount than the customer chose is a price
    -- change at the counter. With nothing reserved this is never reached,
    -- because the redemption is already clamped to v_bal_start.
    if v_loyalty_redeemed > 0 then
      v_loyalty_reserved := public.loyalty_points_reserved(v_customer, null);
      if v_loyalty_redeemed > v_bal_start - v_loyalty_reserved then
        raise exception
          using
            errcode = 'P0001',
            message = 'Some of your loyalty points are held by a card payment that is still open. Order without points, or try again after that payment finishes.',
            hint    = 'loyalty_points_reserved';
      end if;
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

revoke all on function public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. begin_session_attempt -- the guard counts every capturable session
-- ---------------------------------------------------------------------------
create or replace function public.begin_session_attempt(
  p_session_id     uuid,
  p_provider       text,
  p_mode           text,
  p_expiry_minutes integer default 30
)
returns table (
  attempt_id            uuid,
  reference_transaction text,
  reference_order       text,
  provider_ref          text,
  provider_checkout_ref text,
  checkout_url          text,
  amount                numeric,
  currency              text,
  mode                  text,
  reused                boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session  public.checkout_sessions;
  v_existing public.payment_records;
  v_new      public.payment_records;
  v_ref      text;
  v_provider text := nullif(btrim(lower(coalesce(p_provider, ''))), '');
  v_expires  timestamptz := now() + make_interval(mins => greatest(5, least(60, coalesce(p_expiry_minutes, 30))));
  v_redeem   integer;
  v_other    integer;
  v_balance  integer;
begin
  if v_provider is null then
    raise exception 'A payment provider is required' using errcode = 'P0001';
  end if;

  select * into v_session from public.checkout_sessions where id = p_session_id for update;
  if not found then raise exception 'Checkout session % not found', p_session_id; end if;
  if v_session.order_id is not null then raise exception 'Checkout session already completed' using errcode = 'P0001'; end if;
  if v_session.status <> 'pending_payment' then raise exception 'Checkout session is not payable' using errcode = 'P0001'; end if;
  if v_session.expires_at <= now() then
    update public.checkout_sessions set status = 'expired' where id = p_session_id;
    raise exception 'Checkout session expired' using errcode = 'P0001';
  end if;
  if coalesce(v_session.total, 0) <= 0 then raise exception 'Order total must be greater than zero' using errcode = 'P0001'; end if;
  if v_session.total < 1.00 then raise exception 'Order total is below the online payment minimum of 1.00 SAR' using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_session.snapshot->'items') = 'array' then v_session.snapshot->'items' else '[]'::jsonb end) as e(value) where coalesce((e.value ->> 'quantity')::int, 0) > 50) then raise exception 'order_items_quantity_max: at most 50 of one item per order line.' using errcode = '23514'; end if;

  -- Loyalty multi-spend guard: the live balance must still cover the points this
  -- session redeems PLUS points reserved by the customer's other live sessions.
  -- The profile row lock serializes concurrent initiations.
  --
  -- "Reserved" is loyalty_points_reserved (20261019120000). It used to be only
  -- 'pending_payment' sessions inside their 30-minute window, so a session
  -- stopped counting the moment its window ended while its attempt -- and the
  -- Moyasar invoice bounded by that attempt -- could be paid for up to an hour
  -- (F-DBM-32-001). A session now counts for as long as it can be captured.
  v_redeem := coalesce((v_session.snapshot->>'loyalty_points_redeemed')::int, 0);
  if v_redeem > 0 then
    select coalesce(loyalty_points, 0) into v_balance
      from public.profiles where id = v_session.customer_id for update;
    v_other := public.loyalty_points_reserved(v_session.customer_id, v_session.id);
    if v_balance < v_redeem + v_other then
      raise exception 'Your loyalty points balance changed. Please rebuild your order.' using errcode = 'P0001';
    end if;
  end if;

  select * into v_existing from public.payment_records
    where checkout_session_id = p_session_id and provider = v_provider and status = 'initiated'
    order by created_at desc limit 1;
  if found then
    if v_existing.expires_at is not null and v_existing.expires_at <= now() then
      update public.payment_records
        set status = 'failed', failure_code = 'expired', failure_message_safe = 'Payment session expired'
        where id = v_existing.id;
    else
      return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                          v_existing.provider_ref, v_existing.provider_checkout_ref, v_existing.checkout_url,
                          v_existing.amount, v_existing.currency, v_existing.mode, true;
      return;
    end if;
  end if;

  v_ref := 'sm_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.payment_records
      (checkout_session_id, provider, status, amount, currency, mode, reference_transaction, reference_order, initiated_at, expires_at)
    values
      (p_session_id, v_provider, 'initiated', v_session.total, coalesce(v_session.currency, 'SAR'),
       case when p_mode = 'live' then 'live' else 'test' end,
       v_ref, 'CS-' || substr(replace(p_session_id::text, '-', ''), 1, 12), now(), v_expires)
    returning * into v_new;
  exception when unique_violation then
    select * into v_existing from public.payment_records
      where checkout_session_id = p_session_id and provider = v_provider and status = 'initiated'
      order by created_at desc limit 1;
    return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                        v_existing.provider_ref, v_existing.provider_checkout_ref, v_existing.checkout_url,
                        v_existing.amount, v_existing.currency, v_existing.mode, true;
    return;
  end;

  return query select v_new.id, v_new.reference_transaction, v_new.reference_order,
                      v_new.provider_ref, v_new.provider_checkout_ref, v_new.checkout_url,
                      v_new.amount, v_new.currency, v_new.mode, false;
end $$;

revoke all on function public.begin_session_attempt(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.begin_session_attempt(uuid, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. insert_order_from_snapshot -- settle first, write the debited figure
-- ---------------------------------------------------------------------------
create or replace function public.insert_order_from_snapshot(
  p_customer         uuid,
  p_snapshot         jsonb,
  p_payment_method   text,
  p_payment_status   text,
  p_idempotency_key  uuid default null,
  p_payment_provider text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    public.orders;
  v_item     jsonb;
  v_mod      jsonb;
  v_item_id  uuid;
  v_loyalty_on       boolean := coalesce((p_snapshot->>'loyalty_on')::boolean, false);
  v_redeemed         integer := coalesce((p_snapshot->>'loyalty_points_redeemed')::int, 0);
  v_earned           integer := coalesce((p_snapshot->>'loyalty_points_earned')::int, 0);
  v_coupon_raw       text    := p_snapshot->>'coupon_code_raw';
  v_discount         numeric(10,2) := coalesce((p_snapshot->>'discount_amount')::numeric, 0);
  v_bal_start        integer;
  v_bal_new          integer;
  -- 20261019120000. v_redeemed becomes what is actually DEBITED; the snapshot's
  -- figure is kept apart so the two can never be confused again.
  v_snap_redeemed    integer := coalesce((p_snapshot->>'loyalty_points_redeemed')::int, 0);
  v_shortfall        integer := 0;
  v_charged          numeric(10,2) := coalesce((p_snapshot->>'total')::numeric, 0);
begin
  -- SETTLE THE REDEMPTION FIRST, under the profile lock, before the order row
  -- exists (20261019120000; F-DBM-04-002, F-DBM-18-001, F-DBM-27-001). This
  -- used to insert the order with the snapshot's redemption and clamp the debit
  -- afterwards, so a balance spent elsewhere became a free discount, and a
  -- clamp to 0 left the snapshot's figure on the row for a cancellation to
  -- refund. The lock order -- profile, then orders -- is place_order's.
  if v_snap_redeemed > 0 then
    if v_loyalty_on then
      select coalesce(loyalty_points, 0) into v_bal_start
        from public.profiles where id = p_customer for update;
      v_redeemed := least(v_snap_redeemed, greatest(coalesce(v_bal_start, 0), 0));
    else
      v_redeemed := 0;
    end if;

    if v_charged <= 0 then
      -- NOTHING WAS CHARGED (the zero-total session begin_checkout_session
      -- settles inline), so refusing is still possible, and the points another
      -- open card checkout will debit are not available to it. Refused with
      -- place_order's own error.
      if v_redeemed < v_snap_redeemed
         or v_snap_redeemed > coalesce(v_bal_start, 0) - public.loyalty_points_reserved(p_customer, null) then
        raise exception
          using
            errcode = 'P0001',
            message = 'Some of your loyalty points are held by a card payment that is still open. Order without points, or try again after that payment finishes.',
            hint    = 'loyalty_points_reserved';
      end if;
    end if;

    -- A CHARGED order is never refused here: the payment has been captured
    -- (finalize_checkout_session's rule). Debit what is there, write THAT to
    -- the order, and record the rest below for staff.
    v_shortfall := v_snap_redeemed - v_redeemed;
  end if;

  insert into public.orders (
    customer_id, customer_name, customer_phone,
    branch_id, branch_name_en, branch_name_ar,
    status, order_type, subtotal, delivery_fee, discount_amount,
    loyalty_discount_amount, vat_amount, total, payment_status, payment_method,
    payment_provider, paid_at,
    coupon_code, notes, address_id, address_snapshot,
    loyalty_points_earned, loyalty_points_redeemed, loyalty_awarded_at,
    idempotency_key, is_comped, comp_discount_amount
  ) values (
    p_customer, p_snapshot->>'customer_name', p_snapshot->>'customer_phone',
    (p_snapshot->>'branch_id')::uuid, p_snapshot->>'branch_name_en', p_snapshot->>'branch_name_ar',
    'received', (p_snapshot->>'order_type')::public.order_type,
    (p_snapshot->>'subtotal')::numeric, (p_snapshot->>'delivery_fee')::numeric, v_discount,
    (p_snapshot->>'loyalty_discount_amount')::numeric, (p_snapshot->>'vat_amount')::numeric,
    (p_snapshot->>'total')::numeric, p_payment_status::public.payment_status, p_payment_method,
    p_payment_provider,
    case when p_payment_status = 'paid' then now() else null end,
    p_snapshot->>'coupon_code',
    p_snapshot->>'notes',
    nullif(p_snapshot->>'address_id','')::uuid,
    case when jsonb_typeof(p_snapshot->'address_snapshot') = 'object' then p_snapshot->'address_snapshot' else null end,
    v_earned, v_redeemed,
    case when v_loyalty_on and (v_redeemed > 0 or v_earned > 0) then now() else null end,
    p_idempotency_key,
    -- Straight from the snapshot: the comp was decided when the cart was
    -- priced, not re-derived here after the customer has gone.
    coalesce((p_snapshot->>'is_comped')::boolean, false),
    coalesce((p_snapshot->>'comp_discount_amount')::numeric, 0)
  )
  returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_snapshot->'items')
  loop
    insert into public.order_items (order_id, product_id, name_en, name_ar, unit_price, quantity, line_total, note,
                                    variant_id, variant_name_en, variant_name_ar)
    values (v_order.id, (v_item->>'product_id')::uuid, v_item->>'name_en', v_item->>'name_ar',
            (v_item->>'unit_price')::numeric, (v_item->>'quantity')::int, (v_item->>'line_total')::numeric,
            public.order_note_normalized(v_item->>'note'),
            nullif(v_item->>'variant_id','')::uuid,
            nullif(v_item->>'variant_name_en',''),
            nullif(v_item->>'variant_name_ar',''))
    returning id into v_item_id;

    for v_mod in select value from jsonb_array_elements(coalesce(v_item->'modifiers','[]'::jsonb))
    loop
      insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
      values (v_item_id, (v_mod->>'modifier_id')::uuid, v_mod->>'name_en', v_mod->>'name_ar', (v_mod->>'price')::numeric);
    end loop;
  end loop;

  -- Post-payment: never raise on the coupon (the discount was validated and the
  -- customer already paid); over-limit redemptions surface in reporting instead.
  if v_discount > 0 and v_coupon_raw is not null then
    update public.coupons
      set usage_count = usage_count + 1
      where code = upper(trim(v_coupon_raw));
  end if;

  if v_shortfall > 0 then
    insert into public.loyalty_redemption_shortfalls
      (order_id, snapshot_points, debited_points, shortfall_points,
       balance_at_settlement, loyalty_discount_amount)
    values
      (v_order.id, v_snap_redeemed, v_redeemed, v_shortfall, v_bal_start,
       coalesce((p_snapshot->>'loyalty_discount_amount')::numeric, 0));
  end if;

  if v_loyalty_on and (v_redeemed > 0 or v_earned > 0) then
    -- Already locked and read above when anything was redeemed; an earn-only
    -- order still takes the lock here, exactly as before.
    if v_bal_start is null then
      select coalesce(loyalty_points, 0) into v_bal_start from public.profiles where id = p_customer for update;
    end if;
    update public.profiles
      -- EARNING NO LONGER CREDITS HERE, exactly as in place_order since
      -- 20260918120000. Redemption still debits: the customer is spending
      -- points for a discount on THIS order, so deferring it would let the
      -- same points be spent twice.
      set loyalty_points = greatest(0, v_bal_start - v_redeemed)
      where id = p_customer
      returning loyalty_points into v_bal_new;
    if v_redeemed > 0 then
      insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
      -- v_bal_new no longer includes the earn, so it IS the post-redemption
      -- balance. Subtracting v_earned here would now double-count.
      values (p_customer, v_order.id, 'redeem', -v_redeemed, v_bal_new,
              'Redeemed on order ' || v_order.order_number, p_customer);
      -- No follow-up update of orders.loyalty_points_redeemed: the row was
      -- written with the debited figure in the first place.
    end if;
    if v_earned > 0 then
      insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
      -- 'earn_pending', not 'earn': recorded, visible, and NOT in the
      -- spendable balance. admin_set_order_status promotes it on delivery,
      -- and only for a cash order or an online order already marked paid.
      values (p_customer, v_order.id, 'earn_pending', v_earned, v_bal_new,
              'Pending on order ' || v_order.order_number || ' (credited on delivery)', p_customer);
    end if;
  end if;

  return v_order;
end $$;

revoke all on function public.insert_order_from_snapshot(uuid, jsonb, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.insert_order_from_snapshot(uuid, jsonb, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. admin_set_order_status -- refund what the ledger took
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
  v_refunded       integer := 0;
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
    -- The REDEMPTION refund reads the ledger too (20261019120000;
    -- F-DBM-18-001, F-DBM-27-001). It used to restore
    -- orders.loyalty_points_redeemed, a figure insert_order_from_snapshot could
    -- leave at the snapshot's value when no point was actually debited, so a
    -- cancellation minted points. Now: what this order's 'redeem' rows took,
    -- less any redemption refund already written for it. The row lock and the
    -- terminal status remain the fence; the netting keeps it idempotent even
    -- if that fence is ever bypassed.
    select greatest(0, -coalesce(sum(points), 0)) into v_redeemed
      from public.loyalty_transactions
     where order_id = v_order.id and type = 'redeem'
       and profile_id is not distinct from v_order.customer_id;
    select greatest(0, coalesce(sum(points), 0)) into v_refunded
      from public.loyalty_transactions
     where order_id = v_order.id and type = 'adjustment' and points > 0
       and profile_id is not distinct from v_order.customer_id
       and reason like 'Cancelled order redemption refund:%';
    v_redeemed := greatest(0, v_redeemed - v_refunded);

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

  -- PROMOTION. Delivery is the settlement signal this system has for CASH: an
  -- order handed to a customer has been paid for.
  --
  -- IT IS NOT THE SETTLEMENT SIGNAL FOR ONLINE, and the first version of this
  -- file claimed it was — "an online order that was never paid never reaches
  -- here". That was false, and review caught it (#372). `LiveOrdersPanel`
  -- deliberately lets staff advance an unpaid ONLINE order past a
  -- `window.confirm()` — a warning, not a block, and correct for the kitchen —
  -- and this RPC never looked at either payment field. So an online order that
  -- was never paid could be marked delivered and mint spendable points, which
  -- is the exact defect this migration exists to close, moved rather than
  -- removed. It was not theoretical: at the time of writing ALL THREE online
  -- orders in Production were `pending`, and no online order had ever been paid.
  --
  -- `delivered` is terminal, so the cancellation reversal below is unreachable
  -- afterwards; there is no second chance to take the points back.
  --
  -- `is distinct from 'online'` rather than `= 'cash'` on purpose. The column is
  -- nullable text with no default; one legacy row from 2026-07-08 carries NULL,
  -- and treating that as "not online" keeps its behaviour exactly as it is today
  -- rather than silently denying points on a cash order whose method was never
  -- recorded. Every order `place_order` writes carries an explicit method.
  --
  -- This READS payment state and changes none of it: no initiation, no
  -- verification, no webhook, no provider behaviour. The payment confirmation
  -- path stays untouched, per CLAUDE.md §6.
  if p_status = 'delivered'
     and v_order.customer_id is not null
     and (v_order.payment_method is distinct from 'online'
          or v_order.payment_status = 'paid') then
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

revoke all on function public.admin_set_order_status(uuid, public.order_status) from public, anon;
grant execute on function public.admin_set_order_status(uuid, public.order_status) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Self-verification
-- ---------------------------------------------------------------------------
-- A plpgsql body is not name-resolved at creation, so a clean apply proves only
-- that the text was stored. Cardinality is checked before any body is read (a
-- `select prosrc into` over two overloads takes an arbitrary one), and every
-- body assertion runs on the source with `--` comments stripped, so a comment
-- cannot satisfy it. No money-path hash is asserted: a sibling change may move
-- them. Behaviour is pinned by supabase/tests/loyalty_points_reservation_test.sql.
do $verify$
declare
  v_fn    text;
  v_n     integer;
  v_src   text;
  v_oid   oid;
  v_a     integer;
  v_b     integer;
begin
  -- (a) Exactly one overload of each redefined function, still SECURITY
  --     DEFINER with search_path pinned to public.
  foreach v_fn in array array['place_order', 'begin_session_attempt',
                              'insert_order_from_snapshot', 'admin_set_order_status',
                              'loyalty_points_reserved'] loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_n is distinct from 1 then
      raise exception '%: expected exactly one overload, found %', v_fn, v_n;
    end if;
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if not exists (select 1 from pg_proc where oid = v_oid
                    and 'search_path=public' = any (coalesce(proconfig, '{}'::text[]))) then
      raise exception '%: search_path is not pinned to public', v_fn;
    end if;
    if v_fn <> 'loyalty_points_reserved'
       and (select prosecdef from pg_proc where oid = v_oid) is distinct from true then
      raise exception '%: is no longer SECURITY DEFINER', v_fn;
    end if;
    -- Client reach. anon reaches none of them. authenticated reaches only the
    -- admin RPC, whose own is_admin() gate is the boundary.
    if has_function_privilege('anon', v_oid, 'execute') then
      raise exception '%: anon can execute it, which must never be true', v_fn;
    end if;
    if has_function_privilege('authenticated', v_oid, 'execute')
       is distinct from (v_fn = 'admin_set_order_status') then
      raise exception '%: authenticated EXECUTE is not what it was before this file', v_fn;
    end if;
    if not has_function_privilege('service_role', v_oid, 'execute') then
      raise exception '%: service_role lost EXECUTE', v_fn;
    end if;
  end loop;

  -- (b) The shortfall table: RLS on, one admin read policy, readable by
  --     authenticated (the policy decides who), writable by neither client role.
  if (select relrowsecurity from pg_class where oid = 'public.loyalty_redemption_shortfalls'::regclass)
     is distinct from true then
    raise exception 'loyalty_redemption_shortfalls: RLS is not enabled';
  end if;
  select count(*) into v_n from pg_policy where polrelid = 'public.loyalty_redemption_shortfalls'::regclass;
  if v_n is distinct from 1 then
    raise exception 'loyalty_redemption_shortfalls: expected one policy, found %', v_n;
  end if;
  if has_table_privilege('anon', 'public.loyalty_redemption_shortfalls', 'select') then
    raise exception 'loyalty_redemption_shortfalls: anon can select';
  end if;
  if exists (select 1 from unnest(array['insert','update','delete','truncate','references','trigger']) as t(priv)
              where has_table_privilege('authenticated', 'public.loyalty_redemption_shortfalls', t.priv)
                 or has_table_privilege('anon', 'public.loyalty_redemption_shortfalls', t.priv)) then
    raise exception 'loyalty_redemption_shortfalls: a client role holds a write privilege';
  end if;

  -- (c) The helper resolves its names and returns a value, not NULL. It is
  --     stable and reads only, so calling it here writes nothing.
  v_n := public.loyalty_points_reserved('00000000-0000-0000-0000-000000000000'::uuid, null);
  if v_n is distinct from 0 then
    raise exception 'loyalty_points_reserved returned % for a customer with no sessions', v_n;
  end if;

  -- (d) place_order: the reservation is consulted, and it raises the hinted
  --     error; the channel gate is intact (4 references, as before).
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_src from pg_proc
   where oid = 'public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)'::regprocedure;
  if v_src is null then raise exception 'place_order: body not found'; end if;
  if position('public.loyalty_points_reserved(v_customer, null)' in v_src) = 0 then
    raise exception 'place_order: does not consult the reservation';
  end if;
  if position('v_loyalty_redeemed > v_bal_start - v_loyalty_reserved' in v_src) = 0
     or position('hint    = ''loyalty_points_reserved''' in v_src) = 0 then
    raise exception 'place_order: the reservation refusal is missing';
  end if;
  v_n := (length(v_src) - length(replace(v_src, 'v_loyalty_channel_ok', ''))) / length('v_loyalty_channel_ok');
  if v_n is distinct from 4 then
    raise exception 'place_order: % v_loyalty_channel_ok references, expected 4 (pickup-only gate moved)', v_n;
  end if;
  if position('''earn_pending'', v_points_earned' in v_src) = 0 then
    raise exception 'place_order: the earn_pending write moved';
  end if;

  -- (e) begin_session_attempt: the guard reads the reservation, and the
  --     window-only sum (F-DBM-32-001) is gone.
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_src from pg_proc
   where oid = 'public.begin_session_attempt(uuid, text, text, integer)'::regprocedure;
  if position('v_other := public.loyalty_points_reserved(v_session.customer_id, v_session.id);' in v_src) = 0 then
    raise exception 'begin_session_attempt: the guard does not read loyalty_points_reserved';
  end if;
  if position('s.status = ''pending_payment'' and s.expires_at > now()' in v_src) > 0 then
    raise exception 'begin_session_attempt: the window-only reservation sum is still present';
  end if;
  if position('if v_balance < v_redeem + v_other then' in v_src) = 0 then
    raise exception 'begin_session_attempt: the guard comparison moved';
  end if;

  -- (f) insert_order_from_snapshot: the profile is locked BEFORE the order is
  --     inserted, the post-insert correction is gone, the shortfall is
  --     recorded, and the earn side still writes earn_pending.
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_src from pg_proc
   where oid = 'public.insert_order_from_snapshot(uuid, jsonb, text, text, uuid, text)'::regprocedure;
  v_a := position('from public.profiles where id = p_customer for update' in v_src);
  v_b := position('insert into public.orders' in v_src);
  if v_a = 0 or v_b = 0 or v_a > v_b then
    raise exception 'insert_order_from_snapshot: the redemption is not settled before the order is written (% / %)', v_a, v_b;
  end if;
  if position('update public.orders set loyalty_points_redeemed' in v_src) > 0 then
    raise exception 'insert_order_from_snapshot: the snapshot figure is still corrected after the fact';
  end if;
  if position('insert into public.loyalty_redemption_shortfalls' in v_src) = 0 then
    raise exception 'insert_order_from_snapshot: the shortfall is not recorded';
  end if;
  if position('v_snap_redeemed > coalesce(v_bal_start, 0) - public.loyalty_points_reserved(p_customer, null)' in v_src) = 0 then
    raise exception 'insert_order_from_snapshot: the zero-total arm does not honour the reservation';
  end if;
  if position('''earn_pending'', v_earned' in v_src) = 0 then
    raise exception 'insert_order_from_snapshot: the earn_pending write moved';
  end if;

  -- (g) admin_set_order_status: the redemption refund comes from the ledger
  --     and never from the order column; the earn promotion is intact.
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') into v_src from pg_proc
   where oid = 'public.admin_set_order_status(uuid, public.order_status)'::regprocedure;
  if position('v_order.loyalty_points_redeemed' in v_src) > 0 then
    raise exception 'admin_set_order_status: still refunds orders.loyalty_points_redeemed';
  end if;
  if position('where order_id = v_order.id and type = ''redeem''' in v_src) = 0
     or position('reason like ''Cancelled order redemption refund:%''' in v_src) = 0
     or position('v_redeemed := greatest(0, v_redeemed - v_refunded);' in v_src) = 0 then
    raise exception 'admin_set_order_status: the ledger-based, netted refund is missing';
  end if;
  if position('where order_id = v_order.id and type = ''earn_pending''' in v_src) = 0 then
    raise exception 'admin_set_order_status: the earn_pending promotion moved';
  end if;

  raise notice '20261019120000 verified: reservation consulted by place_order, begin_session_attempt and the zero-total snapshot arm; snapshot orders record the debited figure; cancellation refunds from the ledger';
end $verify$;
