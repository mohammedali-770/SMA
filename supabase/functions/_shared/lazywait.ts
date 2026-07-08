/**
 * Lazywait POS — server-side client + PURE helpers.
 *
 * This module is intentionally free of Deno-only APIs and `npm:` imports so the
 * pure functions (payload mapping, error classification, signature verification,
 * backoff, phone normalization) can be unit-tested under Vitest/Node while the
 * Edge Functions run it under Deno. Only the Web-standard `fetch`, `crypto`,
 * `AbortController` and `TextEncoder` are used — all available in both runtimes.
 *
 * Security: the API token + webhook secret are read from integration_settings
 * (server-side) and passed in as config — they NEVER appear in the app or logs.
 */

// ---------------------------------------------------------------------------
// Config + constants
// ---------------------------------------------------------------------------
export interface LazywaitConfig {
  baseUrl: string;   // e.g. https://apiv2.lazywait.com/v1
  clientId: string;  // vAK1AmUr... (not secret; sent as query param)
  apiToken: string;  // SECRET — Bearer token
}

export const DEFAULT_BASE_URL = 'https://apiv2.lazywait.com/v1';
export const MAX_SYNC_ATTEMPTS = 8;
export const SOURCE = 'LWAPI';

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------
export type LazywaitErrorKind = 'ok' | 'retryable' | 'terminal';

/**
 * Classify an HTTP result. 429 + 5xx + network = retryable; 401 INVALID_KEY and
 * 403 LICENSE_EXPIRED = terminal config/license errors (don't hammer); other 4xx
 * = terminal (bad payload/mapping). 2xx = ok.
 */
export function classifyLazywaitError(status: number, code?: string | null): {
  kind: LazywaitErrorKind;
  reason: string;
} {
  if (status >= 200 && status < 300) return { kind: 'ok', reason: 'ok' };
  if (status === 429) return { kind: 'retryable', reason: 'rate_limited' };
  if (status === 0) return { kind: 'retryable', reason: 'network_error' };
  if (status >= 500) return { kind: 'retryable', reason: `server_error_${status}` };
  if (status === 401) return { kind: 'terminal', reason: 'auth_invalid_key' };
  if (status === 403) return { kind: 'terminal', reason: code === 'LICENSE_EXPIRED' ? 'license_expired' : 'forbidden' };
  return { kind: 'terminal', reason: `client_error_${status}` };
}

// ---------------------------------------------------------------------------
// Create Order payload mapping (PICKUP ONLY — confirmed schema)
// ---------------------------------------------------------------------------
export interface CreateOrderItemInput {
  menuItemId: string | null;   // products.lazywait_item_id
  name: string;                // server-trusted item name
  quantity: number;
  unitPrice: number;           // server-trusted, VAT-INCLUSIVE unit price
}
export interface CreateOrderInput {
  clientId: string;
  branchId: string | null;     // branches.lazywait_branch_id
  orderType: 'pickup' | 'delivery' | string;
  customerName: string;
  items: CreateOrderItemInput[];
}
export type BuildResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; blockedReason: string };

/**
 * Build the confirmed Create Order body. Only the CONFIRMED fields are sent —
 * no price_id, no addons, no delivery/customer_phone (schemas unconfirmed).
 * Returns a blockedReason instead of throwing so the worker can record it.
 */
export function buildCreateOrderPayload(input: CreateOrderInput): BuildResult {
  if (input.orderType !== 'pickup') {
    // Delivery Create Order schema is not confirmed by Lazywait; do not invent it.
    return { ok: false, blockedReason: 'delivery_schema_unconfirmed' };
  }
  if (!input.branchId) return { ok: false, blockedReason: 'missing_branch_mapping' };
  if (!input.items.length) return { ok: false, blockedReason: 'no_items' };
  if (input.items.some((it) => !it.menuItemId)) {
    return { ok: false, blockedReason: 'missing_item_mapping' };
  }
  const payload = {
    client_id: input.clientId,
    branch_id: input.branchId,
    order_type: 'pickup',
    order_items: input.items.map((it) => ({
      menu_item_id: it.menuItemId,
      name: it.name,
      quantity: it.quantity,
      // server-trusted, VAT-inclusive unit price (Lazywait response total is NOT trusted)
      price: round2(it.unitPrice),
    })),
    customer_name: input.customerName || 'Guest',
    source: SOURCE,
  };
  return { ok: true, payload };
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Webhook signature (HMAC-SHA256 hex)
// ---------------------------------------------------------------------------
export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify the X-LazyWait-Signature header. Lazywait's documented check hashes
 * `JSON.stringify(body)`; a proxy may deliver the raw body with different
 * whitespace, so we accept a match against ANY of the provided candidate
 * strings (typically the raw body and the re-serialized JSON).
 */
export async function verifyWebhookSignature(
  candidates: string[], signature: string | null, secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  for (const c of candidates) {
    const expected = await hmacSha256Hex(c, secret);
    if (timingSafeEqual(signature.toLowerCase(), expected)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------
/**
 * Exponential backoff with jitter. `attempt` is the new (1-based) attempt count.
 * 30s, 60s, 120s … capped at 1h, ±20% jitter. `rand` is injectable for tests.
 */
export function computeBackoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = 30_000;
  const cap = 3_600_000;
  const raw = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = 1 + (rand() * 0.4 - 0.2); // ±20%
  return Math.round(raw * jitter);
}

// ---------------------------------------------------------------------------
// Phone normalization (best-effort E.164 for KSA CRM matching)
// ---------------------------------------------------------------------------
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('+')) return d;
  if (d.startsWith('966')) return '+' + d;
  if (d.startsWith('05')) return '+966' + d.slice(1);
  if (d.startsWith('5') && d.length === 9) return '+966' + d;
  return d ? (d.startsWith('+') ? d : '+' + d) : null;
}

// ---------------------------------------------------------------------------
// HTTP client (Deno/Node fetch). Never logs the token.
// ---------------------------------------------------------------------------
export interface LazywaitResponse<T = unknown> {
  ok: boolean;
  status: number;         // 0 = network/timeout
  data: T | null;
  code: string | null;    // provider error code (e.g. LICENSE_EXPIRED)
  retryAfterMs: number | null;
  error: string | null;
}

export async function lazywaitFetch<T = unknown>(
  cfg: LazywaitConfig,
  opts: {
    method: 'GET' | 'POST' | 'PUT';
    path: string;                       // e.g. /pos/orders/create
    query?: Record<string, string | undefined>;
    body?: unknown;
    timeoutMs?: number;
  },
): Promise<LazywaitResponse<T>> {
  const base = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const params = new URLSearchParams();
  // client_id is required on every call.
  params.set('client_id', cfg.clientId);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const url = `${base}${opts.path}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${cfg.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: opts.method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    const code = (data && typeof data === 'object' && 'code' in (data as Record<string, unknown>))
      ? String((data as Record<string, unknown>).code) : null;
    const retryAfterHeader = res.headers.get('retry-after');
    const retryAfterMs = retryAfterHeader ? Math.max(0, Number(retryAfterHeader) * 1000) || null : null;
    return {
      ok: res.ok,
      status: res.status,
      data: (data as T) ?? null,
      code,
      retryAfterMs,
      error: res.ok ? null : (data && typeof data === 'object' && 'message' in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).message) : `HTTP ${res.status}`),
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return { ok: false, status: 0, data: null, code: null, retryAfterMs: null,
      error: aborted ? 'timeout' : (e instanceof Error ? e.message : 'network_error') };
  } finally {
    clearTimeout(timer);
  }
}
