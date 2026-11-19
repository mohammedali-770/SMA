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
 * were ignored until 2026-11-19. At most 5 entries; any run of 12+ digits in a
 * string, and any number with 12+ integer digits, is masked; the whole is cut
 * to 1 000 characters of JSON (returned as that text when cut). Anything that
 * is not a non-empty array gives null.
 *
 * NEVER THROWS. In lazywait-sync this runs after a ticket was created and
 * before its reference is saved, so a throw here would leave a created ticket
 * looking unconfirmed. The first version masked digits in the JSON TEXT and
 * parsed it back, which broke on a float such as 28.749999999999996 or a
 * millisecond timestamp (Codex review on #508). Values are now cleaned as
 * values, and any failure gives a fixed string.
 */
export function posWarnings(raw: unknown): unknown[] | string | null {
  try {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const seen = new WeakSet<object>();
    const clean = (v: unknown, depth: number): unknown => {
      if (typeof v === 'string') return v.replace(/\d{12,}/g, '[digits]').slice(0, 300);
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) return null;
        return Math.abs(Math.trunc(v)) >= 1e11 ? '[digits]' : v;
      }
      if (typeof v === 'boolean' || v === null) return v;
      if (typeof v !== 'object' || depth > 4) return null;
      if (seen.has(v)) return '[cycle]';
      seen.add(v);
      if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v).slice(0, 30)) out[k.slice(0, 60)] = clean(x, depth + 1);
      return out;
    };
    const kept = raw.slice(0, 5).map((w) => clean(w, 0));
    const text = JSON.stringify(kept);
    return text.length > 1000 ? text.slice(0, 1000) : kept;
  } catch {
    return 'unserializable_warnings';
  }
}
