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

// ---------------------------------------------------------------------------
// Customer-confirmation lifecycle: retry budget + fixed schedule
// ---------------------------------------------------------------------------
/**
 * A customer is never told the restaurant confirmed the order unless Lazywait
 * returned a usable order_ref. Auto-retry is bounded HARD by BOTH a maximum
 * attempt count AND an absolute wall-clock deadline measured from first
 * eligibility — whichever is reached first ends the retries.
 */
export const MAX_POS_ATTEMPTS = 5;
export const POS_DEADLINE_MINUTES = 10;
/**
 * Minute offsets from pos_sync_started_at for attempts 1..5:
 *   attempt 1 immediately, then +1, +3, +6, +9 — all inside the 10-min window.
 * Index i (0-based) is the schedule for attempt i+1. The SQL helper
 * public.pos_next_attempt_at mirrors this exactly.
 */
export const POS_RETRY_OFFSETS_MIN = [0, 1, 3, 6, 9] as const;

/**
 * How long an order may sit in 'syncing' before the reaper reclaims it. If a
 * worker crashes/times out after claiming (flipping the row to 'syncing') but
 * before calling record_lazywait_sync, the row would otherwise stay stuck and
 * never be picked up again. 10 min is comfortably longer than the worker's
 * per-order network budget (8s CRM + 15s Create Order) so a still-running
 * attempt is never reaped out from under itself. Must match the RPC default.
 */
export const STALE_SYNC_TIMEOUT_MINUTES = 10;

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
// Create Order outcome classification (customer-confirmation safety)
// ---------------------------------------------------------------------------
/**
 * The ONLY outcomes that may be auto-retried are ones with EXPLICIT evidence the
 * Create Order was NOT processed. Everything else that did not cleanly confirm
 * is AMBIGUOUS (the POS may or may not hold the order) and — because Create
 * Order has no idempotency key — must NEVER be blindly resent.
 *
 *   ok         2xx + success:true + a usable order_ref  -> synced.
 *   safe_retry HTTP 429 (rate limited): the gateway rejected us before the POS
 *              saw it, so a retry cannot duplicate.       -> retry within budget.
 *   ambiguous  timeout / dropped connection (status 0), 5xx, 2xx-without-ref,
 *              success:true-without-ref, malformed body   -> confirmation_required.
 *   terminal   401 / 403 / other 4xx: the request reached the POS and was
 *              definitively REJECTED (bad auth/license/payload). Known NOT
 *              created; a resend would fail identically.  -> final known failure.
 */
export type CreateOrderOutcomeKind = 'ok' | 'safe_retry' | 'ambiguous' | 'terminal';
export type PosConfirmationReason =
  | 'timeout' | 'connection' | 'missing_ref' | 'ambiguous_response' | 'provider_5xx';

export interface CreateOrderResultInput {
  status: number;                 // 0 = network/timeout (see lazywaitFetch)
  data?: unknown;                 // parsed provider body (may be malformed)
  error?: string | null;         // e.g. 'timeout' on AbortError
}
export interface CreateOrderOutcome {
  kind: CreateOrderOutcomeKind;
  reason: string;                 // stable machine reason (safe to log)
  orderRef: string | null;        // present only when kind === 'ok'
  confirmationReason?: PosConfirmationReason; // set only when kind === 'ambiguous'
}

/** Pull a non-empty `order.order_ref` out of a provider body, or null. */
export function extractOrderRef(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const order = (data as Record<string, unknown>).order;
  if (!order || typeof order !== 'object') return null;
  const ref = (order as Record<string, unknown>).order_ref;
  if (ref == null) return null;
  const s = String(ref).trim();
  return s.length ? s : null;
}

export function classifyCreateOrderResult(res: CreateOrderResultInput): CreateOrderOutcome {
  const status = res.status;
  const success = (res.data && typeof res.data === 'object')
    ? (res.data as Record<string, unknown>).success : undefined;
  const orderRef = extractOrderRef(res.data);

  if (status >= 200 && status < 300) {
    if (success === true && orderRef) return { kind: 'ok', reason: 'created', orderRef };
    // 2xx but no usable ref: the POS MAY have created it. Never resend.
    return {
      kind: 'ambiguous',
      reason: success === true ? 'created_without_ref' : 'unexpected_response',
      orderRef: null,
      confirmationReason: success === true ? 'missing_ref' : 'ambiguous_response',
    };
  }
  if (status === 429) return { kind: 'safe_retry', reason: 'rate_limited', orderRef: null };
  if (status === 0) {
    // Network failure: the request may have reached the POS before we lost the
    // reply. Ambiguous — verify, never auto-resend.
    const isTimeout = res.error === 'timeout';
    return {
      kind: 'ambiguous',
      reason: isTimeout ? 'timeout' : 'network_error',
      orderRef: null,
      confirmationReason: isTimeout ? 'timeout' : 'connection',
    };
  }
  if (status >= 500) {
    // 5xx: the POS could have processed the order before failing. Ambiguous.
    return { kind: 'ambiguous', reason: `server_error_${status}`, orderRef: null, confirmationReason: 'provider_5xx' };
  }
  if (status === 401) return { kind: 'terminal', reason: 'auth_invalid_key', orderRef: null };
  if (status === 403) return { kind: 'terminal', reason: 'license_or_forbidden', orderRef: null };
  return { kind: 'terminal', reason: `client_error_${status}`, orderRef: null };
}

/**
 * Given how many Create Order attempts have COMPLETED (and the absolute window),
 * decide whether another attempt is allowed and when. Enforces BOTH the attempt
 * ceiling and the deadline. Mirrors the SQL helper public.pos_next_attempt_at.
 *
 * @param startedAtMs  pos_sync_started_at in epoch ms (first eligibility).
 * @param completedAttempts  sync_attempt_count AFTER the attempt that just ran.
 * @param deadlineMs  pos_sync_deadline_at in epoch ms, or null.
 */
export function computePosNextAttempt(
  startedAtMs: number,
  completedAttempts: number,
  deadlineMs: number | null,
): { final: boolean; nextAttemptAtMs?: number } {
  if (completedAttempts >= MAX_POS_ATTEMPTS) return { final: true };
  const offsetMin = POS_RETRY_OFFSETS_MIN[completedAttempts] ?? POS_RETRY_OFFSETS_MIN[POS_RETRY_OFFSETS_MIN.length - 1];
  const candidate = startedAtMs + offsetMin * 60_000;
  if (deadlineMs != null && candidate > deadlineMs) return { final: true };
  return { final: false, nextAttemptAtMs: candidate };
}

// ---------------------------------------------------------------------------
// Create Order payload mapping (PICKUP ONLY)
//
// Grounded in the owner-supplied Lazywait Create Order contract of 2026-08-24
// (read from the DEV host `apiv2-dev.lazywait.com`; field-level parity with the
// production host we actually POST to is UNVERIFIED — see docs/LAZYWAIT.md).
// That document states only `client_id`, `branch_id` and a non-empty
// `order_items` are required and everything else is optional, and that the
// identity fields (order_ref/order_id/order_number/order_date) are generated
// server-side. Delivery is still NOT confirmed by it and stays blocked.
// ---------------------------------------------------------------------------

/**
 * One add-on line on an order item — `order_item_modifiers` joined to
 * `modifiers.lazywait_addon_id`.
 *
 * Contract shape: `{ addon_id, names{en,ar}, price, quantity,
 * is_included_in_custom_addons }`. We do not send
 * `is_included_in_custom_addons`: nothing in our data model says whether a
 * modifier arrived through a custom-addons group, and the contract makes the
 * field optional. We do NOT send `addons_group_id` either — it appears in the
 * catalog add-on-GROUP endpoints, but it is not part of the order add-on object
 * in the contract, so the earlier assumption that Create Order accepts it was
 * wrong and has been removed.
 */
export interface CreateOrderAddonInput {
  addonId: string | null;      // -> addon_id  (modifiers.lazywait_addon_id)
  nameEn: string;              // -> names.en
  nameAr?: string | null;      // -> names.ar
  /** Server-trusted snapshot price (order_item_modifiers.price), VAT-inclusive. */
  price?: number | null;
  quantity?: number;           // we have no per-add-on quantity column; defaults to 1
}

export interface CreateOrderItemInput {
  menuItemId: string | null;   // products.lazywait_item_id
  name: string;                // server-trusted item name
  nameAr?: string | null;      // order_items.name_ar -> names.ar
  quantity: number;
  /**
   * Server-trusted, VAT-INCLUSIVE unit price as stored on `order_items` — which
   * by construction ALREADY INCLUDES every selected modifier's price
   * (`place_order`: `v_unit_price := product.price + Σ modifier.price`).
   *
   * When `addons` are present the serializer subtracts them back out, so the
   * emitted `price` is the bare item price and
   * `price + Σ(addon.price × addon.quantity) === unitPrice` exactly. See
   * `serializeCreateOrderItem` for why that decomposition is mandatory.
   */
  unitPrice: number;
  menuCategoryId?: string | null;  // categories.lazywait_category_id -> menu_category_id
  priceId?: string | null;         // products.lazywait_price_id     -> price_id
  note?: string | null;            // order_items.note               -> details
  addons?: CreateOrderAddonInput[];
}

export interface CreateOrderInput {
  clientId: string;
  branchId: string | null;     // branches.lazywait_branch_id
  orderType: 'pickup' | 'delivery' | string;
  customerName: string;
  items: CreateOrderItemInput[];
  /** orders.notes — the order-level kitchen note. Contract field: `order_details`. */
  orderDetails?: string | null;
  /** profiles.lazywait_customer_id — the CRM link. Contract field: `customer_id`. */
  customerId?: string | null;
  /**
   * Raw stored customer phone. Split into `customer_cell` (local subscriber
   * number) + `country_code` by `splitPhoneForPos` — the contract keeps them
   * apart, so E.164 must NEVER be sent in `customer_cell`.
   */
  customerPhone?: string | null;
  /**
   * Contract field `is_paid`. Supported here, but the live worker deliberately
   * does not set it: telling a cashier an order needs no cash is a financial
   * signal, and payment work is frozen (CLAUDE.md §6). Wiring it is a separate
   * owner decision.
   */
  isPaid?: boolean;
}
export type BuildResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; blockedReason: string };

function trimToNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Total money carried by an item's add-on lines (round2 per line, then summed). */
function addonsTotal(addons: CreateOrderAddonInput[]): number {
  return addons.reduce(
    (sum, a) => sum + round2(Number(a.price ?? 0)) * Math.max(1, Number(a.quantity ?? 1)),
    0,
  );
}

/**
 * Split a stored phone into the two fields the contract wants:
 * `customer_cell` = the LOCAL subscriber number ("541234567") and
 * `country_code` = the dialling prefix ("+966") — NOT one E.164 string.
 *
 * Only Saudi numbers are split. For anything else we return null and send
 * neither field: guessing where a foreign country code ends would put a
 * wrong number in front of a branch, which is worse than sending none.
 */
export function splitPhoneForPos(
  phone: string | null | undefined,
): { countryCode: string; cell: string } | null {
  const e164 = normalizePhone(phone);
  if (!e164 || !e164.startsWith('+966')) return null;
  const local = e164.slice(4).replace(/^0+/, '');
  if (!/^\d{6,12}$/.test(local)) return null;
  return { countryCode: '+966', cell: local };
}

/**
 * Serialize ONE order item into the contract's order_items element.
 *
 * `name` is sent ALONGSIDE `names{en,ar}`, not replaced by it. `name` is not in
 * the documented contract at all, yet pickup sync has worked in Production with
 * it since the integration went live — which is evidence the API tolerates
 * undocumented fields, and no evidence at all that dropping `name` is safe. If a
 * later Production check shows the POS reads `names`, `name` can go then.
 *
 * MONEY — why `price` is decomposed. `unitPrice` already contains the modifier
 * prices (`place_order` adds them into `order_items.unit_price`). The contract's
 * own example sums the add-on prices into the order: item `price` 25 + addon
 * `price` 5 = `subtotal` 30. So emitting the modifier-inclusive unit price AND
 * the add-on lines would charge the add-ons twice on the POS ticket. We
 * therefore emit the bare item price and let the add-on lines carry their own
 * money, which leaves the line's implied total exactly what it is today.
 */
export function serializeCreateOrderItem(it: CreateOrderItemInput): Record<string, unknown> {
  const addons = it.addons ?? [];
  const names: Record<string, string> = {};
  const nameEn = trimToNull(it.name);
  const nameAr = trimToNull(it.nameAr);
  if (nameEn) names.en = nameEn;
  if (nameAr) names.ar = nameAr;

  const item: Record<string, unknown> = {
    menu_item_id: it.menuItemId,
    // Undocumented but Production-proven — kept in addition to `names`.
    name: it.name,
    names,
    quantity: it.quantity,
    // Server-trusted, VAT-inclusive, add-ons subtracted back out (see above).
    // The Lazywait response total is NOT trusted.
    price: round2(round2(it.unitPrice) - addonsTotal(addons)),
  };
  if (it.menuCategoryId != null && String(it.menuCategoryId) !== '') {
    item.menu_category_id = it.menuCategoryId;
  }
  if (it.priceId != null && String(it.priceId) !== '') item.price_id = it.priceId;

  // Per-item kitchen note. The key is OMITTED (not null) when there is no note,
  // matching how every other optional field on this body behaves.
  const details = trimToNull(it.note);
  if (details) item.details = details;

  if (addons.length) {
    item.addons = addons.map((a) => {
      const addonNames: Record<string, string> = {};
      const addonEn = trimToNull(a.nameEn);
      const addonAr = trimToNull(a.nameAr);
      if (addonEn) addonNames.en = addonEn;
      if (addonAr) addonNames.ar = addonAr;
      const addon: Record<string, unknown> = {
        addon_id: a.addonId,
        // Same rationale as the item-level `name`; removable at the same check.
        name: a.nameEn,
        names: addonNames,
        quantity: Math.max(1, Number(a.quantity ?? 1)),
      };
      if (a.price != null) addon.price = round2(a.price);
      return addon;
    });
  }
  return item;
}

/**
 * Column list the sync worker selects from `order_items` to build a Create
 * Order body. Kept here, next to the mapper that consumes it, so the query and
 * the mapping cannot drift apart — before the 2026-08-24 contract the worker
 * selected only name/quantity/unit_price/lazywait_item_id, and the add-on,
 * category and price mappings were simply unreachable from the worker.
 */
export const ORDER_ITEM_SELECT =
  'id, name_en, name_ar, note, quantity, unit_price, product_id,'
  + ' products(lazywait_item_id, lazywait_price_id, categories(lazywait_category_id)),'
  + ' order_item_modifiers(modifier_id, name_en, name_ar, price, modifiers(lazywait_addon_id))';

/**
 * Map rows returned by `ORDER_ITEM_SELECT` onto Create Order items.
 *
 * PURE, so the join that feeds the POS ticket is unit-testable without a
 * database. An unmapped modifier produces `addonId: null`, which
 * `buildCreateOrderPayload` turns into `missing_addon_mapping` — never a
 * silently dropped add-on.
 */
export function mapOrderItemRows(rows: Array<Record<string, unknown>>): CreateOrderItemInput[] {
  return rows.map((it) => {
    const product = it.products as {
      lazywait_item_id?: string | null;
      lazywait_price_id?: string | null;
      categories?: { lazywait_category_id?: string | null } | null;
    } | null;
    const modifiers = (it.order_item_modifiers ?? []) as Array<Record<string, unknown>>;
    return {
      menuItemId: product?.lazywait_item_id ?? null,
      name: String(it.name_en ?? 'Item'),
      nameAr: (it.name_ar as string | null) ?? null,
      quantity: Number(it.quantity ?? 1),
      // VAT-inclusive AND modifier-inclusive; the serializer subtracts the
      // add-on lines back out so the POS cannot charge them twice.
      unitPrice: Number(it.unit_price ?? 0),
      menuCategoryId: product?.categories?.lazywait_category_id ?? null,
      priceId: product?.lazywait_price_id ?? null,
      note: (it.note as string | null) ?? null,
      addons: modifiers.map((m) => ({
        addonId: (m.modifiers as { lazywait_addon_id?: string | null } | null)?.lazywait_addon_id ?? null,
        nameEn: String(m.name_en ?? 'Option'),
        nameAr: (m.name_ar as string | null) ?? null,
        price: Number(m.price ?? 0),
      })),
    };
  });
}

/**
 * Build the confirmed Create Order body.
 *
 * Delivery stays BLOCKED: the contract documents a pickup order and says
 * nothing about `order_type: "delivery"`, its `order_status_id`, or the shape of
 * `order_deliveries[]` — so nothing here enables delivery sync.
 *
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
  // An add-on line must carry its mapped addon_id. Dropping an unmapped modifier
  // instead would send the kitchen an incomplete ticket AND (because the add-on
  // money is subtracted out of the item price) undercharge the line. Blocking is
  // loud and recoverable; a silent drop is neither.
  if (input.items.some((it) => (it.addons ?? []).some((a) => !a.addonId))) {
    return { ok: false, blockedReason: 'missing_addon_mapping' };
  }
  // Defensive: the add-on prices are the same snapshots that were added into
  // unit_price, so this cannot go negative on well-formed data. If it ever does,
  // the decomposition is unsafe and we refuse rather than post a wrong price.
  if (input.items.some((it) => round2(it.unitPrice) - addonsTotal(it.addons ?? []) < -0.005)) {
    return { ok: false, blockedReason: 'addon_price_exceeds_item_price' };
  }

  const payload: Record<string, unknown> = {
    client_id: input.clientId,
    branch_id: input.branchId,
    order_type: 'pickup',
    order_items: input.items.map(serializeCreateOrderItem),
    customer_name: input.customerName || 'Guest',
    source: SOURCE,
  };

  // Order-level kitchen note (orders.notes).
  const orderDetails = trimToNull(input.orderDetails);
  if (orderDetails) payload.order_details = orderDetails;

  // CRM link.
  if (input.customerId != null && String(input.customerId) !== '') {
    payload.customer_id = input.customerId;
  }

  // Phone: local subscriber number and dialling prefix are SEPARATE fields.
  const phone = splitPhoneForPos(input.customerPhone);
  if (phone) {
    payload.customer_cell = phone.cell;
    payload.country_code = phone.countryCode;
  }

  if (typeof input.isPaid === 'boolean') payload.is_paid = input.isPaid;

  // MONEY, deliberately absent. The contract carries subtotal/discount/tax/
  // tax_percentage/total/order_delivery_fee, and its example computes
  // total = subtotal × 1.15 — i.e. tax ADDED ON TOP of the item prices. Ours are
  // VAT-INCLUSIVE, so those fields cannot be filled from our numbers without
  // deciding a question the document does not answer: what the POS does with
  // prices when the tax fields are absent (which is the case today, and pickup
  // tickets are correct). Sending a guessed subtotal/tax/total would disagree
  // with what the customer was charged. Recorded as Q9 in
  // docs/lazywait-delivery-open-questions.md instead.

  return { ok: true, payload };
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Decide whether the worker may (re-)POST Create Order for a claimed order.
 * Create Order has NO idempotency key, so once we hold a Lazywait `order_ref`
 * the POS ticket already exists — re-sending would duplicate it. If a ref is
 * present the caller must finalize as 'synced' WITHOUT re-POSTing. Returns
 * false when a ref is already stored, true only for genuinely un-created orders.
 */
export function shouldResendCreateOrder(order: { lazywait_ref?: string | null }): boolean {
  return !order.lazywait_ref;
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
  /**
   * Raw response body text, always captured (null on a network/timeout failure).
   * Additive: existing callers ignore it. It lets the typed lazywaitApi client
   * recognise non-JSON success bodies (the product/category DELETE returns a
   * plain-text `ok`) as a first-class typed success instead of relying on the
   * `data:{raw}` fallback.
   */
  text?: string | null;
}

/**
 * Parse a `Retry-After` header into milliseconds. RFC 7231 allows either
 * delta-seconds ("120") or an HTTP-date. Returns null when absent/unparseable
 * (caller falls back to computeBackoffMs). Note: a valid "0" returns 0 (retry
 * now) — callers must use `??`, not `||`, so that zero is preserved.
 */
export function parseRetryAfterMs(
  value: string | null | undefined, nowMs: number = Date.now(),
): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  if (/^\d+$/.test(s)) return Math.max(0, Number(s) * 1000);        // delta-seconds
  const t = Date.parse(s);                                          // HTTP-date
  if (!Number.isNaN(t)) return Math.max(0, t - nowMs);
  return null;
}

export async function lazywaitFetch<T = unknown>(
  cfg: LazywaitConfig,
  opts: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
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
      // GET never carries a body; DELETE only when one is explicitly supplied
      // (the path/query-addressed deletes send none). POST/PUT are unchanged —
      // always at least `{}` — so existing behaviour is preserved exactly.
      body: opts.method === 'GET' || (opts.method === 'DELETE' && opts.body === undefined)
        ? undefined
        : JSON.stringify(opts.body ?? {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    const code = (data && typeof data === 'object' && 'code' in (data as Record<string, unknown>))
      ? String((data as Record<string, unknown>).code) : null;
    const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
    return {
      ok: res.ok,
      status: res.status,
      data: (data as T) ?? null,
      code,
      retryAfterMs,
      error: res.ok ? null : (data && typeof data === 'object' && 'message' in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).message) : `HTTP ${res.status}`),
      text,
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return { ok: false, status: 0, data: null, code: null, retryAfterMs: null,
      error: aborted ? 'timeout' : (e instanceof Error ? e.message : 'network_error'), text: null };
  } finally {
    clearTimeout(timer);
  }
}
