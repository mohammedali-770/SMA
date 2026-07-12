/**
 * Tap Payments helpers (pure, web-standard only — no Deno APIs — so vitest can
 * import it, mirroring _shared/whatsapp.ts). Covers exactly the minimal Hosted
 * Checkout flow: build a Charge request, validate the webhook hashstring, format
 * amounts, map statuses, and sanitize provider responses. NOTHING here logs or
 * returns a secret; the secret key is only ever used as the HMAC key / Bearer
 * token by the caller.
 *
 * Webhook hashstring (from Tap Guides "Validate the webhook (hashstring)"):
 *   toBeHashed = x_id{id}x_amount{amount}x_currency{currency}
 *              + x_gateway_reference{reference.gateway||""}
 *              + x_payment_reference{reference.payment}
 *              + x_status{status}x_created{transaction.created}
 *   HMAC-SHA256(toBeHashed, secretKey) as lowercase hex, compared timing-safe
 *   to the `hashstring` the webhook delivers. `amount` is rounded to the ISO
 *   currency decimals (SAR -> 2, e.g. "45.00").
 */

const encoder = new TextEncoder();

/** ISO decimal places per currency (SAR = 2). Defaults to 2 for anything else. */
export function currencyDecimals(currency: string): number {
  switch ((currency || '').toUpperCase()) {
    case 'KWD':
    case 'BHD':
    case 'OMR':
    case 'JOD':
      return 3;
    default:
      return 2; // SAR, AED, QAR, USD, EUR, GBP, EGP …
  }
}

/** Amount formatted to the currency's ISO decimals (Tap uses major units). */
export function formatTapAmount(amount: number, currency = 'SAR'): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return (0).toFixed(currencyDecimals(currency));
  return n.toFixed(currencyDecimals(currency));
}

function hexFromBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export async function hmacSha256Hex(message: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return hexFromBytes(sig);
}

/** Constant-time string comparison (avoid signature timing oracles). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface WebhookHashInput {
  id: string;
  amount: string;          // already formatted to ISO decimals
  currency: string;
  gatewayReference: string; // charge.reference.gateway || ''
  paymentReference: string; // charge.reference.payment || ''
  status: string;
  created: string;          // charge.transaction.created
}

/** Build the exact string Tap hashes for a CHARGE webhook and HMAC it (hex). */
export function computeChargeWebhookHash(input: WebhookHashInput, secretKey: string): Promise<string> {
  const toBeHashed =
    `x_id${input.id}` +
    `x_amount${input.amount}` +
    `x_currency${input.currency}` +
    `x_gateway_reference${input.gatewayReference}` +
    `x_payment_reference${input.paymentReference}` +
    `x_status${input.status}` +
    `x_created${input.created}`;
  return hmacSha256Hex(toBeHashed, secretKey);
}

/** Pull the hashstring fields out of a Tap charge object (webhook or retrieve). */
export function chargeHashFields(charge: Record<string, unknown>): WebhookHashInput {
  const reference = (charge.reference ?? {}) as Record<string, unknown>;
  const transaction = (charge.transaction ?? {}) as Record<string, unknown>;
  const currency = String(charge.currency ?? 'SAR');
  return {
    id: String(charge.id ?? ''),
    amount: formatTapAmount(Number(charge.amount ?? 0), currency),
    currency,
    gatewayReference: reference.gateway != null ? String(reference.gateway) : '',
    paymentReference: reference.payment != null ? String(reference.payment) : '',
    status: String(charge.status ?? ''),
    created: transaction.created != null ? String(transaction.created) : '',
  };
}

// ---------------------------------------------------------------------------
// Saudi phone normalization for the Tap customer.phone object.
// ---------------------------------------------------------------------------
export interface TapPhone { country_code: string; number: string; }

/**
 * Normalize a Saudi mobile to { country_code:'966', number:'5XXXXXXXX' }.
 * Accepts 05XXXXXXXX, 5XXXXXXXX, +9665XXXXXXXX, 9665XXXXXXXX. Returns null on junk.
 */
export function normalizeSaudiPhone(input: unknown): TapPhone | null {
  if (typeof input !== 'string') return null;
  let d = input.trim().replace(/[\s()-]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  // Strip a leading 966 country code, then a leading 0.
  if (d.startsWith('966')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  // Must now be a 9-digit KSA mobile starting with 5.
  if (!/^5\d{8}$/.test(d)) return null;
  return { country_code: '966', number: d };
}

// ---------------------------------------------------------------------------
// Charge request builder (Hosted Checkout, src_all).
// ---------------------------------------------------------------------------
export interface BuildChargeParams {
  amount: number;                 // server order total
  currency: string;               // 'SAR'
  descriptor?: string;            // statement_descriptor (optional)
  description: string;            // "Spicy Meal order <order_number>"
  referenceTransaction: string;   // our unique attempt reference
  referenceOrder: string;         // local order number
  idempotent: string;             // Tap idempotency string (dedup)
  sourceId: string;               // 'src_all'
  merchantId: string;
  expiryMinutes: number;          // 5..60
  langCode: 'ar' | 'en';
  postUrl: string;                // webhook
  redirectUrl: string;            // return page
  customer: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: TapPhone | null;
  };
}

/**
 * The minimal confirmed Charge body: customer_initiated + 3DS on + save_card off,
 * src_all hosted page, expiry, post (webhook) + redirect (return page), and Tap's
 * official `idempotent` string so a repeated create returns the FIRST charge
 * instead of charging the customer twice. No optional/unsupported fields.
 */
export function buildTapChargePayload(p: BuildChargeParams): Record<string, unknown> {
  const customer: Record<string, unknown> = {
    first_name: p.customer.firstName || 'Customer',
    last_name: p.customer.lastName || '-',
  };
  if (p.customer.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.customer.email)) {
    customer.email = p.customer.email;
  }
  if (p.customer.phone) customer.phone = p.customer.phone;

  const expiry = Math.min(60, Math.max(5, Math.round(p.expiryMinutes || 30)));

  const body: Record<string, unknown> = {
    amount: Number(formatTapAmount(p.amount, p.currency)),
    currency: p.currency,
    customer_initiated: true,
    threeDSecure: true,
    save_card: false,
    description: p.description,
    idempotent: p.idempotent,
    reference: { transaction: p.referenceTransaction, order: p.referenceOrder },
    receipt: { email: false, sms: false },
    customer,
    merchant: { id: p.merchantId },
    source: { id: p.sourceId || 'src_all' },
    transaction: { expiry: { period: expiry, type: 'MINUTE' } },
    post: { url: p.postUrl },
    redirect: { url: p.redirectUrl },
    lang_code: p.langCode === 'ar' ? 'ar' : 'en',
  };
  if (p.descriptor && p.descriptor.trim()) body.statement_descriptor = p.descriptor.trim().slice(0, 22);
  return body;
}

// ---------------------------------------------------------------------------
// Config resolution — fail-closed key selection (pure, so it is unit-tested).
// ---------------------------------------------------------------------------
export interface ResolvedTapConfig {
  ok: boolean;
  reason?: 'disabled' | 'not_tap' | 'missing_key' | 'missing_merchant';
  mode: 'test' | 'live';
  secretKey: string;
  merchantId: string;
  currency: string;
  sourceId: string;
  expiryMinutes: number;
  descriptor: string;
}

/**
 * Resolve the effective Tap config from integration_settings. Fail-closed:
 *   - provider must be enabled and provider_name 'tap';
 *   - the key for the SELECTED mode must exist (no silent live→test fallback);
 *   - merchant_id must be set.
 * `secretKey` is chosen strictly by the stored/selected `mode` — callers pass the
 * mode of the ATTEMPT when verifying an old charge so switching Admin test↔live
 * never breaks retrieval of prior attempts.
 */
export function resolveTapConfig(
  enabled: boolean,
  providerName: string | null,
  publicConfig: Record<string, unknown>,
  secretConfig: Record<string, unknown>,
  modeOverride?: 'test' | 'live',
): ResolvedTapConfig {
  const mode: 'test' | 'live' =
    modeOverride ?? (String(publicConfig.mode ?? 'test').toLowerCase() === 'live' ? 'live' : 'test');
  const secretKey = String(
    (mode === 'live' ? secretConfig.live_secret_key : secretConfig.test_secret_key) ?? '',
  ).trim();
  const merchantId = String(publicConfig.merchant_id ?? '').trim();
  const currency = String(publicConfig.currency ?? 'SAR').trim() || 'SAR';
  const sourceId = String(publicConfig.source_id ?? 'src_all').trim() || 'src_all';
  const rawExpiry = Number(publicConfig.transaction_expiry_minutes ?? 30);
  const expiryMinutes = Number.isFinite(rawExpiry) ? Math.min(60, Math.max(5, Math.round(rawExpiry))) : 30;
  const descriptor = String(publicConfig.statement_descriptor ?? '').trim();
  const base = { mode, secretKey, merchantId, currency, sourceId, expiryMinutes, descriptor };

  if (!enabled) return { ok: false, reason: 'disabled', ...base };
  if ((providerName ?? '').toLowerCase() !== 'tap') return { ok: false, reason: 'not_tap', ...base };
  if (!secretKey) return { ok: false, reason: 'missing_key', ...base };
  if (!merchantId) return { ok: false, reason: 'missing_merchant', ...base };
  return { ok: true, ...base };
}

// ---------------------------------------------------------------------------
// Status mapping — only CAPTURED is paid; UNKNOWN is never paid.
// ---------------------------------------------------------------------------
export type TapOutcome = 'paid' | 'pending' | 'failed' | 'cancelled' | 'expired' | 'unknown';

/** Map a Tap charge status to our coarse outcome + a customer-safe message key. */
export function mapTapStatus(status: unknown): { outcome: TapOutcome; messageKey: string } {
  switch (String(status ?? '').toUpperCase()) {
    case 'CAPTURED':
      return { outcome: 'paid', messageKey: 'paySuccess' };
    case 'INITIATED':
      return { outcome: 'pending', messageKey: 'payPending' };
    case 'CANCELLED':
    case 'ABANDONED':
      return { outcome: 'cancelled', messageKey: 'payCancelled' };
    case 'TIMEDOUT':
      return { outcome: 'expired', messageKey: 'payExpired' };
    case 'DECLINED':
      return { outcome: 'failed', messageKey: 'payDeclined' };
    case 'FAILED':
    case 'RESTRICTED':
    case 'VOID':
      return { outcome: 'failed', messageKey: 'payFailed' };
    default: // UNKNOWN or anything unrecognised — NEVER paid.
      return { outcome: 'unknown', messageKey: 'payUnknown' };
  }
}

/**
 * Keep only safe, non-sensitive fields from a Tap charge response for auditing.
 * Drops raw card data (esp. first_six), tokens, and everything unlisted.
 */
export function sanitizeTapResponse(resp: unknown): Record<string, unknown> {
  const c = (resp ?? {}) as Record<string, unknown>;
  const reference = (c.reference ?? {}) as Record<string, unknown>;
  const transaction = (c.transaction ?? {}) as Record<string, unknown>;
  const response = (c.response ?? {}) as Record<string, unknown>;
  const card = (c.card ?? {}) as Record<string, unknown>;
  const merchant = (c.merchant ?? {}) as Record<string, unknown>;
  const source = (c.source ?? {}) as Record<string, unknown>;
  return {
    id: c.id ?? null,
    status: c.status ?? null,
    amount: c.amount ?? null,
    currency: c.currency ?? null,
    live_mode: c.live_mode ?? null,
    reference: {
      gateway: reference.gateway ?? null,
      payment: reference.payment ?? null,
      transaction: reference.transaction ?? null,
      order: reference.order ?? null,
    },
    transaction: { created: transaction.created ?? null },
    response: { code: response.code ?? null, message: response.message ?? null },
    // Safe display fields only — NEVER first_six / full PAN / CVV.
    card: { scheme: card.scheme ?? null, brand: card.brand ?? null, last_four: card.last_four ?? null },
    payment_method: source.payment_method ?? null,
    merchant: { id: merchant.id ?? null },
  };
}
