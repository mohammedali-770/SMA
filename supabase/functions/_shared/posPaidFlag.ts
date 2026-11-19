import { maskedCardNumber, ONLINE_PAYMENT_NAMES, posCardType } from './paymentSync.ts';

/**
 * Whether a POS ticket may be created as PAID (`is_paid: true` on Create Order).
 *
 * Owner decision, 2026-11-19: a card order is sent to Lazywait as paid at the
 * moment its ticket is created -- never sent first and marked paid later -- and
 * only when the payment is certain. Certain means BOTH:
 *
 *   - the order row, as claimed by the sync worker, is an online order with
 *     payment_status 'paid'; and
 *   - a payment_records row for it has status 'paid'. Only the server writes
 *     that row, after it has fetched the payment from Moyasar itself and found
 *     it paid (payment-verify / payment-webhook); nothing the app reports can
 *     create it.
 *
 * Anything else -- a cash order, an unpaid order, a comped order with no
 * captured payment, or a payment lookup that failed -- returns undefined, so
 * the ticket goes out exactly as before, without the flag. The failure
 * direction is "shown unpaid", never "shown paid".
 */
export function posIsPaidFlag(
  order: { payment_method?: unknown; payment_status?: unknown },
  capturedPayment: { rows: number; lookupFailed: boolean },
): true | undefined {
  if (order.payment_method !== 'online' || order.payment_status !== 'paid') return undefined;
  if (capturedPayment.lookupFailed || !(capturedPayment.rows > 0)) return undefined;
  return true;
}

/**
 * The payment line attached to a ticket created paid (`order_payments` on
 * Create Order).
 *
 * WHY. `is_paid` alone made the receipt print "Paid", but the POS order list
 * still showed paid 0.00 and no payment type, even after the separate
 * update-online-payment call was accepted (SM-2026-000110, 2026-11-19). That
 * call was written for a card terminal in the branch; the list reads the
 * order's own payment lines, which we always sent empty. Owner, 2026-11-19:
 * "just fill it with Online Credit Card for now".
 *
 * THE SHAPE IS NOT DOCUMENTED. Lazywait's Create Order page shows only
 * `order_payments: []`. The entry follows its sibling lists (`names` as
 * `{ en, ar }`, an `amount`) and carries the card fields its own
 * update-online-payment documents. If Lazywait refuses it, the worker retries
 * once without it, so a wrong guess can never keep an order from the kitchen.
 *
 * Only for a ticket already certain to be paid (`paid === true` from
 * posIsPaidFlag) and a positive total. Anything else returns undefined and the
 * ticket goes out exactly as before. Nothing here is new to the POS: the same
 * values already reach it through update-online-payment.
 */
export function posOrderPayments(
  paid: true | undefined,
  total: unknown,
  record: { provider_ref?: unknown; card_scheme?: unknown; card_last_four?: unknown } | null | undefined,
): Array<Record<string, unknown>> | undefined {
  if (paid !== true || !record) return undefined;
  const amount = Math.round((Number(total) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const ref = typeof record.provider_ref === 'string' ? record.provider_ref.trim() : '';
  const entry: Record<string, unknown> = {
    names: ONLINE_PAYMENT_NAMES,
    amount,
    Card_Type: posCardType(record.card_scheme),
    Card_Number: maskedCardNumber(record.card_last_four),
    status: 'approved',
  };
  if (ref) {
    entry.Approval_No = ref;
    entry.transaction_uuid = ref;
  }
  return [entry];
}

/**
 * Create Order's `warnings`, bounded for the sync log. Lazywait returns them
 * when the till would charge something other than what we sent (example:
 * `ORDER_TOTAL_MISMATCH` with `sent_total` and the till's own figures). They
 * were ignored until 2026-11-19. At most 5 entries and 1 000 characters of
 * JSON, with any run of 12+ digits masked; anything that is not an array, or
 * an empty one, gives null.
 */
export function posWarnings(raw: unknown): unknown[] | string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const kept = raw.slice(0, 5);
  let text: string;
  try {
    text = JSON.stringify(kept);
  } catch {
    return 'unserializable_warnings';
  }
  const masked = text.replace(/\d{12,}/g, '[digits]');
  if (masked.length > 1000) return masked.slice(0, 1000);
  return JSON.parse(masked) as unknown[];
}
