import { describe, it, expect } from 'vitest';
import {
  buildMoyasarRefundBody, classifyMoyasarRefundResponse, decideAfterReconcile, decideRefundLogging,
  moyasarPaymentUrl, moyasarRefundUrl, mustReconcileBeforePost, needsHumanReview,
  refundFinalStatus, refundRequestIsValid, resolveRefundFromPayment, safeMessage,
} from './moyasarRefund.ts';

describe('moyasarRefundUrl / moyasarPaymentUrl', () => {
  it('builds the documented endpoints and escapes the id', () => {
    expect(moyasarRefundUrl('pay_1')).toBe('https://api.moyasar.com/v1/payments/pay_1/refund');
    expect(moyasarPaymentUrl('pay_1')).toBe('https://api.moyasar.com/v1/payments/pay_1');
    expect(moyasarRefundUrl('a/b')).toBe('https://api.moyasar.com/v1/payments/a%2Fb/refund');
  });
});

describe('buildMoyasarRefundBody', () => {
  it('sends the amount in MINOR units', () => {
    expect(buildMoyasarRefundBody({ paymentId: 'p', amount: 45.5, currency: 'SAR' })).toEqual({ amount: 4550 });
  });
  /**
   * Sent explicitly rather than relying on the full-refund default, so a
   * bookkeeping mistake surfaces as a mismatch instead of quietly sending the
   * whole payment back.
   */
  it('always includes an explicit amount', () => {
    expect(Object.keys(buildMoyasarRefundBody({ paymentId: 'p', amount: 1, currency: 'SAR' }))).toEqual(['amount']);
  });
  it('sends no reference or idempotency field, because none is documented', () => {
    const b = buildMoyasarRefundBody({ paymentId: 'p', amount: 1, currency: 'SAR' });
    expect(b).not.toHaveProperty('reference');
    expect(b).not.toHaveProperty('given_id');
  });
});

describe('refundRequestIsValid', () => {
  it('requires a payment id and a positive amount', () => {
    expect(refundRequestIsValid({ paymentId: 'p', amount: 10, currency: 'SAR' })).toBe(true);
    expect(refundRequestIsValid({ paymentId: '', amount: 10, currency: 'SAR' })).toBe(false);
    expect(refundRequestIsValid({ paymentId: 'p', amount: 0, currency: 'SAR' })).toBe(false);
    expect(refundRequestIsValid({ paymentId: 'p', amount: -1, currency: 'SAR' })).toBe(false);
    expect(refundRequestIsValid({})).toBe(false);
  });
  /** An amount that rounds to zero halalas is not a refund. */
  it('rejects an amount too small to be a single minor unit', () => {
    expect(refundRequestIsValid({ paymentId: 'p', amount: 0.001, currency: 'SAR' })).toBe(false);
  });
});

describe('classifyMoyasarRefundResponse', () => {
  it('only calls a refund succeeded on a confirmed refunded status', () => {
    expect(classifyMoyasarRefundResponse(true, 200, { id: 'p', status: 'refunded' }).outcome).toBe('succeeded');
  });

  /**
   * THE core safety property. Anything not provably terminal must land in
   * 'pending' — never 'succeeded' (which lies to the customer) and never
   * 'failed' (which strands their money).
   */
  it('sends every ambiguous or undocumented state to pending', () => {
    for (const status of ['', 'paid', 'captured', 'initiated', 'in_progress', 'REFUND_QUEUED', undefined]) {
      expect(classifyMoyasarRefundResponse(true, 200, { status }).outcome).toBe('pending');
    }
    expect(classifyMoyasarRefundResponse(false, 0, {}).outcome).toBe('pending');   // network
    expect(classifyMoyasarRefundResponse(false, 500, {}).outcome).toBe('pending'); // server error
    expect(classifyMoyasarRefundResponse(false, 503, {}).outcome).toBe('pending');
    expect(classifyMoyasarRefundResponse(false, 429, {}).outcome).toBe('pending'); // rate limited
  });

  it('treats a definitive 4xx as a terminal failure needing a human', () => {
    const r = classifyMoyasarRefundResponse(false, 400, { type: 'invalid_request_error', message: 'Validation Failed' });
    expect(r.outcome).toBe('failed');
    expect(r.failureCode).toBe('http_400');
    expect(r.errorSafe).toContain('Validation Failed');
  });

  it('treats a 404 as terminal — a payment that does not exist is not retryable', () => {
    expect(classifyMoyasarRefundResponse(false, 404, {}).outcome).toBe('failed');
  });

  it('treats failed and voided payments as terminal rejections', () => {
    expect(classifyMoyasarRefundResponse(true, 200, { status: 'failed' }).outcome).toBe('failed');
    expect(classifyMoyasarRefundResponse(true, 200, { status: 'voided' }).outcome).toBe('failed');
  });

  it('carries the provider reference through on every outcome', () => {
    expect(classifyMoyasarRefundResponse(true, 200, { id: 'pay_9', status: 'refunded' }).providerRef).toBe('pay_9');
    expect(classifyMoyasarRefundResponse(false, 500, { id: 'pay_9' }).providerRef).toBe('pay_9');
  });
});

describe('resolveRefundFromPayment', () => {
  /**
   * This is what makes an automated retry safe at all. Moyasar documents no
   * idempotency on the refund endpoint, so before ANY retry the worker asks the
   * provider what actually happened.
   */
  it('reports succeeded when the payment is now refunded', () => {
    expect(resolveRefundFromPayment({ id: 'p', status: 'refunded' }, 4550).outcome).toBe('succeeded');
  });

  it('reports succeeded on a partial refund that already reached the amount', () => {
    // Moyasar flips `status` to refunded only on a FULL refund, so a partial one
    // is visible in the cumulative `refunded` figure and nowhere else.
    const r = resolveRefundFromPayment({ id: 'p', status: 'paid', refunded: 4550, refunded_at: 'now' }, 4550);
    expect(r.outcome).toBe('succeeded');
  });

  it('reports pending when nothing has been refunded, so a retry is safe', () => {
    const r = resolveRefundFromPayment({ id: 'p', status: 'paid', refunded: 0, refunded_at: null }, 4550);
    expect(r.outcome).toBe('pending');
    expect(needsHumanReview(r)).toBe(false);
  });

  /**
   * The one case that must never be retried automatically: Moyasar says
   * something was refunded but the amount does not reconcile. Retrying here is
   * exactly the action that would send the money twice.
   */
  it('parks an unreconcilable refund for a human instead of retrying it', () => {
    const r = resolveRefundFromPayment({ id: 'p', status: 'paid', refunded: 0, refunded_at: '2026-08-24T10:00:00Z' }, 4550);
    expect(r.outcome).toBe('pending');
    expect(r.failureCode).toBe('refund_ambiguous_needs_review');
    expect(needsHumanReview(r)).toBe(true);
  });

  it('does not call a partial refund short of the target a success', () => {
    const r = resolveRefundFromPayment({ id: 'p', status: 'paid', refunded: 1000 }, 4550);
    expect(r.outcome).toBe('pending');
  });

  it('reports failed for a payment that can never be refunded', () => {
    expect(resolveRefundFromPayment({ id: 'p', status: 'voided' }, 4550).outcome).toBe('failed');
    expect(resolveRefundFromPayment({ id: 'p', status: 'failed' }, 4550).outcome).toBe('failed');
  });

  it('never throws on a malformed payment', () => {
    expect(() => resolveRefundFromPayment({}, 4550)).not.toThrow();
    expect(resolveRefundFromPayment({}, 4550).outcome).toBe('pending');
  });
});

describe('safeMessage', () => {
  it('reads the documented error fields and never a raw payload', () => {
    expect(safeMessage({ type: 'api_error', message: 'Something went wrong' })).toBe('Something went wrong');
    expect(safeMessage({ errors: { amount: ['must be an integer'] } })).toContain('amount: must be an integer');
    expect(safeMessage({ source: { message: 'INSUFFICIENT FUNDS' } })).toBe('INSUFFICIENT FUNDS');
    expect(safeMessage({ type: 'rate_limit_error' })).toBe('rate_limit_error');
  });
  it('clamps to 200 characters and returns null when empty', () => {
    expect((safeMessage({ message: 'x'.repeat(400) }) ?? '').length).toBe(200);
    expect(safeMessage({})).toBeNull();
    expect(safeMessage({ message: '   ' })).toBeNull();
  });
});

describe('decideRefundLogging', () => {
  /**
   * Token fence: a non-`true` finalize result means this run wrote NOTHING, so
   * recording an outcome would persist a refund result that was never applied.
   */
  it('records only when the lease was provably still ours', () => {
    expect(decideRefundLogging(true, 'succeeded')).toEqual({ record: true, logStatus: 'success' });
    expect(decideRefundLogging(true, 'failed')).toEqual({ record: true, logStatus: 'failed' });
    expect(decideRefundLogging(true, 'pending')).toEqual({ record: true, logStatus: 'skipped' });
  });
  it('treats anything that is not exactly true as a lost lease', () => {
    for (const v of [false, null, undefined, 0, '', 'true', {}]) {
      expect(decideRefundLogging(v, 'succeeded')).toEqual({ record: false, reason: 'lost_lease' });
    }
  });
});

describe('mustReconcileBeforePost', () => {
  /**
   * claim_order_refund increments attempt_count BEFORE returning it, so the
   * first ever attempt arrives as 1. The boundary is > 1, not > 0.
   */
  it('lets the FIRST attempt post without a lookup', () => {
    expect(mustReconcileBeforePost(1)).toBe(false);
  });
  it('demands reconciliation on every retry', () => {
    expect(mustReconcileBeforePost(2)).toBe(true);
    expect(mustReconcileBeforePost(7)).toBe(true);
  });
  it('is safe on junk', () => {
    expect(mustReconcileBeforePost(undefined)).toBe(false);
    expect(mustReconcileBeforePost('x')).toBe(false);
    expect(mustReconcileBeforePost(NaN)).toBe(false);
  });
});

describe('decideAfterReconcile', () => {
  const refunded = { outcome: 'succeeded' as const, providerRef: 'p', failureCode: null, errorSafe: null };
  const nothingYet = { outcome: 'pending' as const, providerRef: 'p', failureCode: null, errorSafe: null };
  const ambiguous = { outcome: 'pending' as const, providerRef: 'p', failureCode: 'refund_ambiguous_needs_review', errorSafe: null };
  const dead = { outcome: 'failed' as const, providerRef: 'p', failureCode: 'payment_voided', errorSafe: null };

  /**
   * THE property this whole ordering exists for. A failed lookup is NOT
   * evidence that nothing was refunded, and treating it as permission to POST
   * is exactly how a customer gets paid twice.
   */
  it('refuses to post when the lookup could not be completed', () => {
    expect(decideAfterReconcile(null)).toEqual({ action: 'release', reason: 'reconcile_unavailable' });
  });

  it('posts ONLY when the provider positively reports nothing refunded', () => {
    expect(decideAfterReconcile(nothingYet)).toEqual({ action: 'post' });
  });

  it('settles rather than re-sending when money already moved', () => {
    expect(decideAfterReconcile(refunded)).toEqual({ action: 'settle', verdict: refunded });
  });

  it('settles rather than re-sending when the payment can never be refunded', () => {
    expect(decideAfterReconcile(dead)).toEqual({ action: 'settle', verdict: dead });
  });

  /** Unreconcilable is an answer too — and the answer is not "send it again". */
  it('settles an unreconcilable refund for human review instead of retrying', () => {
    const d = decideAfterReconcile(ambiguous);
    expect(d.action).toBe('settle');
    expect(needsHumanReview((d as { verdict: typeof ambiguous }).verdict)).toBe(true);
  });

  it('never returns post for anything except a clean nothing-refunded', () => {
    for (const prior of [null, refunded, dead, ambiguous]) {
      expect(decideAfterReconcile(prior).action).not.toBe('post');
    }
  });
});

describe('refundFinalStatus', () => {
  const mk = (outcome: 'succeeded' | 'failed' | 'pending', failureCode: string | null = null) =>
    ({ outcome, providerRef: 'p', failureCode, errorSafe: null });

  it('maps the two terminal outcomes straight through', () => {
    expect(refundFinalStatus(mk('succeeded'))).toBe('succeeded');
    expect(refundFinalStatus(mk('failed', 'http_400'))).toBe('failed');
  });

  it('releases an ordinary pending so a later run can re-claim it', () => {
    expect(refundFinalStatus(mk('pending'))).toBe('pending');
  });

  /**
   * The loop this prevents: 'pending' RELEASES the row, so writing it for an
   * unresolvable refund means every run reconciles, gets the same unresolvable
   * answer, releases, re-claims — forever, and nobody ever sees it. 'failed'
   * frees the one-live-refund slot and surfaces the row in
   * list_failed_order_refunds(), which is how expire_stale_order_refund_claims()
   * already handles a lease it cannot resolve.
   */
  it('parks an unresolvable refund as failed rather than releasing it', () => {
    expect(refundFinalStatus(mk('pending', 'refund_ambiguous_needs_review'))).toBe('failed');
  });

  it('never parks a Tap-shaped pending verdict, which carries no such code', () => {
    expect(refundFinalStatus(mk('pending', null))).toBe('pending');
  });
});
