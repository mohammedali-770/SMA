-- ============================================================================
-- Spicy Meal — admin-configurable payment methods (online vs cash).
--
-- Business: online payment can be enabled/disabled by Admin; cash (COD / cash on
-- pickup) can be enabled/disabled by Admin; during an online outage Admin flips
-- to cash so operations continue. Supabase/place_order stays the source of truth
-- and enforces the settings server-side so a client can neither pick a disabled
-- method nor fake payment_status='paid'.
--
-- Model (no risky enum change): payment_status stays {pending, paid}; the chosen
-- method lives in orders.payment_method {online, cash}; "cash pending"/"unpaid"
-- are DERIVED (method + status) in the UI. paid is only ever set by the
-- service-role confirm_order_payment after a verified online payment.
--
-- Lazywait gating (Create Order payload UNCHANGED — confirmed pickup fields only,
-- nothing extra like is_paid/payment_*):
--   * pickup + cash   -> queued to POS UNPAID immediately (Create Order returns
--                        is_paid:false when no payment update is sent).
--   * pickup + online -> held in the new 'awaiting_payment' sync state until
--                        confirm_order_payment enqueues it after verified payment.
--   * delivery        -> blocked (delivery Create Order schema still unconfirmed).
-- ============================================================================

-- ---- 1. app_settings: payment-method availability (non-secret, public-read) --
alter table public.app_settings add column if not exists online_payment_enabled      boolean not null default false;
alter table public.app_settings add column if not exists cash_payment_enabled         boolean not null default true;
alter table public.app_settings add column if not exists default_payment_method       text
  check (default_payment_method is null or default_payment_method in ('online','cash'));
alter table public.app_settings add column if not exists payment_outage_mode_enabled  boolean not null default false;
alter table public.app_settings add column if not exists payment_updated_at           timestamptz;
alter table public.app_settings add column if not exists payment_updated_by           uuid references public.profiles(id) on delete set null;

update public.app_settings
   set default_payment_method = coalesce(default_payment_method, 'cash')
 where id = true;

-- ---- 2. orders: payment method + provider + paid timestamp -------------------
alter table public.orders add column if not exists payment_method   text
  check (payment_method is null or payment_method in ('online','cash'));
alter table public.orders add column if not exists payment_provider text;
alter table public.orders add column if not exists paid_at          timestamptz;

-- Extend the Lazywait sync-state check to include 'awaiting_payment'.
alter table public.orders drop constraint if exists orders_lazywait_sync_state_check;
alter table public.orders add constraint orders_lazywait_sync_state_check
  check (lazywait_sync_state in
    ('pending','syncing','synced','failed','blocked','dead_letter','skipped','awaiting_payment'));

-- ---- 3. set_payment_settings(): admin-only edit of payment availability ------
create or replace function public.set_payment_settings(
  p_online_enabled boolean,
  p_cash_enabled   boolean,
  p_default_method text    default null,
  p_outage_mode    boolean default false
)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.app_settings;
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit payment settings' using errcode = '42501';
  end if;
  if p_default_method is not null and p_default_method not in ('online','cash') then
    raise exception 'Invalid default payment method' using errcode = '22023';
  end if;
  update public.app_settings set
    online_payment_enabled      = coalesce(p_online_enabled, false),
    cash_payment_enabled        = coalesce(p_cash_enabled, false),
    default_payment_method      = p_default_method,
    payment_outage_mode_enabled = coalesce(p_outage_mode, false),
    payment_updated_at          = now(),
    payment_updated_by          = auth.uid(),
    updated_at                  = now()
  where id = true
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.set_payment_settings(boolean, boolean, text, boolean) from public, anon;
grant execute on function public.set_payment_settings(boolean, boolean, text, boolean) to authenticated;

-- ---- 4. place_order(): now resolves + validates the payment method ----------
-- 9-arg version (adds p_payment_method). Drop the 8-arg first to avoid overload
-- ambiguity; existing callers pass named args and bind here (p_payment_method
-- defaults to null -> the configured default method). Body is otherwise the
-- coupon-race-safe version; only the payment-method block + column are added.
drop function if exists public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid);

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

revoke all on function public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)
  from public, anon;
grant execute on function public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)
  to authenticated;

-- ---- 5. confirm_order_payment(): record provider + paid_at, enqueue POS ------
-- Redefined: sets payment_provider + paid_at (keeps payment_method='online'),
-- and enqueues a held online pickup order to Lazywait once it is verified paid.
create or replace function public.confirm_order_payment(
  p_order_id     uuid,
  p_provider     text,
  p_provider_ref text,
  p_amount       numeric,
  p_raw          jsonb default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if p_provider_ref is not null and exists (
    select 1 from public.payment_records
    where provider = p_provider and provider_ref = p_provider_ref and status = 'paid'
  ) then
    return v_order;
  end if;

  if p_amount is distinct from v_order.total then
    insert into public.payment_records (order_id, provider, provider_ref, status, amount, raw)
      values (p_order_id, p_provider, p_provider_ref, 'failed', coalesce(p_amount, 0), p_raw);
    raise exception 'Payment amount % does not match order total %', p_amount, v_order.total;
  end if;

  insert into public.payment_records (order_id, provider, provider_ref, status, amount, raw)
    values (p_order_id, p_provider, p_provider_ref, 'paid', p_amount, p_raw)
  on conflict (provider, provider_ref) where provider_ref is not null
    do update set status = 'paid', amount = excluded.amount, raw = excluded.raw, updated_at = now();

  update public.orders
    set payment_status   = 'paid',
        payment_provider = p_provider,
        paid_at          = now(),
        -- Held online pickup orders enter the Lazywait queue only now (after paid).
        lazywait_sync_state  = case when order_type = 'pickup' and lazywait_sync_state = 'awaiting_payment'
                                    then 'pending' else lazywait_sync_state end,
        sync_next_attempt_at = case when order_type = 'pickup' and lazywait_sync_state = 'awaiting_payment'
                                    then now() else sync_next_attempt_at end,
        updated_at = now()
    where id = p_order_id
    returning * into v_order;

  return v_order;
end $$;

revoke all on function public.confirm_order_payment(uuid, text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_order_payment(uuid, text, text, numeric, jsonb) to service_role;

-- ---- 6. Enqueue trigger: gate Lazywait by payment method --------------------
create or replace function public.set_lazywait_initial_sync()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_type = 'delivery' then
    -- Delivery Create Order schema is unconfirmed; never invented.
    new.lazywait_sync_state  := 'blocked';
    new.sync_blocked_reason  := 'delivery_schema_unconfirmed';
    new.sync_next_attempt_at := null;
  elsif new.payment_method = 'online' and new.payment_status <> 'paid' then
    -- Online orders are NOT sent to the POS until payment is verified server-side
    -- (confirm_order_payment enqueues them once paid).
    new.lazywait_sync_state  := 'awaiting_payment';
    new.sync_blocked_reason  := null;
    new.sync_next_attempt_at := null;
  else
    -- pickup + cash (or already-paid): queue now. Cash orders go to the POS UNPAID;
    -- the confirmed Create Order returns is_paid:false when no payment update is sent.
    new.lazywait_sync_state  := 'pending';
    new.sync_blocked_reason  := null;
    new.sync_next_attempt_at := now();
  end if;
  return new;
end $$;
