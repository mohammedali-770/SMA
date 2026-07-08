import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildCreateOrderPayload, classifyLazywaitError, computeBackoffMs, hmacSha256Hex,
  MAX_SYNC_ATTEMPTS, normalizePhone, round2, verifyWebhookSignature,
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
