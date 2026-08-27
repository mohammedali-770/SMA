-- ============================================================================
-- Delivery orders enter the POS queue (20260827120000)
--
-- THE DEFECT THIS PINS. `set_lazywait_initial_sync` parked every delivery order
-- at `blocked`/`delivery_schema_unconfirmed` on INSERT, so the worker never saw
-- it: SM-2026-000057 died with sync_attempt_count = 0 while the customer was
-- pushed "we sent it to the kitchen". Case 1 fails against the pre-fix trigger.
--
-- The payment gate must survive the change, which is what cases 3 and 4 are for:
-- an unpaid ONLINE order must still park, delivery or not, so nothing reaches
-- the kitchen before it is paid.
-- ============================================================================
begin;

\set cust '''00000000-0000-0000-0000-0000000dd001'''
\set branch '''b0000000-0000-0000-0000-000000000001'''

insert into auth.users (id, email) values (:cust, 'delivery@x');
insert into public.profiles (id, role, full_name, phone_number)
values (:cust, 'customer', 'Delivery Person', '+966500000301')
on conflict (id) do update set role = excluded.role;

-- ============================================================================
-- 1. A cash DELIVERY order queues for the POS
-- ============================================================================
do $$
declare o public.orders;
begin
  insert into public.orders (customer_id, branch_id, order_type, status,
                             payment_method, payment_status, subtotal, total)
  values ('00000000-0000-0000-0000-0000000dd001',
          'b0000000-0000-0000-0000-000000000001', 'delivery', 'received',
          'cash', 'pending', 49.00, 49.00)
  returning * into o;

  if o.lazywait_sync_state <> 'pending' then
    raise exception 'FAIL 1: delivery order parked at % (reason %) instead of queueing',
      o.lazywait_sync_state, o.sync_blocked_reason;
  end if;
  if o.sync_blocked_reason is not null then
    raise exception 'FAIL 1: a queued delivery order carries block reason %', o.sync_blocked_reason;
  end if;
  if o.sync_next_attempt_at is null then
    raise exception 'FAIL 1: delivery order was never scheduled for an attempt';
  end if;

  raise notice 'case 1 ok — a cash delivery order queues, exactly like pickup';
end $$;

-- ============================================================================
-- 2. Pickup is unchanged
-- ============================================================================
do $$
declare o public.orders;
begin
  insert into public.orders (customer_id, branch_id, order_type, status,
                             payment_method, payment_status, subtotal, total)
  values ('00000000-0000-0000-0000-0000000dd001',
          'b0000000-0000-0000-0000-000000000001', 'pickup', 'received',
          'cash', 'pending', 32.00, 32.00)
  returning * into o;

  if o.lazywait_sync_state <> 'pending' or o.sync_next_attempt_at is null then
    raise exception 'FAIL 2: pickup regressed to % ', o.lazywait_sync_state;
  end if;
  raise notice 'case 2 ok — pickup still queues';
end $$;

-- ============================================================================
-- 3. An UNPAID ONLINE delivery order still parks — the payment gate holds
-- ============================================================================
-- This is the case that must NOT regress: opening delivery must not let an
-- unpaid order reach the kitchen.
do $$
declare o public.orders;
begin
  insert into public.orders (customer_id, branch_id, order_type, status,
                             payment_method, payment_status, subtotal, total)
  values ('00000000-0000-0000-0000-0000000dd001',
          'b0000000-0000-0000-0000-000000000001', 'delivery', 'received',
          'online', 'pending', 49.00, 49.00)
  returning * into o;

  if o.lazywait_sync_state <> 'awaiting_payment' then
    raise exception 'FAIL 3: an UNPAID online delivery order is %, not awaiting_payment',
      o.lazywait_sync_state;
  end if;
  if o.sync_next_attempt_at is not null then
    raise exception 'FAIL 3: an unpaid order was scheduled to send';
  end if;
  raise notice 'case 3 ok — an unpaid online delivery order still parks';
end $$;

-- ============================================================================
-- 4. A PAID online delivery order queues
-- ============================================================================
do $$
declare o public.orders;
begin
  insert into public.orders (customer_id, branch_id, order_type, status,
                             payment_method, payment_status, paid_at, subtotal, total)
  values ('00000000-0000-0000-0000-0000000dd001',
          'b0000000-0000-0000-0000-000000000001', 'delivery', 'received',
          'online', 'paid', now(), 49.00, 49.00)
  returning * into o;

  if o.lazywait_sync_state <> 'pending' then
    raise exception 'FAIL 4: a PAID online delivery order is %, not pending', o.lazywait_sync_state;
  end if;
  raise notice 'case 4 ok — a paid online delivery order queues';
end $$;

-- ============================================================================
-- 5. No order type is parked with the retired reason any more
-- ============================================================================
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.orders
   where sync_blocked_reason = 'delivery_schema_unconfirmed'
     and created_at > now() - interval '1 minute';
  if v_n <> 0 then
    raise exception 'FAIL 5: % order(s) still parked with the retired reason', v_n;
  end if;
  raise notice 'case 5 ok — delivery_schema_unconfirmed is no longer produced';
end $$;

-- ============================================================================
-- 6. THE REAL PAYMENT FLOW — pending -> paid via confirm_order_payment
-- ============================================================================
-- Case 4 inserts an already-paid row, which never touches confirm_order_payment
-- and so proved nothing about the online path. Raised in review of PR #274, and
-- it was right: `confirm_order_payment` carried the SAME `order_type = 'pickup'`
-- filter, so a paid online DELIVERY order parked at awaiting_payment forever.
do $$
declare o public.orders; v_after public.orders;
begin
  insert into public.orders (customer_id, branch_id, order_type, status,
                             payment_method, payment_status, subtotal, total)
  values ('00000000-0000-0000-0000-0000000dd001',
          'b0000000-0000-0000-0000-000000000001', 'delivery', 'received',
          'online', 'pending', 49.00, 49.00)
  returning * into o;

  if o.lazywait_sync_state <> 'awaiting_payment' then
    raise exception 'FAIL 6: setup — expected awaiting_payment, got %', o.lazywait_sync_state;
  end if;

  v_after := public.confirm_order_payment(o.id, 'test-provider', 'REF_D_1', 49.00, null);

  if v_after.payment_status <> 'paid' then
    raise exception 'FAIL 6: payment did not confirm (%)', v_after.payment_status;
  end if;
  if v_after.lazywait_sync_state <> 'pending' then
    raise exception 'FAIL 6: a PAID online delivery order is still % — it will never reach the kitchen',
      v_after.lazywait_sync_state;
  end if;
  if v_after.sync_next_attempt_at is null then
    raise exception 'FAIL 6: paid delivery order was never scheduled to send';
  end if;

  raise notice 'case 6 ok — paying for an online delivery order releases it to the POS queue';
end $$;

-- ============================================================================
-- 7. Pickup's payment release is unchanged
-- ============================================================================
do $$
declare o public.orders; v_after public.orders;
begin
  insert into public.orders (customer_id, branch_id, order_type, status,
                             payment_method, payment_status, subtotal, total)
  values ('00000000-0000-0000-0000-0000000dd001',
          'b0000000-0000-0000-0000-000000000001', 'pickup', 'received',
          'online', 'pending', 32.00, 32.00)
  returning * into o;

  v_after := public.confirm_order_payment(o.id, 'test-provider', 'REF_P_1', 32.00, null);
  if v_after.lazywait_sync_state <> 'pending' then
    raise exception 'FAIL 7: pickup payment release regressed to %', v_after.lazywait_sync_state;
  end if;
  raise notice 'case 7 ok — pickup payment release unchanged';
end $$;

-- ============================================================================
-- 8. Retry: delivery is retryable, but the retired-reason rows are NOT
-- ============================================================================
-- Also raised in review: dropping the delivery refusal made the three
-- historical `delivery_schema_unconfirmed` rows fall through to 'requeued'.
-- They are up to a month old with no deadline, so nothing else stopped them.
do $$
begin
  if public.lazywait_requeue_eligibility('failed', null, now()+interval '5m', 1, null, 'delivery', null) <> 'requeued' then
    raise exception 'FAIL 8: a failed delivery order should be retryable';
  end if;
  if public.lazywait_requeue_eligibility('blocked', null, null, 0, null, 'delivery', 'delivery_schema_unconfirmed') <> 'not_retryable' then
    raise exception 'FAIL 8: a row blocked under the RETIRED reason must never auto-retry';
  end if;
  -- The rails still bite for delivery.
  if public.lazywait_requeue_eligibility('synced', 'REF_1', null, 1, null, 'delivery', null) <> 'already_synced' then
    raise exception 'FAIL 8: delivery with a usable ref must not resend';
  end if;
  raise notice 'case 8 ok — delivery retries, retired-reason rows do not';
end $$;

do $$ begin raise notice 'lazywait_delivery_sync_test: all assertions passed'; end $$;

rollback;
