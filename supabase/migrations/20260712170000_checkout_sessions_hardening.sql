-- ============================================================================
-- Checkout sessions — production hardening (fixes from full-project review).
--
-- 1. finalize_checkout_session: the payment_records UPDATE could match MULTIPLE
--    rows (an old failed ref-less attempt + the live one) → unique violation on
--    (provider, provider_ref) → the whole finalize (incl. the just-created
--    order) rolled back, and every webhook/verify retry hit the same violation:
--    customer charged, order never created. Now targets exactly one row.
-- 2. begin_checkout_session: stale pending_payment sessions were never expired,
--    so the (customer_id, idempotency_key) partial unique index raised an
--    unhandled unique_violation on a retried Confirm after 30 min. Now expires
--    stale sessions up-front.
-- 3. finalize now accepts an 'expired' (but unconsumed) session: the Tap charge
--    window can outlive the 30-min session, and a captured payment must NEVER
--    be refused (the amount check still gates it).
-- 4. Session-flow orders now record paid_at + payment_provider (finance queries
--    keyed on paid_at were missing all session-flow revenue).
-- 5. tap_begin_session_attempt now blocks opening a charge when the customer's
--    live loyalty balance no longer covers the points redeemed across their
--    open sessions (concurrent-session multi-spend guard).
-- 6. Index for the Lazywait webhook's hot orders.lazywait_ref lookup.
-- ============================================================================

-- ---- 4a. insert_order_from_snapshot: add payment provider + paid_at ---------
drop function if exists public.insert_order_from_snapshot(uuid, jsonb, text, text, uuid);

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

revoke all on function public.insert_order_from_snapshot(uuid, jsonb, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.insert_order_from_snapshot(uuid, jsonb, text, text, uuid, text) to service_role;

-- ---- 2. begin_checkout_session: expire stale sessions before reuse/insert ---
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

  -- Expire this customer's stale sessions FIRST: frees the partial unique index
  -- (customer_id, idempotency_key) WHERE status='pending_payment', which would
  -- otherwise raise on a retried Confirm after the 30-minute window.
  update public.checkout_sessions
     set status = 'expired'
   where customer_id = v_customer and status = 'pending_payment' and expires_at <= now();

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

  -- Zero-total (fully covered): nothing to charge — settle immediately.
  if v_session.total <= 0 then
    v_order := public.insert_order_from_snapshot(
      v_customer, v_snapshot || jsonb_build_object('notes', p_notes), 'online', 'paid', null, null);
    update public.checkout_sessions
      set status = 'consumed', order_id = v_order.id, consumed_at = now()
      where id = v_session.id
      returning * into v_session;
  end if;

  return v_session;
end $$;

revoke all on function public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid) to authenticated;

-- ---- 5. tap_begin_session_attempt: loyalty multi-spend guard -----------------
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
  v_redeem   integer;
  v_other    integer;
  v_balance  integer;
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

  -- Loyalty multi-spend guard: the live balance must still cover the points this
  -- session redeems PLUS points reserved by the customer's other live sessions.
  -- The profile row lock serializes concurrent initiations.
  v_redeem := coalesce((v_session.snapshot->>'loyalty_points_redeemed')::int, 0);
  if v_redeem > 0 then
    select coalesce(loyalty_points, 0) into v_balance
      from public.profiles where id = v_session.customer_id for update;
    select coalesce(sum(coalesce((s.snapshot->>'loyalty_points_redeemed')::int, 0)), 0) into v_other
      from public.checkout_sessions s
      where s.customer_id = v_session.customer_id and s.id <> v_session.id
        and s.status = 'pending_payment' and s.expires_at > now();
    if v_balance < v_redeem + v_other then
      raise exception 'Your loyalty points balance changed. Please rebuild your order.' using errcode = 'P0001';
    end if;
  end if;

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

-- ---- 1+3+4b. finalize_checkout_session: single-row update, accept expired ----
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
  -- A captured payment must never be refused: the Tap charge window can outlive
  -- the 30-minute session, so an 'expired' (but unconsumed) session is still
  -- finalizable — the amount check below is the real gate. Only 'cancelled' (or
  -- an unexpected state) is rejected.
  if v_session.status not in ('pending_payment', 'expired') then
    raise exception 'Checkout session is not payable (status=%)', v_session.status using errcode = 'P0001';
  end if;

  if round(coalesce(p_amount,0), 2) <> round(v_session.total, 2) then
    raise exception 'Paid amount % does not match order total %', p_amount, v_session.total using errcode = 'P0001';
  end if;

  v_order := public.insert_order_from_snapshot(
    v_session.customer_id,
    v_session.snapshot || jsonb_build_object('notes', v_session.notes),
    'online', 'paid', null, p_provider);

  -- Attach the payment to the (now existing) order. Target EXACTLY ONE row:
  -- prefer the attempt already carrying this provider_ref, else the newest
  -- ref-less 'initiated' attempt. A blanket session-wide update could touch an
  -- old failed ref-less attempt too and violate the (provider, provider_ref)
  -- unique index — rolling back the whole finalize after the customer paid.
  update public.payment_records
    set order_id = v_order.id, status = 'paid', provider_ref = p_provider_ref,
        amount = p_amount, currency = coalesce(p_currency, 'SAR'), raw = coalesce(p_raw, raw),
        card_scheme = coalesce(p_card_scheme, card_scheme),
        card_last_four = coalesce(p_card_last4, card_last_four),
        last_verified_at = now()
    where id = (
      select pr.id from public.payment_records pr
      where pr.checkout_session_id = p_session_id and pr.provider = p_provider
        and (pr.provider_ref = p_provider_ref or (pr.provider_ref is null and pr.status = 'initiated'))
      order by (pr.provider_ref = p_provider_ref) desc nulls last, pr.created_at desc
      limit 1
    );
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

-- ---- 6. Hot-path index for the Lazywait webhook lookup -----------------------
create index if not exists orders_lazywait_ref_idx
  on public.orders (lazywait_ref) where lazywait_ref is not null;
