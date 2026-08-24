/**
 * Moyasar helpers (pure, web-standard only — no Deno APIs — so vitest can import
 * them, mirroring _shared/tap.ts and _shared/whatsapp.ts). Nothing here logs or
 * returns a secret; the secret key is only ever used as the HTTP Basic username
 * by the caller.
 *
 * WHY THE INVOICE, NOT A CHARGE
 * Moyasar's authentication page states, without qualification: "Sending
 * cardholder data to the merchant backend is prohibited and will result in
 * canceling the agreement between Moyasar and the merchant in addition to the
 * immediate termination of the service."
 * (https://docs.moyasar.com/api/authentication)
 *
 * So `POST /v1/payments` with `source[type]=creditcard` — which carries the PAN,
 * CVC and expiry — is NOT a server-side option for us. The server-side flow that
 * corresponds to Tap's hosted checkout is the INVOICE: we create an invoice, the
 * customer is redirected to Moyasar's own checkout page, and the card never
 * touches our infrastructure. That is what this module builds.
 *
 * TWO IDS, NOT ONE — the shape difference from Tap
 * Tap gives one id (the charge) that is created up front and refunded later.
 * Moyasar gives two:
 *   - the INVOICE id, known when we open the attempt, which owns the hosted URL;
 *   - the PAYMENT id, which only exists once the customer actually pays, and
 *     which is the thing `POST /v1/payments/:id/refund` takes.
 * We store the invoice id in `payment_records.provider_checkout_ref` and the
 * payment id in `provider_ref`, so the refund path and the (provider,
 * provider_ref) confirmation idempotency both key off the payment — exactly as
 * they already do for a Tap charge — with no change to any shared RPC.
 *
 * AMOUNTS ARE MINOR UNITS. Moyasar takes "a positive integer representing the
 * payment amount in the smallest currency unit" — 1.00 SAR is `100`, not `1`.
 * Tap takes major units. Getting this wrong is a 100x charge, so the conversion
 * lives here behind unit tests and is never done inline at a call site.
 */

const encoder = new TextEncoder();

/** Base URL for every Moyasar REST call. */
export const MOYASAR_API_BASE = 'https://api.moyasar.com/v1';

// ---------------------------------------------------------------------------
// Amounts — minor units ("smallest currency unit"). SAR -> halalas.
// ---------------------------------------------------------------------------

/**
 * ISO 4217 minor-unit exponent per currency. SAR = 2 (halalas). Defaults to 2,
 * which is correct for every currency Spicy Meal can plausibly bill in; the
 * three-decimal Gulf currencies and the zero-decimal ones are listed explicitly
 * so a future expansion does not silently mis-scale by 10x or 100x.
 */
export function currencyExponent(currency: string): number {
  switch ((currency || '').toUpperCase()) {
    case 'KWD':
    case 'BHD':
    case 'OMR':
    case 'JOD':
    case 'TND':
      return 3;
    case 'JPY':
    case 'KRW':
      return 0;
    default:
      return 2; // SAR, AED, QAR, USD, EUR, GBP, EGP …
  }
}

/**
 * Convert a major-unit amount (what `orders.total` holds: 45.5 SAR) into the
 * integer minor-unit amount Moyasar wants (4550 halalas).
 *
 * Scale FIRST, then clear the binary representation error, then round half-up.
 * The order matters. `45.55 * 100` is 4554.999999999999 in IEEE-754: truncating
 * gives 4554 — a silent one-halala shortfall — and even `Math.round` on a value
 * that landed just below a .5 boundary can go the wrong way. Fixing the scaled
 * value to six decimals collapses the representation error (4554.999999999999
 * becomes 4555.000000, 100.49999999999999 becomes 100.500000) without touching
 * any digit that carries real money, and the rounding is then unambiguous.
 *
 * A shortfall is not a rounding curiosity here: it is an amount mismatch, and
 * validateAndConfirmMoyasarPayment refuses to confirm a mismatched amount — so a
 * customer would be charged for an order that never completes.
 *
 * `orders.total` is `numeric(10,2)`, so a third decimal cannot reach this
 * function from an order in the first place; the extra precision is defence for
 * the callers that are not an order total.
 *
 * Non-finite or negative input returns 0, which every caller treats as invalid.
 */
export function toMinorUnits(amount: number, currency = 'SAR'): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return 0;
  const scale = 10 ** currencyExponent(currency);
  return Math.round(Number((n * scale).toFixed(6)));
}

/** Convert Moyasar's integer minor units back into major units (4550 -> 45.5). */
export function fromMinorUnits(minor: number, currency = 'SAR'): number {
  const n = Number(minor);
  if (!Number.isFinite(n)) return 0;
  const exp = currencyExponent(currency);
  return Number((n / 10 ** exp).toFixed(exp));
}

/**
 * True when two amounts are the same money, comparing in MINOR UNITS.
 * Comparison is integer-to-integer, so no float equality is ever relied on.
 */
export function amountsMatch(majorUnits: number, minorUnits: number, currency = 'SAR'): boolean {
  const expected = toMinorUnits(majorUnits, currency);
  const actual = Number(minorUnits);
  return Number.isInteger(actual) && expected === actual && expected > 0;
}

// ---------------------------------------------------------------------------
// Authentication — HTTP Basic, key as username, EMPTY password.
// ---------------------------------------------------------------------------

/** Base64 of a byte string, without depending on Node's Buffer. */
function base64(input: string): string {
  const bytes = encoder.encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa is available in Deno and in the browser/vitest environments we run in.
  return btoa(binary);
}

/**
 * Moyasar authenticates with HTTP Basic where the API key is the USERNAME and
 * "the password must be kept empty" (https://docs.moyasar.com/api/authentication).
 * The trailing colon is therefore load-bearing: `sk_test_x` and `sk_test_x:`
 * base64-encode to different credentials and only the second one authenticates.
 */
export function basicAuthHeader(apiKey: string): string {
  return `Basic ${base64(`${apiKey}:`)}`;
}

/** Constant-time string comparison (avoid secret-token timing oracles). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Config resolution — fail-closed key selection (pure, so it is unit-tested).
// ---------------------------------------------------------------------------

export type MoyasarMode = 'test' | 'live';

export interface ResolvedMoyasarConfig {
  ok: boolean;
  reason?: 'disabled' | 'not_moyasar' | 'missing_key' | 'key_mode_mismatch' | 'missing_webhook_secret';
  mode: MoyasarMode;
  secretKey: string;
  /** Publishable key for the selected mode. Client-safe by design; may be blank. */
  publishableKey: string;
  webhookSecret: string;
  currency: string;
  expiryMinutes: number;
  descriptor: string;
}

/** Moyasar key prefixes, per https://docs.moyasar.com/api/authentication. */
export const SECRET_KEY_PREFIX: Record<MoyasarMode, string> = {
  test: 'sk_test_',
  live: 'sk_live_',
};
export const PUBLISHABLE_KEY_PREFIX: Record<MoyasarMode, string> = {
  test: 'pk_test_',
  live: 'pk_live_',
};

/** True when a key string carries the prefix Moyasar documents for that mode. */
export function keyMatchesMode(key: string, mode: MoyasarMode, kind: 'secret' | 'publishable' = 'secret'): boolean {
  const prefix = kind === 'secret' ? SECRET_KEY_PREFIX[mode] : PUBLISHABLE_KEY_PREFIX[mode];
  return typeof key === 'string' && key.startsWith(prefix);
}

/**
 * Resolve the effective Moyasar config from integration_settings. Fail-closed:
 *   - the provider must be enabled and provider_name 'moyasar';
 *   - the key for the SELECTED mode must exist (no silent live -> test fallback);
 *   - a webhook secret must exist, because `secret_token` is the ONLY thing
 *     authenticating an inbound webhook (see verifyWebhookSecretToken);
 *   - the key must carry the prefix for the mode it is filed under.
 *
 * That last check has no Tap equivalent and is deliberate. Tap's key slots are
 * opaque strings, so a live key pasted into the test slot is undetectable and
 * would charge real cards from an interface labelled TEST. Moyasar's keys are
 * self-describing (`sk_test_` / `sk_live_`), so we can refuse that outright
 * rather than discovering it from a customer's statement.
 *
 * `secretKey` is chosen strictly by the stored/selected `mode` — callers pass
 * the mode of the ATTEMPT when verifying an older payment, so switching Admin
 * test<->live never breaks retrieval of prior attempts.
 */
export function resolveMoyasarConfig(
  enabled: boolean,
  providerName: string | null,
  publicConfig: Record<string, unknown>,
  secretConfig: Record<string, unknown>,
  modeOverride?: MoyasarMode,
): ResolvedMoyasarConfig {
  const mode: MoyasarMode =
    modeOverride ?? (String(publicConfig.mode ?? 'test').toLowerCase() === 'live' ? 'live' : 'test');
  // NAMESPACED KEY NAMES, and the reason matters.
  //
  // `integration_settings` holds ONE row per provider_type, and
  // upsert_integration_settings MERGES secret_config (`old || new`) rather than
  // replacing it — so keys the new payload does not mention survive a save.
  // That merge only helps if the two gateways use DIFFERENT names: had Moyasar
  // reused Tap's `test_secret_key` / `live_secret_key`, saving Moyasar
  // credentials would overwrite Tap's by collision, and every refund still
  // queued for Tap would become impossible to execute.
  //
  // With these names both gateways' credentials coexist in the one row, so
  // switching the provider is reversible and in-flight work at the old gateway
  // stays serviceable. Nothing is stored under the old names — no Moyasar
  // credential exists anywhere — so this costs nothing to adopt.
  const secretKey = String(
    (mode === 'live' ? secretConfig.moyasar_live_secret_key : secretConfig.moyasar_test_secret_key) ?? '',
  ).trim();
  const publishableKey = String(
    (mode === 'live'
      ? publicConfig.moyasar_live_publishable_key
      : publicConfig.moyasar_test_publishable_key) ?? '',
  ).trim();
  // Moyasar's dashboard keeps test and live entirely separate, so a webhook
  // registered against the live account carries a different secret from the test
  // one. Prefer a mode-specific secret when the operator has configured one and
  // fall back to a single shared value, so a merchant who only runs one webhook
  // is not forced to fill both slots.
  const webhookSecret = String(
    (mode === 'live'
      ? secretConfig.moyasar_live_webhook_secret_token
      : secretConfig.moyasar_test_webhook_secret_token)
    ?? secretConfig.moyasar_webhook_secret_token
    ?? '',
  ).trim();
  const currency = String(publicConfig.currency ?? 'SAR').trim().toUpperCase() || 'SAR';
  const rawExpiry = Number(publicConfig.invoice_expiry_minutes ?? 30);
  const expiryMinutes = Number.isFinite(rawExpiry) ? Math.min(60, Math.max(5, Math.round(rawExpiry))) : 30;
  const descriptor = String(publicConfig.statement_descriptor ?? '').trim();
  const base = { mode, secretKey, publishableKey, webhookSecret, currency, expiryMinutes, descriptor };

  if (!enabled) return { ok: false, reason: 'disabled', ...base };
  if ((providerName ?? '').toLowerCase() !== 'moyasar') return { ok: false, reason: 'not_moyasar', ...base };
  if (!secretKey) return { ok: false, reason: 'missing_key', ...base };
  if (!keyMatchesMode(secretKey, mode, 'secret')) return { ok: false, reason: 'key_mode_mismatch', ...base };
  if (!webhookSecret) return { ok: false, reason: 'missing_webhook_secret', ...base };
  return { ok: true, ...base };
}

// ---------------------------------------------------------------------------
// Invoice request builder (hosted checkout).
// ---------------------------------------------------------------------------

export interface BuildInvoiceParams {
  amount: number;                 // MAJOR units — the server-trusted order total
  currency: string;               // 'SAR'
  /**
   * Customer-safe text only — Moyasar renders `description` on the hosted
   * checkout page the customer sees. NEVER embed the internal SM-… order number
   * here; the verification binding lives in metadata + invoice_id, not this
   * field. (Same rule as the Tap charge description — Issue #94.)
   */
  description: string;
  /** Our unique per-attempt reference (sm_<uuid>). */
  referenceTransaction: string;
  /**
   * Opaque PER-ORDER reference: 'ORD-<order uuid fragment>' for the direct-order
   * path, 'CS-<session uuid fragment>' for the checkout-session path. NEVER the
   * internal SM-… order number.
   */
  referenceOrder: string;
  expiryMinutes: number;          // 5..60
  /** Where the customer lands after paying successfully. */
  successUrl: string;
  /** Where the customer lands if they press back out of the hosted page. */
  backUrl: string;
  /** ISO-8601 instant the invoice stops being payable. */
  expiresAtIso: string;
  metadata?: Record<string, string>;
}

/**
 * Build the Create-Invoice body.
 *
 * Only documented fields are sent. `metadata` carries our two opaque references
 * so a human reconciling in the Moyasar dashboard can tie an invoice back to an
 * attempt — but note that metadata is NOT part of the verification binding,
 * because Moyasar does not document metadata propagating from an invoice to the
 * payment that settles it. The binding that IS load-bearing is
 * `payment.invoice_id === the invoice id we stored`, which Moyasar sets itself
 * and a client cannot influence. See moyasarVerify.ts.
 *
 * `amount` is emitted in MINOR units. Moyasar rejects an invoice under 100
 * minor units (1.00 SAR); the caller checks the total is positive and the
 * server-side amount check in validateAndConfirm re-compares independently.
 *
 * `callback_url` IS DELIBERATELY NOT SENT, and the omission is the considered
 * choice rather than an oversight. Moyasar documents it as "an endpoint on your
 * server that will get a POST request with the INVOICE object when the invoice
 * is paid" — a bare invoice body. It is NOT the dashboard/API webhook, so it
 * carries no `secret_token` and there is nothing on it we could authenticate.
 * Pointing it at payment-webhook would mean either (a) the function rejects
 * every one of those POSTs as unauthenticated, which is just noise at a payment
 * endpoint, or (b) we accept an unauthenticated POST as a reason to go make
 * outbound API calls, which hands any stranger a lever on our infrastructure.
 *
 * Two channels already cover confirmation and both are authenticated: the
 * registered `payment_paid` webhook, which arrives with a `secret_token` and a
 * payment carrying `invoice_id`, and the app's own call to payment-verify after
 * the redirect. Neither is trusted on its own — both re-fetch server-side. A
 * third, unauthenticatable channel adds no safety and some risk.
 */
export function buildInvoicePayload(p: BuildInvoiceParams): Record<string, unknown> {
  const currency = (p.currency || 'SAR').toUpperCase();
  const metadata: Record<string, string> = {
    reference_transaction: p.referenceTransaction,
    reference_order: p.referenceOrder,
    ...(p.metadata ?? {}),
  };

  const body: Record<string, unknown> = {
    amount: toMinorUnits(p.amount, currency),
    currency,
    description: p.description,
    success_url: p.successUrl,
    back_url: p.backUrl,
    expired_at: p.expiresAtIso,
    metadata,
  };
  return body;
}

/** Clamp an expiry to Moyasar-safe bounds and render the ISO instant. */
export function invoiceExpiryIso(nowMs: number, expiryMinutes: number): string {
  const minutes = Math.min(60, Math.max(5, Math.round(Number(expiryMinutes) || 30)));
  return new Date(nowMs + minutes * 60_000).toISOString();
}

/**
 * True when an invoice/payment is the admin dashboard's isolated test invoice
 * (not linked to any Spicy Meal order). Recognised by our own metadata so the
 * webhook can ignore it and never touch order or payment state.
 */
export function isAdminTestInvoice(obj: unknown): boolean {
  const o = (obj ?? {}) as Record<string, unknown>;
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  return String(meta.purpose ?? '') === 'admin_test'
    || String(meta.reference_order ?? '') === 'admin_test';
}

// ---------------------------------------------------------------------------
// Status mapping — only `paid`/`captured` is money we hold. UNKNOWN is never paid.
// ---------------------------------------------------------------------------

export type MoyasarOutcome = 'paid' | 'pending' | 'failed' | 'cancelled' | 'expired' | 'refunded' | 'unknown';

/**
 * Map a Moyasar PAYMENT status to our coarse outcome + a customer-safe message
 * key. The eight documented statuses are at
 * https://docs.moyasar.com/api/payments/payment-status-reference.
 *
 * `authorized` maps to 'pending', not 'paid': an authorized payment reserves
 * funds but, in Moyasar's own words, "the cardholder is not charged yet". We
 * never place a manual-capture invoice, so seeing one means something is
 * configured differently than we think — which is a reason to hold, not to feed
 * an order to the kitchen.
 *
 * `verified` is the tokenization card-check status, not a sale. Also pending.
 */
export function mapMoyasarPaymentStatus(status: unknown): { outcome: MoyasarOutcome; messageKey: string } {
  switch (String(status ?? '').toLowerCase()) {
    case 'paid':
    case 'captured':
      return { outcome: 'paid', messageKey: 'paySuccess' };
    case 'initiated':
    case 'authorized':
    case 'verified':
      return { outcome: 'pending', messageKey: 'payPending' };
    case 'failed':
      return { outcome: 'failed', messageKey: 'payDeclined' };
    case 'voided':
      return { outcome: 'cancelled', messageKey: 'payCancelled' };
    case 'refunded':
      return { outcome: 'refunded', messageKey: 'payRefunded' };
    default: // anything unrecognised — NEVER paid.
      return { outcome: 'unknown', messageKey: 'payUnknown' };
  }
}

/**
 * Map a Moyasar INVOICE status. Invoices add `canceled`, `on_hold` and
 * `expired` to the payment set (https://docs.moyasar.com/api/invoices/01-create-invoice).
 * `on_hold` is deliberately 'pending': it is not a terminal state and closing
 * the attempt on it would strand a payment that may still complete.
 */
export function mapMoyasarInvoiceStatus(status: unknown): { outcome: MoyasarOutcome; messageKey: string } {
  switch (String(status ?? '').toLowerCase()) {
    case 'paid':
      return { outcome: 'paid', messageKey: 'paySuccess' };
    case 'initiated':
    case 'on_hold':
      return { outcome: 'pending', messageKey: 'payPending' };
    case 'failed':
      return { outcome: 'failed', messageKey: 'payDeclined' };
    case 'canceled':
    case 'cancelled':
    case 'voided':
      return { outcome: 'cancelled', messageKey: 'payCancelled' };
    case 'expired':
      return { outcome: 'expired', messageKey: 'payExpired' };
    case 'refunded':
      return { outcome: 'refunded', messageKey: 'payRefunded' };
    default:
      return { outcome: 'unknown', messageKey: 'payUnknown' };
  }
}

// ---------------------------------------------------------------------------
// Webhook authentication — a shared secret in the BODY, not a signature.
// ---------------------------------------------------------------------------

/**
 * Moyasar authenticates a webhook with a `secret_token` field inside the JSON
 * body — "a password you need to validate on your server to make sure the
 * notification is coming from moyasar"
 * (https://docs.moyasar.com/guides/dashboard/setting-up-webhooks). There is NO
 * HMAC and NO signature header; the webhook reference documents `secret_token`
 * as a field of the event object and nothing else.
 *
 * THIS IS WEAKER THAN TAP'S HASHSTRING AND THE DIFFERENCE MATTERS.
 * A bearer secret in a request body proves only that the sender knows the
 * secret. It does not bind the secret to the payload, so it cannot detect a
 * tampered body the way an HMAC over the charge fields does — anyone who ever
 * obtains the token (a log, a proxy, a misrouted request) can post an arbitrary
 * "paid" event. The mitigation is architectural, not cryptographic, and it is
 * the same one the Tap path already uses: this check only decides whether we
 * BOTHER to look, and the webhook body is never trusted as evidence of payment.
 * Confirmation always comes from a server-to-server fetch of the payment with
 * our own secret key (moyasarVerify.ts), so a forged webhook achieves nothing
 * beyond making us perform a lookup that will not confirm.
 *
 * Compared timing-safe. Returns false for a missing/blank configured secret so
 * an unconfigured provider can never be spoofed into accepting everything.
 */
export function verifyWebhookSecretToken(provided: unknown, configured: string): boolean {
  const expected = String(configured ?? '');
  if (!expected) return false;
  const got = provided == null ? '' : String(provided);
  if (!got) return false;
  return timingSafeEqual(got, expected);
}

/** Pull the event envelope fields out of a Moyasar webhook body. */
export interface MoyasarWebhookEnvelope {
  id: string;
  type: string;
  secretToken: string;
  live: boolean;
  createdAt: string;
  data: Record<string, unknown>;
}

export function parseWebhookEnvelope(body: unknown): MoyasarWebhookEnvelope {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    id: String(b.id ?? ''),
    type: String(b.type ?? ''),
    secretToken: b.secret_token != null ? String(b.secret_token) : '',
    live: b.live === true,
    createdAt: b.created_at != null ? String(b.created_at) : '',
    data: (b.data ?? {}) as Record<string, unknown>,
  };
}

/**
 * Webhook event types we act on. Everything else is acknowledged and ignored.
 * `payment_faild` is Moyasar's own spelling — it is reproduced verbatim because
 * correcting it here would simply stop matching the events they send.
 */
export const HANDLED_WEBHOOK_TYPES = new Set([
  'payment_paid',
  'payment_captured',
  // Moyasar's dashboard lists the failure event as `payment_faild`, while
  // GET /v1/webhooks/available_events returns `payment_failed`. Both spellings
  // are accepted because we cannot tell from the documentation which one the
  // sender actually uses, and guessing wrong means silently ignoring every
  // failed payment.
  'payment_faild',
  'payment_failed',
  'payment_voided',
  'payment_refunded',
  'payment_authorized',
  'payment_abandoned',
  'payment_verified',
]);

// ---------------------------------------------------------------------------
// Response sanitization + error extraction.
// ---------------------------------------------------------------------------

/**
 * Reduce a masked PAN to its last four digits.
 *
 * Moyasar returns `source.number` masked as first-six + last-four. The first six
 * are the BIN: they identify the issuing bank and card product, which is more
 * about the customer than we need to keep, and the Tap sanitizer already drops
 * the equivalent `first_six` deliberately. So we store only the last four.
 */
export function lastFourOf(maskedNumber: unknown): string | null {
  const s = String(maskedNumber ?? '').replace(/\D/g, '');
  if (s.length < 4) return null;
  return s.slice(-4);
}

/**
 * Keep only safe, non-sensitive fields from a Moyasar payment for auditing.
 * Drops the BIN, tokens, the payer IP, and everything unlisted.
 */
export function sanitizeMoyasarPayment(resp: unknown): Record<string, unknown> {
  const p = (resp ?? {}) as Record<string, unknown>;
  const source = (p.source ?? {}) as Record<string, unknown>;
  return {
    id: p.id ?? null,
    status: p.status ?? null,
    amount: p.amount ?? null,
    currency: p.currency ?? null,
    fee: p.fee ?? null,
    refunded: p.refunded ?? null,
    captured: p.captured ?? null,
    invoice_id: p.invoice_id ?? null,
    created_at: p.created_at ?? null,
    // Safe display + reconciliation fields only — never the BIN, never a token.
    source: {
      type: source.type ?? null,
      company: source.company ?? null,
      last_four: lastFourOf(source.number),
      message: source.message != null ? String(source.message).slice(0, 200) : null,
      reference_number: source.reference_number ?? null,
      authorization_code: source.authorization_code ?? null,
      response_code: source.response_code ?? null,
      issuer_name: source.issuer_name ?? null,
      issuer_country: source.issuer_country ?? null,
    },
  };
}

/** Keep only safe fields from a Moyasar invoice for auditing. */
export function sanitizeMoyasarInvoice(resp: unknown): Record<string, unknown> {
  const i = (resp ?? {}) as Record<string, unknown>;
  const payments = Array.isArray(i.payments) ? (i.payments as unknown[]) : [];
  return {
    id: i.id ?? null,
    status: i.status ?? null,
    amount: i.amount ?? null,
    currency: i.currency ?? null,
    description: i.description ?? null,
    expired_at: i.expired_at ?? null,
    created_at: i.created_at ?? null,
    payments: payments.map((p) => sanitizeMoyasarPayment(p)),
  };
}

/**
 * Extract ONLY the safe error type + message from a rejected Moyasar response.
 * The documented error shape is `{ type, message, errors }`
 * (https://docs.moyasar.com/api/errors). `errors` is a field->messages map on a
 * validation failure; we fold it into a short, bounded string so Admin can see
 * the real reason without us persisting a raw provider payload.
 */
export function extractMoyasarError(body: unknown): { type: string | null; message: string | null } {
  const b = (body ?? {}) as Record<string, unknown>;
  const type = b.type != null ? String(b.type).slice(0, 60) : null;
  let message = b.message != null ? String(b.message) : '';

  const errs = b.errors;
  if (errs && typeof errs === 'object' && !Array.isArray(errs)) {
    const parts: string[] = [];
    for (const [field, val] of Object.entries(errs as Record<string, unknown>)) {
      const detail = Array.isArray(val) ? val.map((v) => String(v)).join(', ') : String(val);
      parts.push(`${field}: ${detail}`);
    }
    if (parts.length) message = message ? `${message} (${parts.join('; ')})` : parts.join('; ');
  }

  const trimmed = message.trim();
  return { type, message: trimmed ? trimmed.slice(0, 200) : null };
}

/**
 * A short, customer-safe reason for a failed payment. Moyasar puts the human
 * message on `source.message` (the strings catalogued at
 * https://docs.moyasar.com/guides/references/payment-errors). Bounded and
 * never a raw payload.
 */
export function paymentFailureMessage(payment: unknown): string | null {
  const p = (payment ?? {}) as Record<string, unknown>;
  const source = (p.source ?? {}) as Record<string, unknown>;
  const raw = source.message != null ? String(source.message).trim() : '';
  return raw ? raw.slice(0, 200) : null;
}

// ---------------------------------------------------------------------------
// Verification binding — the security-critical decision, kept pure and tested.
// ---------------------------------------------------------------------------

/**
 * The stored attempt fields the binding compares against. Mirrors the columns
 * moyasarVerify reads, but as a plain shape so this decision can be unit-tested
 * without a database.
 */
export interface BindingAttempt {
  provider_checkout_ref: string | null;
  amount: number;            // MAJOR units, server-trusted
  currency: string | null;
  mode: string | null;
}

export interface BindingResult {
  hasId: boolean;
  invoiceMatch: boolean;
  amountMatch: boolean;
  currencyMatch: boolean;
  modeMatch: boolean;
  allMatch: boolean;
}

/**
 * Decide whether a retrieved Moyasar payment provably belongs to this attempt.
 *
 * `payment.invoice_id` is the load-bearing check. Moyasar sets it itself when a
 * payment settles an invoice, so it cannot be steered by a customer or an
 * attacker; matching it against the invoice id we stored when we opened the
 * attempt is what stops somebody else's real payment being credited to this
 * order.
 *
 * `metadata` is deliberately NOT compared. Moyasar does not document metadata
 * propagating from an invoice to the payment that settles it, so requiring it
 * would reject legitimate payments; it is written for human reconciliation only.
 *
 * MODE is bound by construction rather than by a field: Moyasar's test and live
 * key spaces are disjoint, and the caller resolves the secret key from the
 * ATTEMPT's stored mode, so a live payment cannot be fetched with the test key
 * that opened a test attempt. `liveMode` is compared only when the caller
 * actually has one (the webhook envelope), as a second check that costs nothing.
 */
export function checkPaymentBinding(
  attempt: BindingAttempt,
  payment: Record<string, unknown>,
  opts: { liveMode?: boolean | null } = {},
): BindingResult {
  const currency = String(attempt.currency ?? 'SAR').toUpperCase();
  const hasId = String(payment.id ?? '').length > 0;
  const invoiceMatch = Boolean(attempt.provider_checkout_ref)
    && String(payment.invoice_id ?? '') === String(attempt.provider_checkout_ref);
  const amountMatch = amountsMatch(Number(attempt.amount), Number(payment.amount ?? -1), currency);
  const currencyMatch = String(payment.currency ?? '').toUpperCase() === currency;
  const modeMatch = opts.liveMode == null || opts.liveMode === (attempt.mode === 'live');
  return {
    hasId,
    invoiceMatch,
    amountMatch,
    currencyMatch,
    modeMatch,
    allMatch: hasId && invoiceMatch && amountMatch && currencyMatch && modeMatch,
  };
}

/**
 * Choose the settled payment from an invoice's `payments` array.
 *
 * An invoice can accumulate several payment attempts — a declined card followed
 * by a successful one leaves both on the invoice. We take a `paid`/`captured`
 * one if it exists, and otherwise return the most recent attempt so the caller
 * can report a real failure reason rather than a bare "pending".
 */
export function selectInvoicePayment(invoice: Record<string, unknown>): Record<string, unknown> | null {
  const payments = Array.isArray(invoice?.payments) ? (invoice.payments as Record<string, unknown>[]) : [];
  if (!payments.length) return null;
  const settled = payments.find((p) => {
    const st = String(p?.status ?? '').toLowerCase();
    return st === 'paid' || st === 'captured';
  });
  if (settled) return settled;
  // Most recent by created_at, falling back to array order.
  const sorted = [...payments].sort((a, b) =>
    String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? '')));
  return sorted[0] ?? null;
}

/**
 * Does this webhook body look like a Moyasar event rather than another
 * gateway's?
 *
 * WHY SHAPE AND NOT CONFIGURATION. payment-webhook used to pick its handler
 * from `integration_settings.provider_name` — whatever an administrator
 * selected most recently. That is the wrong question when a customer is
 * mid-checkout during a provider switch: the event that arrives belongs to the
 * gateway that took the money, not to the one now configured. Routing a Tap
 * charge into the Moyasar handler makes it fail the secret-token check and
 * return 401, so a paid order silently never confirms.
 *
 * The test is deliberately structural and cheap: Moyasar's envelope is
 * `{ id, type, created_at, secret_token, account_name, live, data }`
 * (https://docs.moyasar.com/api/other/webhooks/webhook-reference), and a Tap
 * charge body has no `type`/`data` pair. This only chooses which handler looks
 * at the body — each one still authenticates independently and fails closed, so
 * a wrong guess cannot confirm anything.
 */
export function looksLikeMoyasarWebhook(body: unknown): boolean {
  const b = (body ?? {}) as Record<string, unknown>;
  return typeof b.type === 'string'
    && b.type.length > 0
    && typeof b.data === 'object'
    && b.data !== null;
}

// ---------------------------------------------------------------------------
// Cross-provider attempt guard.
// ---------------------------------------------------------------------------

export interface LiveAttempt {
  id: string;
  provider: string | null;
  provider_ref: string | null;
  provider_checkout_ref: string | null;
}

export type CrossProviderDecision =
  | { action: 'proceed' }
  | { action: 'close_stale'; attemptId: string }
  | { action: 'refuse'; attemptId: string; provider: string };

/**
 * Decide what to do when an order (or checkout session) already has a LIVE
 * payment attempt belonging to a DIFFERENT provider than the one about to be
 * used.
 *
 * WHY THIS IS NEEDED AT ALL. The database's double-charge guard is two partial
 * unique indexes keyed on (order_id, provider) and
 * (checkout_session_id, provider) — they are provider-SCOPED. That was correct
 * when one gateway existed. With two, a Tap attempt does not block a Moyasar
 * attempt on the same order: switch the configured provider while a customer has
 * a hosted checkout page open, let them tap Pay again, and they end up holding
 * TWO payable pages for one order. If both are paid, `confirm_order_payment`
 * de-duplicates on (provider, provider_ref) — which differ — so both settle, and
 * `open_order_refund_record` can only ever enrol ONE of the two charges for
 * refund. The second charge is money we took and cannot automatically give back.
 *
 * The check cannot live in the SQL RPCs without touching the frozen Tap ones, so
 * it lives at the one place that knows about both gateways: payment-initiate.
 *
 * The two outcomes are deliberately different:
 *  - The other attempt has NO provider-side object yet (no charge, no invoice) —
 *    nothing is payable anywhere, so it is safe to close it and move on.
 *  - The other attempt already has one. That page IS payable and we cannot close
 *    it from here, so opening a second one is refused outright. The customer
 *    waits for it to expire; that is a worse checkout and a far better outcome
 *    than being charged twice.
 */
export function decideCrossProviderAttempt(
  existing: LiveAttempt | null | undefined,
  wantedProvider: string,
): CrossProviderDecision {
  if (!existing) return { action: 'proceed' };
  const other = String(existing.provider ?? '').toLowerCase();
  if (!other || other === String(wantedProvider ?? '').toLowerCase()) return { action: 'proceed' };

  const hasProviderSideCheckout =
    Boolean(existing.provider_ref) || Boolean(existing.provider_checkout_ref);
  return hasProviderSideCheckout
    ? { action: 'refuse', attemptId: existing.id, provider: other }
    : { action: 'close_stale', attemptId: existing.id };
}
