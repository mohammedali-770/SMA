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

do $$ begin raise notice 'lazywait_delivery_sync_test: all assertions passed'; end $$;

rollback;
