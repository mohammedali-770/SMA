/**
 * WhatsApp OTP — pure, provider-agnostic helpers.
 *
 * Like `_shared/lazywait.ts`, this module deliberately uses ONLY Web-standard
 * APIs (`crypto.subtle`, `crypto.getRandomValues`, `TextEncoder`, `btoa`) and no
 * Deno-only or npm imports, so it runs under Deno at runtime AND is importable by
 * Vitest (node) for unit tests. It NEVER logs anything and NEVER touches secrets
 * beyond receiving the HMAC pepper as an argument.
 *
 * Security: OTPs are generated with a CSPRNG (never Math.random) and are only
 * ever stored/compared as an HMAC-SHA256 digest — the plaintext code never lives
 * anywhere except the outbound WhatsApp message.
 */
const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Phone normalization → E.164 (KSA-aware). Rejects junk / injection.
// ---------------------------------------------------------------------------
export type NormalizedPhone = { ok: true; e164: string } | { ok: false };

/** Normalize to E.164. Saudi mobiles become +9665XXXXXXXX; other inputs must
 *  already be valid E.164. Anything that isn't a clean phone is rejected. */
export function normalizePhoneE164(input: string | null | undefined): NormalizedPhone {
  if (!input) return { ok: false };
  const raw = String(input).trim();
  // Fail closed on anything that isn't clearly phone punctuation — letters,
  // quotes, semicolons, etc. never belong in a phone number (anti-injection).
  if (!/^[\d+\s().-]+$/.test(raw)) return { ok: false };
  // Keep only digits and '+'; drop formatting (spaces/dashes/parentheses).
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  // KSA conversions.
  if (!d.startsWith('+')) {
    if (d.startsWith('966')) d = '+' + d;
    else if (d.startsWith('05') && d.length === 10) d = '+966' + d.slice(1);
    else if (d.startsWith('5') && d.length === 9) d = '+966' + d;
    else if (d.length >= 8 && d.length <= 15) d = '+' + d; // assume already-international
    else return { ok: false };
  }
  // Final E.164 shape: '+' then 8–15 digits, first digit 1–9.
  if (!/^\+[1-9]\d{7,14}$/.test(d)) return { ok: false };
  // KSA sanity: a +966 number must be a 9-digit national part starting with 5.
  if (d.startsWith('+966') && !/^\+9665\d{8}$/.test(d)) return { ok: false };
  return { ok: true, e164: d };
}

// ---------------------------------------------------------------------------
// OTP generation (CSPRNG, uniform, 6 digits)
// ---------------------------------------------------------------------------
/** Cryptographically-secure uniform 6-digit code as a zero-padded string. */
export function generateOtp(): string {
  const bound = 1_000_000;
  // Rejection sampling to avoid modulo bias.
  const max = Math.floor(0x1_0000_0000 / bound) * bound;
  const buf = new Uint32Array(1);
  let n = 0;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= max);
  return String(n % bound).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// OTP hashing (HMAC-SHA256 → base64). The pepper is a server-only secret.
// ---------------------------------------------------------------------------
function toBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

/** HMAC-SHA256(pepper, `${phone}:${purpose}:${otp}:${salt}`) → base64. Binding
 *  the phone + purpose + per-row salt means a hash can't be replayed elsewhere. */
export async function hashOtp(
  pepper: string, phone: string, purpose: string, otp: string, salt: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${phone}:${purpose}:${otp}:${salt}`));
  return toBase64(sig);
}

/** Random salt (hex) for a challenge row. */
export function randomSalt(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 → lowercase hex (for the webhook X-Hub-Signature-256 check). */
export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison (avoids leaking match position via timing). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Meta Cloud API — Authentication template message body
// ---------------------------------------------------------------------------
export interface OtpTemplateInput {
  to: string;           // E.164 (may include '+'); provider wants digits only
  templateName: string;
  langCode: string;     // e.g. 'ar' or 'en_US'
  otp: string;
  hasCopyButton?: boolean;
}

/**
 * Build the Meta WhatsApp **Authentication** template message. The code goes in
 * the body parameter and (for copy-code / one-tap templates) is repeated in the
 * URL button parameter at index 0 — the structure Meta documents for OTP auth
 * templates. Only documented fields are emitted; nothing is invented.
 */
export function buildOtpTemplateMessage(input: OtpTemplateInput): Record<string, unknown> {
  const components: Record<string, unknown>[] = [
    { type: 'body', parameters: [{ type: 'text', text: input.otp }] },
  ];
  if (input.hasCopyButton !== false) {
    components.push({
      type: 'button', sub_type: 'url', index: '0',
      parameters: [{ type: 'text', text: input.otp }],
    });
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: input.to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.langCode },
      components,
    },
  };
}

// ---------------------------------------------------------------------------
// Provider response sanitization (safe to persist / never contains our secrets)
// ---------------------------------------------------------------------------
export interface SanitizedProviderResponse {
  message_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

/** Keep only the provider message id + a safe error summary; drop everything
 *  else (recipient echoes, trace ids, tokens never appear here anyway). */
export function sanitizeProviderResponse(resp: unknown): SanitizedProviderResponse {
  const r = (resp ?? {}) as Record<string, any>;
  const messageId = Array.isArray(r.messages) && r.messages[0]?.id ? String(r.messages[0].id) : null;
  const err = r.error && typeof r.error === 'object' ? r.error as Record<string, any> : null;
  return {
    message_id: messageId,
    error_code: err && (err.code ?? err.type) != null ? String(err.code ?? err.type) : null,
    error_message: err && err.message ? String(err.message).slice(0, 300) : null,
  };
}
