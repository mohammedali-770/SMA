-- ============================================================================
-- Spicy Meal — server-authoritative order lifecycle + cancellation compensation
--
-- Fixes two production-readiness defects without touching the frozen payment
-- area:
--   1. admin_set_order_status previously accepted any enum -> any enum, so the
--      client-side lifecycle could be bypassed by calling the RPC directly.
--   2. cancelling an order reversed neither loyalty redemption nor loyalty earn,
--      and left coupon usage_count consumed forever.
--
-- Cancellation stays admin-only. The entire status change + compensation runs
-- in one PostgreSQL transaction and the order row is locked first, so two
-- concurrent cancellation clicks cannot double-refund points or double-decrement
-- coupon usage.
-- ============================================================================

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
    v_earn_requested := greatest(0, coalesce(v_order.loyalty_points_earned, 0));
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

  update public.orders
     set status = p_status,
         updated_at = now()
   where id = v_order.id;
end $$;

revoke all on function public.admin_set_order_status(uuid, public.order_status)
  from public, anon;
grant execute on function public.admin_set_order_status(uuid, public.order_status)
  to authenticated;

comment on function public.admin_set_order_status(uuid, public.order_status) is
  'Admin-only forward order lifecycle. Cancellation transactionally reverses available earned loyalty, fully restores redeemed loyalty, returns coupon usage, and is row-lock idempotent (20260810100000).';
