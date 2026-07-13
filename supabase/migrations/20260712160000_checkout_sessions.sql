-- ============================================================================
-- Spicy Meal — Online payment: order created ONLY after payment is verified.
--
-- Problem with the order-first flow: place_order creates the order (and burns
-- loyalty points + coupon usage) the instant the customer taps "Confirm", before
-- any payment. A failed/abandoned online payment therefore left a real order row
-- (hidden + POS-gated, but still consuming an order number, loyalty and coupon).
--
-- New online flow (this migration): "Confirm" creates a TEMPORARY checkout
-- session (NOT an order, never in My Orders, never at POS, no loyalty/coupon
-- side effects). The Tap charge is tied to the session. Only when the backend
-- verifies the charge as CAPTURED does finalize_checkout_session() create the
-- real, already-PAID order (which the existing INSERT trigger then enqueues to
-- the POS for pickup). The webhook and payment-verify are the sole authorities.
--
-- ADDITIVE + backward compatible:
--   * place_order + confirm_order_payment are UNTOUCHED (cash path + any
--     already-deployed app that still uses the order-first flow keep working).
--   * payment_records gains a nullable checkout_session_id and order_id becomes
--     nullable, so an attempt can exist before its order does.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. checkout_sessions: a validated, priced cart snapshot awaiting payment.
--    This is NOT an order. It carries the fully-resolved order the customer was
--    quoted, so finalize inserts exactly what was charged (no re-pricing drift).
-- ---------------------------------------------------------------------------
create table if not exists public.checkout_sessions (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.profiles(id) on delete cascade,
  status         text not null default 'pending_payment'
                   check (status in ('pending_payment','consumed','expired','cancelled')),
  order_type     public.order_type not null,
  payment_method text not null default 'online',
  branch_id      uuid not null references public.branches(id),
  address_id     uuid references public.addresses(id),
  coupon_code    text,
  notes          text,
  loyalty_points integer not null default 0,
  -- Server-computed, server-trusted snapshot (mirror of what place_order builds).
  snapshot       jsonb not null,       -- { items:[...], names, address_snapshot, loyalty_* }
  subtotal       numeric(10,2) not null,
  delivery_fee   numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  loyalty_discount_amount numeric(10,2) not null default 0,
  vat_amount     numeric(10,2) not null default 0,
  total          numeric(10,2) not null,
  currency       text not null default 'SAR',
  idempotency_key uuid,
  order_id       uuid references public.orders(id) on delete set null,  -- set on consume
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '30 minutes',
  consumed_at    timestamptz
);
create index if not exists checkout_sessions_customer_idx on public.checkout_sessions(customer_id);
create index if not exists checkout_sessions_status_idx   on public.checkout_sessions(status);
-- One live session per idempotency key per customer (retry-safe "Confirm" taps).
create unique index if not exists checkout_sessions_idem_idx
  on public.checkout_sessions(customer_id, idempotency_key)
  where idempotency_key is not null and status = 'pending_payment';

drop trigger if exists set_checkout_sessions_updated_at on public.checkout_sessions;
create trigger set_checkout_sessions_updated_at
  before update on public.checkout_sessions
  for each row execute function public.set_updated_at();

alter table public.checkout_sessions enable row level security;
revoke all on public.checkout_sessions from anon, authenticated;
grant select on public.checkout_sessions to authenticated;
-- The customer may READ their own session (to poll status / show the total).
-- Writes happen only through the SECURITY DEFINER RPCs / service role.
drop policy if exists checkout_sessions_select_own on public.checkout_sessions;
create policy checkout_sessions_select_own on public.checkout_sessions
  for select to authenticated
  using (customer_id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------------
-- 2. payment_records: allow an attempt to exist before its order does.
--    order_id becomes nullable; a checkout_session_id links the pre-order
--    attempt. Exactly one of (order_id, checkout_session_id) is set.
-- ---------------------------------------------------------------------------
alter table public.payment_records alter column order_id drop not null;
alter table public.payment_records add column if not exists checkout_session_id uuid
  references public.checkout_sessions(id) on delete cascade;
alter table public.payment_records drop constraint if exists payment_records_owner_ck;
alter table public.payment_records add constraint payment_records_owner_ck
  check (order_id is not null or checkout_session_id is not null);
create index if not exists payment_records_session_idx
  on public.payment_records(checkout_session_id) where checkout_session_id is not null;
-- One ACTIVE attempt per session (session-flow double-charge guard, mirrors the
-- existing per-order guard).
create unique index if not exists payment_records_one_active_session_idx
  on public.payment_records (checkout_session_id, provider)
  where status = 'initiated' and checkout_session_id is not null;

-- ---------------------------------------------------------------------------
-- 3. compute_order_snapshot(): the read-only validation + pricing of place_order,
--    with NO writes and NO side effects. Returns the fully-resolved order as
--    jsonb. Kept in lock-step with place_order (validated by a parity test).
--    Raises the same user-facing errors on invalid input.
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

revoke all on function public.compute_order_snapshot(uuid, uuid, public.order_type, jsonb, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.compute_order_snapshot(uuid, uuid, public.order_type, jsonb, uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. insert_order_from_snapshot(): create the real order + items + apply the
--    loyalty/coupon side effects, from a computed snapshot. Used by finalize
--    (post-payment) so these side effects NEVER happen for an unpaid checkout.
-- ---------------------------------------------------------------------------
create or replace function public.insert_order_from_snapshot(
  p_customer        uuid,
  p_snapshot        jsonb,
  p_payment_method  text,
  p_payment_status  text,
  p_idempotency_key uuid default null
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
    insert into public.order_items (order_id, product_id, name_en, name_ar, unit_price, quantity, line_total)
    values (v_order.id, (v_item->>'product_id')::uuid, v_item->>'name_en', v_item->>'name_ar',
            (v_item->>'unit_price')::numeric, (v_item->>'quantity')::int, (v_item->>'line_total')::numeric)
    returning id into v_item_id;

    for v_mod in select value from jsonb_array_elements(coalesce(v_item->'modifiers','[]'::jsonb))
    loop
      insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
      values (v_item_id, (v_mod->>'modifier_id')::uuid, v_mod->>'name_en', v_mod->>'name_ar', (v_mod->>'price')::numeric);
    end loop;
  end loop;

  -- Coupon usage is counted here (post-payment), never for an abandoned checkout.
  -- This runs AFTER the customer has already paid, so it must never raise/abort:
  -- the discount was validated and charged at checkout time. We increment usage
  -- unconditionally (a coupon that hit its limit in the race between checkout and
  -- payment is honored for this already-paid order rather than failing it).
  if v_discount > 0 and v_coupon_raw is not null then
    update public.coupons
      set usage_count = usage_count + 1
      where code = upper(trim(v_coupon_raw));
  end if;

  -- Loyalty is redeemed/earned here (post-payment). Re-read the live balance and
  -- clamp the deduction to it so a balance spent elsewhere between checkout and
  -- payment can never drive it negative.
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

revoke all on function public.insert_order_from_snapshot(uuid, jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function public.insert_order_from_snapshot(uuid, jsonb, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. begin_checkout_session(): authenticated. Validates + prices the cart and
--    stores it as a pending session. Creates NO order and NO side effects.
-- ---------------------------------------------------------------------------
create or replace function public.begin_checkout_session(
  p_branch_id       uuid,
  p_order_type      public.order_type,
  p_items           jsonb,
  p_address_id      uuid    default null,
  p_coupon_code     text    default null,
  p_notes           text    default null,
  p_loyalty_points  integer default 0,
  p_idempotency_key uuid    default null
)
returns public.checkout_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid := auth.uid();
  v_settings public.app_settings;
  v_snapshot jsonb;
  v_session  public.checkout_sessions;
  v_existing public.checkout_sessions;
  v_order    public.orders;
begin
  if v_customer is null then
    raise exception 'Authentication is required to place an order' using errcode = '28000';
  end if;

  -- Retry-safe: reuse a live session for the same idempotency key.
  if p_idempotency_key is not null then
    select * into v_existing from public.checkout_sessions
      where customer_id = v_customer and idempotency_key = p_idempotency_key
        and status = 'pending_payment' and expires_at > now()
      order by created_at desc limit 1;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_settings from public.app_settings where id = true;
  if not coalesce(v_settings.online_payment_enabled, false) then
    raise exception 'Online payment is not available' using errcode = 'P0001';
  end if;

  v_snapshot := public.compute_order_snapshot(
    v_customer, p_branch_id, p_order_type, p_items, p_address_id, p_coupon_code, p_loyalty_points);

  insert into public.checkout_sessions (
    customer_id, status, order_type, payment_method, branch_id, address_id, coupon_code, notes,
    loyalty_points, snapshot, subtotal, delivery_fee, discount_amount, loyalty_discount_amount,
    vat_amount, total, currency, idempotency_key
  ) values (
    v_customer, 'pending_payment', p_order_type, 'online', p_branch_id,
    nullif(v_snapshot->>'address_id','')::uuid, p_coupon_code, p_notes,
    greatest(0, coalesce(p_loyalty_points,0)), v_snapshot,
    (v_snapshot->>'subtotal')::numeric, (v_snapshot->>'delivery_fee')::numeric,
    (v_snapshot->>'discount_amount')::numeric, (v_snapshot->>'loyalty_discount_amount')::numeric,
    (v_snapshot->>'vat_amount')::numeric, (v_snapshot->>'total')::numeric, 'SAR', p_idempotency_key
  )
  returning * into v_session;

  -- Zero-total (fully covered by coupon/loyalty): there is nothing to charge, so
  -- create the paid order immediately and return an already-consumed session
  -- pointing at it. The app sees order_id set and goes straight to the receipt.
  if v_session.total <= 0 then
    v_order := public.insert_order_from_snapshot(
      v_customer, v_snapshot || jsonb_build_object('notes', p_notes), 'online', 'paid', null);
    update public.checkout_sessions
      set status = 'consumed', order_id = v_order.id, consumed_at = now()
      where id = v_session.id
      returning * into v_session;
  end if;

  return v_session;
end $$;

revoke all on function public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. tap_begin_session_attempt(): service-role. Atomic open-or-reuse of THE
--    single active Tap attempt for a checkout session (session-flow analog of
--    tap_begin_payment_attempt). Returns the server-trusted amount.
-- ---------------------------------------------------------------------------
create or replace function public.tap_begin_session_attempt(
  p_session_id     uuid,
  p_mode           text,
  p_expiry_minutes integer default 30
)
returns table (
  attempt_id            uuid,
  reference_transaction text,
  reference_order       text,
  provider_ref          text,
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
  v_expires  timestamptz := now() + make_interval(mins => greatest(5, least(60, coalesce(p_expiry_minutes, 30))));
begin
  select * into v_session from public.checkout_sessions where id = p_session_id for update;
  if not found then raise exception 'Checkout session % not found', p_session_id; end if;
  if v_session.order_id is not null then raise exception 'Checkout session already completed' using errcode = 'P0001'; end if;
  if v_session.status <> 'pending_payment' then raise exception 'Checkout session is not payable' using errcode = 'P0001'; end if;
  if v_session.expires_at <= now() then
    update public.checkout_sessions set status = 'expired' where id = p_session_id;
    raise exception 'Checkout session expired' using errcode = 'P0001';
  end if;
  if coalesce(v_session.total, 0) <= 0 then raise exception 'Order total must be greater than zero' using errcode = 'P0001'; end if;

  select * into v_existing from public.payment_records
    where checkout_session_id = p_session_id and provider = 'tap' and status = 'initiated'
    order by created_at desc limit 1;
  if found then
    if v_existing.expires_at is not null and v_existing.expires_at <= now() then
      update public.payment_records
        set status = 'failed', failure_code = 'expired', failure_message_safe = 'Payment session expired'
        where id = v_existing.id;
    else
      return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                          v_existing.provider_ref, v_existing.checkout_url, v_existing.amount,
                          v_existing.currency, v_existing.mode, true;
      return;
    end if;
  end if;

  v_ref := 'sm_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.payment_records
      (checkout_session_id, provider, status, amount, currency, mode, reference_transaction, reference_order, initiated_at, expires_at)
    values
      (p_session_id, 'tap', 'initiated', v_session.total, coalesce(v_session.currency,'SAR'),
       case when p_mode = 'live' then 'live' else 'test' end,
       v_ref, 'CS-' || substr(replace(p_session_id::text,'-',''),1,12), now(), v_expires)
    returning * into v_new;
  exception when unique_violation then
    select * into v_existing from public.payment_records
      where checkout_session_id = p_session_id and provider = 'tap' and status = 'initiated'
      order by created_at desc limit 1;
    return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                        v_existing.provider_ref, v_existing.checkout_url, v_existing.amount,
                        v_existing.currency, v_existing.mode, true;
    return;
  end;

  return query select v_new.id, v_new.reference_transaction, v_new.reference_order,
                      v_new.provider_ref, v_new.checkout_url, v_new.amount,
                      v_new.currency, v_new.mode, false;
end $$;

revoke all on function public.tap_begin_session_attempt(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.tap_begin_session_attempt(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7. finalize_checkout_session(): service-role, THE authority that turns a
--    verified payment into a real order. Idempotent: a second call (webhook +
--    verify racing, or a duplicate webhook) returns the already-created order.
--    The order is inserted already-PAID, so the existing INSERT trigger enqueues
--    pickup orders to the POS immediately. Delivery stays 'blocked' as before.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_checkout_session(
  p_session_id   uuid,
  p_provider     text,
  p_provider_ref text,
  p_amount       numeric,
  p_currency     text,
  p_raw          jsonb default null,
  p_card_scheme  text  default null,
  p_card_last4   text  default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.checkout_sessions;
  v_order   public.orders;
begin
  select * into v_session from public.checkout_sessions where id = p_session_id for update;
  if not found then raise exception 'Checkout session % not found', p_session_id; end if;

  -- Idempotent: already finalized -> return the existing order.
  if v_session.order_id is not null then
    select * into v_order from public.orders where id = v_session.order_id;
    return v_order;
  end if;
  if v_session.status <> 'pending_payment' then
    raise exception 'Checkout session is not payable (status=%)', v_session.status using errcode = 'P0001';
  end if;

  -- The verified charge amount MUST equal the server-quoted total the customer
  -- was shown and charged. (Caller also re-retrieves + validates against Tap.)
  if round(coalesce(p_amount,0), 2) <> round(v_session.total, 2) then
    raise exception 'Paid amount % does not match order total %', p_amount, v_session.total using errcode = 'P0001';
  end if;

  -- Create the real, already-paid order from the frozen snapshot. `notes` is not
  -- part of the pricing snapshot, so merge it in here. Pass NULL idempotency_key:
  -- this path is made idempotent by the session (order_id set below), so the
  -- order needs no cart key and can never collide with a cash order's key.
  v_order := public.insert_order_from_snapshot(
    v_session.customer_id,
    v_session.snapshot || jsonb_build_object('notes', v_session.notes),
    'online', 'paid', null);

  -- Record the payment against the (now existing) order. Reuse the session's
  -- 'initiated' attempt if present; else insert. (provider, provider_ref) unique
  -- gives webhook idempotency.
  update public.payment_records
    set order_id = v_order.id, status = 'paid', provider_ref = p_provider_ref,
        amount = p_amount, currency = coalesce(p_currency, 'SAR'), raw = coalesce(p_raw, raw),
        card_scheme = coalesce(p_card_scheme, card_scheme),
        card_last_four = coalesce(p_card_last4, card_last_four),
        last_verified_at = now()
    where checkout_session_id = p_session_id and provider = p_provider
      and (provider_ref is null or provider_ref = p_provider_ref);
  if not found then
    insert into public.payment_records
      (order_id, checkout_session_id, provider, provider_ref, status, amount, currency, raw, card_scheme, card_last_four)
    values
      (v_order.id, p_session_id, p_provider, p_provider_ref, 'paid', p_amount, coalesce(p_currency,'SAR'), p_raw, p_card_scheme, p_card_last4)
    on conflict (provider, provider_ref) where provider_ref is not null
      do update set order_id = excluded.order_id, status = 'paid';
  end if;

  update public.checkout_sessions
    set status = 'consumed', order_id = v_order.id, consumed_at = now()
    where id = p_session_id;

  return v_order;
end $$;

revoke all on function public.finalize_checkout_session(uuid, text, text, numeric, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.finalize_checkout_session(uuid, text, text, numeric, text, jsonb, text, text) to service_role;
