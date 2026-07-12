import { describe, it, expect } from 'vitest';
import {
  formatTapAmount, currencyDecimals, normalizeSaudiPhone, buildTapChargePayload,
  computeChargeWebhookHash, chargeHashFields, mapTapStatus, sanitizeTapResponse, timingSafeEqual,
  resolveTapConfig, isAdminTestCharge,
} from './tap.ts';

describe('formatTapAmount / currencyDecimals', () => {
  it('formats SAR to 2 decimals (major units)', () => {
    expect(formatTapAmount(45, 'SAR')).toBe('45.00');
    expect(formatTapAmount(45.5, 'SAR')).toBe('45.50');
    expect(formatTapAmount(45.005, 'SAR')).toBe('45.01');
  });
  it('uses 3 decimals for KWD/BHD/OMR/JOD, 2 otherwise', () => {
    expect(currencyDecimals('KWD')).toBe(3);
    expect(currencyDecimals('SAR')).toBe(2);
    expect(formatTapAmount(3, 'BHD')).toBe('3.000');
  });
  it('is safe on non-finite input', () => {
    expect(formatTapAmount(NaN, 'SAR')).toBe('0.00');
  });
});

describe('normalizeSaudiPhone', () => {
  it('accepts the four KSA shapes', () => {
    expect(normalizeSaudiPhone('0501234567')).toEqual({ country_code: '966', number: '501234567' });
    expect(normalizeSaudiPhone('501234567')).toEqual({ country_code: '966', number: '501234567' });
    expect(normalizeSaudiPhone('+966501234567')).toEqual({ country_code: '966', number: '501234567' });
    expect(normalizeSaudiPhone('966501234567')).toEqual({ country_code: '966', number: '501234567' });
    expect(normalizeSaudiPhone('+966 50 123 4567')).toEqual({ country_code: '966', number: '501234567' });
  });
  it('rejects junk / non-mobile / injection', () => {
    expect(normalizeSaudiPhone('12345')).toBeNull();
    expect(normalizeSaudiPhone('0400000000')).toBeNull(); // not a 5-prefixed mobile
    expect(normalizeSaudiPhone('abc')).toBeNull();
    expect(normalizeSaudiPhone(null)).toBeNull();
    expect(normalizeSaudiPhone('05012345678')).toBeNull(); // too long
  });
});

describe('buildTapChargePayload', () => {
  const base = {
    amount: 45.5, currency: 'SAR', description: 'Spicy Meal order SM-1',
    referenceTransaction: 'txn_abc', referenceOrder: 'SM-1', idempotent: 'txn_abc',
    sourceId: 'src_all', merchantId: 'mid_1', expiryMinutes: 30, langCode: 'en' as const,
    postUrl: 'https://x/functions/v1/payment-webhook', redirectUrl: 'https://x/functions/v1/payment-return?order=o1',
    customer: { firstName: 'Sara', lastName: 'A', email: 'sara@example.com', phone: { country_code: '966', number: '501234567' } },
  };
  it('sets the mandatory security fields and src_all', () => {
    const b = buildTapChargePayload(base);
    expect(b.customer_initiated).toBe(true);
    expect(b.threeDSecure).toBe(true);
    expect(b.save_card).toBe(false);
    expect((b.source as any).id).toBe('src_all');
    expect(b.idempotent).toBe('txn_abc');
    expect((b.reference as any)).toEqual({ transaction: 'txn_abc', order: 'SM-1' });
    expect(b.amount).toBe(45.5);
    expect((b.post as any).url).toContain('payment-webhook');
    expect((b.redirect as any).url).toContain('payment-return');
    expect((b.transaction as any).expiry).toEqual({ period: 30, type: 'MINUTE' });
  });
  it('omits email when invalid, keeps phone', () => {
    const b = buildTapChargePayload({ ...base, customer: { firstName: 'A', lastName: 'B', email: 'not-an-email', phone: base.customer.phone } });
    expect((b.customer as any).email).toBeUndefined();
    expect((b.customer as any).phone).toEqual({ country_code: '966', number: '501234567' });
  });
  it('clamps expiry to 5..60 minutes', () => {
    expect(((buildTapChargePayload({ ...base, expiryMinutes: 1 }).transaction as any).expiry.period)).toBe(5);
    expect(((buildTapChargePayload({ ...base, expiryMinutes: 999 }).transaction as any).expiry.period)).toBe(60);
  });
  it('attaches metadata only when provided', () => {
    expect(buildTapChargePayload(base).metadata).toBeUndefined();
    expect(buildTapChargePayload({ ...base, metadata: { purpose: 'admin_test' } }).metadata).toEqual({ purpose: 'admin_test' });
  });
});

describe('isAdminTestCharge', () => {
  it('recognises the admin test charge by reference.order or metadata.purpose', () => {
    expect(isAdminTestCharge({ reference: { order: 'admin_test' } })).toBe(true);
    expect(isAdminTestCharge({ metadata: { purpose: 'admin_test' } })).toBe(true);
  });
  it('is false for a normal order charge', () => {
    expect(isAdminTestCharge({ reference: { order: 'SM-2026-000123' }, metadata: {} })).toBe(false);
    expect(isAdminTestCharge({})).toBe(false);
    expect(isAdminTestCharge(null)).toBe(false);
  });
});

describe('computeChargeWebhookHash / chargeHashFields', () => {
  const charge = {
    id: 'chg_1', amount: 45, currency: 'SAR',
    status: 'CAPTURED',
    reference: { gateway: 'gw1', payment: 'pay1' },
    transaction: { created: '1699999999999' },
  };
  it('is deterministic and secret-sensitive', async () => {
    const f = chargeHashFields(charge);
    const h1 = await computeChargeWebhookHash(f, 'sk_test_A');
    const h2 = await computeChargeWebhookHash(f, 'sk_test_A');
    const h3 = await computeChargeWebhookHash(f, 'sk_test_B');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
  it('formats amount to 2dp and treats missing gateway ref as empty', () => {
    const f = chargeHashFields({ ...charge, amount: 45.5, reference: { payment: 'pay1' } });
    expect(f.amount).toBe('45.50');
    expect(f.gatewayReference).toBe('');
    expect(f.paymentReference).toBe('pay1');
  });
});

describe('timingSafeEqual', () => {
  it('true only for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('mapTapStatus', () => {
  it('only CAPTURED is paid; UNKNOWN never paid', () => {
    expect(mapTapStatus('CAPTURED').outcome).toBe('paid');
    expect(mapTapStatus('INITIATED').outcome).toBe('pending');
    expect(mapTapStatus('DECLINED').outcome).toBe('failed');
    expect(mapTapStatus('CANCELLED').outcome).toBe('cancelled');
    expect(mapTapStatus('ABANDONED').outcome).toBe('cancelled');
    expect(mapTapStatus('TIMEDOUT').outcome).toBe('expired');
    expect(mapTapStatus('VOID').outcome).toBe('failed');
    expect(mapTapStatus('RESTRICTED').outcome).toBe('failed');
    expect(mapTapStatus('UNKNOWN').outcome).toBe('unknown');
    expect(mapTapStatus('anything-else').outcome).toBe('unknown');
  });
});

describe('resolveTapConfig (fail-closed)', () => {
  const pub = { merchant_id: 'mid', mode: 'test', currency: 'SAR', source_id: 'src_all', transaction_expiry_minutes: 30 };
  const sec = { test_secret_key: 'sk_test_x', live_secret_key: 'sk_live_y' };
  it('selects the key for the active mode', () => {
    expect(resolveTapConfig(true, 'tap', pub, sec).ok).toBe(true);
    expect(resolveTapConfig(true, 'tap', pub, sec).secretKey).toBe('sk_test_x');
    expect(resolveTapConfig(true, 'tap', { ...pub, mode: 'live' }, sec).secretKey).toBe('sk_live_y');
  });
  it('fails closed when disabled / not tap / missing key / missing merchant', () => {
    expect(resolveTapConfig(false, 'tap', pub, sec)).toMatchObject({ ok: false, reason: 'disabled' });
    expect(resolveTapConfig(true, 'geidea', pub, sec)).toMatchObject({ ok: false, reason: 'not_tap' });
    expect(resolveTapConfig(true, 'tap', { ...pub, mode: 'live' }, { test_secret_key: 'sk_test_x' }))
      .toMatchObject({ ok: false, reason: 'missing_key' }); // no silent live->test fallback
    expect(resolveTapConfig(true, 'tap', { ...pub, merchant_id: '' }, sec)).toMatchObject({ ok: false, reason: 'missing_merchant' });
  });
  it('honors the mode override (verify old attempt regardless of current admin mode)', () => {
    expect(resolveTapConfig(true, 'tap', { ...pub, mode: 'test' }, sec, 'live').secretKey).toBe('sk_live_y');
  });
  it('clamps expiry to 5..60', () => {
    expect(resolveTapConfig(true, 'tap', { ...pub, transaction_expiry_minutes: 3 }, sec).expiryMinutes).toBe(5);
    expect(resolveTapConfig(true, 'tap', { ...pub, transaction_expiry_minutes: 120 }, sec).expiryMinutes).toBe(60);
  });
});

describe('sanitizeTapResponse', () => {
  it('keeps only safe fields and drops first_six / raw card', () => {
    const s = sanitizeTapResponse({
      id: 'chg_1', status: 'CAPTURED', amount: 45, currency: 'SAR', live_mode: false,
      reference: { gateway: 'g', payment: 'p', transaction: 't', order: 'o' },
      transaction: { created: '123', url: 'https://secret' },
      response: { code: '000', message: 'Captured' },
      card: { id: 'card_x', first_six: '411111', last_four: '1111', scheme: 'VISA', brand: 'VISA' },
      merchant: { id: 'm1' },
      source: { payment_method: 'VISA', object: 'token' },
      secret_field: 'should-not-be-here',
    });
    expect((s.card as any).first_six).toBeUndefined();
    expect((s.card as any).last_four).toBe('1111');
    expect((s.card as any).scheme).toBe('VISA');
    expect((s as any).secret_field).toBeUndefined();
    expect((s.reference as any).order).toBe('o');
    expect((s.response as any).code).toBe('000');
    expect(s.live_mode).toBe(false);
  });
});
