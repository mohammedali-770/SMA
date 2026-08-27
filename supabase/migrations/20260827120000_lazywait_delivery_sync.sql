-- ===========================================================================
-- Delivery orders enter the POS queue
-- ===========================================================================
--
-- A real customer delivery order (SM-2026-000057, 2026-08-27 10:35, Nasserah)
-- never reached the kitchen. It was not a failure — it was never attempted:
-- `sync_attempt_count = 0`, `sync_next_attempt_at = null`.
--
-- THE GATE WAS HERE, not in the worker. `set_lazywait_initial_sync` is a BEFORE
-- INSERT trigger on `orders`, and its first branch parked every delivery order
-- at `blocked` / `delivery_schema_unconfirmed` before `claim_lazywait_sync_batch`
-- could ever see it. The Edge Function's own delivery block (removed in the same
-- change) was the second lock on a door this trigger had already bolted.
--
-- WHY IT IS SAFE TO OPEN NOW. The gate existed because the vendor contract
-- documented a pickup order and nothing about delivery. Re-reading it, plus the
-- owner's vendor request sample of 2026-08-27:
--
--   * only `client_id`, `branch_id` and a non-empty `order_items` are REQUIRED;
--   * `delivery_address` is a confirmed top-level string;
--   * `order_deliveries[]` is sent EMPTY on the vendor's own PICKUP sample,
--     alongside `order_payments[]`, `order_discounts[]` and `order_taxes[]` —
--     POS-side collections, not caller input. Nothing is invented for it.
--
-- The one thing still unconfirmed is whether `order_type` accepts the literal
-- `"delivery"`. A rejection now surfaces as an ordinary sync failure carrying
-- the API's own message, which is a better answer than a permanent guess — and
-- strictly better than the previous behaviour, which was to drop the order and
-- tell the customer it had reached the kitchen.
--
-- WHAT DOES NOT CHANGE. The payment gate is untouched: an ONLINE order that is
-- not yet paid still parks at `awaiting_payment` whether it is pickup or
-- delivery, so nothing reaches the kitchen before payment. Delivery simply stops
-- being a special case and follows the same rule as pickup.
--
-- EXISTING ROWS ARE NOT TOUCHED. This is BEFORE INSERT, so the three orders
-- already sitting at `delivery_schema_unconfirmed` (2026-07-24, 2026-08-21 and
-- SM-2026-000057) keep that state. Re-driving them is a separate, deliberate
-- write.
--
-- ORDER OF OPERATIONS IS NOT A TRAP HERE, in either direction:
--   * migration first, old worker  -> the order queues, the worker's builder
--     blocks it, and it lands `blocked` exactly as it does today;
--   * worker first, no migration   -> delivery never queues, nothing changes.
-- Both halves are needed for delivery to reach the POS; neither breaks pickup.
-- ===========================================================================

create or replace function public.set_lazywait_initial_sync()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Delivery is no longer a special case. The only gate left is payment, and it
  -- applies identically to both order types.
  if new.payment_method = 'online' and new.payment_status <> 'paid' then
    new.lazywait_sync_state  := 'awaiting_payment';
    new.sync_blocked_reason  := null;
    new.sync_next_attempt_at := null;
  else
    new.lazywait_sync_state  := 'pending';
    new.sync_blocked_reason  := null;
    new.sync_next_attempt_at := now();
  end if;
  return new;
end $$;

comment on function public.set_lazywait_initial_sync() is
  'BEFORE INSERT on orders: parks an unpaid ONLINE order at awaiting_payment, '
  'otherwise queues it for the POS. Delivery orders queue exactly like pickup '
  'as of 20260827120000; the destination is carried to the POS in the confirmed '
  'delivery_address field and repeated in order_details.';

-- ---------------------------------------------------------------------------
-- A failed delivery order must be retryable, like any other
-- ---------------------------------------------------------------------------
-- `lazywait_requeue_eligibility` refused delivery outright — its FIRST branch
-- was `when p_order_type = 'delivery' then 'not_retryable'`. That was correct
-- while delivery was never sent: there is nothing to retry when nothing was
-- attempted, and the admin Retry button should not offer a lie.
--
-- Now that delivery reaches the POS, a delivery order can fail for the ordinary
-- reasons — a 5xx, a timeout, a branch mapping fixed after the fact — and the
-- operator needs the same Retry the pickup path has had all along.
--
-- Every other rail is untouched and now protects delivery too, in this order: a
-- usable POS ref means it was created (`already_synced`); ANY stored ref marker,
-- even blank, refuses an automatic resend (`ref_present_unverified`); a send
-- marker without a ref needs a human (`may_have_sent`); then the attempt limit
-- and the deadline. Removing the first line widens WHO may retry, not WHAT is
-- considered safe to resend.
--
-- `src/lib/lazywaitRequeue.ts` mirrors this function and is changed in the same
-- commit; a test asserts the two agree.
create or replace function public.lazywait_requeue_eligibility(
  p_state text,
  p_ref text,
  p_deadline_at timestamptz,
  p_attempt_count integer,
  p_marker_at timestamptz,
  p_order_type text
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when public.lazywait_pos_ref_is_usable(p_ref) then 'already_synced'
    when p_ref is not null then 'ref_present_unverified'
    when p_state = 'synced' then 'ref_present_unverified'
    when p_state = 'confirmation_required' then 'confirmation_required'
    when p_marker_at is not null then 'may_have_sent'
    when p_state not in ('failed','blocked','dead_letter','skipped') then 'not_retryable'
    when coalesce(p_attempt_count, 0) >= 5 then 'attempt_limit_reached'
    when p_deadline_at is not null and now() >= p_deadline_at then 'deadline_expired'
    else 'requeued'
  end;
$$;
