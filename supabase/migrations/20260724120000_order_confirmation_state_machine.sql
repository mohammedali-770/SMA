-- ============================================================================
-- Spicy Meal — Customer order-confirmation state machine + automatic refunds.
--
-- GOAL (Issue #94): a customer is NEVER shown "Order placed" for an order that
-- has not been accepted by the branch, and the internal SM-… order number is
-- never customer-visible. Payment verification and branch (Lazywait) acceptance
-- become two SEPARATE, explicitly-modelled states:
--
--   * payment provider confirmation  = source of truth for PAYMENT
--   * Lazywait acceptance            = source of truth for ORDER PLACEMENT
--
-- and a paid order that cannot reach the branch becomes a recoverable state with
-- up to THREE customer-triggered resends, followed by an automatic refund.
--
-- This migration is FORWARD-ONLY and, at authoring time, REPOSITORY-ONLY /
-- UNAPPLIED. It does not touch cron, Vault, credentials, the push master flag,
-- or any applied migration.
--
-- ---------------------------------------------------------------------------
-- DESIGN CONSTRAINT 1 — Lazywait Create Order has NO idempotency key.
-- The confirmation lifecycle (20260721120000) is built entirely around this: an
-- AMBIGUOUS outcome (timeout / 2xx-without-ref / 5xx) may already have produced a
-- restaurant ticket, so it is routed to 'confirmation_required' and NEVER resent.
-- The customer resend added here therefore fires ONLY from PROVEN-NOT-SENT state
-- (no stored ref marker AND no pre-send phase marker). Ambiguous orders show
-- "verifying with the branch" and stay in the existing human-verification feed.
-- This is what makes requirement "retries never create duplicate Lazywait orders"
-- true in the absence of a provider idempotency key.
--
-- DESIGN CONSTRAINT 2 — not every channel is POS-integrated.
-- Delivery orders are held at 'blocked'/'delivery_schema_unconfirmed' because the
-- Lazywait delivery Create Order schema is unconfirmed and is never invented. Such
-- an order has NO branch-confirmation step, so gating it on Lazywait acceptance
-- would mark every delivery order permanently unconfirmed and refund all of them.
-- Participation in the gate is therefore decided by ONE predicate,
-- pos_confirmation_channel_active(), rather than hardcoded to pickup. When the
-- Lazywait delivery API lands and delivery begins enqueuing to 'pending' like
-- pickup, that predicate returns true and delivery flows through this identical
-- state machine with NO further change here.
--
-- DESIGN CONSTRAINT 3 — the automatic POS budget is deadline-bounded.
-- claim_lazywait_sync_* refuse rows past pos_sync_deadline_at. A manual resend
-- that did not extend that deadline would report success while the worker never
-- sent the order (the exact false-success bug 20260721120000 was written to fix),
-- so request_customer_pos_resend() extends the window as part of the same locked
-- statement that re-queues the row.
--
-- Contents:
--   1. orders: customer-resend counters + refund lifecycle columns.
--   2. order_refunds: append-only refund attempt ledger (one active per order).
--   3. pos_confirmation_channel_active(): does this order have a branch-
--      confirmation step at all?
--   4. customer_order_state(): THE authority mapping authoritative columns to one
--      customer-visible state. Pure; mirrored by the mobile app.
--   5. customer_pos_resend_eligibility(): pure proven-not-sent + budget predicate.
--   6. request_customer_pos_resend(): owner-scoped, server-counted, idempotent.
--   7. Refund enrollment triggers: automatic, path-independent, proven-not-sent.
--   8. Refund state-transition guard (rejects invalid/out-of-order transitions).
--   9. Refund worker RPCs: claim / finalize / release (token-fenced, idempotent).
--  10. Admin + service-role read RPCs.
--  11. Indexes and grants.
--
-- Idempotent: guarded so it can be re-applied safely.
-- ============================================================================

-- ---- 1. orders: customer-resend counters + refund lifecycle -----------------
-- pos_customer_retry_count    : server-counted MANUAL resends. Never trusted from
--                               the client. The budget (3) is deliberately not
--                               disclosed to the customer in any payload.
-- pos_customer_retry_last_at  : debounce/audit marker for the last manual resend.
-- refund_state                : 'none' until a proven non-delivery of a PAID order
--                               exhausts the manual budget. Only ever advanced by
--                               the guarded transitions in §8.
-- refund_required_at          : when the order became refund-eligible.
-- refund_completed_at         : provider-CONFIRMED completion (never optimistic).
-- refund_failure_code         : stable machine reason for the manual-review feed.
alter table public.orders add column if not exists pos_customer_retry_count   integer not null default 0;
alter table public.orders add column if not exists pos_customer_retry_last_at timestamptz;
alter table public.orders add column if not exists refund_required_at         timestamptz;
alter table public.orders add column if not exists refund_completed_at        timestamptz;
alter table public.orders add column if not exists refund_failure_code        text;
alter table public.orders add column if not exists refund_state               text not null default 'none';

do $$
begin
  alter table public.orders drop constraint if exists orders_refund_state_check;
  alter table public.orders add constraint orders_refund_state_check
    check (refund_state in ('none','pending','processing','refunded','failed'));
end $$;

-- The manual budget. Kept as a single named constant in SQL so the predicate, the
-- RPC and the refund-enrollment trigger can never drift apart.
create or replace function public.customer_pos_resend_limit()
returns integer language sql immutable set search_path = public as $$ select 3 $$;

revoke all on function public.customer_pos_resend_limit() from public, anon;
grant execute on function public.customer_pos_resend_limit() to authenticated, service_role;

-- Each manual resend re-opens the automatic send window by this much, so the
-- deadline-bounded claim RPCs will actually pick the row up (Design constraint 3).
create or replace function public.customer_pos_resend_window()
returns interval language sql immutable set search_path = public as $$ select interval '5 minutes' $$;

revoke all on function public.customer_pos_resend_window() from public, anon, authenticated;
grant execute on function public.customer_pos_resend_window() to service_role;

-- ---- 2. order_refunds: append-only refund attempt ledger -------------------
-- Full auditability without exposing anything customer-facing: no raw provider
-- payloads, no secrets, no PAN — only the provider's refund id, the charge it
-- refunds, a sanitized error string and counters.
--
-- idempotency_key is DETERMINISTIC per order (see §7), so a duplicated enrollment
-- — from a retried trigger, a concurrent path, or a replayed webhook — collides on
-- the unique index instead of opening a second refund. The partial unique index on
-- order_id additionally guarantees at most ONE live-or-succeeded refund per order:
-- the customer can never be refunded twice.
create table if not exists public.order_refunds (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  payment_record_id uuid references public.payment_records(id) on delete set null,
  provider          text not null,
  charge_ref        text,                     -- the original provider charge being refunded
  provider_ref      text,                     -- the provider's refund id, once issued
  idempotency_key   text not null,
  amount            numeric(10,2) not null check (amount >= 0),
  currency          text not null default 'SAR',
  status            text not null default 'pending'
                      check (status in ('pending','processing','succeeded','failed')),
  attempt_count     integer not null default 0,
  claim_token       text,
  reason            text,                     -- internal machine reason for the refund
  failure_code      text,
  last_error_safe   text,                     -- sanitized; never a provider payload
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create unique index if not exists order_refunds_idem_uq
  on public.order_refunds (idempotency_key);
-- At most one live-or-succeeded refund per order. A 'failed' row does not occupy
-- the slot, so an operator-driven retry can open a fresh attempt.
create unique index if not exists order_refunds_one_active_uq
  on public.order_refunds (order_id)
  where status in ('pending','processing','succeeded');
create index if not exists order_refunds_queue_idx
  on public.order_refunds (created_at)
  where status = 'pending';

drop trigger if exists set_order_refunds_updated_at on public.order_refunds;
create trigger set_order_refunds_updated_at
  before update on public.order_refunds
  for each row execute function public.set_updated_at();

-- The ledger is operational data: NOT customer-readable. The customer sees only
-- the derived refund_state on their own order row (existing orders RLS).
alter table public.order_refunds enable row level security;
revoke all on public.order_refunds from anon, authenticated;
drop policy if exists order_refunds_staff_read on public.order_refunds;
create policy order_refunds_staff_read on public.order_refunds
  for select to authenticated using (public.is_staff());
grant select on public.order_refunds to authenticated;

-- ---- 3. pos_confirmation_channel_active() ----------------------------------
-- Does this order have a branch-confirmation step at all? (Design constraint 2.)
--
-- FALSE means "there is no Lazywait acceptance to wait for", so the order is
-- complete once payment is settled — it is NEVER shown as unconfirmed and NEVER
-- auto-refunded. TRUE means the order participates in the full gate below.
--
-- Deliberately expressed in terms of the SYNC STATE, not the order type: the day
-- Lazywait publishes the delivery Create Order schema and set_lazywait_initial_sync
-- starts enqueuing delivery to 'pending' instead of blocking it, delivery becomes
-- gate-active automatically with no edit here.
create or replace function public.pos_confirmation_channel_active(
  p_sync_state     text,
  p_blocked_reason text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    -- Structurally not integrated with the POS: the delivery Create Order schema
    -- is unconfirmed, so nothing is ever sent and no confirmation can ever arrive.
    when p_sync_state = 'blocked' and p_blocked_reason = 'delivery_schema_unconfirmed' then false
    -- Pre-integration rows placed before Lazywait existed.
    when p_sync_state = 'skipped' then false
    when p_sync_state is null then false
    else true
  end;
$$;

revoke all on function public.pos_confirmation_channel_active(text, text) from public, anon;
grant execute on function public.pos_confirmation_channel_active(text, text) to authenticated, service_role;

-- ---- 4. customer_order_state(): THE authority ------------------------------
-- Maps authoritative columns to exactly ONE customer-visible state. Pure (no
-- table access), STABLE (reads now() for the retry window). The mobile app mirrors
-- this function in apps/mobile/src/features/orders/orderConfirmation.ts; both
-- sides are unit-tested against the same case table so they cannot drift.
--
-- Returned states — payment and branch acceptance are never collapsed together:
--   payment_pending                  online, not yet verified paid
--   accepted_no_pos_channel          PAID; this channel has no branch step
--   accepted_no_pos_channel_unpaid   unpaid (cash); this channel has no branch step
--   sending_to_branch                paid/cash; a send is in flight or auto-queued
--   confirmed_by_branch              Lazywait accepted; show the Lazywait number
--   verifying_with_branch            ambiguous outcome; human verification, NO resend
--   branch_failed_retry_available    PAID, proven not sent, resend available
--   unpaid_branch_failed_retry_available  CASH, proven not sent, resend available
--   final_failure_refund_pending     PAID, budget spent; refund in progress
--   final_failure_refunded           refund provider-CONFIRMED
--   final_failure_refund_failed      refund could not be completed; manual review
--   unpaid_final_failure             CASH, budget spent; no refund language
create or replace function public.customer_order_state(
  p_order_type        text,
  p_payment_method    text,
  p_payment_status    text,
  p_sync_state        text,
  p_ref               text,
  p_blocked_reason    text,
  p_next_attempt_at   timestamptz,
  p_marker_at         timestamptz,
  p_retry_count       integer,
  p_refund_state      text
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    -- (1) A refund lifecycle, once entered, is the whole customer story. It is
    --     only ever entered from a PROVEN non-delivery of a PAID order (§7).
    when p_refund_state = 'failed'     then 'final_failure_refund_failed'
    when p_refund_state = 'refunded'   then 'final_failure_refunded'
    when p_refund_state in ('pending','processing') then 'final_failure_refund_pending'

    -- (2) Online payment not yet verified. Never show anything order-like: the
    --     session flow does not even create an order until the charge is CAPTURED,
    --     so this only ever matches a legacy order-first row.
    when p_payment_method = 'online' and coalesce(p_payment_status,'pending') <> 'paid'
      then 'payment_pending'

    -- (3) No branch-confirmation step exists for this channel (Design constraint 2).
    --     Split by payment so the copy can state payment success WITHOUT ever
    --     implying branch acceptance: a cash-on-delivery order lands here too and
    --     must not be told "payment received".
    when not public.pos_confirmation_channel_active(p_sync_state, p_blocked_reason)
      then case when p_payment_status = 'paid'
                then 'accepted_no_pos_channel'
                else 'accepted_no_pos_channel_unpaid' end

    -- (4) The branch accepted it — the ONLY state that may claim confirmation, and
    --     only with a USABLE reference (the canonical helper, JS .trim() parity).
    when p_sync_state = 'synced' and public.lazywait_pos_ref_is_usable(p_ref)
      then 'confirmed_by_branch'

    -- (5) Ambiguous: a ticket MAY exist. Never "confirmed", never "failed", and
    --     never resendable (Design constraint 1) — a human verifies.
    when p_sync_state = 'confirmation_required' then 'verifying_with_branch'
    when p_sync_state = 'synced' then 'verifying_with_branch'   -- 'synced' w/o usable ref
    when p_ref is not null then 'verifying_with_branch'         -- ref marker, unusable
    when p_marker_at is not null then 'verifying_with_branch'   -- may have been sent

    -- (6) A send is in flight, or an automatic retry is still queued. The customer
    --     is not alarmed while the system is still trying on its own.
    when p_sync_state in ('pending','syncing','awaiting_payment') then 'sending_to_branch'
    when p_sync_state = 'failed'
         and p_next_attempt_at is not null and p_next_attempt_at > now()
      then 'sending_to_branch'

    -- (7) Proven not sent and out of automatic road. Offer the manual resend while
    --     the budget lasts, then fall through to the terminal outcome.
    when coalesce(p_retry_count, 0) < public.customer_pos_resend_limit() then
      case when p_payment_status = 'paid'
           then 'branch_failed_retry_available'
           else 'unpaid_branch_failed_retry_available' end

    -- (8) Budget spent. A paid order is refunded (§7 enrolls it; this state is
    --     shown from the moment the budget is spent so the customer is told the
    --     truth even in the instant before the ledger row is written). An unpaid
    --     order gets the same apology with NO refund language.
    else
      case when p_payment_status = 'paid'
           then 'final_failure_refund_pending'
           else 'unpaid_final_failure' end
  end;
$$;

revoke all on function public.customer_order_state(text, text, text, text, text, text, timestamptz, timestamptz, integer, text) from public, anon;
grant execute on function public.customer_order_state(text, text, text, text, text, text, timestamptz, timestamptz, integer, text) to authenticated, service_role;

-- ---- 5. customer_pos_resend_eligibility(): pure predicate -------------------
-- PROVEN-NOT-SENT ONLY (Design constraint 1). Returns 'eligible' or a stable
-- INTERNAL reason code. The reason codes never reach the customer — the RPC
-- collapses every ineligible outcome to a single opaque result so the 3-attempt
-- budget is not disclosed in any client-visible payload.
create or replace function public.customer_pos_resend_eligibility(
  p_sync_state      text,
  p_ref             text,
  p_blocked_reason  text,
  p_next_attempt_at timestamptz,
  p_marker_at       timestamptz,
  p_retry_count     integer,
  p_payment_method  text,
  p_payment_status  text,
  p_refund_state    text
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    -- A refund lifecycle has started: the order is closed to resends.
    when coalesce(p_refund_state,'none') <> 'none' then 'refund_in_progress'
    -- No branch step for this channel — nothing to resend.
    when not public.pos_confirmation_channel_active(p_sync_state, p_blocked_reason) then 'not_applicable'
    -- An unpaid ONLINE order was never paid for; it must not be pushed to a branch.
    when p_payment_method = 'online' and coalesce(p_payment_status,'pending') <> 'paid' then 'not_paid'
    -- ANY stored ref marker, or 'synced', means a ticket may exist — never resend.
    when p_ref is not null then 'ref_present'
    when p_sync_state = 'synced' then 'ref_present'
    -- Ambiguous outcome: the request may have reached the POS. Human verifies.
    when p_sync_state = 'confirmation_required' then 'verification_required'
    when p_marker_at is not null then 'may_have_sent'
    -- Still in flight, or an automatic retry is still queued: nothing to do yet.
    when p_sync_state not in ('failed','dead_letter','blocked') then 'not_failed'
    when p_sync_state = 'failed'
         and p_next_attempt_at is not null and p_next_attempt_at > now() then 'auto_retry_pending'
    -- Server-counted budget. Deliberately the LAST check, so an unsafe order is
    -- rejected for the unsafe reason rather than for exhausting its budget.
    when coalesce(p_retry_count, 0) >= public.customer_pos_resend_limit() then 'attempt_limit_reached'
    else 'eligible'
  end;
$$;

revoke all on function public.customer_pos_resend_eligibility(text, text, text, timestamptz, timestamptz, integer, text, text, text) from public, anon;
grant execute on function public.customer_pos_resend_eligibility(text, text, text, timestamptz, timestamptz, integer, text, text, text) to authenticated, service_role;

-- ---- 6. request_customer_pos_resend(): the customer Retry action ------------
-- Authenticated and OWNER-SCOPED (a customer may only resend their OWN order).
-- The order row is locked so a concurrent double-tap, a background worker claim
-- and the admin requeue all serialize; the second concurrent press observes the
-- already-requeued row and is rejected as 'not_failed' — it can never double the
-- counter or open a second send.
--
-- Returns ONLY { outcome, state }:
--   outcome 'accepted'    — the order was re-queued for one more send
--   outcome 'unavailable' — anything else, with NO reason and NO counter, so the
--                           three-attempt budget is never disclosed to the client
--   state                 — the freshly derived customer_order_state, which is the
--                           only thing the app renders
-- The internal reason is written to integration_sync_logs for operations.
create or replace function public.request_customer_pos_resend(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_elig  text;
  v_state text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> auth.uid() then
    -- Same response for "not yours" and "does not exist": never confirm the
    -- existence of another customer's order.
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  v_elig := public.customer_pos_resend_eligibility(
    v_order.lazywait_sync_state, v_order.lazywait_ref, v_order.sync_blocked_reason,
    v_order.sync_next_attempt_at, v_order.pos_create_attempted_at,
    v_order.pos_customer_retry_count, v_order.payment_method,
    v_order.payment_status::text, v_order.refund_state);

  if v_elig <> 'eligible' then
    insert into public.integration_sync_logs (provider, order_id, direction, status, request, error)
      values ('lazywait', p_order_id, 'push', 'skipped',
              jsonb_build_object('action', 'customer_resend'), 'resend_rejected_' || v_elig);
    v_state := public.customer_order_state(
      v_order.order_type::text, v_order.payment_method, v_order.payment_status::text,
      v_order.lazywait_sync_state, v_order.lazywait_ref, v_order.sync_blocked_reason,
      v_order.sync_next_attempt_at, v_order.pos_create_attempted_at,
      v_order.pos_customer_retry_count, v_order.refund_state);
    return jsonb_build_object('outcome', 'unavailable', 'state', v_state);
  end if;

  -- Eligible: count the attempt server-side and re-queue it. The absolute POS
  -- deadline is EXTENDED in the same statement — without this the row would be
  -- accepted here but refused by the deadline-bounded claim RPCs, reporting a
  -- success the worker never acts on (Design constraint 3).
  update public.orders set
    pos_customer_retry_count = pos_customer_retry_count + 1,
    pos_customer_retry_last_at = now(),
    lazywait_sync_state  = 'pending',
    sync_next_attempt_at = now(),
    pos_sync_deadline_at = greatest(
      coalesce(pos_sync_deadline_at, now()), now()) + public.customer_pos_resend_window(),
    sync_last_error      = null,
    sync_blocked_reason  = null,
    sync_status          = 'not_synced'::public.sync_status,
    updated_at           = now()
  where id = p_order_id
  returning * into v_order;

  insert into public.integration_sync_logs (provider, order_id, direction, status, request, error)
    values ('lazywait', p_order_id, 'push', 'success',
            jsonb_build_object('action', 'customer_resend',
                               'attempt', v_order.pos_customer_retry_count), null);

  v_state := public.customer_order_state(
    v_order.order_type::text, v_order.payment_method, v_order.payment_status::text,
    v_order.lazywait_sync_state, v_order.lazywait_ref, v_order.sync_blocked_reason,
    v_order.sync_next_attempt_at, v_order.pos_create_attempted_at,
    v_order.pos_customer_retry_count, v_order.refund_state);

  return jsonb_build_object('outcome', 'accepted', 'state', v_state);
end $$;

revoke all on function public.request_customer_pos_resend(uuid) from public, anon;
grant execute on function public.request_customer_pos_resend(uuid) to authenticated;

-- ---- 7. Automatic refund enrollment ----------------------------------------
-- order_refund_due(): the ONE predicate deciding that a PAID order has provably
-- NOT reached the branch and has exhausted its manual budget.
--
-- Every clause is a safety property, not a convenience:
--   * paid                        — nothing to refund otherwise
--   * channel active              — a channel with no branch step never "fails"
--   * ref IS NULL                 — any stored reference means a ticket may exist
--   * marker IS NULL              — a send may have left; PROVEN-not-sent only
--   * state in dead_letter/blocked— reached exclusively via proven-not-sent paths
--   * budget spent                — the customer got their three attempts
-- Together these implement "never refund an order that Lazywait actually
-- accepted": an ambiguous order is 'confirmation_required' (or carries a marker /
-- a ref) and is therefore excluded here, going to human verification instead.
create or replace function public.order_refund_due(
  p_payment_status text,
  p_sync_state     text,
  p_ref            text,
  p_blocked_reason text,
  p_marker_at      timestamptz,
  p_retry_count    integer,
  p_refund_state   text,
  p_total          numeric
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_refund_state,'none') = 'none'
     and p_payment_status = 'paid'
     and coalesce(p_total, 0) > 0
     and public.pos_confirmation_channel_active(p_sync_state, p_blocked_reason)
     and p_ref is null
     and p_marker_at is null
     and p_sync_state in ('dead_letter','blocked')
     and coalesce(p_retry_count, 0) >= public.customer_pos_resend_limit();
$$;

revoke all on function public.order_refund_due(text, text, text, text, timestamptz, integer, text, numeric) from public, anon;
grant execute on function public.order_refund_due(text, text, text, text, timestamptz, integer, text, numeric) to authenticated, service_role;

-- BEFORE trigger: stamp the refund enrollment onto the row being written, so it
-- is atomic with whatever drove the order terminal and cannot be missed. This is
-- deliberately PATH-INDEPENDENT: it fires whether the terminal transition came
-- from the stale reaper, the deadline sweep, the sync worker or an admin action.
create or replace function public.set_order_refund_enrollment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.order_refund_due(
       new.payment_status::text, new.lazywait_sync_state, new.lazywait_ref,
       new.sync_blocked_reason, new.pos_create_attempted_at,
       new.pos_customer_retry_count, new.refund_state, new.total) then
    new.refund_state       := 'pending';
    new.refund_required_at := coalesce(new.refund_required_at, now());
  end if;
  return new;
end $$;

drop trigger if exists set_orders_refund_enrollment on public.orders;
create trigger set_orders_refund_enrollment
  before insert or update on public.orders
  for each row execute function public.set_order_refund_enrollment();

-- AFTER trigger: open the ledger row for a freshly enrolled refund. The
-- idempotency key is DETERMINISTIC per order, so any duplicate enrollment path
-- collides on order_refunds_idem_uq instead of opening a second refund, and the
-- partial unique index on order_id blocks a second live refund regardless.
create or replace function public.open_order_refund_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payment_records;
begin
  if new.refund_state <> 'pending' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.refund_state = 'pending' then
    return null;                     -- already enrolled; nothing new to open
  end if;

  -- The captured attempt being refunded. Chosen by (order, paid) so a failed or
  -- abandoned earlier attempt can never be selected as the refund target.
  select * into v_pay from public.payment_records
   where order_id = new.id and status = 'paid'
   order by confirmed_at nulls last, created_at desc
   limit 1;

  insert into public.order_refunds (
    order_id, payment_record_id, provider, charge_ref, idempotency_key,
    amount, currency, status, reason
  ) values (
    new.id, v_pay.id, coalesce(v_pay.provider, new.payment_provider, 'tap'),
    v_pay.provider_ref,
    -- Deterministic: one refund identity per order, forever.
    'refund_' || replace(new.id::text, '-', ''),
    coalesce(v_pay.amount, new.total), coalesce(v_pay.currency, 'SAR'),
    'pending', 'pos_delivery_failed_after_customer_retries'
  )
  on conflict do nothing;

  return null;
end $$;

-- NOTE: deliberately NOT `update of refund_state`. A column-list trigger fires on
-- the columns named in the UPDATE's SET clause, not on what actually changed — and
-- refund_state is set by the BEFORE trigger above, never by the caller's SET list.
-- Scoping this to the column would therefore mean the ledger row is never opened.
-- The function guards on the transition itself instead, so the wider firing scope
-- costs one early return per order update.
drop trigger if exists open_orders_refund_record on public.orders;
create trigger open_orders_refund_record
  after insert or update on public.orders
  for each row execute function public.open_order_refund_record();

-- ---- 8. Refund state-transition guard --------------------------------------
-- An explicit state machine: any transition not listed is rejected, so an
-- out-of-order or replayed update can never, for example, walk 'refunded' back to
-- 'pending' and refund a customer twice.
create or replace function public.enforce_refund_state_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.refund_state is not distinct from old.refund_state then
    return new;
  end if;
  if not (
       (old.refund_state = 'none'       and new.refund_state = 'pending')
    or (old.refund_state = 'pending'    and new.refund_state in ('processing','failed'))
    or (old.refund_state = 'processing' and new.refund_state in ('refunded','failed','pending'))
    or (old.refund_state = 'failed'     and new.refund_state in ('processing','pending'))
  ) then
    raise exception 'invalid refund transition % -> %', old.refund_state, new.refund_state
      using errcode = 'P0001';
  end if;
  -- 'refunded' is terminal and provider-confirmed; stamp the completion once.
  if new.refund_state = 'refunded' then
    new.refund_completed_at := coalesce(new.refund_completed_at, now());
  end if;
  return new;
end $$;

drop trigger if exists enforce_orders_refund_transition on public.orders;
create trigger enforce_orders_refund_transition
  before update of refund_state on public.orders
  for each row execute function public.enforce_refund_state_transition();

-- ---- 9. Refund worker RPCs (token-fenced, idempotent) ----------------------
-- claim_order_refund(): atomically lease ONE pending refund. FOR UPDATE SKIP
-- LOCKED so concurrent workers never claim the same refund, and the order row is
-- advanced to 'processing' in the same transaction — the ledger and the customer-
-- visible state can never diverge.
--
-- LIVENESS: candidates are scanned first (unlocked, oldest-first, bounded) and
-- then locked and RE-VALIDATED one at a time. The earlier `… for update skip
-- locked limit 1` form returned ZERO rows whenever its single candidate failed
-- the post-lock re-check (a concurrent worker having just committed a claim),
-- so a run could idle while other refunds waited. Validating each candidate
-- under its own lock lets the scan advance to the next one instead.
--
-- The unlocked pre-scan is only a candidate LIST — every candidate is re-checked
-- for `status = 'pending'` while holding its row lock, so ordering, locking,
-- SKIP LOCKED non-blocking, lease/token fencing and single-claim safety are all
-- preserved. The bound stops one call from scanning an unbounded backlog.
create or replace function public.claim_order_refund(p_claim_token text)
returns table (
  refund_id       uuid,
  order_id        uuid,
  provider        text,
  charge_ref      text,
  idempotency_key text,
  amount          numeric,
  currency        text,
  attempt_count   integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.order_refunds;
  v_id    uuid;
  v_found boolean := false;
begin
  if p_claim_token is null or p_claim_token = '' then
    raise exception 'claim token required' using errcode = '22004';
  end if;

  -- Oldest-first candidate scan (unlocked, bounded), then lock + re-validate each
  -- in turn. A candidate that is locked by another worker is SKIPped; one that is
  -- no longer 'pending' fails the re-check; either way the scan continues.
  for v_id in
    select id from public.order_refunds
     where status = 'pending'
     order by created_at
     limit 50
  loop
    select * into v_row from public.order_refunds
     where id = v_id and status = 'pending'
     for update skip locked;
    if found then
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    return;
  end if;

  -- Aliased so `r.attempt_count` resolves to the COLUMN: this function's
  -- RETURNS TABLE output names are plpgsql variables, and an unqualified
  -- `attempt_count` would be an ambiguous reference.
  update public.order_refunds r
     set status = 'processing', claim_token = p_claim_token,
         attempt_count = r.attempt_count + 1, updated_at = now()
   where r.id = v_row.id
   returning r.* into v_row;

  update public.orders set refund_state = 'processing', updated_at = now()
   where id = v_row.order_id and refund_state in ('pending','failed');

  return query select v_row.id, v_row.order_id, v_row.provider, v_row.charge_ref,
                      v_row.idempotency_key, v_row.amount, v_row.currency, v_row.attempt_count;
end $$;

revoke all on function public.claim_order_refund(text) from public, anon, authenticated;
grant execute on function public.claim_order_refund(text) to service_role;

-- finalize_order_refund(): owner-fenced completion. 'succeeded' is written ONLY
-- when the provider confirmed it — never optimistically on a request being sent.
create or replace function public.finalize_order_refund(
  p_refund_id    uuid,
  p_claim_token  text,
  p_status       text,                     -- succeeded | failed | pending (release)
  p_provider_ref text default null,
  p_failure_code text default null,
  p_error_safe   text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.order_refunds;
begin
  if p_status not in ('succeeded','failed','pending') then
    raise exception 'invalid refund final status %', p_status using errcode = '22023';
  end if;

  update public.order_refunds
     set status       = p_status,
         provider_ref = coalesce(p_provider_ref, provider_ref),
         failure_code = case when p_status = 'succeeded' then null else p_failure_code end,
         last_error_safe = case when p_status = 'succeeded' then null else nullif(left(coalesce(p_error_safe,''), 300), '') end,
         -- Every outcome ends the lease: 'succeeded'/'failed' are terminal, and
         -- 'pending' releases the refund so a later run can re-claim it.
         claim_token  = null,
         completed_at = case when p_status = 'succeeded' then now() else completed_at end,
         updated_at   = now()
   where id = p_refund_id and status = 'processing' and claim_token = p_claim_token
   returning * into v_row;

  if not found then
    return false;                          -- lost claim: never touch a foreign lease
  end if;

  update public.orders
     set refund_state = case p_status
                          when 'succeeded' then 'refunded'
                          when 'failed'    then 'failed'
                          else 'pending' end,
         refund_failure_code = case when p_status = 'failed' then p_failure_code else null end,
         updated_at = now()
   where id = v_row.order_id;

  return true;
end $$;

revoke all on function public.finalize_order_refund(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_order_refund(uuid, text, text, text, text, text) to service_role;

-- ---- 10. Admin / service-role read RPCs ------------------------------------
-- Manual-review feed for refunds that could not be completed. Safe fields only:
-- no phone, no card data, no provider payloads, no full charge references.
drop function if exists public.list_failed_order_refunds(integer);
create or replace function public.list_failed_order_refunds(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_total integer; v_items jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins may view refund failures' using errcode = '42501';
  end if;

  select count(*) into v_total from public.order_refunds where status = 'failed';

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_items from (
    select r.id, r.order_id, o.order_number, r.amount, r.currency,
           r.attempt_count, r.failure_code, r.last_error_safe,
           r.created_at, r.updated_at,
           -- Fingerprint only; the full provider reference is never exposed.
           case when r.charge_ref is null then null else md5(r.charge_ref) end as charge_fingerprint
      from public.order_refunds r
      join public.orders o on o.id = r.order_id
     where r.status = 'failed'
     order by r.updated_at asc
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) t;

  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;

revoke all on function public.list_failed_order_refunds(integer) from public, anon;
grant execute on function public.list_failed_order_refunds(integer) to authenticated;

-- ---- 11. Indexes -----------------------------------------------------------
-- Orders awaiting refund action (small, hot for the worker + admin badge).
create index if not exists orders_refund_active_idx
  on public.orders (refund_required_at)
  where refund_state in ('pending','processing','failed');
