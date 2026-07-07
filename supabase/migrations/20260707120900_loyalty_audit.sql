-- ============================================================================
-- Spicy Meal — loyalty audit trail + per-order tracking.
--
-- Hardens the (already server-authoritative) loyalty flow for production:
--   * orders gains loyalty_points_earned / _redeemed / _awarded_at so each
--     order records exactly what it did to the balance.
--   * loyalty_transactions is an append-only ledger of every earn / redeem /
--     adjustment, with the resulting balance snapshot — the audit source of
--     truth. A partial unique index guarantees a given order can be awarded at
--     most once (idempotency), even against future code paths.
--   * place_order + adjust_loyalty_points now write ledger rows. All loyalty
--     math stays server-side; clients still cannot touch loyalty_points.
-- ============================================================================

-- ---- orders: per-order loyalty accounting ---------------------------------
alter table public.orders add column if not exists loyalty_points_earned   integer not null default 0;
alter table public.orders add column if not exists loyalty_points_redeemed integer not null default 0;
alter table public.orders add column if not exists loyalty_awarded_at      timestamptz;

-- ---- loyalty_transactions ledger ------------------------------------------
create table if not exists public.loyalty_transactions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  order_id     uuid references public.orders(id) on delete set null,
  type         text not null check (type in ('earn', 'redeem', 'adjustment')),
  points       integer not null,          -- signed: +earn / -redeem / +-adjust
  balance_after integer,                  -- balance snapshot after this row
  reason       text,
  created_by   uuid references public.profiles(id) on delete set null,
  -- clock_timestamp() (not now()) so the redeem + earn rows written by a single
  -- place_order transaction get distinct, insert-ordered timestamps.
  created_at   timestamptz not null default clock_timestamp()
);
-- Ensure the distinct-timestamp default is applied even if the table pre-exists.
alter table public.loyalty_transactions alter column created_at set default clock_timestamp();
create index if not exists loyalty_tx_profile_idx on public.loyalty_transactions(profile_id, created_at desc);
create index if not exists loyalty_tx_order_idx   on public.loyalty_transactions(order_id);
-- Defense-in-depth: at most one 'earn' row per (existing) order id. Awarding is
-- done exactly once inside place_order at order creation, so this guards against
-- a future/duplicate award for an already-created order — not against a client
-- retry that creates a brand-new order (that would be a distinct order).
create unique index if not exists loyalty_tx_one_earn_per_order
  on public.loyalty_transactions(order_id) where type = 'earn';

alter table public.loyalty_transactions enable row level security;
revoke all on public.loyalty_transactions from anon, authenticated;
-- Read-only for clients (writes happen only inside SECURITY DEFINER routines).
grant select on public.loyalty_transactions to authenticated;

drop policy if exists loyalty_tx_select_own_or_staff on public.loyalty_transactions;
create policy loyalty_tx_select_own_or_staff on public.loyalty_transactions
  for select to authenticated
  using (profile_id = auth.uid() or public.is_staff());

-- ---- place_order: same 7-arg contract, now writes the ledger ---------------
-- Belt-and-suspenders: drop the exact 7-arg signature first so re-runs can
-- never accumulate a second overload (which would break PostgREST resolution).
drop function if exists public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer);
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
  v_bal_start        integer;
  v_bal_new          integer;
begin
  if v_customer is null then
    raise exception 'Authentication is required to place an order' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cannot place an order with an empty cart';
  end if;

  -- Lock the customer's profile row so the read → cap → deduct sequence is
  -- serialized: two concurrent orders can't both redeem against the same
  -- (stale) balance and over-spend points.
  select * into v_profile  from public.profiles    where id = v_customer for update;
  select * into v_settings from public.app_settings where id = true;

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

  if p_order_type = 'delivery' and v_subtotal < v_branch.min_delivery_order then
    raise exception 'Order subtotal is below the branch delivery minimum of %',
      v_branch.min_delivery_order;
  end if;

  -- ---- Loyalty redemption (server-authoritative) ---------------------------
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

  -- ---- Create the order (records what it did to the loyalty balance) --------
  insert into public.orders (
    customer_id, customer_name, customer_phone,
    branch_id, branch_name_en, branch_name_ar,
    status, order_type, subtotal, delivery_fee, discount_amount,
    loyalty_discount_amount, vat_amount, total, payment_status,
    coupon_code, notes, address_id, address_snapshot,
    loyalty_points_earned, loyalty_points_redeemed, loyalty_awarded_at
  ) values (
    v_customer, v_profile.full_name, v_profile.phone_number,
    v_branch.id, v_branch.name_en, v_branch.name_ar,
    'received', p_order_type, v_subtotal, v_delivery_fee, v_discount,
    v_loyalty_discount, v_vat, v_total, 'pending',
    case when v_discount > 0 then upper(trim(p_coupon_code)) else null end,
    p_notes, v_address.id,
    case when v_address.id is not null then to_jsonb(v_address) else null end,
    v_points_earned, v_loyalty_redeemed,
    -- only stamp awarded_at when the order actually moved the loyalty balance
    case when v_loyalty_on and (v_loyalty_redeemed > 0 or v_points_earned > 0) then now() else null end
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

  if v_discount > 0 and p_coupon_code is not null then
    update public.coupons
      set usage_count = usage_count + 1
      where code = upper(trim(p_coupon_code));
  end if;

  -- ---- Apply the loyalty balance change + write the ledger ------------------
  -- Capture the authoritative post-update balance (reflects any floor clamp) so
  -- the ledger's balance_after snapshots are exact and reconcile row-to-row:
  -- redeem row balance_after = B0 - redeemed; earn row = B0 - redeemed + earned.
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

revoke all on function public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer)
  from public, anon;
grant execute on function public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer)
  to authenticated;

-- ---- adjust_loyalty_points: now audited (+ optional reason) ----------------
drop function if exists public.adjust_loyalty_points(uuid, integer);
drop function if exists public.adjust_loyalty_points(uuid, integer, text);

create or replace function public.adjust_loyalty_points(p_customer_id uuid, p_delta integer, p_reason text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_old     integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins may adjust loyalty points' using errcode = '42501';
  end if;
  -- Lock + read the current balance so the ledger records the ACTUAL applied
  -- delta (a large negative adjustment clamps at 0; the row must reflect that).
  select loyalty_points into v_old from public.profiles where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found';
  end if;
  update public.profiles
    set loyalty_points = greatest(0, coalesce(v_old, 0) + coalesce(p_delta, 0))
    where id = p_customer_id
    returning * into v_profile;

  insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
  values (p_customer_id, null, 'adjustment', v_profile.loyalty_points - coalesce(v_old, 0),
          v_profile.loyalty_points, coalesce(p_reason, 'Admin adjustment'), auth.uid());

  return v_profile;
end $$;

revoke all on function public.adjust_loyalty_points(uuid, integer, text) from public, anon;
grant execute on function public.adjust_loyalty_points(uuid, integer, text) to authenticated;
