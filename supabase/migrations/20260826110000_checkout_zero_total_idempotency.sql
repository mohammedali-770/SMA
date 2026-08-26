-- ===========================================================================
-- begin_checkout_session: make the zero-total path idempotent
-- ===========================================================================
--
-- Found while building the comped-customer feature, and fixed here rather than
-- in that feature's migrations because it is a PRE-EXISTING defect that has
-- nothing to do with comps - it is simply about to become reachable.
--
-- THE DEFECT. begin_checkout_session settles a zero-total cart inside a single
-- call: it inserts the session, creates the order, and flips the session to
-- 'consumed'. Its retry-safety lookup, however, required
-- `status = 'pending_payment'`, and it passed `p_idempotency_key = null` to
-- insert_order_from_snapshot. So a retried call with the SAME cart key found
-- nothing to reuse at either level and produced a second checkout session AND
-- a second free order. A flaky mobile network is enough to trigger it; that is
-- exactly the scenario order idempotency was added for in the first place
-- (20260707121400).
--
-- WHY IT HAS NOT BITTEN. Online payment is disabled, and the availability check
-- sits ABOVE the snapshot, so today every call raises 'Online payment is not
-- available' before reaching the zero-total branch. A zero total is also
-- currently only reachable by fully covering a cart with loyalty points and a
-- coupon. Comped customers make that branch ordinary rather than exotic, so the
-- hole is closed BEFORE it is stood on rather than after.
--
-- THE FIX, in two independent layers:
--
--   1. the reuse lookup also matches a session that already produced an order,
--      which is what a settled zero-total session looks like - the sequential
--      retry;
--   2. the idempotency key is carried onto the order, so the existing unique
--      index refuses a duplicate - the concurrent retry. The unique_violation
--      is recovered by returning the order that won, the same shape place_order
--      has used since 20260707121400.
--
-- Nothing else in the function changes: the expiry sweep, the online-payment
-- gate, the pricing call and the session row are reproduced verbatim.
-- ===========================================================================

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
    -- Two kinds of session are reusable, and until now only the first was found.
    --
    --   * still live      - pending_payment and inside its window, the ordinary
    --                       "customer tapped Confirm twice" case;
    --   * already settled - order_id is not null. A zero-total session is
    --                       created, consumed and given its order inside a
    --                       SINGLE call, so by the time a retry arrives it is no
    --                       longer 'pending_payment' and the old lookup missed
    --                       it entirely - falling through to create a SECOND
    --                       session and a SECOND free order. Matching on
    --                       order_id rather than on a status list also covers a
    --                       session consumed by finalize_checkout_session.
    select * into v_existing from public.checkout_sessions
      where customer_id = v_customer and idempotency_key = p_idempotency_key
        and (order_id is not null
             or (status = 'pending_payment' and expires_at > now()))
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
    begin
      -- The key is now carried onto the ORDER as well. The lookup above stops a
      -- sequential retry; this stops a concurrent one, because
      -- orders_idempotency_idx (20260707121400:14) refuses the second insert
      -- instead of letting two free orders exist for one cart.
      v_order := public.insert_order_from_snapshot(
        v_customer, v_snapshot || jsonb_build_object('notes', p_notes),
        'online', 'paid', p_idempotency_key, null);
    exception when unique_violation then
      -- Only the idempotency index may be recovered from. Without a key it
      -- cannot have been that index, so the error is something else and must
      -- not be swallowed; the same is true if the supposed winner is absent.
      if p_idempotency_key is null then raise; end if;
      select * into v_order from public.orders
        where customer_id = v_customer and idempotency_key = p_idempotency_key;
      if not found then raise; end if;
    end;
    update public.checkout_sessions
      set status = 'consumed', order_id = v_order.id, consumed_at = now()
      where id = v_session.id
      returning * into v_session;
  end if;

  return v_session;
end $$;
