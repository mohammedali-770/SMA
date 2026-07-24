import { describe, expect, it } from 'vitest';

import {
  buildRefundBody, classifyRefundResponse, refundRequestIsValid, safeMessage,
} from './tapRefund.ts';

/**
 * The refund classifier decides whether a customer's money moved. The property
 * under test throughout: an outcome is reported as 'succeeded' ONLY when the
 * provider confirmed it, and anything uncertain resolves to 'pending' (retry)
 * rather than to 'failed' (stranding the money) or 'succeeded' (lying).
 */

describe('classifyRefundResponse — confirmed success', () => {
  it('succeeds only on a terminal REFUNDED status', () => {
    const v = classifyRefundResponse(true, 200, { id: 're_1', status: 'REFUNDED' });
    expect(v.outcome).toBe('succeeded');
    expect(v.providerRef).toBe('re_1');
    expect(v.failureCode).toBeNull();
  });

  it('does NOT succeed on an in-flight refund', () => {
    for (const status of ['PENDING', 'IN_PROGRESS', 'INITIATED']) {
      expect(classifyRefundResponse(true, 200, { id: 're_1', status }).outcome, status)
        .toBe('pending');
    }
  });

  it('does NOT succeed on an undocumented status', () => {
    // The critical default: an unrecognised status must never be read as success.
    expect(classifyRefundResponse(true, 200, { id: 're_1', status: 'SOMETHING_NEW' }).outcome)
      .toBe('pending');
    expect(classifyRefundResponse(true, 200, {}).outcome).toBe('pending');
  });
});

describe('classifyRefundResponse — terminal rejections', () => {
  it('fails on a definitive provider rejection', () => {
    for (const status of ['FAILED', 'DECLINED', 'CANCELLED', 'VOID', 'REJECTED']) {
      const v = classifyRefundResponse(true, 200, { id: 're_1', status });
      expect(v.outcome, status).toBe('failed');
      expect(v.failureCode, status).toBe(`refund_${status.toLowerCase()}`);
    }
  });

  it('fails on a definitive 4xx', () => {
    const v = classifyRefundResponse(false, 400, { errors: [{ code: '2107', description: 'Invalid charge' }] });
    expect(v.outcome).toBe('failed');
    expect(v.failureCode).toBe('http_400');
    expect(v.errorSafe).toBe('Invalid charge');
  });
});

describe('classifyRefundResponse — uncertainty is always retryable', () => {
  it('keeps a rate-limited request pending', () => {
    expect(classifyRefundResponse(false, 429, {}).outcome).toBe('pending');
  });

  it('keeps provider outages pending', () => {
    for (const code of [500, 502, 503, 504]) {
      expect(classifyRefundResponse(false, code, {}).outcome, String(code)).toBe('pending');
    }
  });

  it('keeps a transport failure pending', () => {
    // httpStatus 0 is how the worker reports a timeout / network error: the
    // refund MAY have been accepted by Tap, so it must be reconciled, not guessed.
    const v = classifyRefundResponse(false, 0, {});
    expect(v.outcome).toBe('pending');
    expect(v.failureCode).toBeNull();
  });
});

describe('safeMessage', () => {
  it('reads only documented human-readable fields', () => {
    expect(safeMessage({ errors: [{ description: 'Charge already refunded' }] }))
      .toBe('Charge already refunded');
    expect(safeMessage({ errors: [{ code: '2107' }] })).toBe('code 2107');
    expect(safeMessage({ message: 'Unauthorized' })).toBe('Unauthorized');
  });

  it('returns null rather than inventing a message', () => {
    expect(safeMessage({})).toBeNull();
    expect(safeMessage({ errors: [] })).toBeNull();
    expect(safeMessage({ errors: [{ description: '   ' }] })).toBeNull();
  });

  it('bounds the stored message', () => {
    const long = safeMessage({ message: 'x'.repeat(500) });
    expect(long).not.toBeNull();
    expect(long!.length).toBe(200);
  });

  it('never surfaces card or token fields', () => {
    // Only description/code/message are read, so a payload carrying card data
    // cannot leak into our tables through this path.
    const msg = safeMessage({
      card: { first_six: '424242', last_four: '4242' },
      token: 'tok_secret', message: 'Declined',
    });
    expect(msg).toBe('Declined');
  });
});

describe('buildRefundBody', () => {
  it('carries our deterministic key as the merchant reference', () => {
    const body = buildRefundBody({
      chargeId: 'chg_1', amount: 45.5, currency: 'sar',
      reference: 'refund_abc', reason: 'order_could_not_be_delivered_to_branch',
    });
    expect(body.charge_id).toBe('chg_1');
    expect(body.amount).toBe(45.5);
    expect(body.currency).toBe('SAR');
    expect(body.reference).toEqual({ merchant: 'refund_abc' });
  });
});

describe('refundRequestIsValid', () => {
  it('requires a real charge reference and a positive amount', () => {
    expect(refundRequestIsValid({ chargeId: 'chg_1', amount: 10 })).toBe(true);
    expect(refundRequestIsValid({ chargeId: '', amount: 10 })).toBe(false);
    expect(refundRequestIsValid({ chargeId: '   ', amount: 10 })).toBe(false);
    expect(refundRequestIsValid({ chargeId: 'chg_1', amount: 0 })).toBe(false);
    expect(refundRequestIsValid({ chargeId: 'chg_1', amount: -5 })).toBe(false);
    expect(refundRequestIsValid({ amount: 10 })).toBe(false);
  });
});
