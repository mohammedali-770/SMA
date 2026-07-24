/**
 * Tap refund helpers — PURE (web-standard only, no Deno APIs), so vitest can
 * import them exactly like _shared/tap.ts.
 *
 * The refund path is the most dangerous thing in the payment stack: it moves real
 * money, and both failure modes are bad (a customer not refunded, or a customer
 * refunded twice). Everything decidable without I/O therefore lives here, behind
 * unit tests, and the Edge Function is left as thin transport.
 *
 * KEY SAFETY PROPERTY — classifyRefundResponse() distinguishes three outcomes,
 * never two:
 *   succeeded — the provider CONFIRMED the refund reached a terminal success
 *   failed    — the provider gave a definitive terminal rejection
 *   pending   — anything else: in-flight, unknown status, transport error, 5xx,
 *               timeout. A pending outcome RELEASES the claim so the refund is
 *               retried later; it is never reported to the customer as complete.
 * An unrecognised status must land in `pending`, never in `succeeded`.
 */

/** Tap's refund statuses. Only REFUNDED is a confirmed terminal success. */
const TERMINAL_SUCCESS = new Set(['REFUNDED']);
/** Definitive terminal rejections — retrying these would never succeed. */
const TERMINAL_FAILURE = new Set(['FAILED', 'DECLINED', 'CANCELLED', 'VOID', 'REJECTED']);

export type RefundOutcome = 'succeeded' | 'failed' | 'pending';

export interface RefundClassification {
  outcome: RefundOutcome;
  /** Tap's refund id, when one was issued. */
  providerRef: string | null;
  /** Stable machine reason (never a provider payload). */
  failureCode: string | null;
  /** Short sanitized message safe to persist. Never contains secrets or PAN. */
  errorSafe: string | null;
}

/**
 * Classify a Tap refund API result. `ok` is the transport-level success of the
 * HTTP call; `body` is the parsed JSON (or {} when unparseable).
 *
 * Deliberately conservative: an HTTP failure, an unparseable body, or a status
 * Tap has not documented all resolve to 'pending' so the refund is retried rather
 * than being written off as failed (which would strand the customer's money) or
 * claimed as succeeded (which would lie to them).
 */
export function classifyRefundResponse(
  ok: boolean,
  httpStatus: number,
  body: Record<string, unknown>,
): RefundClassification {
  const providerRef = body?.id != null ? String(body.id) : null;
  const status = String(body?.status ?? '').toUpperCase();

  if (!ok) {
    // 4xx that is NOT a rate limit is a definitive request-level rejection — the
    // same request will keep being rejected, so mark it failed for manual review.
    // Everything else (429, 5xx, network) stays retryable.
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
      failureCode: `refund_${status.toLowerCase()}`,
      errorSafe: safeMessage(body),
    };
  }
  // PENDING / IN_PROGRESS / '' / anything undocumented: still open. Retry later.
  return { outcome: 'pending', providerRef, failureCode: null, errorSafe: null };
}

/**
 * A short, bounded, non-sensitive message from a provider error body. Only the
 * documented human-readable fields are read — the raw payload is never persisted,
 * so card data, tokens and customer PII cannot leak into our tables or logs.
 */
export function safeMessage(body: Record<string, unknown>): string | null {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const first = (errors[0] ?? {}) as Record<string, unknown>;
  const raw =
    (first.description != null ? String(first.description) : '')
    || (first.code != null ? `code ${String(first.code)}` : '')
    || (body?.message != null ? String(body.message) : '');
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : null;
}

export interface RefundRequest {
  chargeId: string;
  amount: number;
  currency: string;
  /** OUR idempotency key — also sent as Tap's `post.reference` for reconciliation. */
  reference: string;
  reason: string;
}

/**
 * Build the Tap refund request body. `reference` carries our deterministic
 * per-order idempotency key so a duplicated request is reconcilable on Tap's side
 * as well as ours; our own DB claim is what actually prevents a double refund.
 */
export function buildRefundBody(req: RefundRequest): Record<string, unknown> {
  return {
    charge_id: req.chargeId,
    amount: Number(req.amount),
    currency: (req.currency || 'SAR').toUpperCase(),
    reason: req.reason,
    reference: { merchant: req.reference },
    // Tap notifies this endpoint on refund state changes; the worker also polls,
    // so delivery is not depended upon.
    post: { url: null },
  };
}

/** Refund is only ever attempted against a real captured charge and a positive amount. */
export function refundRequestIsValid(req: Partial<RefundRequest>): boolean {
  return typeof req.chargeId === 'string' && req.chargeId.trim().length > 0
    && Number.isFinite(Number(req.amount)) && Number(req.amount) > 0;
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
