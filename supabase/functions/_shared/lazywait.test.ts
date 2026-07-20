import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildCreateOrderPayload, classifyCreateOrderResult, classifyLazywaitError, computeBackoffMs,
  computePosNextAttempt, extractOrderRef, hmacSha256Hex, MAX_POS_ATTEMPTS, MAX_SYNC_ATTEMPTS,
  normalizePhone, parseRetryAfterMs, POS_DEADLINE_MINUTES, POS_RETRY_OFFSETS_MIN, round2,
  shouldResendCreateOrder, STALE_SYNC_TIMEOUT_MINUTES, verifyWebhookSignature,
} from './lazywait';

const items = [{ menuItemId: 'ITEM_1', name: 'Burger', quantity: 2, unitPrice: 25 }];

describe('buildCreateOrderPayload', () => {
  it('builds the confirmed pickup payload with server-trusted fields + source LWAPI', () => {
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'Ahmed', items });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual({
      client_id: 'C', branch_id: 'B', order_type: 'pickup',
      order_items: [{ menu_item_id: 'ITEM_1', name: 'Burger', quantity: 2, price: 25 }],
      customer_name: 'Ahmed', source: 'LWAPI',
    });
    // never sends price_id / addons / delivery / customer phone
    expect(JSON.stringify(r.payload)).not.toMatch(/price_id|addon|delivery|customer_cell|customer_id/i);
  });

  it('BLOCKS delivery orders (schema unconfirmed)', () => {
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'delivery', customerName: 'A', items });
    expect(r).toEqual({ ok: false, blockedReason: 'delivery_schema_unconfirmed' });
  });

  it('BLOCKS when branch mapping is missing', () => {
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: null, orderType: 'pickup', customerName: 'A', items });
    expect(r).toEqual({ ok: false, blockedReason: 'missing_branch_mapping' });
  });

  it('BLOCKS when any item is missing its lazywait_item_id', () => {
    const bad = [{ menuItemId: null, name: 'X', quantity: 1, unitPrice: 5 }];
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items: bad });
    expect(r).toEqual({ ok: false, blockedReason: 'missing_item_mapping' });
  });

  it('BLOCKS an empty cart and rounds prices to 2dp', () => {
    expect(buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items: [] }))
      .toEqual({ ok: false, blockedReason: 'no_items' });
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{ menuItemId: 'I', name: 'N', quantity: 1, unitPrice: 25.005 }] });
    expect(r.ok && (r.payload.order_items as { price: number }[])[0].price).toBe(25.01);
  });
});

describe('classifyLazywaitError', () => {
  it('classifies terminal vs retryable per the confirmed error codes', () => {
    expect(classifyLazywaitError(200).kind).toBe('ok');
    expect(classifyLazywaitError(429).kind).toBe('retryable');   // rate limit
    expect(classifyLazywaitError(0).kind).toBe('retryable');     // network/timeout
    expect(classifyLazywaitError(503).kind).toBe('retryable');   // 5xx
    expect(classifyLazywaitError(401).kind).toBe('terminal');    // INVALID_KEY
    expect(classifyLazywaitError(401).reason).toBe('auth_invalid_key');
    expect(classifyLazywaitError(403, 'LICENSE_EXPIRED').reason).toBe('license_expired');
    expect(classifyLazywaitError(400).kind).toBe('terminal');    // bad payload/mapping
  });
});

describe('verifyWebhookSignature (HMAC-SHA256 hex)', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ order: { order_ref: 'r1', order_status_id: 'new-order' } });

  it('matches an independent Node HMAC reference and accepts it', async () => {
    const ref = createHmac('sha256', secret).update(body).digest('hex');
    expect(await hmacSha256Hex(body, secret)).toBe(ref); // Web Crypto == node crypto
    expect(await verifyWebhookSignature([body], ref, secret)).toBe(true);
  });

  it('rejects a tampered signature and a missing signature', async () => {
    const bad = createHmac('sha256', 'wrong').update(body).digest('hex');
    expect(await verifyWebhookSignature([body], bad, secret)).toBe(false);
    expect(await verifyWebhookSignature([body], null, secret)).toBe(false);
    expect(await verifyWebhookSignature([body], 'abc', '')).toBe(false); // no secret
  });
});

describe('computeBackoffMs', () => {
  it('is exponential (30s,60s,120s…), capped at 1h; jitter injectable', () => {
    const noJitter = () => 0.5; // -> jitter factor 1.0
    expect(computeBackoffMs(1, noJitter)).toBe(30_000);
    expect(computeBackoffMs(2, noJitter)).toBe(60_000);
    expect(computeBackoffMs(3, noJitter)).toBe(120_000);
    expect(computeBackoffMs(MAX_SYNC_ATTEMPTS, noJitter)).toBeLessThanOrEqual(3_600_000);
  });
});

describe('normalizePhone (KSA E.164)', () => {
  it('normalizes common KSA formats', () => {
    expect(normalizePhone('0501234567')).toBe('+966501234567');
    expect(normalizePhone('+966501234567')).toBe('+966501234567');
    expect(normalizePhone('966501234567')).toBe('+966501234567');
    expect(normalizePhone('501234567')).toBe('+966501234567');
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('round2', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(25.005)).toBe(25.01);
    expect(round2(25)).toBe(25);
  });
});

describe('shouldResendCreateOrder (duplicate-send guard)', () => {
  it('NEVER re-sends Create Order once a Lazywait ref exists', () => {
    expect(shouldResendCreateOrder({ lazywait_ref: 'ORDER_REF_1' })).toBe(false);
  });
  it('allows the first send when no ref is stored yet', () => {
    expect(shouldResendCreateOrder({ lazywait_ref: null })).toBe(true);
    expect(shouldResendCreateOrder({ lazywait_ref: '' })).toBe(true);
    expect(shouldResendCreateOrder({})).toBe(true);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds, keeping a valid 0 (retry now)', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
    expect(parseRetryAfterMs('0')).toBe(0);              // must NOT become null
  });
  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-07-08T00:00:00Z');
    expect(parseRetryAfterMs('Wed, 08 Jul 2026 00:00:30 GMT', now)).toBe(30_000);
    // A past date clamps to 0 rather than going negative.
    expect(parseRetryAfterMs('Wed, 08 Jul 2026 00:00:00 GMT', now + 5_000)).toBe(0);
  });
  it('returns null for absent/blank/garbage values (falls back to backoff)', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
  });
});

describe('STALE_SYNC_TIMEOUT_MINUTES', () => {
  it('is a safe 5–10 min lease window, longer than the worker network budget', () => {
    expect(STALE_SYNC_TIMEOUT_MINUTES).toBeGreaterThanOrEqual(5);
    expect(STALE_SYNC_TIMEOUT_MINUTES).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Customer-confirmation lifecycle helpers
// ---------------------------------------------------------------------------
describe('extractOrderRef', () => {
  it('returns a trimmed non-empty order_ref, else null', () => {
    expect(extractOrderRef({ order: { order_ref: 'REF_1' } })).toBe('REF_1');
    expect(extractOrderRef({ order: { order_ref: '  REF_2 ' } })).toBe('REF_2');
    expect(extractOrderRef({ order: { order_ref: '' } })).toBeNull();
    expect(extractOrderRef({ order: { order_ref: null } })).toBeNull();
    expect(extractOrderRef({ order: {} })).toBeNull();
    expect(extractOrderRef({})).toBeNull();
    expect(extractOrderRef(null)).toBeNull();
    expect(extractOrderRef('nonsense')).toBeNull();
  });
});

describe('classifyCreateOrderResult (customer-confirmation safety)', () => {
  it('OK only for 2xx + success:true + a usable order_ref', () => {
    const r = classifyCreateOrderResult({ status: 200, data: { success: true, order: { order_ref: 'R1' } } });
    expect(r.kind).toBe('ok');
    expect(r.orderRef).toBe('R1');
  });
  it('2xx + success:true but NO ref is AMBIGUOUS (missing_ref) — never resent', () => {
    const r = classifyCreateOrderResult({ status: 200, data: { success: true, order: {} } });
    expect(r.kind).toBe('ambiguous');
    expect(r.confirmationReason).toBe('missing_ref');
    expect(r.orderRef).toBeNull();
  });
  it('2xx without success/ref is AMBIGUOUS (ambiguous_response)', () => {
    const r = classifyCreateOrderResult({ status: 200, data: { foo: 'bar' } });
    expect(r.kind).toBe('ambiguous');
    expect(r.confirmationReason).toBe('ambiguous_response');
  });
  it('429 is the ONLY safe_retry (explicit not-processed)', () => {
    expect(classifyCreateOrderResult({ status: 429 }).kind).toBe('safe_retry');
  });
  it('status 0 timeout vs network map to distinct ambiguous reasons', () => {
    expect(classifyCreateOrderResult({ status: 0, error: 'timeout' }).confirmationReason).toBe('timeout');
    expect(classifyCreateOrderResult({ status: 0, error: 'connection reset' }).confirmationReason).toBe('connection');
    expect(classifyCreateOrderResult({ status: 0, error: 'timeout' }).kind).toBe('ambiguous');
  });
  it('5xx is AMBIGUOUS (provider_5xx) — the POS may have created it', () => {
    const r = classifyCreateOrderResult({ status: 503 });
    expect(r.kind).toBe('ambiguous');
    expect(r.confirmationReason).toBe('provider_5xx');
  });
  it('401/403/other-4xx are TERMINAL known failures (never confirmation_required)', () => {
    expect(classifyCreateOrderResult({ status: 401 }).kind).toBe('terminal');
    expect(classifyCreateOrderResult({ status: 403 }).kind).toBe('terminal');
    expect(classifyCreateOrderResult({ status: 400 }).kind).toBe('terminal');
    expect(classifyCreateOrderResult({ status: 422 }).kind).toBe('terminal');
  });
});

describe('computePosNextAttempt (5 attempts / 10-minute deadline)', () => {
  const t0 = Date.parse('2026-07-20T00:00:00.000Z');
  const deadline = t0 + POS_DEADLINE_MINUTES * 60_000;

  it('exposes the fixed schedule contract', () => {
    expect(MAX_POS_ATTEMPTS).toBe(5);
    expect(POS_DEADLINE_MINUTES).toBe(10);
    expect([...POS_RETRY_OFFSETS_MIN]).toEqual([0, 1, 3, 6, 9]);
  });
  it('schedules attempt N+1 at started + offset[N] within the window', () => {
    expect(computePosNextAttempt(t0, 1, deadline)).toEqual({ final: false, nextAttemptAtMs: t0 + 1 * 60_000 });
    expect(computePosNextAttempt(t0, 2, deadline)).toEqual({ final: false, nextAttemptAtMs: t0 + 3 * 60_000 });
    expect(computePosNextAttempt(t0, 3, deadline)).toEqual({ final: false, nextAttemptAtMs: t0 + 6 * 60_000 });
    expect(computePosNextAttempt(t0, 4, deadline)).toEqual({ final: false, nextAttemptAtMs: t0 + 9 * 60_000 });
  });
  it('is FINAL once the attempt ceiling is hit', () => {
    expect(computePosNextAttempt(t0, 5, deadline)).toEqual({ final: true });
    expect(computePosNextAttempt(t0, 6, deadline)).toEqual({ final: true });
  });
  it('is FINAL when the next scheduled attempt would fall past the deadline', () => {
    const tightDeadline = t0 + 2 * 60_000; // only room for +1min
    expect(computePosNextAttempt(t0, 1, tightDeadline)).toEqual({ final: false, nextAttemptAtMs: t0 + 60_000 });
    expect(computePosNextAttempt(t0, 2, tightDeadline)).toEqual({ final: true }); // +3min > deadline
  });
  it('with no deadline, only the attempt ceiling bounds it', () => {
    expect(computePosNextAttempt(t0, 4, null)).toEqual({ final: false, nextAttemptAtMs: t0 + 9 * 60_000 });
    expect(computePosNextAttempt(t0, 5, null)).toEqual({ final: true });
  });
});
