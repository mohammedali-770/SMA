/**
 * Supabase Auth "Send SMS" Hook — pure, testable verification + parsing.
 *
 * When customer login uses Supabase **Phone Auth**, Supabase Auth (GoTrue)
 * generates the login OTP itself and calls the configured *Send SMS Hook* to
 * DELIVER it. Those hook requests are signed with the Standard Webhooks scheme
 * (https://www.standardwebhooks.com), the same scheme Supabase documents for
 * auth hooks. We verify that signature ourselves with Web-standard crypto only
 * (no npm import) so this module runs under Deno at runtime AND is importable by
 * Vitest (node) for unit tests — mirroring `_shared/whatsapp.ts`.
 *
 * This module NEVER logs anything and NEVER stores the OTP. Supabase Auth stays
 * the sole login authority; this only proves the delivery request is genuinely
 * from our Supabase project and hands back the phone + Supabase-generated OTP.
 *
 * Signature scheme (Standard Webhooks):
 *   headers        : webhook-id, webhook-timestamp, webhook-signature
 *   signed content : `${id}.${timestamp}.${rawBody}`
 *   key            : base64decode(secret without the `v1,whsec_` prefix)
 *   expected sig   : base64(HMAC-SHA256(key, signedContent))
 *   webhook-signature is a space-separated list of `v1,<sig>` values; a
 *   timing-safe match against any one passes.
 */
const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// base64 <-> bytes (standard alphabet). atob/btoa exist in both Deno and Node.
// ---------------------------------------------------------------------------
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

/** HMAC-SHA256(keyBytes, message) → base64. */
export async function hmacSha256Base64(keyBytes: Uint8Array, message: string): Promise<string> {
  // Uint8Array is generic over its backing buffer from TS 5.7 on, and WebCrypto's
  // BufferSource only accepts an ArrayBuffer-backed view — a Uint8Array<ArrayBufferLike>
  // (potentially SharedArrayBuffer-backed) no longer assigns. Copy into a view that is
  // statically ArrayBuffer-backed. Runtime behaviour is unchanged; hook keys are tiny.
  const rawKey = new Uint8Array(keyBytes);
  const key = await crypto.subtle.importKey(
    'raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToBase64(sig);
}

/** Constant-time string comparison (avoids leaking match position via timing). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Strip the Supabase / Standard Webhooks secret prefix, returning the base64
 * signing key. Supabase presents the hook secret as `v1,whsec_<base64>`; the
 * standardwebhooks reference lib wants the base64 that follows `whsec_`. We
 * tolerate the prefix being present, absent, or partially present.
 */
export function normalizeHookSecret(secret: string | null | undefined): string {
  let s = String(secret ?? '').trim();
  if (s.startsWith('v1,')) s = s.slice(3);
  if (s.startsWith('whsec_')) s = s.slice('whsec_'.length);
  return s.trim();
}

export interface HookHeaders { id: string; timestamp: string; signature: string }

/** Pull the three Standard Webhooks headers (case-insensitive). Accepts a
 *  Headers object (Deno runtime) or a plain record (tests). */
export function readHookHeaders(headers: Headers | Record<string, string>): HookHeaders {
  const get = (k: string): string => {
    if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(k) ?? '';
    const rec = headers as Record<string, string>;
    const found = Object.keys(rec).find((h) => h.toLowerCase() === k);
    return found ? String(rec[found] ?? '') : '';
  };
  return {
    id: get('webhook-id'),
    timestamp: get('webhook-timestamp'),
    signature: get('webhook-signature'),
  };
}

export interface VerifyResult { ok: boolean; reason?: string }

/**
 * Verify a Standard Webhooks signature over `rawBody`. `toleranceSeconds`
 * bounds clock skew / replay (default 5 min); pass `nowMs` for deterministic
 * tests. Fails closed on any missing/oversized/mis-shaped input.
 */
export async function verifyStandardWebhook(
  secret: string | null | undefined,
  headers: Headers | Record<string, string>,
  rawBody: string,
  opts: { toleranceSeconds?: number; nowMs?: number } = {},
): Promise<VerifyResult> {
  const { id, timestamp, signature } = readHookHeaders(headers);
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' };

  const b64secret = normalizeHookSecret(secret);
  if (!b64secret) return { ok: false, reason: 'no_secret' };

  // Replay / clock-skew guard.
  const tolerance = opts.toleranceSeconds ?? 300;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - ts) > tolerance) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(b64secret);
    if (keyBytes.length === 0) return { ok: false, reason: 'bad_secret' };
  } catch {
    return { ok: false, reason: 'bad_secret' };
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = await hmacSha256Base64(keyBytes, signedContent);

  // webhook-signature: space-separated list of `v<ver>,<b64sig>` (or bare sig).
  for (const part of signature.split(' ')) {
    if (!part) continue;
    const comma = part.indexOf(',');
    const sig = comma >= 0 ? part.slice(comma + 1) : part;
    if (timingSafeEqual(sig, expected)) return { ok: true };
  }
  return { ok: false, reason: 'signature_mismatch' };
}

// ---------------------------------------------------------------------------
// Send SMS Hook payload → { phone, otp }
// ---------------------------------------------------------------------------
export interface SendSmsHookData { phone: string; otp: string }
export type ParseResult = { ok: true; data: SendSmsHookData } | { ok: false };

/**
 * Parse the official Supabase Send SMS Hook body, which has the shape
 * `{ user: { phone }, sms: { otp } }`. Supabase sends the phone without a
 * leading '+' (e.g. "966501234567"); normalization is the caller's job.
 * Returns `{ ok:false }` for anything that doesn't match — never throws.
 */
export function parseSendSmsHookPayload(raw: string | unknown): ParseResult {
  let obj: unknown;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return { ok: false }; }
  } else {
    obj = raw;
  }
  const o = (obj ?? {}) as Record<string, any>;
  const phone = o.user?.phone;
  const otp = o.sms?.otp;
  if (typeof phone !== 'string' || typeof otp !== 'string') return { ok: false };
  const p = phone.trim();
  const t = otp.trim();
  if (!p || !t) return { ok: false };
  return { ok: true, data: { phone: p, otp: t } };
}
