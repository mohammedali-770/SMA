import { describe, it, expect } from 'vitest';
import {
  normalizeHookSecret, verifyStandardWebhook, parseSendSmsHookPayload,
  base64ToBytes, bytesToBase64, hmacSha256Base64, timingSafeEqual,
} from './authHook';

// A deterministic base64 signing key for tests (16 bytes).
const B64_KEY = bytesToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
const SECRET = `v1,whsec_${B64_KEY}`;
const NOW_MS = 1_700_000_000_000;
const TS = String(Math.floor(NOW_MS / 1000));

async function signHeaders(secret: string, id: string, ts: string, body: string): Promise<Record<string, string>> {
  const sig = await hmacSha256Base64(base64ToBytes(normalizeHookSecret(secret)), `${id}.${ts}.${body}`);
  return { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` };
}

describe('normalizeHookSecret', () => {
  it('strips the v1, and whsec_ prefixes', () => {
    expect(normalizeHookSecret(`v1,whsec_${B64_KEY}`)).toBe(B64_KEY);
    expect(normalizeHookSecret(`whsec_${B64_KEY}`)).toBe(B64_KEY);
    expect(normalizeHookSecret(B64_KEY)).toBe(B64_KEY);
  });
  it('handles null/empty safely', () => {
    expect(normalizeHookSecret(null)).toBe('');
    expect(normalizeHookSecret(undefined)).toBe('');
    expect(normalizeHookSecret('')).toBe('');
  });
});

describe('verifyStandardWebhook', () => {
  const body = JSON.stringify({ user: { phone: '966501234567' }, sms: { otp: '123456' } });

  it('accepts a correctly signed request', async () => {
    const headers = await signHeaders(SECRET, 'msg_1', TS, body);
    expect((await verifyStandardWebhook(SECRET, headers, body, { nowMs: NOW_MS })).ok).toBe(true);
  });

  it('accepts a Headers object, not just a plain record', async () => {
    const headers = new Headers(await signHeaders(SECRET, 'msg_1', TS, body));
    expect((await verifyStandardWebhook(SECRET, headers, body, { nowMs: NOW_MS })).ok).toBe(true);
  });

  it('accepts when webhook-signature lists several space-separated sigs', async () => {
    const headers = await signHeaders(SECRET, 'msg_1', TS, body);
    headers['webhook-signature'] = `v1,AAAAbadsigAAAA ${headers['webhook-signature']}`;
    expect((await verifyStandardWebhook(SECRET, headers, body, { nowMs: NOW_MS })).ok).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const headers = await signHeaders(SECRET, 'msg_1', TS, body);
    const r = await verifyStandardWebhook(SECRET, headers, body + 'x', { nowMs: NOW_MS });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('signature_mismatch');
  });

  it('rejects the wrong secret', async () => {
    const headers = await signHeaders(SECRET, 'msg_1', TS, body);
    const other = `whsec_${bytesToBase64(new Uint8Array(16).fill(9))}`;
    expect((await verifyStandardWebhook(other, headers, body, { nowMs: NOW_MS })).ok).toBe(false);
  });

  it('rejects missing headers', async () => {
    const r = await verifyStandardWebhook(SECRET, {}, body, { nowMs: NOW_MS });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_headers');
  });

  it('rejects an out-of-tolerance (replayed) timestamp', async () => {
    const oldTs = String(Math.floor(NOW_MS / 1000) - 3600);
    const headers = await signHeaders(SECRET, 'msg_1', oldTs, body);
    const r = await verifyStandardWebhook(SECRET, headers, body, { nowMs: NOW_MS });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('timestamp_out_of_tolerance');
  });

  it('fails closed when no secret is configured', async () => {
    const headers = await signHeaders(SECRET, 'msg_1', TS, body);
    const r = await verifyStandardWebhook('', headers, body, { nowMs: NOW_MS });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_secret');
  });
});

describe('parseSendSmsHookPayload', () => {
  it('extracts phone + otp from the official Supabase shape', () => {
    const r = parseSendSmsHookPayload(JSON.stringify({ user: { phone: '966501234567' }, sms: { otp: '123456' } }));
    expect(r).toEqual({ ok: true, data: { phone: '966501234567', otp: '123456' } });
  });
  it('accepts an already-parsed object', () => {
    expect(parseSendSmsHookPayload({ user: { phone: '966501234567' }, sms: { otp: '123456' } }).ok).toBe(true);
  });
  it('rejects missing phone/otp, wrong types, and junk without throwing', () => {
    expect(parseSendSmsHookPayload('{}').ok).toBe(false);
    expect(parseSendSmsHookPayload({ user: {}, sms: {} }).ok).toBe(false);
    expect(parseSendSmsHookPayload({ user: { phone: 966 }, sms: { otp: '1' } }).ok).toBe(false);
    expect(parseSendSmsHookPayload({ user: { phone: '  ' }, sms: { otp: '123456' } }).ok).toBe(false);
    expect(parseSendSmsHookPayload('not json').ok).toBe(false);
    expect(parseSendSmsHookPayload(null).ok).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('is true only for equal strings and rejects length mismatch', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});
