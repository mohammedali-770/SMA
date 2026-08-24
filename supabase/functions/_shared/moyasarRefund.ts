/**
 * Moyasar refund helpers — PURE (web-standard only, no Deno APIs), so vitest can
 * import them exactly like _shared/moyasar.ts.
 *
 * The refund path is the most dangerous thing in the payment stack: it moves
 * real money, and both failure modes are bad (a customer not refunded, or a
 * customer refunded twice). Everything decidable without I/O therefore lives
 * here, behind unit tests, and the Edge Function is left as thin transport.
 *
 * KEY SAFETY PROPERTY — classifyMoyasarRefundResponse() distinguishes three
 * outcomes, never two:
 *   succeeded — Moyasar CONFIRMED the refund reached a terminal success
 *   failed    — a definitive terminal rejection
 *   pending   — anything else: in-flight, unknown status, transport error, 5xx,
 *               timeout. A pending outcome RELEASES the claim so the refund is
 *               retried later; it is never reported to the customer as complete.
 * An unrecognised status must land in `pending`, never in `succeeded`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE IDEMPOTENCY GAP, AND WHY MOYASAR CAN ACTUALLY CLOSE IT
 *
 * `docs/PAYMENT_POSTPONEMENT.md` §7 states the condition for ever re-enabling
 * automated refunds: the chosen provider must supply EITHER a true idempotency
 * key on the refund endpoint, OR a reliable refund-status lookup that can
 * resolve an ambiguous attempt before a retry.
 *
 * Moyasar does not supply the first. `given_id` is documented for PAYMENT
 * CREATION only (https://docs.moyasar.com/api/idempotency); no idempotency
 * parameter is documented on `POST /v1/payments/:id/refund`. Taken alone that is
 * WORSE than Tap, which at least has a 24-hour `reference.idempotent`.
 *
 * It does supply the second, and supplies it well. `GET /v1/payments/:id`
 * returns `status`, `refunded` (the cumulative amount refunded so far, in minor
 * units) and `refunded_at`. Those three fields answer "did my ambiguous attempt
 * actually land?" exactly — which a Tap refund retrieve was only assumed to do.
 * `resolveRefundFromPayment()` below is that resolution step, and the worker
 * must run it before any retry rather than re-POSTing blind.
 *
 * This does NOT authorise re-enabling the refund worker. It records that the
 * §7 blocker is answerable for this provider, so the decision becomes a review
 * of this code rather than an open question about the API.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { MOYASAR_API_BASE, toMinorUnits } from './moyasar.ts';

/** Only these payment statuses mean money has provably gone back. */
const TERMINAL_SUCCESS = new Set(['refunded']);
/**
 * Definitive terminal rejections — retrying these would never succeed.
 * `voided` is a cancellation, not a refund, and is treated as terminal for a
 * refund attempt: there is nothing left to send back.
 */
const TERMINAL_FAILURE = new Set(['failed', 'voided']);

export type RefundOutcome = 'succeeded' | 'failed' | 'pending';

export interface RefundClassification {
  outcome: RefundOutcome;
  /** Moyasar's payment id, when the response carried one. */
  providerRef: string | null;
  /** Stable machine reason (never a provider payload). */
  failureCode: string | null;
  /** Short sanitized message safe to persist. Never contains secrets or PAN. */
  errorSafe: string | null;
}

/** The refund endpoint for a payment. */
export function moyasarRefundUrl(paymentId: string): string {
  return `${MOYASAR_API_BASE}/payments/${encodeURIComponent(paymentId)}/refund`;
}

/** The fetch endpoint used to resolve an ambiguous refund. */
export function moyasarPaymentUrl(paymentId: string): string {
  return `${MOYASAR_API_BASE}/payments/${encodeURIComponent(paymentId)}`;
}

/**
 * Classify a Moyasar refund API result. `ok` is the transport-level success of
 * the HTTP call; `body` is the parsed JSON (or {} when unparseable).
 *
 * Deliberately conservative: an HTTP failure, an unparseable body, or a status
 * Moyasar has not documented all resolve to 'pending' so the refund is retried
 * rather than being written off as failed (which would strand the customer's
 * money) or claimed as succeeded (which would lie to them).
 */
export function classifyMoyasarRefundResponse(
  ok: boolean,
  httpStatus: number,
  body: Record<string, unknown>,
): RefundClassification {
  const providerRef = body?.id != null ? String(body.id) : null;
  const status = String(body?.status ?? '').toLowerCase();

  if (!ok) {
    // A 4xx that is NOT a rate limit is a definitive request-level rejection —
    // the same request will keep being rejected, so mark it failed for manual
    // review. Everything else (429, 5xx, network) stays retryable.
    //
    // 404 is included deliberately: Moyasar documents it as "the requested
    // resource doesn't exist", and a refund against a payment id that does not
    // exist in this key's namespace is an operational error a human must look
    // at, not something a retry can fix.
    const definitive = httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429;
    return {
      outcome: definitive ? 'failed' : 'pending',
      providerRef,
      failureCode: definitive ? `http_${httpStatus}` : null,
      errorSafe: definitive ? safeMessage(body) : null,
    };
  }

  if (TERMINAL_SUCCESS.has(status)) {
    return { outcome: 'succeeded', providerRef, failureCode: null, errorSafe: null };
  }
  if (TERMINAL_FAILURE.has(status)) {
    return {
      outcome: 'failed', providerRef,
      failureCode: `refund_${status}`,
      errorSafe: safeMessage(body),
    };
  }
  // paid / captured / initiated / '' / anything undocumented: the refund did not
  // demonstrably complete. Still open — retry later, never guess.
  return { outcome: 'pending', providerRef, failureCode: null, errorSafe: null };
}

/**
 * Resolve an AMBIGUOUS refund attempt from a freshly fetched payment object,
 * WITHOUT sending a second refund.
 *
 * This is the step that makes an automated retry safe. After a timeout, a 5xx or
 * an unparseable response, the worker does not know whether the refund landed.
 * Re-POSTing would risk a double refund, because Moyasar documents no
 * idempotency on the refund endpoint. Instead the worker fetches the payment and
 * asks this function what the provider's own record now says.
 *
 *   succeeded — the payment is `refunded`, or the cumulative `refunded` amount
 *               has reached the amount we were trying to send back. Money has
 *               provably moved; do NOT retry.
 *   pending   — nothing refunded yet, so the earlier attempt did not land and a
 *               retry is safe.
 *   failed    — the payment is in a state from which no refund can ever succeed.
 *
 * `expectedMinorUnits` is the refund amount in MINOR units. A partial refund
 * that has already reached that figure counts as succeeded even if the payment's
 * status is still `paid`, because Moyasar only flips the status to `refunded` on
 * a full refund.
 */
export function resolveRefundFromPayment(
  payment: Record<string, unknown>,
  expectedMinorUnits: number,
): RefundClassification {
  const providerRef = payment?.id != null ? String(payment.id) : null;
  const status = String(payment?.status ?? '').toLowerCase();
  const refunded = Number(payment?.refunded ?? 0);
  const refundedAt = payment?.refunded_at;
  const expected = Number(expectedMinorUnits);

  if (TERMINAL_SUCCESS.has(status)) {
    return { outcome: 'succeeded', providerRef, failureCode: null, errorSafe: null };
  }
  if (
    Number.isFinite(refunded) && refunded > 0
    && Number.isFinite(expected) && expected > 0
    && refunded >= expected
  ) {
    return { outcome: 'succeeded', providerRef, failureCode: null, errorSafe: null };
  }
  // A refunded_at with no usable amount is still evidence something went back.
  // Refuse to retry on it: reporting 'pending' here is what would double-refund.
  if (refundedAt != null && String(refundedAt).trim() !== '' && !(refunded > 0)) {
    return {
      outcome: 'pending', providerRef,
      failureCode: 'refund_ambiguous_needs_review', errorSafe: null,
    };
  }
  if (TERMINAL_FAILURE.has(status)) {
    return {
      outcome: 'failed', providerRef,
      failureCode: `payment_${status}`, errorSafe: safeMessage(payment),
    };
  }
  return { outcome: 'pending', providerRef, failureCode: null, errorSafe: null };
}

/**
 * True when an ambiguous outcome must NOT be retried automatically and belongs
 * in front of a human instead. The refund worker uses this to keep a refund
 * claimed-and-visible rather than looping.
 */
export function needsHumanReview(c: RefundClassification): boolean {
  return c.outcome === 'pending' && c.failureCode === 'refund_ambiguous_needs_review';
}

/**
 * A short, bounded, non-sensitive message from a provider error body. Only the
 * documented human-readable fields are read — the raw payload is never
 * persisted, so card data, tokens and customer PII cannot leak into our tables
 * or logs.
 *
 * Moyasar's documented error shape is `{ type, message, errors }`
 * (https://docs.moyasar.com/api/errors); a failed payment additionally carries a
 * human string on `source.message`.
 */
export function safeMessage(body: Record<string, unknown>): string | null {
  const source = (body?.source ?? {}) as Record<string, unknown>;
  const errs = body?.errors;
  let fromErrors = '';
  if (errs && typeof errs === 'object' && !Array.isArray(errs)) {
    fromErrors = Object.entries(errs as Record<string, unknown>)
      .map(([field, val]) => `${field}: ${Array.isArray(val) ? val.join(', ') : String(val)}`)
      .join('; ');
  }
  const raw =
    (body?.message != null ? String(body.message) : '')
    || fromErrors
    || (source.message != null ? String(source.message) : '')
    || (body?.type != null ? String(body.type) : '');
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : null;
}

export interface RefundRequest {
  /** Moyasar PAYMENT id — what `POST /v1/payments/:id/refund` takes. */
  paymentId: string;
  /** MAJOR units (what order_refunds stores). Converted to minor units here. */
  amount: number;
  currency: string;
}

/**
 * Build the Moyasar refund request body.
 *
 * The endpoint takes a single optional `amount` in MINOR units; omitting it
 * refunds the payment in full. We always send it explicitly rather than relying
 * on the full-refund default, so a mistake in our own amount bookkeeping shows
 * up as a mismatch instead of silently sending back the whole payment.
 *
 * There is NO reference or idempotency field to send. Our deterministic
 * per-order refund identity lives in `order_refunds.idempotency_key` and the
 * database claim; the provider-side protection is the resolve-before-retry step
 * in resolveRefundFromPayment(), not anything in this body.
 */
export function buildMoyasarRefundBody(req: RefundRequest): Record<string, unknown> {
  return { amount: toMinorUnits(Number(req.amount), req.currency || 'SAR') };
}

/** Refund is only ever attempted against a real payment id and a positive amount. */
export function refundRequestIsValid(req: Partial<RefundRequest>): boolean {
  return typeof req.paymentId === 'string' && req.paymentId.trim().length > 0
    && Number.isFinite(Number(req.amount)) && Number(req.amount) > 0
    && toMinorUnits(Number(req.amount), req.currency || 'SAR') > 0;
}

export type RefundLogDecision =
  | { record: true; logStatus: 'success' | 'failed' | 'skipped' }
  | { record: false; reason: 'lost_lease' };

/**
 * Decide whether this run may persist an outcome record for a refund.
 *
 * `finalize_order_refund` is token-fenced and returns FALSE when the caller no
 * longer owns the lease — which happens when the refund was released and
 * re-claimed by another run while this one's provider call was in flight. In
 * that case NOTHING was written by this run, so recording an outcome here would
 * persist a refund result that was never applied, defeating the fence and
 * misleading anyone reading integration_sync_logs.
 *
 * Strict on purpose: only an explicit boolean `true` counts as ownership. A
 * null/undefined/error result from the RPC is treated as a lost lease, because
 * an unconfirmed finalize must never be reported as a completed outcome.
 */
export function decideRefundLogging(
  finalized: unknown,
  outcome: RefundOutcome,
): RefundLogDecision {
  if (finalized !== true) return { record: false, reason: 'lost_lease' };
  return {
    record: true,
    logStatus: outcome === 'succeeded' ? 'success' : outcome === 'failed' ? 'failed' : 'skipped',
  };
}

// ---------------------------------------------------------------------------
// The retry decision, extracted so the safety property is TESTED, not just
// asserted in a comment.
// ---------------------------------------------------------------------------

/**
 * Must this run ask Moyasar what happened before it sends another refund?
 *
 * `claim_order_refund` increments `attempt_count` BEFORE returning it, so the
 * first ever attempt arrives as 1. Anything greater means this refund has
 * already been POSTed at least once — and since Moyasar documents no idempotency
 * on the refund endpoint, a second POST is a second movement of money. Those
 * runs must reconcile first.
 *
 * Written as a named predicate because the off-by-one is exactly the kind of
 * thing that gets "simplified" to `> 0` by someone who assumes the counter is
 * incremented afterwards — which would make every first attempt do a pointless
 * lookup, and, far worse, would look correct.
 */
export function mustReconcileBeforePost(attemptCount: unknown): boolean {
  const n = Number(attemptCount);
  return Number.isFinite(n) && n > 1;
}

export type RetryDecision =
  | { action: 'post' }
  | { action: 'settle'; verdict: RefundClassification }
  | { action: 'release'; reason: 'reconcile_unavailable' };

/**
 * Given what the provider now says about a refund that was already attempted,
 * decide whether this run may send another one.
 *
 * `prior` is null when the reconciliation lookup itself could not be completed —
 * a timeout, a 5xx, an unparseable body. That is NOT the same as "nothing was
 * refunded", and treating it as permission to POST is precisely how a customer
 * gets paid twice. It releases the row instead, so a later run can ask again.
 *
 * Only one answer permits another POST: the provider positively reporting that
 * nothing has been refunded.
 */
export function decideAfterReconcile(prior: RefundClassification | null): RetryDecision {
  if (prior === null) return { action: 'release', reason: 'reconcile_unavailable' };
  if (prior.outcome !== 'pending') return { action: 'settle', verdict: prior };
  if (needsHumanReview(prior)) return { action: 'settle', verdict: prior };
  return { action: 'post' };
}

/**
 * The `order_refunds.status` to write for a finished attempt.
 *
 * The interesting case is the third one. An unreconcilable refund — Moyasar
 * reports a `refunded_at` we cannot match to an amount — must NOT be written as
 * 'pending', because `finalize_order_refund` documents 'pending' as "releases
 * the refund so a later run can re-claim it". That would loop forever: every
 * run reconciles, gets the same unreconcilable answer, releases, and re-claims.
 * The refund never completes and never reaches anybody who could look at it.
 *
 * Writing 'failed' with a machine reason parks it instead: it frees the
 * one-live-refund-per-order slot and surfaces the row in
 * `list_failed_order_refunds()`. That is precisely how
 * `expire_stale_order_refund_claims()` already treats a lease it cannot resolve,
 * and for the same stated reason — "we cannot know whether the dead worker
 * already sent the refund … an automatic re-send could double-refund".
 *
 * A Tap verdict never carries this failure code, so this is a no-op there.
 */
export function refundFinalStatus(v: RefundClassification): 'succeeded' | 'failed' | 'pending' {
  if (v.outcome === 'succeeded') return 'succeeded';
  if (v.outcome === 'failed') return 'failed';
  if (needsHumanReview(v)) return 'failed';
  return 'pending';
}
