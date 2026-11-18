/**
 * When the receipt shows its full page.
 *
 * The owner's rule (2026-11-18, repeated): the customer sees the receipt page
 * WITH the branch's (Lazywait) order number, not a page that says the order is
 * on its way. While the order is still being sent (`sending_to_branch`) the
 * screen stays on its loading skeleton, and the receipt polls every 2 s
 * (nextReceiptPollMs), so the page appears the moment the number exists:
 * about 6 s after payment on build 30 (SM-2026-000102).
 *
 * A bound, so a slow or failing POS can never leave a customer on a blank
 * screen with no way forward: after RECEIPT_WAIT_FOR_NUMBER_MS the page shows
 * anyway, saying "Order received", and the number appears when it arrives.
 * Every other state (confirmed, uncertain, not sent, failed, cancelled) shows
 * at once, because each tells the customer something they must know.
 */
import type { CustomerOrderState } from './orderConfirmation';

export const RECEIPT_WAIT_FOR_NUMBER_MS = 20_000;

export function showFullReceipt(state: CustomerOrderState, waitedMs: number): boolean {
  return state !== 'sending_to_branch' || waitedMs >= RECEIPT_WAIT_FOR_NUMBER_MS;
}
