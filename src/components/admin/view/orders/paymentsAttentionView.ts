/**
 * Pure view-state for "Refunds and payments needing attention" (gaps PG-01 and
 * PG-02 in docs/readiness/20261113-card-payments-gaps.md).
 *
 * Everything the card decides lives here, so it is testable without React: which
 * failures hide the card and which are shown, how a stored failure code reads,
 * and which sections there are. The data comes from the `is_admin()`-gated
 * `list_payments_needing_attention` RPC (20261013120000).
 */
import type { PaymentsNeedingAttention } from '../../../../lib/api';
import type { AdminLocale } from '../../adminLocales';

/** Items requested per list. The totals always count every row. */
export const PAYMENTS_ATTENTION_LIMIT = 20;

/** How often the card re-reads: an exception feed, not a live board, like the POS-verification card. */
export const PAYMENTS_ATTENTION_REFRESH_MS = 60_000;

/**
 * What a failed read means for the card.
 *
 *   hidden  the RPC does not exist yet (PGRST202: the console deploys on merge,
 *           before the migration is applied, CLAUDE.md section 13), or the caller
 *           is not an admin at AAL2 (42501): an accountant sees Live Orders too,
 *           and there is nothing here they could act on.
 *   error   anything else. Money may be owed, so a failed read is SAID, not
 *           hidden: an empty-looking console must not mean "nothing to refund".
 */
export function attentionFailure(error: unknown): 'hidden' | 'error' {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'PGRST202' || code === '42501') return 'hidden';
  return 'error';
}

/** Every row needing a person, across the four lists. */
export function attentionTotal(data: PaymentsNeedingAttention | null): number {
  if (!data) return 0;
  return (
    (data.failed_refunds?.total ?? 0) +
    (data.retrying_refunds?.total ?? 0) +
    (data.payments_to_refund?.total ?? 0) +
    (data.unconfirmed_payments?.total ?? 0)
  );
}

type ReasonKey = Extract<keyof AdminLocale, `payattn_reason_${string}`>;

/**
 * The locale key for a stored failure code. The codes are written by
 * payment-refund (moyasarRefund.ts), expire_stale_order_refund_claims and
 * moyasarVerify.ts. A code this list does not know reads as "Other", with the
 * code itself shown beside it, so nothing is silently dropped.
 */
export function attentionReasonKey(code: string | null | undefined): ReasonKey | null {
  if (!code) return null;
  switch (code) {
    case 'provider_no_answer':
      return 'payattn_reason_provider_no_answer';
    case 'reconcile_unavailable':
      return 'payattn_reason_reconcile_unavailable';
    case 'key_unavailable':
      return 'payattn_reason_key_unavailable';
    case 'moyasar_ip_not_allowed':
      return 'payattn_reason_ip_not_allowed';
    case 'http_429':
      return 'payattn_reason_rate_limited';
    case 'refund_not_final':
      return 'payattn_reason_not_final';
    case 'lease_expired':
      return 'payattn_reason_lease_expired';
    case 'missing_charge_reference':
      return 'payattn_reason_no_payment_id';
    case 'unsupported_provider':
      return 'payattn_reason_old_provider';
    case 'refund_ambiguous_needs_review':
      return 'payattn_reason_ambiguous';
    case 'refund_failed':
    case 'refund_voided':
    case 'payment_failed':
    case 'payment_voided':
      return 'payattn_reason_not_refundable';
    case 'finalize_failed':
      return 'payattn_reason_order_not_created';
    case 'confirm_failed':
      return 'payattn_reason_order_not_paid';
    default:
      if (/^http_5\d\d$/.test(code)) return 'payattn_reason_server_error';
      if (/^http_4\d\d$/.test(code)) return 'payattn_reason_refused';
      return 'payattn_reason_other';
  }
}

export type AttentionSectionId =
  'failed_refunds' | 'retrying_refunds' | 'payments_to_refund' | 'unconfirmed_payments';

/**
 * The sections in the order a person should work through them: money that
 * left with nothing to show for it first, then refunds that stopped, then the
 * ones still being retried. Empty sections are left out.
 */
export const ATTENTION_SECTION_ORDER: AttentionSectionId[] = [
  'unconfirmed_payments',
  'payments_to_refund',
  'failed_refunds',
  'retrying_refunds',
];

export function attentionSections(data: PaymentsNeedingAttention | null): AttentionSectionId[] {
  if (!data) return [];
  return ATTENTION_SECTION_ORDER.filter((id) => (data[id]?.total ?? 0) > 0);
}

/** How many rows a section holds beyond the ones returned. */
export function hiddenCount(section: { total: number; items: unknown[] } | null | undefined): number {
  if (!section) return 0;
  return Math.max(0, section.total - section.items.length);
}
