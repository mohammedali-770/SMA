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
-- A SEVENTH parameter is added: the block reason. Removing the delivery refusal
-- would otherwise make the THREE historical rows blocked under the retired
-- `delivery_schema_unconfirmed` reason retryable — and they are 1 month, 5 days
-- and 40 minutes old, with `pos_sync_deadline_at` NULL because they were never
-- queued, so not one of the existing rails stops them. An admin clicking Retry
-- would print a month-old ticket in a live kitchen.
--
-- Those rows were never sent and were never meant to be. Reviving one is a
-- deliberate decision about a specific old order, not a routine retry, so the
-- predicate refuses them by name.
drop function if exists public.lazywait_requeue_eligibility(text, text, timestamptz, integer, timestamptz, text);

create or replace function public.lazywait_requeue_eligibility(
  p_state text,
  p_ref text,
  p_deadline_at timestamptz,
  p_attempt_count integer,
  p_marker_at timestamptz,
  p_order_type text,
  p_blocked_reason text default null
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    -- Retired gate: these rows predate delivery sync and were never attempted.
    when p_blocked_reason = 'delivery_schema_unconfirmed' then 'not_retryable'
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

revoke all on function public.lazywait_requeue_eligibility(text, text, timestamptz, integer, timestamptz, text, text)
  from public, anon;
grant execute on function public.lazywait_requeue_eligibility(text, text, timestamptz, integer, timestamptz, text, text)
  to authenticated;

-- Pass the reason through from the caller that holds the whole row.
create or replace function public.requeue_lazywait_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_elig  text;
begin
  if not public.is_admin() then
    raise exception 'Only admins may requeue Lazywait sync' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found: Order not found' using errcode = 'P0002';
  end if;

  v_elig := public.lazywait_requeue_eligibility(
    v_order.lazywait_sync_state, v_order.lazywait_ref, v_order.pos_sync_deadline_at,
    v_order.sync_attempt_count, v_order.pos_create_attempted_at, v_order.order_type::text,
    v_order.sync_blocked_reason);

  if v_elig <> 'requeued' then
    raise exception '%', v_elig || ': ' || case v_elig
      when 'deadline_expired'      then 'Automatic POS retry window has expired. Verify the order manually.'
      when 'confirmation_required' then 'Order needs manual verification; automatic retry is disabled.'
      when 'already_synced'        then 'Order already has a usable POS reference / is synced; never resend.'
      when 'ref_present_unverified' then 'An existing POS reference marker requires manual verification; automatic resend is disabled.'
      when 'may_have_sent'         then 'A Create Order request may already have been sent; verify manually before any resend.'
      when 'attempt_limit_reached' then 'Maximum POS retry attempts reached. Verify the order manually.'
      else                              'Order is not in a safe, retryable state.'
    end
    using errcode = 'P0001';
  end if;

  update public.orders set
    lazywait_sync_state  = 'pending',
    sync_next_attempt_at = now(),
    sync_last_error      = null,
    sync_blocked_reason  = null,
    sync_status          = 'not_synced'::public.sync_status,
    updated_at           = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end $$;

-- ---------------------------------------------------------------------------
-- A PAID online delivery order must actually enter the queue
-- ---------------------------------------------------------------------------
-- The same `order_type = 'pickup'` filter appears a THIRD time, in
-- `confirm_order_payment`: it released `awaiting_payment` -> `pending` only for
-- pickup. Opening the insert trigger without this would have moved the failure
-- rather than fixed it — an online delivery order would take the payment, park
-- at `awaiting_payment`, and sit there forever.
--
-- It does not bite today only because online payment is disabled; it would fire
-- the moment that is switched on. Found in review of PR #274.
--
-- Body carried over verbatim; the two `order_type = 'pickup' and` clauses are
-- the only change. The rest of the payment logic — the duplicate-ref short
-- circuit, the amount check, the payment_records upsert — is untouched.
create or replace function public.confirm_order_payment(
  p_order_id uuid,
  p_provider text,
  p_provider_ref text,
  p_amount numeric,
  p_raw jsonb default null
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
        -- Delivery is released here too, as of 20260827120000.
        lazywait_sync_state  = case when lazywait_sync_state = 'awaiting_payment'
                                    then 'pending' else lazywait_sync_state end,
        sync_next_attempt_at = case when lazywait_sync_state = 'awaiting_payment'
                                    then now() else sync_next_attempt_at end,
        updated_at = now()
    where id = p_order_id
    returning * into v_order;

  return v_order;
end $$;
