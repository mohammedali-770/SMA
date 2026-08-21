-- Per-item kitchen notes — the column and its bound.
--
-- WHAT THIS CLOSES. The customer can attach ONE note to a whole order, so
-- "no onion" applies to the burger, the salad and the drink alike. There is
-- nowhere to say something about a single line: no column on `order_items`, no
-- field on the cart item, and nothing carrying one through `place_order`.
-- `apps/mobile/src/features/order/orderNote.ts` has anticipated this since it
-- was written ("once per-item notes arrive"); this is the storage half of it.
--
-- WHY THREE FUNCTIONS ARE REDEFINED BELOW. A note is data the INSERT has to
-- carry, so a trigger cannot supply it the way `enforce_order_note` merely
-- bounds the order note. Three functions write or forward an order line, and
-- all three must carry `note` or it silently disappears on whichever path was
-- missed:
--
--   3. place_order                 - cash / direct  (last defined 20260820140500)
--   4. compute_order_snapshot      - builds the online snapshot (20260712160000)
--   5. insert_order_from_snapshot  - writes it after payment (20260712170000)
--
-- (`begin_checkout_session` delegates its item work to compute_order_snapshot
-- and never touches a line itself, so it needs no change and is not redefined.)
--
-- Each of those three bodies is the CURRENT definition copied VERBATIM from the
-- migration that last defined it, with exactly one edit: the note. Nothing else
-- in them changed. They were extracted programmatically and each edit asserted
-- to match exactly once, so a hand-copying slip cannot hide in 300 lines.
--
-- THIS ALREADY ALMOST WENT WRONG ONCE, which is why the parenthesised versions
-- above are worth checking rather than trusting. This migration was first
-- written against place_order as of 20260710120100. While it sat in review,
-- 20260820140500_place_order_modifier_availability.sql landed on the base
-- branch and added per-branch product and modifier availability checks. Because
-- this file sorts AFTER that one, the original copy would have replayed the
-- older body over it and silently deleted those checks — no conflict, no error,
-- and an out-of-stock option quietly orderable again. The body below was
-- rebuilt from 20260820140500 and re-diffed to a single hunk.
--
-- So: before touching any body here, re-run the check. `create or replace`
-- against a stale copy is a silent revert, and the migration chain will not
-- notice.
--
-- GRANTS ARE NOT RE-ISSUED, deliberately. `create or replace function` preserves
-- the existing ACL, and 20260724200000_order_read_contracts.sql revoked EXECUTE
-- on place_order from `authenticated` on purpose (customers go through the
-- place_customer_order wrapper). Re-granting here would silently reopen it.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
alter table public.order_items
  add column if not exists note text;

comment on column public.order_items.note is
  'Optional customer instruction for THIS line ("no onion"), trimmed to NULL when empty. Bounded by enforce_order_item_note; mirrors ITEM_NOTE_MAX_LENGTH in apps/mobile/src/features/order/orderNote.ts.';

-- ---------------------------------------------------------------------------
-- 1b. COLUMN GRANTS — without these the customer app breaks outright
--
-- 20260724200000_order_read_contracts.sql revoked table-wide SELECT on `orders`,
-- `order_items` and `order_item_modifiers` and replaced it with an EXPLICIT
-- column list per table. A new column is therefore NOT readable by
-- `authenticated` just because it exists.
--
-- This is not a partial-visibility failure, which is what makes it dangerous:
-- PostgREST rejects the ENTIRE select with a privilege error rather than
-- omitting the column it may not read. So the moment the customer app asks for
-- `notes` / `note` without these grants, `orders.byId` and `orders.listWithItems`
-- fail for every signed-in customer — the whole receipt and My Orders, not just
-- the note. The app change and these grants must ship together.
--
-- `orders.notes` is granted for the same reason it was reclassified in
-- lib/orderSelect.ts: it is text the customer typed themselves, on their own
-- RLS-scoped order. The read_contracts comment lists it under "staff notes",
-- but nothing writes a staff note there — `place_order` fills it from the
-- customer's own `p_notes`.
--
-- ROW-level ownership is untouched: RLS policies are evaluated by the system and
-- do not require the caller to hold a column privilege, so this widens WHICH
-- COLUMNS an owner may read and never WHOSE rows.
grant select (notes) on public.orders to authenticated;
grant select (note)  on public.order_items to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The bound
--
-- Shorter than the 280-character ORDER note, and that is not arbitrary: an
-- order note is one instruction for the whole ticket, while a line note is read
-- by a cook glancing at a single row. Ten lines each carrying 280 characters is
-- not a ticket anybody can work from. `order_note_normalized` (20260819120000)
-- is reused as-is, so "trimmed, and empty means none" has ONE definition for
-- both kinds of note rather than two that can drift.
-- ---------------------------------------------------------------------------
create or replace function public.order_item_note_is_acceptable(p_note text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Optional, so NULL is acceptable: it normalizes to NULL and coalesce
  -- measures that as an empty note rather than making the whole predicate NULL
  -- (and `if not null` never fires).
  select char_length(coalesce(public.order_note_normalized(p_note), '')) <= 140;
$$;

comment on function public.order_item_note_is_acceptable(text) is
  'True when a per-item note is within the 140-character limit after trimming. NULL is acceptable - the note is optional. Mirrors ITEM_NOTE_MAX_LENGTH in the mobile client.';

revoke all on function public.order_item_note_is_acceptable(text) from public, anon, authenticated;

create or replace function public.enforce_order_item_note()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Normalize FIRST so the stored value is always the trimmed form, then bound
  -- it. Storing '   ' would make an empty note look present to every reader,
  -- which is exactly the failure the order-note rule already avoids.
  new.note := public.order_note_normalized(new.note);
  if not public.order_item_note_is_acceptable(new.note) then
    raise exception 'Item note is too long' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.enforce_order_item_note() from public, anon, authenticated;

drop trigger if exists trg_enforce_order_item_note on public.order_items;
create trigger trg_enforce_order_item_note
  before insert or update of note on public.order_items
  for each row execute function public.enforce_order_item_note();

-- ---------------------------------------------------------------------------
-- 3. place_order - cash / direct path
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
      end loop;
    end if;

    v_subtotal := v_subtotal + (v_unit_price * v_qty);
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

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item ->> 'quantity')::int;
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid;

    insert into public.order_items (order_id, product_id, name_en, name_ar, unit_price, quantity, line_total, note)
    values (v_order.id, v_product.id, v_product.name_en, v_product.name_ar, v_product.price, v_qty, 0,
            public.order_note_normalized(v_item ->> 'note'))
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

-- ---------------------------------------------------------------------------
-- 4. compute_order_snapshot - the online snapshot must carry the note
-- ---------------------------------------------------------------------------
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
  v_bal_start        integer;
  v_items_out    jsonb := '[]'::jsonb;
  v_mods_out     jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cannot place an order with an empty cart';
  end if;

  select * into v_profile  from public.profiles    where id = p_customer;
  select * into v_settings from public.app_settings where id = true;

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

    v_unit_price := v_product.price;
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
    v_items_out := v_items_out || jsonb_build_object(
      'product_id', v_product.id, 'name_en', v_product.name_en, 'name_ar', v_product.name_ar,
      'unit_price', v_unit_price, 'quantity', v_qty, 'line_total', v_unit_price * v_qty,
      'note', public.order_note_normalized(v_item ->> 'note'),
      'modifiers', v_mods_out);
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
    v_loyalty_redeemed := least(v_loyalty_req, v_bal_start, floor(v_pre_loyalty / v_per_point)::int);
    if v_loyalty_redeemed < coalesce(v_settings.min_points_to_redeem, 0) then
      v_loyalty_redeemed := 0;
    end if;
    v_loyalty_discount := least(round(v_loyalty_redeemed * v_per_point, 2), v_pre_loyalty);
  end if;

  v_total := greatest(0, v_subtotal + v_delivery_fee - v_discount - v_loyalty_discount);
  v_vat := round(v_total - (v_total / (1 + coalesce(v_settings.vat_percentage, 15) / 100.0)), 2);

  if v_loyalty_on then
    v_points_earned := floor(v_total * v_per_riyal)::int;
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
    'address_snapshot', case when v_address.id is not null then to_jsonb(v_address) else null end
  );
end $$;

-- ---------------------------------------------------------------------------
-- 5. insert_order_from_snapshot - write it once payment is verified
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
begin
  insert into public.orders (
    customer_id, customer_name, customer_phone,
    branch_id, branch_name_en, branch_name_ar,
    status, order_type, subtotal, delivery_fee, discount_amount,
    loyalty_discount_amount, vat_amount, total, payment_status, payment_method,
    payment_provider, paid_at,
    coupon_code, notes, address_id, address_snapshot,
    loyalty_points_earned, loyalty_points_redeemed, loyalty_awarded_at,
    idempotency_key
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
    p_idempotency_key
  )
  returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_snapshot->'items')
  loop
    insert into public.order_items (order_id, product_id, name_en, name_ar, unit_price, quantity, line_total, note)
    values (v_order.id, (v_item->>'product_id')::uuid, v_item->>'name_en', v_item->>'name_ar',
            (v_item->>'unit_price')::numeric, (v_item->>'quantity')::int, (v_item->>'line_total')::numeric,
            public.order_note_normalized(v_item->>'note'))
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

  if v_loyalty_on and (v_redeemed > 0 or v_earned > 0) then
    select coalesce(loyalty_points, 0) into v_bal_start from public.profiles where id = p_customer for update;
    v_redeemed := least(v_redeemed, v_bal_start);
    update public.profiles
      set loyalty_points = greatest(0, v_bal_start - v_redeemed + v_earned)
      where id = p_customer
      returning loyalty_points into v_bal_new;
    if v_redeemed > 0 then
      insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
      values (p_customer, v_order.id, 'redeem', -v_redeemed, v_bal_new - v_earned,
              'Redeemed on order ' || v_order.order_number, p_customer);
      update public.orders set loyalty_points_redeemed = v_redeemed where id = v_order.id;
    end if;
    if v_earned > 0 then
      insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
      values (p_customer, v_order.id, 'earn', v_earned, v_bal_new,
              'Earned on order ' || v_order.order_number, p_customer);
    end if;
  end if;

  return v_order;
end $$;

-- ---------------------------------------------------------------------------
-- 6. admin_list_orders_with_items - the kitchen has to be able to READ it
--
-- Storing a note nobody serves is worse than not offering one: the customer is
-- told their instruction was accepted, and no staff surface ever shows it. The
-- ORDER-level note was already projected here; the ITEM-level one was not, so
-- "no onion" on a single line reached the database and stopped there.
--
-- DELIBERATELY NOT SENT TO THE POS. `lazywait-sync` does not forward the note,
-- and this migration does not change that. Whether Lazywait's Create Order
-- accepts an order/item note at all is open question Q5 in
-- docs/lazywait-delivery-open-questions.md, and the client only sends assumed
-- fields behind `allowAssumedFields`. Inventing a field name to carry a note
-- would be guessing at the vendor's schema, which is the exact thing that gate
-- exists to prevent. Until Lazywait confirms it, the staff dashboard is the
-- surface that carries per-item notes, and the POS ticket does not.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_orders_with_items(p_limit integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_rows jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff may list orders' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from (
    select
      o.id, o.order_number, o.customer_id, o.customer_name, o.customer_phone,
      o.branch_id, o.branch_name_en, o.branch_name_ar,
      o.status, o.order_type,
      o.subtotal, o.delivery_fee, o.discount_amount, o.loyalty_discount_amount,
      o.vat_amount, o.total,
      o.loyalty_points_earned, o.loyalty_points_redeemed,
      o.payment_status, o.payment_method, o.payment_provider, o.paid_at,
      o.coupon_code, o.notes, o.created_at, o.updated_at,
      o.sync_status, o.lazywait_sync_state, o.lazywait_ref,
      o.lazywait_order_number, o.lazywait_status,
      o.sync_attempt_count, o.sync_last_error, o.sync_blocked_reason,
      o.synced_at, o.first_pos_sync_failure_at, o.sync_next_attempt_at,
      o.pos_create_attempted_at, o.pos_customer_retry_count,
      o.pos_confirmation_reason, o.refund_state,
      o.address_snapshot,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id, 'order_id', i.order_id, 'product_id', i.product_id,
          'name_en', i.name_en, 'name_ar', i.name_ar,
          'unit_price', i.unit_price, 'quantity', i.quantity,
          'line_total', i.line_total, 'note', i.note,
          'order_item_modifiers', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', m.id, 'order_item_id', m.order_item_id,
              'modifier_id', m.modifier_id,
              'name_en', m.name_en, 'name_ar', m.name_ar, 'price', m.price)
              order by m.id)
            from public.order_item_modifiers m where m.order_item_id = i.id
          ), '[]'::jsonb))
          order by i.id)
        from public.order_items i where i.order_id = o.id
      ), '[]'::jsonb) as order_items
    from public.orders o
    where p_limit is null
       -- the recent window …
       or o.id in (
            select r.id from public.orders r
             order by r.created_at desc
             limit greatest(1, p_limit)
          )
       -- … plus everything still owed to a customer, however old.
       or o.status not in ('delivered', 'cancelled')
    order by o.created_at desc
  ) t;

  return v_rows;
end $$;
