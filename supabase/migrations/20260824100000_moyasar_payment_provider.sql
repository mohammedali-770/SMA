-- ============================================================================
-- Spicy Meal — Moyasar payment provider support. ADDITIVE + reversible.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved workflow in docs/MIGRATIONS.md (CLAUDE.md §8), and
-- the payment area is frozen on top of that (CLAUDE.md §6,
-- docs/PAYMENT_POSTPONEMENT.md). This file exists so the provider evaluation has
-- something concrete and reviewable to look at; applying it is a separate,
-- explicit owner decision.
--
-- WHAT THIS ADDS, AND WHY IT IS A NEW FILE RATHER THAN AN EDIT
-- The applied Tap migrations are never edited (docs/MIGRATIONS.md §2). Moyasar
-- therefore gets its support the same way Tap did: a new, additive migration.
-- Nothing here changes, drops or redefines a Tap object.
--
--   1. payment_records.provider_checkout_ref — the provider-side CHECKOUT object
--      an attempt is being paid through, when the provider issues one id to open
--      the checkout and a different id for the settled payment.
--
--      Tap does not: a charge id is created up front and refunded later, so
--      provider_ref alone covers it. Moyasar does: `POST /v1/invoices` returns
--      an INVOICE id and the hosted URL, and the PAYMENT id only exists once the
--      customer actually pays — and `POST /v1/payments/:id/refund` takes the
--      payment. So provider_ref keeps holding the thing that gets confirmed and
--      refunded (the payment), exactly as it does for a Tap charge, and this new
--      column holds the invoice the attempt was opened against.
--
--      That split is what lets `confirm_order_payment`, `finalize_checkout_session`
--      and the whole refund stack stay UNTOUCHED: order_refunds.charge_ref is
--      populated from payment_records.provider_ref, so it automatically receives
--      a refundable Moyasar payment id and needs no change.
--
--   2. begin_payment_attempt() / begin_session_attempt() — provider-parameterised
--      versions of tap_begin_payment_attempt() / tap_begin_session_attempt().
--      Same locking, same reuse-or-expire logic, same one-active-attempt
--      double-charge guard, same opaque references. The only differences are
--      that the provider is an argument instead of the literal 'tap', and that
--      the result carries provider_checkout_ref.
--
--      The Tap functions are left in place and unmodified. Nothing is migrated
--      onto the generic ones by this file; payment-initiate still calls the Tap
--      pair for Tap.
--
-- DOUBLE-CHARGE GUARD — UNCHANGED AND STILL THE PRIMARY CONTROL
-- The existing partial unique indexes are already provider-scoped:
--   payment_records_one_active_idx          (order_id, provider) where initiated
--   payment_records_one_active_session_idx  (checkout_session_id, provider) where initiated
-- so a Moyasar attempt is guarded by the same index that guards a Tap attempt,
-- with no new index required.
--
-- This matters more for Moyasar than it did for Tap. Tap accepts an
-- `reference.idempotent` string that makes a repeated charge create return the
-- FIRST charge for 24 hours. Moyasar documents `given_id` idempotency for
-- payment creation ONLY — there is no documented idempotency parameter on
-- `POST /v1/invoices`. The database guard below is therefore not a belt-and-
-- braces addition to a provider-side protection; for the invoice path it IS the
-- protection. See docs/integrations/Moyasar_API_Reference.md.
--
-- SAFETY
-- - Purely additive: one nullable column, one index, two new functions.
-- - No existing row is rewritten, no grant/ownership/RLS policy changes, no
--   change to any Tap object, no change to amount/currency/expiry/reuse
--   behaviour for any existing attempt.
-- - Reversible: drop the two functions, the index and the column.
-- - Nothing here enables Moyasar. The provider stays inert until an
--   administrator selects and enables it, which is itself an owner action.
-- ============================================================================

-- ---- 1. payment_records.provider_checkout_ref -------------------------------
alter table public.payment_records
  add column if not exists provider_checkout_ref text;

comment on column public.payment_records.provider_checkout_ref is
  'Provider-side checkout/session object this attempt is being paid through, when it is a different id from the settled payment. Moyasar: the invoice id (provider_ref holds the payment id). Tap: unused — a charge id is both.';

-- The webhook and the verify path locate an attempt by the provider's checkout
-- id, so it needs its own index. Not UNIQUE: uniqueness for an active attempt is
-- already enforced per (order|session, provider) by the two partial indexes
-- above, and a unique constraint here would additionally forbid re-opening an
-- attempt against a re-used invoice id, which is not a property we want to bet on.
create index if not exists payment_records_provider_checkout_ref_idx
  on public.payment_records (provider, provider_checkout_ref)
  where provider_checkout_ref is not null;

-- ---- 2. begin_payment_attempt(): provider-generic open-or-reuse -------------
-- Service-role only (called by payment-initiate AFTER it has proven order
-- ownership via the user's RLS). Returns the server-trusted amount so the client
-- never supplies it. Reuses a live attempt (idempotent button taps) and expires
-- a stale one before opening a new one.
--
-- reference_order is the OPAQUE 'ORD-…' value, never the internal SM-… order
-- number — the rule established for Tap by 20260724180000 and applied here from
-- the start.
create or replace function public.begin_payment_attempt(
  p_order_id       uuid,
  p_provider       text,
  p_mode           text,
  p_expiry_minutes integer default 30
)
returns table (
  attempt_id            uuid,
  reference_transaction text,
  reference_order       text,
  provider_ref          text,
  provider_checkout_ref text,
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
  v_provider text := nullif(btrim(lower(coalesce(p_provider, ''))), '');
  v_expires  timestamptz := now() + make_interval(mins => greatest(5, least(60, coalesce(p_expiry_minutes, 30))));
begin
  if v_provider is null then
    raise exception 'A payment provider is required' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_order.payment_status = 'paid' then raise exception 'Order is already paid' using errcode = 'P0001'; end if;
  if coalesce(v_order.payment_method, '') <> 'online' then raise exception 'Order is not an online-payment order' using errcode = 'P0001'; end if;
  if coalesce(v_order.total, 0) <= 0 then raise exception 'Order total must be greater than zero' using errcode = 'P0001'; end if;

  -- Reuse a still-live attempt; expire a stale one.
  select * into v_existing from public.payment_records
    where order_id = p_order_id and provider = v_provider and status = 'initiated'
    order by created_at desc limit 1;
  if found then
    if v_existing.expires_at is not null and v_existing.expires_at <= now() then
      update public.payment_records
        set status = 'failed', failure_code = 'expired', failure_message_safe = 'Payment session expired'
        where id = v_existing.id;
    else
      return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                          v_existing.provider_ref, v_existing.provider_checkout_ref, v_existing.checkout_url,
                          v_existing.amount, v_existing.currency, v_existing.mode, true;
      return;
    end if;
  end if;

  v_ref     := 'sm_' || replace(gen_random_uuid()::text, '-', '');
  v_ref_ord := 'ORD-' || substr(replace(p_order_id::text, '-', ''), 1, 12);
  begin
    insert into public.payment_records
      (order_id, provider, status, amount, currency, mode, reference_transaction, reference_order, initiated_at, expires_at)
    values
      (p_order_id, v_provider, 'initiated', v_order.total, 'SAR',
       case when p_mode = 'live' then 'live' else 'test' end,
       v_ref, v_ref_ord, now(), v_expires)
    returning * into v_new;
  exception when unique_violation then
    -- A concurrent attempt won the one-active-attempt race; return it instead of
    -- opening a second checkout.
    select * into v_existing from public.payment_records
      where order_id = p_order_id and provider = v_provider and status = 'initiated'
      order by created_at desc limit 1;
    return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                        v_existing.provider_ref, v_existing.provider_checkout_ref, v_existing.checkout_url,
                        v_existing.amount, v_existing.currency, v_existing.mode, true;
    return;
  end;

  return query select v_new.id, v_new.reference_transaction, v_new.reference_order,
                      v_new.provider_ref, v_new.provider_checkout_ref, v_new.checkout_url,
                      v_new.amount, v_new.currency, v_new.mode, false;
end $$;

revoke all on function public.begin_payment_attempt(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.begin_payment_attempt(uuid, text, text, integer) to service_role;

comment on function public.begin_payment_attempt(uuid, text, text, integer) is
  'Opens (or reuses) THE single active payment attempt for an order, for any provider. Provider-generic form of tap_begin_payment_attempt; reference_order is an OPAQUE ORD-… value, never the internal SM-… order number.';

-- ---- 3. begin_session_attempt(): provider-generic, checkout-session flow -----
create or replace function public.begin_session_attempt(
  p_session_id     uuid,
  p_provider       text,
  p_mode           text,
  p_expiry_minutes integer default 30
)
returns table (
  attempt_id            uuid,
  reference_transaction text,
  reference_order       text,
  provider_ref          text,
  provider_checkout_ref text,
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
  v_provider text := nullif(btrim(lower(coalesce(p_provider, ''))), '');
  v_expires  timestamptz := now() + make_interval(mins => greatest(5, least(60, coalesce(p_expiry_minutes, 30))));
begin
  if v_provider is null then
    raise exception 'A payment provider is required' using errcode = 'P0001';
  end if;

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
    where checkout_session_id = p_session_id and provider = v_provider and status = 'initiated'
    order by created_at desc limit 1;
  if found then
    if v_existing.expires_at is not null and v_existing.expires_at <= now() then
      update public.payment_records
        set status = 'failed', failure_code = 'expired', failure_message_safe = 'Payment session expired'
        where id = v_existing.id;
    else
      return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                          v_existing.provider_ref, v_existing.provider_checkout_ref, v_existing.checkout_url,
                          v_existing.amount, v_existing.currency, v_existing.mode, true;
      return;
    end if;
  end if;

  v_ref := 'sm_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.payment_records
      (checkout_session_id, provider, status, amount, currency, mode, reference_transaction, reference_order, initiated_at, expires_at)
    values
      (p_session_id, v_provider, 'initiated', v_session.total, coalesce(v_session.currency, 'SAR'),
       case when p_mode = 'live' then 'live' else 'test' end,
       v_ref, 'CS-' || substr(replace(p_session_id::text, '-', ''), 1, 12), now(), v_expires)
    returning * into v_new;
  exception when unique_violation then
    select * into v_existing from public.payment_records
      where checkout_session_id = p_session_id and provider = v_provider and status = 'initiated'
      order by created_at desc limit 1;
    return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                        v_existing.provider_ref, v_existing.provider_checkout_ref, v_existing.checkout_url,
                        v_existing.amount, v_existing.currency, v_existing.mode, true;
    return;
  end;

  return query select v_new.id, v_new.reference_transaction, v_new.reference_order,
                      v_new.provider_ref, v_new.provider_checkout_ref, v_new.checkout_url,
                      v_new.amount, v_new.currency, v_new.mode, false;
end $$;

revoke all on function public.begin_session_attempt(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.begin_session_attempt(uuid, text, text, integer) to service_role;

comment on function public.begin_session_attempt(uuid, text, text, integer) is
  'Opens (or reuses) THE single active payment attempt for a checkout session, for any provider. Provider-generic form of tap_begin_session_attempt.';
