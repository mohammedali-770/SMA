/**
 * Server-side Moyasar retrieval + validate-and-confirm, shared by the webhook,
 * the customer verify endpoint and the admin re-verify action. A payment is
 * confirmed ONLY here, and ONLY when Moyasar's own fetch response says `paid`
 * (or `captured`) and every bound field matches the stored attempt.
 *
 * Confirmation goes through the existing, provider-agnostic RPCs —
 * `confirm_order_payment` for the order-first flow and
 * `finalize_checkout_session` for the session-first flow — both idempotent on
 * (provider, provider_ref). A webhook, a verify and a retry can all run and the
 * order is paid, enqueued and rewarded exactly once.
 *
 * WHY WE ALWAYS RE-FETCH
 * Moyasar's redirect appends only `id` to the callback URL, unsigned, and its
 * webhook authenticates with a bearer `secret_token` in the body rather than a
 * signature over the payload. Neither is evidence that money moved. Moyasar's
 * own integration guide is explicit about the remedy: "fetch the payment using
 * its id through our fetch API, and verify its status, amount, and currency
 * before accepting your user's order or completing any business action."
 * (https://docs.moyasar.com/guides/card-payments/basic-integration)
 * That fetch — with our own secret key — is the only thing this module trusts.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  MOYASAR_API_BASE,
  basicAuthHeader,
  checkPaymentBinding,
  fromMinorUnits,
  lastFourOf,
  mapMoyasarPaymentStatus,
  paymentFailureMessage,
  sanitizeMoyasarInvoice,
  sanitizeMoyasarPayment,
  selectInvoicePayment,
  type MoyasarOutcome,
} from './moyasar.ts';

export { selectInvoicePayment } from './moyasar.ts';
import { triggerLazywaitSyncOnce, pushLazywaitOnlinePayment } from './paymentSync.ts';

const FETCH_TIMEOUT_MS = 12_000;

export interface RetrievedResource {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

async function moyasarGet(secretKey: string, path: string): Promise<RetrievedResource> {
  const res = await fetch(`${MOYASAR_API_BASE}${path}`, {
    method: 'GET',
    headers: { Authorization: basicAuthHeader(secretKey), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: body as Record<string, unknown> };
}

/** GET the invoice (server-to-server) with the mode-appropriate secret key. */
export function retrieveMoyasarInvoice(secretKey: string, invoiceId: string): Promise<RetrievedResource> {
  return moyasarGet(secretKey, `/invoices/${encodeURIComponent(invoiceId)}`);
}

/** GET the payment (server-to-server) with the mode-appropriate secret key. */
export function retrieveMoyasarPayment(secretKey: string, paymentId: string): Promise<RetrievedResource> {
  return moyasarGet(secretKey, `/payments/${encodeURIComponent(paymentId)}`);
}

export interface MoyasarAttempt {
  id: string;
  order_id: string | null;                 // null for a session attempt (order not created yet)
  checkout_session_id?: string | null;     // set for the session-first flow
  provider_ref: string | null;             // Moyasar PAYMENT id (set at confirmation)
  provider_checkout_ref: string | null;    // Moyasar INVOICE id (set when the attempt opens)
  reference_transaction: string | null;
  reference_order: string | null;
  amount: number;                          // MAJOR units, server-trusted
  currency: string | null;
  mode: string | null;
  status: string;
}

export interface ConfirmResult {
  outcome: MoyasarOutcome | 'mismatch';
  paid: boolean;
  reason?: string;
  orderId?: string;
}

/**
 * Validate a retrieved Moyasar payment against the stored attempt and, if it is
 * a clean `paid`/`captured`, confirm the order paid and hand it to the POS.
 * Returns a coarse outcome; never throws.
 *
 * THE BINDING, FIELD BY FIELD
 *  - `payment.invoice_id` must equal the invoice id we stored when we opened the
 *    attempt. This is the load-bearing link. Moyasar sets it itself when a
 *    payment settles an invoice, and nothing a customer or an attacker controls
 *    can point somebody else's payment at our invoice.
 *  - the amount must equal the server-trusted attempt amount, compared in MINOR
 *    units so no float equality is involved.
 *  - the currency must be the attempt's currency.
 *  - the MODE is bound by construction rather than by a field: Moyasar's test
 *    and live key spaces are disjoint, and the caller resolves the secret key
 *    from the ATTEMPT's stored mode, so a live payment simply cannot be fetched
 *    with the test key that opened a test attempt — it 404s. Where the webhook
 *    envelope supplies an explicit `live` flag we compare that too, as a second
 *    check that costs nothing.
 *
 * `metadata` is NOT part of the binding. Moyasar does not document metadata
 * propagating from an invoice to the payment that settles it, so requiring it
 * would reject legitimate payments. It is written for human reconciliation only.
 */
export async function validateAndConfirmMoyasarPayment(
  admin: SupabaseClient,
  attempt: MoyasarAttempt,
  payment: Record<string, unknown>,
  opts: { liveMode?: boolean | null } = {},
): Promise<ConfirmResult> {
  const { outcome } = mapMoyasarPaymentStatus(payment.status);
  const currency = String(attempt.currency ?? 'SAR').toUpperCase();
  const sanitized = sanitizeMoyasarPayment(payment);
  const source = (payment.source ?? {}) as Record<string, unknown>;

  const paymentId = String(payment.id ?? '');
  // The binding decision itself is pure and unit-tested in moyasar.ts.
  const { hasId, invoiceMatch, amountMatch, currencyMatch, modeMatch, allMatch } =
    checkPaymentBinding(attempt, payment, opts);

  // Always record that we verified (bounded, sanitized) — never overwrite a paid row.
  const touch = async (patch: Record<string, unknown>) => {
    await admin.from('payment_records')
      .update({ last_verified_at: new Date().toISOString(), raw: sanitized, ...patch })
      .eq('id', attempt.id).neq('status', 'paid').then(() => {}, () => {});
  };

  if (outcome === 'paid' && allMatch) {
    const paidMajor = fromMinorUnits(Number(payment.amount ?? 0), currency);
    const cardScheme = source.company != null ? String(source.company) : null;
    const cardLast4 = lastFourOf(source.number);
    let orderId = '';
    let confirmedOrder: Record<string, unknown> | null = null;

    if (attempt.checkout_session_id) {
      // Session-first flow: the order does NOT exist yet. finalize_checkout_session
      // atomically creates the real, already-paid order from the frozen snapshot,
      // marks the attempt paid and links it, and consumes the session. Idempotent:
      // a webhook + a verify (or a duplicate webhook) converge on ONE order.
      // It also fills in provider_ref on an attempt row that still has none,
      // which is exactly the state a Moyasar session attempt is in until now.
      const { data, error } = await admin.rpc('finalize_checkout_session', {
        p_session_id: attempt.checkout_session_id,
        p_provider: 'moyasar',
        p_provider_ref: paymentId,
        p_amount: paidMajor,
        p_currency: currency,
        p_raw: sanitized,
        p_card_scheme: cardScheme,
        p_card_last4: cardLast4,
      });
      if (error || !data) {
        await admin.from('integration_sync_logs').insert({
          provider: 'moyasar', order_id: null, direction: 'webhook', status: 'failed',
          request: {
            payment_id: paymentId.slice(0, 64),
            session: String(attempt.checkout_session_id).slice(0, 64),
          },
          error: 'finalize_failed',
        }).then(() => {}, () => {});
        return { outcome: 'failed', paid: false, reason: 'finalize_failed' };
      }
      confirmedOrder = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
      orderId = String(confirmedOrder?.id ?? '');
    } else {
      // Order-first flow. confirm_order_payment upserts on (provider,
      // provider_ref); our attempt row was opened with provider_ref NULL because
      // Moyasar only issues a payment id once the customer pays. Stamp it onto
      // THIS attempt first, so the upsert updates the row we already own instead
      // of inserting a second one beside it.
      const { error: stampErr } = await admin.from('payment_records')
        .update({ provider_ref: paymentId })
        .eq('id', attempt.id)
        .is('provider_ref', null);
      if (stampErr) {
        // A concurrent webhook/verify may have stamped it already — that is fine
        // and idempotent. Anything else means we cannot safely attribute the
        // payment to this attempt, so we stop rather than risk a duplicate row.
        const { data: current } = await admin.from('payment_records')
          .select('provider_ref').eq('id', attempt.id).maybeSingle();
        if (String(current?.provider_ref ?? '') !== paymentId) {
          console.error('moyasar provider_ref stamp failed', String(stampErr.message ?? '').slice(0, 200));
          return { outcome: 'failed', paid: false, reason: 'stamp_failed' };
        }
      }

      const { data, error } = await admin.rpc('confirm_order_payment', {
        p_order_id: attempt.order_id,
        p_provider: 'moyasar',
        p_provider_ref: paymentId,
        p_amount: paidMajor,
        p_raw: sanitized,
      });
      if (error) {
        await admin.from('integration_sync_logs').insert({
          provider: 'moyasar', order_id: attempt.order_id, direction: 'webhook', status: 'failed',
          request: { payment_id: paymentId.slice(0, 64) }, error: 'confirm_failed',
        }).then(() => {}, () => {});
        return { outcome: 'failed', paid: false, reason: 'confirm_failed' };
      }
      confirmedOrder = (data ?? null) as Record<string, unknown> | null;
      orderId = String(attempt.order_id ?? '');
      // Store safe card display fields (the session path does this inside finalize).
      await admin.from('payment_records').update({
        card_scheme: cardScheme,
        card_last_four: cardLast4,
        last_verified_at: new Date().toISOString(),
      }).eq('id', attempt.id).then(() => {}, () => {});
    }

    // Paid -> hand the order to the POS, then attach the online payment. Best-effort;
    // a POS hiccup must never undo a confirmed payment (the worker/reaper reconcile).
    await triggerLazywaitSyncOnce(admin);
    const { data: fresh } = orderId
      ? await admin.from('orders').select('*').eq('id', orderId).maybeSingle()
      : { data: null };
    await pushLazywaitOnlinePayment(
      admin, (fresh ?? confirmedOrder) as Record<string, unknown> | null, paymentId,
    ).catch(() => {});
    return { outcome: 'paid', paid: true, orderId };
  }

  // Settled at Moyasar but a bound field does not match -> possible tampering,
  // or a payment that belongs to a different invoice. Never confirm.
  if (outcome === 'paid' && !allMatch) {
    await admin.from('integration_sync_logs').insert({
      provider: 'moyasar', order_id: attempt.order_id, direction: 'webhook', status: 'failed',
      request: {
        payment_id: paymentId.slice(0, 64),
        mismatch: { hasId, invoiceMatch, amountMatch, currencyMatch, modeMatch },
      },
      error: 'verification_mismatch',
    }).then(() => {}, () => {});
    await touch({
      status: 'failed', failure_code: 'verification_mismatch',
      failure_message_safe: 'Payment could not be verified.',
    });
    return { outcome: 'mismatch', paid: false, reason: 'verification_mismatch' };
  }

  // Terminal non-success -> mark the attempt failed so a fresh attempt is allowed.
  if (outcome === 'failed' || outcome === 'cancelled' || outcome === 'expired') {
    await touch({
      status: 'failed',
      failure_code: String(payment.status ?? outcome).slice(0, 40),
      failure_message_safe: paymentFailureMessage(payment),
    });
    return { outcome, paid: false };
  }

  // initiated / authorized / verified / refunded / unknown -> keep the attempt
  // open (never paid). `refunded` is deliberately not treated as a success: the
  // money has come back, so there is nothing to confirm.
  await touch({});
  return { outcome, paid: false };
}

/**
 * Retrieve the invoice, pick its settled payment, and run the confirmation.
 * Returns 'pending' without touching anything when the invoice cannot be reached
 * (transient) or has not been paid yet.
 */
export async function verifyMoyasarAttempt(
  admin: SupabaseClient,
  attempt: MoyasarAttempt,
  secretKey: string,
): Promise<ConfirmResult & { messageKey: string }> {
  const invoiceId = String(attempt.provider_checkout_ref ?? '');
  if (!invoiceId) return { outcome: 'pending', paid: false, messageKey: 'payPending' };

  const retrieved = await retrieveMoyasarInvoice(secretKey, invoiceId);
  // A transient failure must leave the attempt open so the app can retry. A 404
  // is NOT transient, but it is also not a reason to fail an attempt that may be
  // mid-flight in the other mode's namespace, so it is reported the same way and
  // the expiry sweep closes the attempt instead.
  if (!retrieved.ok) return { outcome: 'pending', paid: false, messageKey: 'payPending' };

  const invoice = retrieved.body;
  const payment = selectInvoicePayment(invoice);
  if (!payment) {
    // The invoice exists but nobody has attempted a payment on it yet.
    await admin.from('payment_records')
      .update({ last_verified_at: new Date().toISOString(), raw: sanitizeMoyasarInvoice(invoice) })
      .eq('id', attempt.id).neq('status', 'paid').then(() => {}, () => {});
    return { outcome: 'pending', paid: false, messageKey: 'payPending' };
  }

  const result = await validateAndConfirmMoyasarPayment(admin, attempt, payment);
  const { messageKey } = mapMoyasarPaymentStatus(payment.status);
  return { ...result, messageKey };
}

/**
 * Find an invoice we may have already created, by the per-attempt reference we
 * stamped into its metadata.
 *
 * WHY THIS EXISTS — the retry that Tap can do safely and Moyasar cannot.
 * The Tap path retries a failed charge create once, and that is safe because the
 * payload carries `reference.idempotent`, so Tap returns the FIRST charge rather
 * than opening a second one. Moyasar documents idempotency (`given_id`) for
 * PAYMENT CREATION ONLY — there is no idempotency parameter on
 * `POST /v1/invoices` (https://docs.moyasar.com/api/idempotency). Blindly
 * retrying an invoice create after a timeout could therefore leave two live
 * invoices for one order. The customer would only pay one of them, but we would
 * have stored the id of the other — and verification binds on
 * `payment.invoice_id`, so a real payment against the forgotten invoice would
 * never confirm. Money taken, order never placed.
 *
 * So instead of retrying, the caller RECONCILES: it asks Moyasar whether the
 * ambiguous create actually landed, and adopts the existing invoice if it did.
 *
 * WHAT IS DOCUMENTED, AND WHAT IS NOT.
 * The bracket query syntax is documented: Moyasar's metadata page shows
 * `-d "metadata[order_id]"=1000` against a list endpoint and names list-invoices
 * as one of the endpoints that supports it (https://docs.moyasar.com/api/metadata).
 * What has NOT been validated is the behaviour against a live account — whether
 * an unsupported or misspelled metadata filter is rejected or silently ignored.
 * That distinction matters, because a silently ignored filter returns the whole
 * invoice list rather than nothing.
 *
 * So this function FAILS CLOSED twice over: `{ ok: false }` on any transport or
 * API error, `{ ok: true, invoice: null }` only when Moyasar positively answered
 * with a list that contained no match, and the reference is re-checked locally
 * on every candidate rather than trusting the filter to have been applied.
 *
 * The caller must treat those two cases differently — a failed lookup is NOT
 * permission to create a second invoice. See payment-initiate.
 */
export interface InvoiceLookupResult {
  ok: boolean;
  invoice: Record<string, unknown> | null;
}

export async function findInvoiceByReference(
  secretKey: string,
  referenceTransaction: string,
): Promise<InvoiceLookupResult> {
  const ref = String(referenceTransaction ?? '').trim();
  if (!ref) return { ok: false, invoice: null };
  try {
    const query = `?metadata[reference_transaction]=${encodeURIComponent(ref)}`;
    const res = await moyasarGet(secretKey, `/invoices${query}`);
    if (!res.ok) return { ok: false, invoice: null };

    const body = res.body;
    const list = Array.isArray(body.invoices)
      ? (body.invoices as Record<string, unknown>[])
      : Array.isArray(body)
        ? (body as unknown as Record<string, unknown>[])
        : [];

    // Never trust the filter to have been applied — if Moyasar ignored the
    // query parameter it would return the whole invoice list, and adopting
    // another order's invoice would be far worse than creating a second one.
    // Re-check the reference ourselves on every candidate.
    const match = list.find((inv) => {
      const meta = (inv?.metadata ?? {}) as Record<string, unknown>;
      return String(meta.reference_transaction ?? '') === ref;
    });
    return { ok: true, invoice: match ?? null };
  } catch {
    return { ok: false, invoice: null };
  }
}
