/**
 * Customer order-confirmation state machine.
 *
 * Branch acceptance is separate from payment. A customer may resend only when
 * the order is proven not to have reached Lazywait. As of the manual-resend-only
 * policy, a FAILED order is inert until the customer explicitly resends it;
 * sync_next_attempt_at is retained only as legacy/operational data and never
 * means the app should wait for an automatic retry.
 */
export type CustomerOrderState =
  | 'payment_pending'
  | 'accepted_no_pos_channel'
  | 'accepted_no_pos_channel_unpaid'
  | 'sending_to_branch'
  | 'confirmed_by_branch'
  | 'verifying_with_branch'
  | 'branch_failed_retry_available'
  | 'unpaid_branch_failed_retry_available'
  | 'final_failure_refund_pending'
  | 'final_failure_refunded'
  | 'final_failure_refund_failed'
  | 'unpaid_final_failure';

export interface OrderConfirmationInput {
  orderType?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  syncState?: string | null;
  ref?: unknown;
  blockedReason?: string | null;
  /** Legacy/operational schedule metadata. Failed rows are never auto-retried. */
  nextAttemptAt?: string | null;
  posCreateAttemptedAt?: string | null;
  customerRetryCount?: number | null;
  refundState?: string | null;
}

export const CUSTOMER_RESEND_LIMIT = 3;

export function hasUsablePosRef(ref: unknown): boolean {
  return typeof ref === 'string' && ref.trim().length > 0;
}

export function posConfirmationChannelActive(syncState?: string | null, blockedReason?: string | null): boolean {
  if (!syncState) return false;
  if (syncState === 'blocked' && blockedReason === 'delivery_schema_unconfirmed') return false;
  if (syncState === 'skipped') return false;
  return true;
}

export function deriveCustomerOrderState(o: OrderConfirmationInput): CustomerOrderState {
  const refundState = o.refundState ?? 'none';
  const paid = o.paymentStatus === 'paid';
  const retries = o.customerRetryCount ?? 0;

  if (refundState === 'failed') return 'final_failure_refund_failed';
  if (refundState === 'refunded') return 'final_failure_refunded';
  if (refundState === 'pending' || refundState === 'processing') return 'final_failure_refund_pending';

  if (o.paymentMethod === 'online' && !paid) return 'payment_pending';

  if (!posConfirmationChannelActive(o.syncState, o.blockedReason)) {
    return paid ? 'accepted_no_pos_channel' : 'accepted_no_pos_channel_unpaid';
  }

  if (o.syncState === 'synced' && hasUsablePosRef(o.ref)) return 'confirmed_by_branch';

  // Ambiguous means Create Order MAY have reached the branch. Never resend it.
  if (o.syncState === 'confirmation_required') return 'verifying_with_branch';
  if (o.syncState === 'synced') return 'verifying_with_branch';
  if (o.ref != null) return 'verifying_with_branch';
  if (o.posCreateAttemptedAt != null) return 'verifying_with_branch';

  // pending is either the first send or a customer-triggered resend. syncing is
  // that one send in progress. Neither implies a future automatic retry.
  if (o.syncState === 'pending' || o.syncState === 'syncing' || o.syncState === 'awaiting_payment') {
    return 'sending_to_branch';
  }

  // Any proven-not-sent failure is immediately customer-actionable. In
  // particular, a legacy future sync_next_attempt_at is intentionally ignored.
  if (retries < CUSTOMER_RESEND_LIMIT) {
    return paid ? 'branch_failed_retry_available' : 'unpaid_branch_failed_retry_available';
  }

  return paid ? 'final_failure_refund_pending' : 'unpaid_final_failure';
}

export type ConfirmationTone = 'info' | 'success' | 'warning' | 'danger';
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
  titleKey: ConfirmationTitleKey; bodyKey: ConfirmationBodyKey; tone: ConfirmationTone;
  success: boolean; canResend: boolean;
  /**
   * Whether the branch-order-number card is MEANINGFUL for this state — not
   * whether a number is already known.
   *
   * True for the three states on an active POS channel: the number is either
   * present (`confirmed_by_branch`) or still expected (`sending_to_branch`,
   * `verifying_with_branch`), so "it will appear here once the branch issues
   * it" is a true statement.
   *
   * False everywhere else, and that is the point. A channel with no POS step
   * (`accepted_no_pos_channel*` — delivery today) will NEVER be issued a
   * number, so promising one is a lie the customer cannot act on. The card was
   * previously rendered unconditionally and this flag had no consumer at all,
   * which is exactly how a delivery customer came to be shown
   * "not issued yet / it will appear here as soon as the branch issues it"
   * for an order no branch would ever see.
   */
  showBranchNumber: boolean;
}
const PRESENTATION: Record<CustomerOrderState, ConfirmationPresentation> = {
  payment_pending:{titleKey:'oc_payment_pending',bodyKey:'oc_payment_pending_body',tone:'info',success:false,canResend:false,showBranchNumber:false},
  accepted_no_pos_channel:{titleKey:'oc_payment_received',bodyKey:'oc_no_pos_channel_body',tone:'info',success:false,canResend:false,showBranchNumber:false},
  accepted_no_pos_channel_unpaid:{titleKey:'oc_received',bodyKey:'oc_no_pos_channel_body',tone:'info',success:false,canResend:false,showBranchNumber:false},
  sending_to_branch:{titleKey:'oc_sending',bodyKey:'oc_sending_body',tone:'info',success:false,canResend:false,showBranchNumber:true},
  confirmed_by_branch:{titleKey:'oc_confirmed',bodyKey:'oc_confirmed_body',tone:'success',success:true,canResend:false,showBranchNumber:true},
  verifying_with_branch:{titleKey:'oc_verifying',bodyKey:'oc_verifying_body',tone:'warning',success:false,canResend:false,showBranchNumber:true},
  branch_failed_retry_available:{titleKey:'oc_not_sent',bodyKey:'oc_not_sent_paid_body',tone:'warning',success:false,canResend:true,showBranchNumber:false},
  unpaid_branch_failed_retry_available:{titleKey:'oc_not_sent',bodyKey:'oc_not_sent_unpaid_body',tone:'warning',success:false,canResend:true,showBranchNumber:false},
  final_failure_refund_pending:{titleKey:'oc_failed',bodyKey:'oc_failed_refund_pending_body',tone:'danger',success:false,canResend:false,showBranchNumber:false},
  final_failure_refunded:{titleKey:'oc_failed',bodyKey:'oc_failed_refunded_body',tone:'danger',success:false,canResend:false,showBranchNumber:false},
  final_failure_refund_failed:{titleKey:'oc_failed',bodyKey:'oc_failed_refund_failed_body',tone:'danger',success:false,canResend:false,showBranchNumber:false},
  unpaid_final_failure:{titleKey:'oc_failed',bodyKey:'oc_failed_unpaid_body',tone:'danger',success:false,canResend:false,showBranchNumber:false},
};
export function confirmationPresentation(s:CustomerOrderState):ConfirmationPresentation{return PRESENTATION[s];}
export function orderConfirmationState(o:{orderType?:string|null;paymentMethod?:string|null;paymentStatus?:string|null;lazywaitSyncState?:string|null;lazywaitRef?:unknown;syncBlockedReason?:string|null;syncNextAttemptAt?:string|null;posCreateAttemptedAt?:string|null;posCustomerRetryCount?:number|null;refundState?:string|null;}):CustomerOrderState{return deriveCustomerOrderState({orderType:o.orderType,paymentMethod:o.paymentMethod,paymentStatus:o.paymentStatus,syncState:o.lazywaitSyncState,ref:o.lazywaitRef,blockedReason:o.syncBlockedReason,nextAttemptAt:o.syncNextAttemptAt,posCreateAttemptedAt:o.posCreateAttemptedAt,customerRetryCount:o.posCustomerRetryCount,refundState:o.refundState});}
