-- Remove the internal SM-… order number from the Tap payment binding.
--
-- WHY
-- `tap_begin_payment_attempt` stored `orders.order_number` as
-- `payment_records.reference_order`, and payment-initiate forwards that value to
-- Tap as `reference.order`. Migration 20260724130000 already replaced the Tap
-- charge *description* with a constant, but `reference.order` still carried the
-- SM-… id off-platform on the direct-order payment path.
--
-- The checkout-session path (`tap_begin_session_attempt`, 20260712170000) has
-- always used an opaque `'CS-' || <session uuid fragment>` for the same field, so
-- an opaque reference is already proven against the live Tap contract.
--
-- SCOPE OF THE VALUE: PER-ORDER, NOT PER-ATTEMPT
-- `reference_order` is derived from the ORDER id, so every attempt opened for
-- the same order receives the SAME value. That is deliberate and matches both
-- the previous behaviour (orders.order_number was equally per-order) and the
-- session path ('CS-' is per checkout session). The PER-ATTEMPT component is
-- `reference_transaction` = 'sm_' || a fresh gen_random_uuid() — 122 bits, new
-- on every attempt.
--
-- Do not describe reference_order as per-attempt: after an attempt expires, a
-- second attempt for the same order is opened with an identical reference_order
-- and a different reference_transaction.
--
-- VERIFICATION STRENGTH IS UNCHANGED
-- `validateAndConfirmTapCharge` (supabase/functions/_shared/tapVerify.ts) binds
-- on BOTH references plus charge id, amount, currency, live_mode and merchant:
--   reference.order       === attempt.reference_order        (per-order)
--   reference.transaction === attempt.reference_transaction  (per-attempt)
-- Each is an exact comparison against the value THIS system stored when it
-- opened the charge, so the PAIR identifies one attempt uniquely. Strength comes
-- from the stored value being immutable and unguessable, not from its content —
-- and an opaque reference is strictly less guessable than a sequential SM-…
-- number, so this is a small improvement rather than a regression.
--
-- ENTROPY / TRUNCATION
-- 12 hex characters = 48 bits, the same width the session path has used against
-- the live Tap contract. Distinct orders yield distinct references until the
-- birthday bound (~2^24 ≈ 16.7M orders for a 50% chance of one collision).
-- A collision would affect reconciliation readability only, never verification:
-- reference_transaction still differs, and charge id + amount + mode + merchant
-- are all compared independently. Widen both this and 'CS-' together if the
-- order volume ever approaches that bound.
--
-- The other bound fields (charge id, amount, currency, reference.transaction,
-- live_mode, merchant id) are untouched, as is the webhook hashstring — the
-- description and reference.order are not part of `chargeHashFields`.
--
-- SAFETY
-- - Existing `payment_records` rows are NOT rewritten. Verification compares a
--   charge against the reference stored on its OWN attempt, so in-flight charges
--   opened before this migration keep verifying against their old SM-… value.
--   Only newly opened attempts get the opaque form.
-- - No grant, ownership, RLS policy or SECURITY DEFINER contract changes.
-- - No amount, currency, expiry, reuse or one-active-attempt behaviour changes.
--
-- NOT APPLIED TO PRODUCTION by this change (docs/MIGRATIONS.md; CLAUDE.md §8).

create or replace function public.tap_begin_payment_attempt(
  p_order_id       uuid,
  p_mode           text,
  p_expiry_minutes integer default 30
)
returns table (
  -- MUST stay `attempt_id`: CREATE OR REPLACE cannot change a function's return
  -- type, and payment-initiate reads `attempt.attempt_id`. Renaming it breaks
  -- both the migration chain and every payment initiation.
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
  v_order    public.orders;
  v_existing public.payment_records;
  v_new      public.payment_records;
  v_ref      text;
  v_ref_ord  text;
  v_expires  timestamptz := now() + make_interval(mins => greatest(5, least(60, coalesce(p_expiry_minutes, 30))));
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_order.payment_status = 'paid' then raise exception 'Order is already paid' using errcode = 'P0001'; end if;
  if coalesce(v_order.payment_method, '') <> 'online' then raise exception 'Order is not an online-payment order' using errcode = 'P0001'; end if;
  if coalesce(v_order.total, 0) <= 0 then raise exception 'Order total must be greater than zero' using errcode = 'P0001'; end if;

  -- Reuse a still-live attempt; expire a stale one.
  select * into v_existing from public.payment_records
    where order_id = p_order_id and provider = 'tap' and status = 'initiated'
    order by created_at desc limit 1;
  if found then
    if v_existing.expires_at is not null and v_existing.expires_at <= now() then
      update public.payment_records
        set status = 'failed', failure_code = 'expired', failure_message_safe = 'Payment session expired'
        where id = v_existing.id;
    else
      -- Reuse returns the attempt's OWN stored reference, so a pre-migration
      -- in-flight charge keeps the value it was opened with.
      return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                          v_existing.provider_ref, v_existing.checkout_url, v_existing.amount,
                          v_existing.currency, v_existing.mode, true;
      return;
    end if;
  end if;

  -- PER-ATTEMPT: a fresh 122-bit value on every attempt.
  v_ref := 'sm_' || replace(gen_random_uuid()::text, '-', '');
  -- PER-ORDER: stable for this order across attempts, same shape as the session
  -- path's 'CS-…'. Deliberately NOT orders.order_number.
  v_ref_ord := 'ORD-' || substr(replace(p_order_id::text, '-', ''), 1, 12);
  begin
    insert into public.payment_records
      (order_id, provider, status, amount, currency, mode, reference_transaction, reference_order, initiated_at, expires_at)
    values
      (p_order_id, 'tap', 'initiated', v_order.total, 'SAR',
       case when p_mode = 'live' then 'live' else 'test' end,
       v_ref, v_ref_ord, now(), v_expires)
    returning * into v_new;
  exception when unique_violation then
    -- A concurrent attempt won the one-active-attempt race; return it instead of
    -- opening a second charge.
    select * into v_existing from public.payment_records
      where order_id = p_order_id and provider = 'tap' and status = 'initiated'
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

-- Unchanged grant contract: service_role only (payment-initiate runs as admin).
revoke all on function public.tap_begin_payment_attempt(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.tap_begin_payment_attempt(uuid, text, integer) to service_role;

comment on function public.tap_begin_payment_attempt(uuid, text, integer) is
  'Opens (or reuses) a Tap attempt for an order. reference_order is an OPAQUE ORD-… value, never the internal SM-… order number — see 20260724180000.';

-- Rollback: re-apply 20260712120000''s definition of this function (it differs
-- only in the reference_order expression).
