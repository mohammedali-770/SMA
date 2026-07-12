-- ============================================================================
-- Spicy Meal — Tap Payments (Hosted Checkout) support. ADDITIVE + reversible.
--
-- Reuses the existing provider-agnostic payment core untouched:
--   * confirm_order_payment(provider,...) already marks paid idempotently on
--     (provider, provider_ref), enforces amount == order total, and flips a held
--     online pickup order (awaiting_payment -> pending) into the Lazywait queue.
--   * payment_records already has the (provider, provider_ref) webhook-idempotency
--     unique index and staff-read RLS.
--
-- This migration adds ONLY: Tap-specific columns for reconciliation, timestamp
-- stamping, a DB-level "one active payment attempt per order" guard (the core
-- double-charge protection), and one atomic RPC to open/reuse an attempt.
-- Nothing here enables Tap; the provider stays disabled until an admin configures
-- it. No secret is stored here.
-- ============================================================================

-- ---- 1. payment_records: Tap reconciliation fields (all additive/nullable) ---
alter table public.payment_records add column if not exists mode                  text
  check (mode is null or mode in ('test','live'));
alter table public.payment_records add column if not exists reference_transaction text;   -- our unique attempt ref
alter table public.payment_records add column if not exists reference_order       text;   -- local order number
alter table public.payment_records add column if not exists checkout_url          text;   -- Tap transaction.url (not secret)
alter table public.payment_records add column if not exists initiated_at          timestamptz default now();
alter table public.payment_records add column if not exists confirmed_at          timestamptz;
alter table public.payment_records add column if not exists failed_at             timestamptz;
alter table public.payment_records add column if not exists failure_code          text;
alter table public.payment_records add column if not exists failure_message_safe  text;
alter table public.payment_records add column if not exists last_verified_at      timestamptz;
alter table public.payment_records add column if not exists expires_at            timestamptz;
-- Safe display fields ONLY (never first_six / PAN / CVV).
alter table public.payment_records add column if not exists card_scheme           text;
alter table public.payment_records add column if not exists card_last_four        text;

-- ---- 2. One ACTIVE payment attempt per order (the double-charge guard) -------
-- At most one 'initiated' record per (order_id, provider). A second concurrent
-- attempt (double-tap / retried request) hits this unique index and is rejected,
-- so the app can never open two live charges for the same order. Paid/failed rows
-- are exempt, so a genuine retry after a finalized attempt still works.
create unique index if not exists payment_records_one_active_idx
  on public.payment_records (order_id, provider)
  where status = 'initiated';

create index if not exists payment_records_ref_txn_idx
  on public.payment_records (reference_transaction) where reference_transaction is not null;

-- ---- 3. Stamp confirmed_at / failed_at from status transitions ---------------
-- Keeps confirm_order_payment (reused verbatim) unchanged: the timestamps are set
-- by a trigger whenever a row reaches 'paid'/'failed', on INSERT or UPDATE.
create or replace function public.stamp_payment_record_ts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'paid'   and new.confirmed_at is null then new.confirmed_at := now(); end if;
  if new.status = 'failed' and new.failed_at    is null then new.failed_at    := now(); end if;
  return new;
end $$;

drop trigger if exists stamp_payment_record_ts on public.payment_records;
create trigger stamp_payment_record_ts
  before insert or update on public.payment_records
  for each row execute function public.stamp_payment_record_ts();

-- ---- 4. tap_begin_payment_attempt(): atomic open-or-reuse a payment attempt --
-- Service-role only (called by the payment-initiate Edge Function AFTER it has
-- proven order ownership via the user's RLS). Returns the server-trusted amount
-- so the client never supplies it. Reuses a live attempt (idempotent button taps)
-- and expires a stale one before opening a new one.
create or replace function public.tap_begin_payment_attempt(
  p_order_id       uuid,
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
  v_order    public.orders;
  v_existing public.payment_records;
  v_new      public.payment_records;
  v_ref      text;
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
      return query select v_existing.id, v_existing.reference_transaction, v_existing.reference_order,
                          v_existing.provider_ref, v_existing.checkout_url, v_existing.amount,
                          v_existing.currency, v_existing.mode, true;
      return;
    end if;
  end if;

  v_ref := 'sm_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.payment_records
      (order_id, provider, status, amount, currency, mode, reference_transaction, reference_order, initiated_at, expires_at)
    values
      (p_order_id, 'tap', 'initiated', v_order.total, 'SAR',
       case when p_mode = 'live' then 'live' else 'test' end,
       v_ref, v_order.order_number, now(), v_expires)
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

revoke all on function public.tap_begin_payment_attempt(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.tap_begin_payment_attempt(uuid, text, integer) to service_role;
