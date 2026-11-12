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
  DUPLICATE_PAYMENT,
  DUPLICATE_PAYMENT_MESSAGE,
  MOYASAR_API_BASE,
  MOYASAR_IP_NOT_ALLOWED,
  NOT_A_DUPLICATE_FILTER,
  basicAuthHeader,
  checkPaymentBinding,
  closedInvoiceOutcome,
  confirmMessageKey,
  fromMinorUnits,
  isGenuineConfirmation,
  isMoyasarIpNotAllowed,
  isOrderAlreadyPaidByAnother,
  lastFourOf,
  mapMoyasarPaymentStatus,
  sanitizeMoyasarInvoice,
  sanitizeMoyasarPayment,
  selectInvoicePayment,
  type MoyasarOutcome,
} from './moyasar.ts';
import { moyasarFetch } from './moyasarHttp.ts';

export { selectInvoicePayment } from './moyasar.ts';
import { triggerLazywaitSyncOnce, pushLazywaitOnlinePayment } from './paymentSync.ts';

const FETCH_TIMEOUT_MS = 12_000;

export interface RetrievedResource {
  ok: boolean;
  /** 0 when no HTTP answer arrived at all: a timeout, a network error or a refused proxy. */
  status: number;
  body: Record<string, unknown>;
}

/**
 * Every caller treats `ok: false` as "could not find out", which is what a
 * timeout, a network error and a refused proxy all are. Throwing instead made
 * payment-verify answer 500 where its contract is 'pending', and the proxy
 * makes those failures likelier, so they are reported, not thrown.
 */
async function moyasarGet(secretKey: string, path: string): Promise<RetrievedResource> {
  try {
    const res = await moyasarFetch(`${MOYASAR_API_BASE}${path}`, {
      method: 'GET',
      headers: { Authorization: basicAuthHeader(secretKey), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: body as Record<string, unknown> };
  } catch (e) {
    console.error(JSON.stringify({ event: 'moyasar_request_failed', error: e instanceof Error ? e.name : 'error' }));
    return { ok: false, status: 0, body: {} };
  }
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

/** What the stamp read-back found on the attempt row. */
type StampState =
  | { kind: 'ours'; orderId: string | null; status: string }
  | { kind: 'other'; orderId: string | null }
  | { kind: 'unknown' };

/**
 * Stamp THIS payment's id onto the attempt, then READ BACK what the row holds.
 *
 * The `.is('provider_ref', null)` filter means a row already stamped by a
 * concurrent run matches ZERO rows — and a zero-row PostgREST update is not an
 * error. Keying a guard on the error therefore skipped it in exactly the case it
 * existed for. Only the row's actual state settles it: this payment ('ours'),
 * another payment already holding the attempt ('other'), or no stamp at all
 * ('unknown': the write or the read failed).
 */
async function stampPaymentRef(
  admin: SupabaseClient, attemptId: string, paymentId: string,
): Promise<StampState> {
  await admin.from('payment_records')
    .update({ provider_ref: paymentId })
    .eq('id', attemptId)
    .is('provider_ref', null)
    .then(() => {}, () => {});
  const { data: current, error } = await admin.from('payment_records')
    .select('provider_ref, order_id, status').eq('id', attemptId).maybeSingle();
  const ref = String(current?.provider_ref ?? '');
  if (error || !current || !ref) return { kind: 'unknown' };
  const orderId = current.order_id ? String(current.order_id) : null;
  if (ref === paymentId) return { kind: 'ours', orderId, status: String(current.status ?? '') };
  return { kind: 'other', orderId };
}

/**
 * Record a DUPLICATE: a settled, binding-valid payment that did not pay the
 * order, because another payment already had. It must be refundable, so it is
 * written down rather than reported paid.
 *
 *  - `stamped`: the attempt already carries this payment id (the session path
 *    after finalize_checkout_session returned an order another payment
 *    created), so THAT row becomes the record.
 *  - `insert`: the attempt belongs to another payment, or the order was already
 *    paid before this one was stamped, so a row of its own carries this
 *    payment id. It carries no invoice id, so the webhook's invoice lookup
 *    still finds the attempt, and every attempt lookup skips it
 *    (NOT_A_DUPLICATE_FILTER).
 *
 * A UNIQUE VIOLATION ON (provider, provider_ref) IS NOT "ALREADY RECORDED". It
 * says some row carries this payment id, and that row may be the attempt the
 * payment was stamped on before its confirmation failed: an ordinary failed or
 * expired attempt with nothing marking the money for a refund. So the row
 * carrying this payment id becomes the record, unless it is paid or already a
 * duplicate record; only then is it already recorded.
 *
 * Status 'failed' with failure_code DUPLICATE_PAYMENT, the precedent a binding
 * mismatch set: never 'paid', because the refund worker and the watchdog expect
 * one paid row per order. One integration_sync_logs row is written per row that
 * BECOMES a duplicate record (the update answers with the rows it changed), so
 * a replayed webhook does not count the same duplicate twice; if the payment row
 * itself could not be written, that log row is still written.
 */
async function recordDuplicatePayment(
  admin: SupabaseClient,
  how: 'stamped' | 'insert',
  ctx: {
    attempt: MoyasarAttempt;
    paymentId: string;
    orderId: string | null;
    amount: number;
    currency: string;
    raw: Record<string, unknown>;
    cardScheme: string | null;
    cardLast4: string | null;
    alreadyRecorded?: boolean;
  },
): Promise<ConfirmResult> {
  const { attempt, paymentId } = ctx;
  const orderId = ctx.orderId ?? attempt.order_id ?? null;
  const record = {
    status: 'failed',
    failure_code: DUPLICATE_PAYMENT,
    failure_message_safe: DUPLICATE_PAYMENT_MESSAGE,
    order_id: orderId,
    amount: ctx.amount,
    currency: ctx.currency,
    raw: ctx.raw,
    card_scheme: ctx.cardScheme,
    card_last_four: ctx.cardLast4,
    last_verified_at: new Date().toISOString(),
  };

  // Turn an existing row into the record. `fresh` follows the rows the update
  // CHANGED: none means it was already recorded (or is paid, and never
  // touched). An update that fails leaves the sync-log row as the record.
  const markExisting = async (match: Record<string, string>): Promise<boolean> => {
    let q = admin.from('payment_records').update(record);
    for (const [col, val] of Object.entries(match)) q = q.eq(col, val);
    const { data, error } = await q
      .neq('status', 'paid').or(NOT_A_DUPLICATE_FILTER).select('id')
      .then((r) => r, () => ({ data: null, error: { message: 'update threw' } }));
    if (error) {
      console.error(JSON.stringify({
        event: 'moyasar_duplicate_not_recorded', attempt: String(attempt.id).slice(0, 36),
      }));
      return !ctx.alreadyRecorded;
    }
    return Array.isArray(data) && data.length > 0;
  };

  let fresh: boolean;
  if (how === 'stamped') {
    fresh = await markExisting({ id: String(attempt.id) });
  } else {
    const { error } = await admin.from('payment_records').insert({
      ...record,
      provider: 'moyasar',
      provider_ref: paymentId,
      mode: attempt.mode,
      // A row must name an order or a session (payment_records' CHECK); the
      // session is named even when the order is known, for whoever refunds it.
      checkout_session_id: attempt.checkout_session_id ?? null,
    });
    if (!error) {
      fresh = true;
    } else if (String((error as { code?: unknown }).code ?? '') === '23505') {
      // A row already carries this payment id: make IT the record (see above).
      fresh = await markExisting({ provider: 'moyasar', provider_ref: paymentId });
    } else {
      // Any other failure leaves the sync-log row below as the only record, so
      // it is still written.
      console.error(JSON.stringify({
        event: 'moyasar_duplicate_not_recorded', attempt: String(attempt.id).slice(0, 36),
      }));
      fresh = true;
    }
  }

  if (fresh) {
    await admin.from('integration_sync_logs').insert({
      provider: 'moyasar', order_id: orderId, direction: 'webhook', status: 'failed',
      request: {
        payment_id: paymentId.slice(0, 64),
        ...(attempt.checkout_session_id ? { session: String(attempt.checkout_session_id).slice(0, 64) } : {}),
        ...(orderId ? { order: String(orderId).slice(0, 64) } : {}),
      },
      error: DUPLICATE_PAYMENT,
    }).then(() => {}, () => {});
    console.warn(JSON.stringify({
      event: 'moyasar_duplicate_payment', attempt: String(attempt.id).slice(0, 36),
    }));
  }
  return { outcome: 'failed', paid: false, reason: DUPLICATE_PAYMENT, ...(orderId ? { orderId: String(orderId) } : {}) };
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
    // A TEST-mode attempt never confirms anything. Moyasar's sandbox settles a
    // test invoice exactly as live settles a real one, so the binding above
    // matches and a published test card would mark a real order paid and send
    // it to the kitchen. payment-initiate refuses to open such an attempt for a
    // customer; this is the second line, here because every confirmation (the
    // webhook, payment-verify and the admin re-verify) comes through it. The
    // admin sandbox invoice has no attempt row, so it never reaches this.
    if (attempt.mode !== 'live') {
      console.warn(JSON.stringify({
        event: 'moyasar_confirm_refused', reason: 'test_mode_attempt', attempt: String(attempt.id).slice(0, 36),
      }));
      await touch({
        status: 'failed', failure_code: 'test_mode_attempt',
        failure_message_safe: 'A test payment cannot pay for an order.',
      });
      return { outcome: 'failed', paid: false, reason: 'test_mode_attempt' };
    }

    const paidMajor = fromMinorUnits(Number(payment.amount ?? 0), currency);
    const cardScheme = source.company != null ? String(source.company) : null;
    const cardLast4 = lastFourOf(source.number);
    const duplicate = (how: 'stamped' | 'insert', dupOrderId: string | null, alreadyRecorded = false) =>
      recordDuplicatePayment(admin, how, {
        attempt, paymentId, orderId: dupOrderId, amount: paidMajor, currency, raw: sanitized,
        cardScheme, cardLast4, alreadyRecorded,
      });
    let orderId = '';
    let confirmedOrder: Record<string, unknown> | null = null;

    if (attempt.checkout_session_id) {
      // Session-first flow: the order does NOT exist yet. finalize_checkout_session
      // atomically creates the real, already-paid order from the frozen snapshot,
      // marks the attempt paid and links it, and consumes the session. Idempotent:
      // a webhook + a verify (or a duplicate webhook) converge on ONE order.
      //
      // STAMP FIRST, so the payment lands on the attempt that owns its invoice.
      // finalize's row picker prefers the row already carrying this payment id
      // and otherwise takes the NEWEST ref-less 'initiated' attempt
      // (20260712170000), which, once a session holds a second attempt, is the
      // wrong one: the first payment was attached to the second invoice's row.
      const stamp = await stampPaymentRef(admin, attempt.id, paymentId);
      if (stamp.kind === 'other') {
        // The attempt already belongs to another payment on this invoice, so
        // this one paid nothing. Never finalize with it.
        return await duplicate('insert', stamp.orderId);
      }
      if (stamp.kind === 'unknown') {
        console.error('moyasar provider_ref stamp did not land', JSON.stringify({
          attempt: String(attempt.id).slice(0, 36),
        }));
        // 'pending', not 'failed': the payment may be genuine, and the app clears
        // its saved session on a terminal answer. A retry stamps again.
        return { outcome: 'pending', paid: false, reason: 'stamp_failed' };
      }

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

      // DID THIS PAYMENT PAY IT? finalize returns the session's existing order
      // for ANY payment id once the session is consumed (20260712170000), so a
      // second payment used to come back 'paid' and be written nowhere. Only the
      // row carrying this payment id can tell: the genuine payment's row is paid
      // and linked to that order. The first payment, its replayed webhook, and a
      // webhook racing payment-verify for it all read that back.
      const { data: mine, error: mineErr } = await admin.from('payment_records')
        .select('status, order_id, failure_code')
        .eq('provider', 'moyasar').eq('provider_ref', paymentId).maybeSingle();
      if (mineErr) {
        // Unknown is not 'paid' and not 'failed': the order may be this payment's.
        return { outcome: 'pending', paid: false, reason: 'readback_failed' };
      }
      if (!isGenuineConfirmation(mine, orderId)) {
        return await duplicate('stamped', orderId || null, mine?.failure_code === DUPLICATE_PAYMENT);
      }
    } else {
      // Order-first flow. ALREADY PAID BY ANOTHER PAYMENT? Then this one paid
      // nothing. Decided before the stamp, so the attempt is left for the
      // payment that is still its own. This read is the fast path, not the
      // guarantee: two payments confirmed at once can both read "unpaid" here,
      // and confirm_order_payment settles that under the order lock below.
      const { data: paidRows, error: paidErr } = await admin.from('payment_records')
        .select('provider, provider_ref')
        .eq('order_id', attempt.order_id).eq('status', 'paid');
      if (paidErr) return { outcome: 'pending', paid: false, reason: 'readback_failed' };
      const paidByAnother = (Array.isArray(paidRows) ? paidRows : []).some(
        (r: { provider?: unknown; provider_ref?: unknown }) =>
          !(String(r.provider ?? '') === 'moyasar' && String(r.provider_ref ?? '') === paymentId),
      );
      if (paidByAnother) {
        // An attempt that already carries THIS payment id (stamped by an earlier
        // run whose confirm then failed) is itself the record; a new row beside
        // it would only collide with it on (provider, provider_ref).
        return await duplicate(
          String(attempt.provider_ref ?? '') === paymentId ? 'stamped' : 'insert', attempt.order_id,
        );
      }

      // confirm_order_payment upserts on (provider, provider_ref); our attempt
      // row was opened with provider_ref NULL because Moyasar only issues a
      // payment id once the customer pays. Stamp it onto THIS attempt first, so
      // the upsert updates the row we already own instead of inserting a second
      // one beside it. An attempt already carrying a DIFFERENT payment id would
      // otherwise fall through to that upsert and insert a SECOND paid row.
      const stamp = await stampPaymentRef(admin, attempt.id, paymentId);
      if (stamp.kind === 'other') return await duplicate('insert', attempt.order_id);
      if (stamp.kind === 'unknown') {
        console.error('moyasar provider_ref stamp did not land', JSON.stringify({
          attempt: String(attempt.id).slice(0, 36),
        }));
        // 'pending', as on the session path: the payment may be genuine, and a
        // terminal answer makes the app give up on a payment a retry confirms.
        return { outcome: 'pending', paid: false, reason: 'stamp_failed' };
      }

      const { data, error } = await admin.rpc('confirm_order_payment', {
        p_order_id: attempt.order_id,
        p_provider: 'moyasar',
        p_provider_ref: paymentId,
        p_amount: paidMajor,
        p_raw: sanitized,
      });
      if (isOrderAlreadyPaidByAnother(error)) {
        // ANOTHER PAYMENT WON THE RACE. The read above ran before that
        // payment's confirm committed, so only the order's row lock can tell,
        // and confirm_order_payment decides it there (20261003120000). This
        // attempt carries this payment id now, so it becomes the record.
        return await duplicate('stamped', attempt.order_id);
      }
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

  // EVERYTHING ELSE LEAVES THE ATTEMPT OPEN, a declined, voided or expired
  // PAYMENT included, recording only when we looked and what we saw.
  //
  // A payment is one try at an invoice, and the invoice stays payable after it:
  // a declined card can be followed by Apple Pay on the same hosted page
  // (selectInvoicePayment). Closing the attempt on that decline let a resumed
  // checkout open a SECOND attempt and a second invoice beside the first, still
  // payable one, and a customer could then pay both. Only an INVOICE that
  // Moyasar has closed ends an attempt (closedInvoiceOutcome, in
  // verifyMoyasarAttempt), or the attempt's own expiry in begin_*_attempt.
  //
  // The outcome is still reported: a lone declined payment makes payment-verify
  // answer 'failed', and the app starts again on the same session, which reuses
  // this attempt and its invoice. `refunded` is never a success: the money has
  // come back, so there is nothing to confirm.
  await touch({});
  return { outcome, paid: false };
}

/**
 * Retrieve the invoice, pick its settled payment, and run the confirmation.
 * Returns 'pending' without touching anything when the invoice cannot be reached
 * (transient) or has not been paid yet, and a terminal 'expired' or 'cancelled'
 * when Moyasar has closed it with nothing settled (closedInvoiceOutcome).
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
  // mid-flight in the other mode's namespace, so it is reported the same way.
  // Nothing sweeps such an attempt: begin_payment_attempt / begin_session_attempt
  // close it once it has expired, the next time the customer starts a payment.
  // A refusal by Moyasar's Allowed IPs list is named, so the admin re-verify
  // can say what to fix; the customer still sees only 'pending'.
  if (!retrieved.ok) {
    return {
      outcome: 'pending',
      paid: false,
      messageKey: 'payPending',
      ...(isMoyasarIpNotAllowed(retrieved.status, retrieved.body) ? { reason: MOYASAR_IP_NOT_ALLOWED } : {}),
    };
  }

  const invoice = retrieved.body;

  // Expired or cancelled with nothing settled: it can never be paid now, so the
  // attempt is closed (a fresh one can open) and the outcome is terminal.
  const closed = closedInvoiceOutcome(invoice);
  if (closed) {
    await admin.from('payment_records')
      .update({
        status: 'failed', failure_code: closed.failureCode,
        failure_message_safe: closed.outcome === 'expired' ? 'Payment session expired' : 'Invoice cancelled at Moyasar',
        last_verified_at: new Date().toISOString(), raw: sanitizeMoyasarInvoice(invoice),
      })
      .eq('id', attempt.id).neq('status', 'paid').then(() => {}, () => {});
    return { outcome: closed.outcome, paid: false, messageKey: closed.messageKey };
  }

  // The payment this attempt already carries comes first: a second settled one
  // on the same invoice is a duplicate, and must not stand in front of it.
  const payment = selectInvoicePayment(invoice, attempt.provider_ref);
  if (!payment) {
    // The invoice exists but nobody has attempted a payment on it yet. The
    // reason lets payment-verify tell this from a payment in flight.
    await admin.from('payment_records')
      .update({ last_verified_at: new Date().toISOString(), raw: sanitizeMoyasarInvoice(invoice) })
      .eq('id', attempt.id).neq('status', 'paid').then(() => {}, () => {});
    return { outcome: 'pending', paid: false, messageKey: 'payPending', reason: 'no_payment' };
  }

  const result = await validateAndConfirmMoyasarPayment(admin, attempt, payment);
  return { ...result, messageKey: confirmMessageKey(payment.status, result.paid) };
}

/**
 * Find an invoice we may have already created, by the per-attempt reference we
 * stamped into its metadata.
 *
 * WHY THIS EXISTS — an invoice create cannot safely be retried.
 * Moyasar documents idempotency (`given_id`) for PAYMENT CREATION ONLY — there
 * is no idempotency parameter on `POST /v1/invoices`
 * (https://docs.moyasar.com/api/idempotency). Blindly retrying an invoice
 * create after a timeout could therefore leave two live invoices for one
 * order. The customer would only pay one of them, but we would have stored the
 * id of the other — and verification binds on `payment.invoice_id`, so a real
 * payment against the forgotten invoice would never confirm. Money taken, order
 * never placed.
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
