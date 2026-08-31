-- Customer order state: an in-flight send is "sending", not "may have been sent".
--
-- Two corrections to public.customer_order_state, which is THE server authority
-- and whose TypeScript mirror lives in
-- apps/mobile/src/features/orders/orderConfirmation.ts.
--
-- (1) ORDERING. The marker test ran BEFORE the in-flight test, so a healthy
--     order that was merely still being sent returned 'verifying_with_branch'
--     — the "we could not verify whether the branch received this order" copy.
--     pos_create_attempted_at is stamped by begin_lazywait_create_attempt
--     IMMEDIATELY BEFORE the POST leaves, so `syncing` + marker set is the
--     normal in-flight window of EVERY order, not an anomaly. The TypeScript
--     mirror was corrected on 2026-08-28 (PR #286) after a customer was shown
--     that screen for SM-2026-000070 — synced as ticket #2 in 7.30 s, zero
--     failed attempts — alongside a "confirmed" push. This brings the SQL into
--     line with it.
--
--     `p_ref is not null` deliberately stays AHEAD of the new test: a syncing
--     row that already carries a reference really is ambiguous. A marker that
--     OUTLIVED its send (pending / failed / dead_letter) also still returns
--     'verifying_with_branch' — the POST left and we never learned its fate.
--     Only the actively in-flight case moves.
--
-- (2) THE STALE AUTO-RETRY ARM. Clause (6) carried a second arm:
--
--         when p_sync_state = 'failed'
--              and p_next_attempt_at is not null and p_next_attempt_at > now()
--           then 'sending_to_branch'
--
--     That predates the manual-resend-only policy (20260813143000). There is no
--     automatic retry any more: a failed order is inert until the customer
--     explicitly resends it, and sync_next_attempt_at is retained only as
--     legacy/operational data. The arm told a customer we were still trying
--     when nothing was going to try. The TypeScript mirror has ignored
--     nextAttemptAt since that policy landed, and asserts
--     'branch_failed_retry_available' for this input — so this arm was ALSO a
--     silent SQL/TS divergence, and an older one than (1). Removing it makes a
--     failed row fall through to the resend-budget clause, which is the
--     documented behaviour.
--
-- WHAT THIS DOES NOT TOUCH, deliberately:
--
--   * customer_manual_pos_resend_eligibility. Its marker-first ordering is
--     CORRECT for its purpose — an order whose POST is in flight must never be
--     resent, because Create Order has no idempotency key and a resend would
--     duplicate a kitchen ticket. Do not "align" it with this function.
--   * Resend safety generally. request_customer_pos_resend branches on the
--     eligibility predicate, never on this function; customer_order_state is
--     called only AFTER the accept/refuse decision, to populate the response's
--     advisory `state` field. Reordering here cannot turn a refused resend into
--     an accepted one.
--
-- Pure function replacement. No table is read or written, no grant changes.

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

    -- (6) A send that is STILL IN FLIGHT is not ambiguous — it is unfinished.
    --     This MUST precede the marker test below: the marker is stamped just
    --     before the POST leaves, so it is set for the whole of this window.
    --     No staleness clock: a worker that dies mid-POST leaves 'syncing' for
    --     up to ten minutes before the reaper routes it to
    --     confirmation_required, and under-alarming on that rare case is far
    --     cheaper than alarming on every normal order. The reaper owns it.
    when p_sync_state = 'syncing' then 'sending_to_branch'

    -- (7) A marker that OUTLIVED its send really is ambiguous.
    when p_marker_at is not null then 'verifying_with_branch'   -- may have been sent

    -- (8) A first send or a customer-triggered resend is queued. There is NO
    --     automatic retry — see the header note on the removed arm.
    when p_sync_state in ('pending','awaiting_payment') then 'sending_to_branch'

    -- (9) Proven not sent and out of automatic road. Offer the manual resend while
    --     the budget lasts, then fall through to the terminal outcome.
    when coalesce(p_retry_count, 0) < public.customer_pos_resend_limit() then
      case when p_payment_status = 'paid'
           then 'branch_failed_retry_available'
           else 'unpaid_branch_failed_retry_available' end

    -- (10) Budget spent. A paid order is refunded (§7 enrolls it; this state is
    --     shown from the moment the budget is spent so the customer is told the
    --     truth even in the instant before the ledger row is written). An unpaid
    --     order gets the same apology with NO refund language.
    else
      case when p_payment_status = 'paid'
           then 'final_failure_refund_pending'
           else 'unpaid_final_failure' end
  end;
$$;

-- Grants are unchanged by CREATE OR REPLACE; restated so the surface is visible
-- in this file rather than only in 20260724120000.
revoke all on function public.customer_order_state(text, text, text, text, text, text, timestamptz, timestamptz, integer, text) from public, anon;
grant execute on function public.customer_order_state(text, text, text, text, text, text, timestamptz, timestamptz, integer, text) to authenticated, service_role;
