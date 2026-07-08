/**
 * Geidea payment-gateway helpers (signatures + host resolution).
 *
 * Signature spec (from https://docs.geidea.net):
 *   - Create Session: base64( HMAC-SHA256(
 *       publicKey + amount + currency + merchantReferenceId + timestamp,
 *       key = apiPassword ) )
 *   - Callback/webhook: base64( HMAC-SHA256(
 *       publicKey + amount + currency + orderId + status + merchantReferenceId + timestamp,
 *       key = apiPassword ) )
 *
 * `amount` is the 2-decimal, dot-separated string (e.g. "44.00"). The API
 * password is the HMAC key AND the Basic-auth password — it is a secret and
 * lives only in integration_settings.secret_config (read server-side).
 */

const encoder = new TextEncoder();

function base64FromBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function hmacSha256Base64(message: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return base64FromBytes(sig);
}

/** Geidea amounts are formatted with exactly 2 decimals, no thousands separator. */
export function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

/** Signature for the server-to-server Create Session request. */
export function createSessionSignature(p: {
  publicKey: string;
  amount: string;
  currency: string;
  merchantReferenceId: string;
  timestamp: string;
  apiPassword: string;
}): Promise<string> {
  const data = `${p.publicKey}${p.amount}${p.currency}${p.merchantReferenceId}${p.timestamp}`;
  return hmacSha256Base64(data, p.apiPassword);
}

/** Expected signature for a callback/webhook payload (to compare against `signature`). */
export function callbackSignature(p: {
  publicKey: string;
  amount: string;
  currency: string;
  orderId: string;
  status: string;
  merchantReferenceId: string;
  timestamp: string;
  apiPassword: string;
}): Promise<string> {
  const data =
    `${p.publicKey}${p.amount}${p.currency}${p.orderId}${p.status}${p.merchantReferenceId}${p.timestamp}`;
  return hmacSha256Base64(data, p.apiPassword);
}

/** Constant-time string comparison (avoid signature timing oracles). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * API base host for the Create Session call. Defaults to KSA production; the
 * exact environment (sandbox vs prod, country) is configurable in
 * integration_settings.public_config so it can be confirmed against the
 * sandbox without a code change.
 */
export function geideaApiBase(publicConfig: Record<string, unknown>): string {
  const explicit = typeof publicConfig.apiBaseUrl === 'string' ? publicConfig.apiBaseUrl : '';
  if (explicit) return explicit.replace(/\/+$/, '');
  const country = String(publicConfig.country ?? 'ksa').toLowerCase();
  switch (country) {
    case 'egypt':
    case 'eg':
      return 'https://api.merchant.geidea.net';
    case 'uae':
    case 'ae':
      return 'https://api.geidea.ae';
    default:
      return 'https://api.ksamerchant.geidea.net';
  }
}

/**
 * Hosted Payment Page base for the redirect checkout URL
 * (`${hppBase}/hpp/checkout/?${sessionId}`). Configurable for the same reason.
 */
export function geideaHppBase(publicConfig: Record<string, unknown>): string {
  const explicit = typeof publicConfig.checkoutBaseUrl === 'string' ? publicConfig.checkoutBaseUrl : '';
  if (explicit) return explicit.replace(/\/+$/, '');
  const country = String(publicConfig.country ?? 'ksa').toLowerCase();
  switch (country) {
    case 'egypt':
    case 'eg':
      return 'https://www.merchant.geidea.net';
    case 'uae':
    case 'ae':
      return 'https://www.geidea.ae';
    default:
      return 'https://www.ksamerchant.geidea.net';
  }
}
