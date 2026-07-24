/**
 * Customer order-confirmation state machine — PURE, framework-free MIRROR of the
 * SQL authority `public.customer_order_state()` (migration 20260724120000).
 *
 * The rule this module exists to enforce (Issue #94): payment settlement and
 * BRANCH ACCEPTANCE are two different facts, and the customer is never told their
 * order was placed on the strength of the first one alone. Exactly one state is
 * derived per order, and the screens render only from that state — there is no
 * unconditional success hero anywhere in the app.
 *
 * PARITY: this file and `customer_order_state()` must agree for every input. The
 * case table in orderConfirmation.test.ts is the shared contract, and the SQL side
 * asserts the same table in supabase/tests/order_confirmation_state_machine_test.sql.
 * If you change one, change the other in the same commit.
 *
 * No React / Expo / Supabase imports, so it runs under Vitest/Node like the other
 * pure order helpers.
 */

/** The single customer-visible state. Payment and branch acceptance never merge. */
export type CustomerOrderState =
  /** Online payment not yet verified. No order-like language may be shown. */
  | 'payment_pending'
  /**
   * PAID, and this channel has no branch-confirmation step (see below). Payment
   * success may be stated; branch acceptance may NOT — no success check.
   */
  | 'accepted_no_pos_channel'
  /**
   * UNPAID (cash), and this channel has no branch-confirmation step. Same as
   * above but without any payment claim — cash-on-delivery lands here.
   */
  | 'accepted_no_pos_channel_unpaid'
  /** A send is in flight, or an automatic retry is still queued. */
  | 'sending_to_branch'
  /** The branch accepted it. The ONLY state that may show a success hero. */
  | 'confirmed_by_branch'
  /** Ambiguous outcome — a ticket may exist. Human verification, never a resend. */
  | 'verifying_with_branch'
  /** PAID, proven not sent, customer resend available. */
  | 'branch_failed_retry_available'
  /** CASH, proven not sent, customer resend available. */
  | 'unpaid_branch_failed_retry_available'
  /** PAID, resend budget spent — refund in progress (never claimed complete). */
  | 'final_failure_refund_pending'
  /** Refund CONFIRMED by the provider. */
  | 'final_failure_refunded'
  /** Refund could not be completed — operations follow up. */
  | 'final_failure_refund_failed'
  /** CASH, resend budget spent. Same apology, no refund language. */
  | 'unpaid_final_failure';

export interface OrderConfirmationInput {
  orderType?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  /** orders.lazywait_sync_state — the authoritative technical state. */
  syncState?: string | null;
  /** orders.lazywait_ref — REQUIRED to claim branch confirmation. */
  ref?: unknown;
  /** orders.sync_blocked_reason — distinguishes "no POS channel" from a failure. */
  blockedReason?: string | null;
  /** orders.sync_next_attempt_at — a future value means an auto-retry is queued. */
  nextAttemptAt?: string | null;
  /** orders.pos_create_attempted_at — the may-have-been-sent phase marker. */
  posCreateAttemptedAt?: string | null;
  /** orders.pos_customer_retry_count — SERVER-counted manual resends. */
  customerRetryCount?: number | null;
  /** orders.refund_state. */
  refundState?: string | null;
}

/**
 * The manual resend budget. Mirrors `customer_pos_resend_limit()`.
 *
 * NOTE: this constant exists so the derivation matches the server; it is NEVER
 * rendered. The customer is not told how many attempts remain, or that a limit
 * exists at all — the UI only ever shows "retry available" or the final outcome.
 */
export const CUSTOMER_RESEND_LIMIT = 3;

/**
 * A Lazywait ref is "usable" only when it is a trimmed, non-empty string. Mirrors
 * `lazywait_pos_ref_is_usable()` (which implements JS .trim() semantics in SQL).
 */
export function hasUsablePosRef(ref: unknown): boolean {
  return typeof ref === 'string' && ref.trim().length > 0;
}

/**
 * Does this order have a branch-confirmation step at all? Mirrors
 * `pos_confirmation_channel_active()`.
 *
 * FALSE means there is no Lazywait acceptance to wait for, so the order is
 * complete once payment settles — it is never shown as unconfirmed and never
 * refunded. Today that is delivery, held at 'blocked'/'delivery_schema_unconfirmed'
 * because the Lazywait delivery Create Order schema is unconfirmed. Expressed in
 * terms of the SYNC STATE rather than the order type on purpose: when the delivery
 * API lands and delivery starts enqueuing to 'pending' like pickup, delivery
 * becomes gate-active automatically with no change here.
 */
export function posConfirmationChannelActive(
  syncState?: string | null,
  blockedReason?: string | null,
): boolean {
  if (!syncState) return false;
  if (syncState === 'blocked' && blockedReason === 'delivery_schema_unconfirmed') return false;
  if (syncState === 'skipped') return false;
  return true;
}

function isFuture(iso?: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > Date.now();
}

/**
 * Derive the one customer-visible state. Mirrors `customer_order_state()` clause
 * for clause, in the same order — the ordering is load-bearing (an ambiguous
 * outcome must be caught before any "failed" branch can offer a resend).
 */
export function deriveCustomerOrderState(o: OrderConfirmationInput): CustomerOrderState {
  const refundState = o.refundState ?? 'none';
  const paid = o.paymentStatus === 'paid';
  const retries = o.customerRetryCount ?? 0;

  // (1) A refund lifecycle, once entered, is the whole customer story.
  if (refundState === 'failed') return 'final_failure_refund_failed';
  if (refundState === 'refunded') return 'final_failure_refunded';
  if (refundState === 'pending' || refundState === 'processing') return 'final_failure_refund_pending';

  // (2) Online payment not yet verified.
  if (o.paymentMethod === 'online' && !paid) return 'payment_pending';

  // (3) No branch-confirmation step for this channel. Split by payment so the
  //     copy can state payment success without ever implying branch acceptance;
  //     a cash-on-delivery order lands here and must claim no payment.
  if (!posConfirmationChannelActive(o.syncState, o.blockedReason)) {
    return paid ? 'accepted_no_pos_channel' : 'accepted_no_pos_channel_unpaid';
  }

  // (4) The branch accepted it — the only state that may claim confirmation.
  if (o.syncState === 'synced' && hasUsablePosRef(o.ref)) return 'confirmed_by_branch';

  // (5) Ambiguous: a ticket MAY exist. Never confirmed, never failed, never
  //     resendable — Lazywait Create Order has no idempotency key, so a resend
  //     here could double the restaurant's ticket. A human verifies instead.
  if (o.syncState === 'confirmation_required') return 'verifying_with_branch';
  if (o.syncState === 'synced') return 'verifying_with_branch';      // 'synced' w/o usable ref
  if (o.ref != null) return 'verifying_with_branch';                  // ref marker, unusable
  if (o.posCreateAttemptedAt != null) return 'verifying_with_branch'; // may have been sent

  // (6) Still in flight, or an automatic retry is still queued.
  if (o.syncState === 'pending' || o.syncState === 'syncing' || o.syncState === 'awaiting_payment') {
    return 'sending_to_branch';
  }
  if (o.syncState === 'failed' && isFuture(o.nextAttemptAt)) return 'sending_to_branch';

  // (7) Proven not sent, out of automatic road — offer the manual resend.
  if (retries < CUSTOMER_RESEND_LIMIT) {
    return paid ? 'branch_failed_retry_available' : 'unpaid_branch_failed_retry_available';
  }

  // (8) Budget spent.
  return paid ? 'final_failure_refund_pending' : 'unpaid_final_failure';
}

/** Visual tone for the state banner (mapped to theme colors by the UI). */
export type ConfirmationTone = 'info' | 'success' | 'warning' | 'danger';

/**
 * i18n keys are LITERAL unions, not `string`, so `t()` type-checks them against
 * the strings table — a state whose copy was never written cannot ship.
 */
export type ConfirmationTitleKey =
  | 'oc_payment_pending' | 'oc_payment_received' | 'oc_received' | 'oc_sending'
  | 'oc_confirmed' | 'oc_verifying' | 'oc_not_sent' | 'oc_failed';

export type ConfirmationBodyKey =
  | 'oc_payment_pending_body' | 'oc_no_pos_channel_body' | 'oc_sending_body'
  | 'oc_confirmed_body' | 'oc_verifying_body'
  | 'oc_not_sent_paid_body' | 'oc_not_sent_unpaid_body'
  | 'oc_failed_refund_pending_body' | 'oc_failed_refunded_body'
  | 'oc_failed_refund_failed_body' | 'oc_failed_unpaid_body';

export interface ConfirmationPresentation {
  /** Short label i18n key (hero title / My Orders chip). */
  titleKey: ConfirmationTitleKey;
  /** Full message i18n key. */
  bodyKey: ConfirmationBodyKey;
  tone: ConfirmationTone;
  /** Whether the success hero (check mark) may be shown. */
  success: boolean;
  /** Whether the customer Retry action is offered. */
  canResend: boolean;
  /** Whether the branch's own order number may be displayed. */
  showBranchNumber: boolean;
}

const PRESENTATION: Record<CustomerOrderState, ConfirmationPresentation> = {
  payment_pending: {
    titleKey: 'oc_payment_pending', bodyKey: 'oc_payment_pending_body',
    tone: 'info', success: false, canResend: false, showBranchNumber: false,
  },
  // NEUTRAL, not success. Payment settlement is stated; branch acceptance is
  // NOT claimed and no green check is rendered — `confirmed_by_branch` remains
  // the only POS-related state that may show one.
  accepted_no_pos_channel: {
    titleKey: 'oc_payment_received', bodyKey: 'oc_no_pos_channel_body',
    tone: 'info', success: false, canResend: false, showBranchNumber: false,
  },
  // Same, minus any payment claim (cash on delivery).
  accepted_no_pos_channel_unpaid: {
    titleKey: 'oc_received', bodyKey: 'oc_no_pos_channel_body',
    tone: 'info', success: false, canResend: false, showBranchNumber: false,
  },
  sending_to_branch: {
    titleKey: 'oc_sending', bodyKey: 'oc_sending_body',
    tone: 'info', success: false, canResend: false, showBranchNumber: false,
  },
  confirmed_by_branch: {
    titleKey: 'oc_confirmed', bodyKey: 'oc_confirmed_body',
    tone: 'success', success: true, canResend: false, showBranchNumber: true,
  },
  verifying_with_branch: {
    titleKey: 'oc_verifying', bodyKey: 'oc_verifying_body',
    tone: 'warning', success: false, canResend: false, showBranchNumber: false,
  },
  branch_failed_retry_available: {
    titleKey: 'oc_not_sent', bodyKey: 'oc_not_sent_paid_body',
    tone: 'warning', success: false, canResend: true, showBranchNumber: false,
  },
  unpaid_branch_failed_retry_available: {
    titleKey: 'oc_not_sent', bodyKey: 'oc_not_sent_unpaid_body',
    tone: 'warning', success: false, canResend: true, showBranchNumber: false,
  },
  final_failure_refund_pending: {
    titleKey: 'oc_failed', bodyKey: 'oc_failed_refund_pending_body',
    tone: 'danger', success: false, canResend: false, showBranchNumber: false,
  },
  final_failure_refunded: {
    titleKey: 'oc_failed', bodyKey: 'oc_failed_refunded_body',
    tone: 'danger', success: false, canResend: false, showBranchNumber: false,
  },
  final_failure_refund_failed: {
    titleKey: 'oc_failed', bodyKey: 'oc_failed_refund_failed_body',
    tone: 'danger', success: false, canResend: false, showBranchNumber: false,
  },
  unpaid_final_failure: {
    titleKey: 'oc_failed', bodyKey: 'oc_failed_unpaid_body',
    tone: 'danger', success: false, canResend: false, showBranchNumber: false,
  },
};

export function confirmationPresentation(s: CustomerOrderState): ConfirmationPresentation {
  return PRESENTATION[s];
}

/** Convenience: derive straight from a mapped Order-shaped object. */
export function orderConfirmationState(o: {
  orderType?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  lazywaitSyncState?: string | null;
  lazywaitRef?: unknown;
  syncBlockedReason?: string | null;
  syncNextAttemptAt?: string | null;
  posCreateAttemptedAt?: string | null;
  posCustomerRetryCount?: number | null;
  refundState?: string | null;
}): CustomerOrderState {
  return deriveCustomerOrderState({
    orderType: o.orderType,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    syncState: o.lazywaitSyncState,
    ref: o.lazywaitRef,
    blockedReason: o.syncBlockedReason,
    nextAttemptAt: o.syncNextAttemptAt,
    posCreateAttemptedAt: o.posCreateAttemptedAt,
    customerRetryCount: o.posCustomerRetryCount,
    refundState: o.refundState,
  });
}
