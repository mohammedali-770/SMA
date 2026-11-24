/**
 * The generic payment-method label (owner, 2026-11-19: "send it to Lazywait as
 * Online Credit Card"), used when the card brand is unknown. Both strings are
 * the ones Lazywait's own documentation uses for `names`.
 */
export const ONLINE_PAYMENT_NAMES = { en: 'ONLINE CREDIT CARD', ar: 'بطاقة ائتمانية' } as const;

/**
 * The card scheme as the POS expects it (`Card_Type`, "Card scheme", e.g.
 * VISA). Moyasar reports it in lower case (`mada`, `visa`, `master`), stored on
 * the paid payment record. An unknown or odd value sends CARD.
 */
export function posCardType(scheme: unknown): string {
  const s = typeof scheme === 'string' ? scheme.trim().toUpperCase() : '';
  return /^[A-Z][A-Z0-9_]{1,19}$/.test(s) ? s : 'CARD';
}

/**
 * The card number as the POS may see it: four asterisks and the last four
 * digits, the shape Lazywait's own example uses ("****1234"), so it carries
 * nothing beyond what a paper receipt prints. Anything that is not exactly four
 * digits sends the asterisks alone.
 */
export function maskedCardNumber(lastFour: unknown): string {
  const s = typeof lastFour === 'string' ? lastFour.trim() : '';
  return /^\d{4}$/.test(s) ? `****${s}` : '****';
}

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
 * Anything else -- a cash order, an unpaid order, or a comped order with no
 * captured payment -- returns undefined, so the ticket goes out exactly as
 * before, without the flag. The failure direction is "shown unpaid", never
 * "shown paid".
 *
 * A payment LOOKUP THAT FAILED is not in that list any more (audit F-D2-001,
 * 2026-11-24). For a card order the row says is paid, "shown unpaid" is the
 * wrong direction: the customer has been charged, the ticket would print the
 * full total, Create Order has no idempotency key so nothing resends it, and the
 * separate update-online-payment call that could have corrected it is gone. The
 * worker therefore asks posPaidLookupMustDefer() first and does not send at all
 * on an error. `lookupFailed` still answers undefined here, as a last guard.
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
 * True when the POS handoff for this order must be DEFERRED rather than sent:
 * an online order the row says is paid, whose captured-payment lookup returned
 * an error. Sending it would put a card-paid order on the branch's screen as
 * unpaid with nothing to correct it afterwards (audit F-D2-001).
 *
 * Deliberately narrow. Only a lookup ERROR defers. A lookup that succeeded and
 * found no paid record is not an error, and cash, unpaid and comped orders have
 * no lookup to fail, so none of those can be held back by this.
 */
export function posPaidLookupMustDefer(
  order: { payment_method?: unknown; payment_status?: unknown },
  lookupFailed: boolean,
): boolean {
  return lookupFailed && order.payment_method === 'online' && order.payment_status === 'paid';
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
 * ticket goes out exactly as before. Since 2026-11-19 this line is the ONLY
 * way the payment reaches the POS: the separate update-online-payment call was
 * removed, having been accepted without recording anything.
 */
/**
 * The payment-type label the POS shows, named after the card brand Moyasar
 * reported (owner, 2026-11-19: "give the correct payment type like mada visa
 * master card etc if we get the info from moyasar otherwise it is okay").
 * Moyasar's `source.company` is stored as `payment_records.card_scheme`, and
 * `source.type` (`creditcard`, `applepay`) is in the stored `raw`. Apple Pay
 * is named as such with its card brand. An unknown brand keeps the generic
 * ONLINE CREDIT CARD label, which is what the owner accepted first.
 */
const BRAND_NAMES: Record<string, { en: string; ar: string }> = {
  mada: { en: 'MADA', ar: 'مدى' },
  visa: { en: 'VISA', ar: 'فيزا' },
  master: { en: 'MASTERCARD', ar: 'ماستركارد' },
  mastercard: { en: 'MASTERCARD', ar: 'ماستركارد' },
  amex: { en: 'AMEX', ar: 'أمريكان إكسبريس' },
};

export function posPaymentNames(scheme: unknown, sourceType: unknown): { en: string; ar: string } {
  const brand = typeof scheme === 'string' ? BRAND_NAMES[scheme.trim().toLowerCase()] : undefined;
  const applePay = typeof sourceType === 'string' && sourceType.trim().toLowerCase() === 'applepay';
  if (!brand) return applePay ? { en: 'APPLE PAY', ar: 'Apple Pay' } : { ...ONLINE_PAYMENT_NAMES };
  return applePay ? { en: `APPLE PAY - ${brand.en}`, ar: `Apple Pay - ${brand.ar}` } : { ...brand };
}

/**
 * Prefix for the payment label of a TEST-mode payment (`payment_records.mode`
 * = 'test'), which moved no money. Since 2026-11-18 the testing-phase switch
 * (paymentTestCheckout.ts) lets a listed customer pay a real order with a
 * Moyasar test card, and the order still reaches the branch as a paid ticket;
 * without this the ticket showed an ordinary approved card payment
 * (F-EFP-05-001). The Arabic is engineering-drafted and needs a native read.
 */
export const TEST_PAYMENT_PREFIX = { en: 'TEST - ', ar: 'اختبار - ' } as const;

/** `source.type` from a stored Moyasar payment (`payment_records.raw`), if present. */
function sourceTypeOf(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = (raw as { source?: unknown }).source;
  return source && typeof source === 'object' ? (source as { type?: unknown }).type : undefined;
}

export function posOrderPayments(
  paid: true | undefined,
  total: unknown,
  record:
    | { provider_ref?: unknown; card_scheme?: unknown; card_last_four?: unknown; raw?: unknown; mode?: unknown }
    | null
    | undefined,
): Array<Record<string, unknown>> | undefined {
  if (paid !== true || !record) return undefined;
  const amount = Math.round((Number(total) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const ref = typeof record.provider_ref === 'string' ? record.provider_ref.trim() : '';
  const label = posPaymentNames(record.card_scheme, sourceTypeOf(record.raw));
  const names = record.mode === 'test'
    ? { en: `${TEST_PAYMENT_PREFIX.en}${label.en}`, ar: `${TEST_PAYMENT_PREFIX.ar}${label.ar}` }
    : label;
  const entry: Record<string, unknown> = {
    names,
    amount,
    // The POS list's Paid column reads `payment_amount`, MEASURED rather than
    // guessed (2026-11-19). A probe order (#10) carried one line with eleven
    // candidate fields set to distinct powers of two (0.01, 0.02, 0.04 ...);
    // the list showed Paid 0.32 / Remaining 12.68 on a 13.00 order, and 0.32
    // was `payment_amount` alone. `amount` and `Trans_Amount` (tried in #509)
    // are stored but not counted. `amount` stays: Lazywait keeps it verbatim
    // and dropping a field it already holds gains nothing.
    payment_amount: amount,
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
