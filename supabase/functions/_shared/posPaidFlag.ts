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
