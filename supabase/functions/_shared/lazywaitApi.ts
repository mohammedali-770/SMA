/**
 * Lazywait API v2 — typed, PURE client (partial GitHub issue #104).
 *
 * A thin, fully-typed layer over the audited `lazywaitFetch` transport in
 * `lazywait.ts`. For every one of the 27 documented endpoints it provides:
 *   1. an explicit request TypeScript interface,
 *   2. a PURE request serializer (`build<Endpoint>Request`) that returns the
 *      exact `{ method, path, query, body }` handed to `lazywaitFetch`, and
 *   3. an explicit response interface + a hand-rolled runtime validator
 *      (`parse<Endpoint>Response`) that never throws on malformed input.
 *
 * PURITY: like `lazywaitCatalog.ts`, this module uses only Web-standard APIs
 * (no Deno-only globals, no `npm:` imports) so it is unit-testable under Vitest
 * on Node AND runnable under Deno in the Edge Functions. The `client.*` methods
 * call `lazywaitFetch` (Web `fetch`); the serializers/validators are pure and
 * are tested directly without any network.
 *
 * SECURITY: the API token is injected by `lazywaitFetch` as the `Bearer` header
 * and NEVER appears in a serialized request body/query. `redactLazywait()`
 * (below) scrubs token/Bearer, customer phone/email, and payment card fields out
 * of any object before it is logged or returned.
 *
 * SAFETY (Create Order): the CONFIRMED body is always available. As of the
 * owner-supplied contract (2026-08-24) the add-on / customer / price_id /
 * per-item-note fields are CONFIRMED and no longer gated — they are built by the
 * audited `buildCreateOrderPayload` in `lazywait.ts`, which both modes call, so
 * the gated path cannot drift from the confirmed one. What REMAINS gated behind
 * `allowAssumedFields: true` (default OFF) is only what that contract still does
 * not settle: `order_type:"delivery"` and its status id, the element shape of
 * `order_deliveries[]`, and `latitude`/`longitude` — which are absent from the
 * contract entirely. The live `lazywait-sync` worker keeps calling
 * `buildCreateOrderPayload` directly and delivery stays BLOCKED.
 *
 * The contract was read from the DEV host `apiv2-dev.lazywait.com`; field-level
 * parity with Production is UNVERIFIED and DEFAULT_BASE_URL is unchanged.
 *
 * PAYMENTS (Tap freeze — CLAUDE.md §6): the cash/online payment endpoints are
 * TYPED + serialized + validated here, but this client does not wire them into
 * any live payment flow; that remains frozen pending explicit owner approval.
 */

import {
  buildConfirmedOrderItem,
  buildCreateOrderPayload,
  classifyCreateOrderResult,
  DEFAULT_BASE_URL,
  lazywaitFetch,
  round2,
  SOURCE,
  shouldResendCreateOrder,
  type CreateOrderAddonLine,
  type CreateOrderInput,
  type CreateOrderItemInput,
  type CreateOrderOutcome,
  type BuildResult,
  type LazywaitConfig,
  type LazywaitResponse,
} from './lazywait.ts';
import {
  normalizeCatalogPayload,
  type CatalogEntityType,
  type NormalizedCatalogRecord,
} from './lazywaitCatalog.ts';

// ===========================================================================
// Runtime-validation primitives (null-safe, never throw)
// ===========================================================================
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}
function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}
function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asString(x)).filter((x): x is string => x !== null);
}

/** Discriminated validation result — the typed value, or the issues found. */
export type ValidationResult<T> =
  | { ok: true; value: T; issues: string[] }
  | { ok: false; value: null; issues: string[] };

function valid<T>(value: T, issues: string[] = []): ValidationResult<T> {
  return { ok: true, value, issues };
}
function invalid<T>(issues: string[]): ValidationResult<T> {
  return { ok: false, value: null, issues };
}

// ===========================================================================
// Centralized redaction — token/Bearer, phone/email, payment card fields
// ===========================================================================
/** Keys whose VALUE must never be logged, regardless of casing. */
const SENSITIVE_KEYS = new Set(
  [
    'authorization', 'api_token', 'apitoken', 'token', 'bearer',
    'webhook_secret', 'sync_trigger_secret', 'secret', 'password',
    'customer_phone', 'customer_cell', 'phone', 'mobile', 'cell',
    'email', 'customer_email',
    // payment card fields — exact documented casing lower-cased for the lookup
    'card_number', 'approval_no', 'cvv', 'cvc', 'card_cvv', 'pan',
  ].map((k) => k.toLowerCase()),
);

/** Strip token-shaped substrings out of any free string (reuses the repo pattern). */
export function redactSecretsInString(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
    .replace(/lw_(?:live|test)_[A-Za-z0-9._\-]+/gi, 'lw_***')
    .replace(/whsec_[A-Za-z0-9._\-]+/gi, 'whsec_***');
}

/**
 * Deep-redact any value before it is logged/returned. Objects are cloned;
 * sensitive keys are replaced with `'***'` and free strings are scrubbed for
 * token-shaped substrings. Bounded recursion depth guards against cycles.
 */
export function redactLazywait(value: unknown, depth = 0): unknown {
  if (depth > 8) return '***';
  if (typeof value === 'string') return redactSecretsInString(value);
  if (Array.isArray(value)) return value.map((v) => redactLazywait(v, depth + 1));
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '***' : redactLazywait(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ===========================================================================
// Request spec + result envelope
// ===========================================================================
export interface LazywaitRequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs?: number;
  /**
   * When true, a plain-text `ok` body (product/category DELETE) is an
   * acceptable success even though it is not JSON.
   */
  expectTextOk?: boolean;
}

export interface LazywaitApiResult<T> {
  ok: boolean;            // HTTP-level ok (2xx)
  status: number;         // 0 = network/timeout
  valid: boolean;         // did the runtime validator accept the body
  data: T | null;         // validated, typed payload (null when invalid)
  issues: string[];       // validation issues (safe to log)
  error: string | null;   // redacted transport/HTTP error, or null
}

/** Server-owned identity fields that must NEVER be sent in a create/update body. */
export const SERVER_OWNED_ORDER_FIELDS = ['order_ref', 'order_id', 'order_number', 'order_date'] as const;

function stripServerOwned(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if ((SERVER_OWNED_ORDER_FIELDS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Menu pagination is applied ONLY when BOTH offset and limit are supplied
 * (issue #104 caution). Otherwise neither is sent.
 */
export function paginationQuery(offset?: number | null, limit?: number | null): Record<string, string | undefined> {
  if (offset == null || limit == null) return {};
  return { offset: String(offset), limit: String(limit) };
}

// ===========================================================================
// Shared response shapes
// ===========================================================================
/** A generic write acknowledgement (`{ success: true, ... }`). */
export interface SuccessResponse {
  success: boolean;
  message: string | null;
  raw: Record<string, unknown> | null;
}
export function parseSuccessResponse(data: unknown): ValidationResult<SuccessResponse> {
  if (!isObject(data)) return invalid(['response is not an object']);
  const success = asBool(data.success);
  if (success === null) {
    return valid({ success: false, message: asString(data.message), raw: data }, ['no boolean `success` field']);
  }
  return valid({ success, message: asString(data.message), raw: data });
}

/** DELETE ack that may be JSON `{success:true}` OR a plain-text `ok` body. */
export interface DeleteResponse {
  deleted: boolean;
  via: 'json' | 'text';
  raw: string | null;
}
export function parseDeleteResponse(res: LazywaitResponse<unknown>): ValidationResult<DeleteResponse> {
  // Plain-text `ok` (documented for product/category delete). We read the raw
  // TEXT surfaced by lazywaitFetch rather than the `{raw}` JSON fallback.
  const text = (res.text ?? '').trim().toLowerCase();
  if (text === 'ok' || text === '"ok"') return valid({ deleted: true, via: 'text', raw: 'ok' });
  if (isObject(res.data)) {
    const success = asBool(res.data.success);
    if (success === true) return valid({ deleted: true, via: 'json', raw: null });
    if (success === false) return valid({ deleted: false, via: 'json', raw: null }, ['success:false']);
  }
  // 2xx with an empty/opaque body is treated as deleted only when the HTTP call
  // itself succeeded; otherwise it is invalid.
  if (res.ok) return valid({ deleted: true, via: 'text', raw: res.text ?? null }, ['no explicit ok/success token']);
  return invalid(['delete not acknowledged']);
}

/** A list-of-catalog-records response, normalized via the shared catalog parser. */
export interface CatalogListResponse {
  records: NormalizedCatalogRecord[];
  count: number;
}
export function parseCatalogListResponse(entity: CatalogEntityType, data: unknown): ValidationResult<CatalogListResponse> {
  const records = normalizeCatalogPayload(entity, data);
  return valid({ records, count: records.length });
}

// ---------------------------------------------------------------------------
// POS order shapes (defensive — documented identity + status fields)
// ---------------------------------------------------------------------------
export interface LazywaitOrderItem {
  menu_item_id: string | null;
  name: string | null;
  quantity: number | null;
  price: number | null;
  raw: Record<string, unknown>;
}
export interface LazywaitOrder {
  order_ref: string | null;
  order_id: string | null;
  order_number: string | null;
  order_date: string | null;
  order_status_id: string | null;
  branch_id: string | null;
  order_type: string | null;
  customer_name: string | null;
  source: string | null;
  total: number | null;
  order_items: LazywaitOrderItem[];
  raw: Record<string, unknown>;
}

function parseOrderItem(raw: unknown): LazywaitOrderItem {
  const o = isObject(raw) ? raw : {};
  return {
    menu_item_id: asString(o.menu_item_id ?? o.menuItemId),
    name: asString(o.name),
    quantity: asNumber(o.quantity),
    price: asNumber(o.price),
    raw: o,
  };
}
export function parseOrder(raw: unknown): LazywaitOrder | null {
  // Some responses wrap the order under `order`.
  const src = isObject(raw) && isObject(raw.order) ? raw.order : raw;
  if (!isObject(src)) return null;
  const items = Array.isArray(src.order_items) ? src.order_items.map(parseOrderItem) : [];
  // No usable order identity and no items → not an order body.
  const hasIdentity = src.order_ref != null || src.order_id != null || src.order_number != null;
  if (!hasIdentity && items.length === 0) return null;
  return {
    order_ref: asString(src.order_ref),
    order_id: asString(src.order_id),
    order_number: asString(src.order_number),
    order_date: asString(src.order_date),
    order_status_id: asString(src.order_status_id ?? src.status),
    branch_id: asString(src.branch_id),
    order_type: asString(src.order_type),
    customer_name: asString(src.customer_name),
    source: asString(src.source),
    total: asNumber(src.total),
    order_items: items,
    raw: src,
  };
}

export interface OrderResponse { order: LazywaitOrder | null; }
export function parseOrderResponse(data: unknown): ValidationResult<OrderResponse> {
  const order = parseOrder(data);
  if (!order) return invalid(['no order object in response']);
  return valid({ order });
}

export interface OrderListResponse { orders: LazywaitOrder[]; count: number; }
export function parseOrderListResponse(data: unknown): ValidationResult<OrderListResponse> {
  let arr: unknown[] = [];
  if (Array.isArray(data)) arr = data;
  else if (isObject(data)) {
    for (const k of ['orders', 'data', 'results', 'records', 'items']) {
      if (Array.isArray(data[k])) { arr = data[k] as unknown[]; break; }
    }
  }
  const orders = arr.map(parseOrder).filter((o): o is LazywaitOrder => o !== null);
  return valid({ orders, count: orders.length });
}

// ===========================================================================
// Create Order — CONFIRMED body + GATED still-unconfirmed delivery fields
// ===========================================================================
/**
 * An add-on line on an order item. As of the owner-supplied contract
 * (2026-08-24) this is CONFIRMED and NO LONGER GATED — see
 * `CreateOrderAddonLine` in `lazywait.ts` for the shape and for why
 * `is_included_in_custom_addons` is still not sent.
 *
 * CORRECTED 2026-08-24: the previous `addons_group_id` assumption is WRONG for
 * create-order — the contract's add-on object carries no group id. (The catalog
 * endpoints `/menu/addons` + `/menu/addons-groups` genuinely do use
 * `addons_group_id`; that is a different field and is untouched below.)
 */
export type CreateOrderAddonInput = CreateOrderAddonLine;

/**
 * Order item. Now identical to the confirmed `CreateOrderItemInput`: `price_id`
 * and `addons` were promoted out of the assumed gate on 2026-08-24, and
 * `names{en,ar}`, `menu_category_id` and `details` were added from the contract.
 * Kept as a named alias so existing call sites keep reading clearly.
 */
export type CreateOrderItemInputV2 = CreateOrderItemInput;

/**
 * Create Order request.
 *
 * CONFIRMED (always sent when present — grounded in the 2026-08-24 contract):
 * client_id, branch_id, order_type:"pickup", source, customer_name,
 * order_items[{menu_item_id, name, names{en,ar}, menu_category_id, price_id,
 * quantity, price, details, addons[{addon_id, names{en,ar}, price, quantity}]}],
 * customer_id, customer_cell + country_code, order_details, is_paid.
 *
 * STILL ASSUMED (sent ONLY when `allowAssumedFields === true`) — the contract
 * does NOT settle these; see docs/lazywait-delivery-open-questions.md:
 *   - order_type:"delivery" and its order_status_id (Q1)
 *   - the element shape of `order_deliveries[]`, which is almost certainly where
 *     delivery actually lives (Q2/Q3) — empty in the contract's example
 *   - latitude / longitude: ABSENT from the contract entirely. These are NOT
 *     confirmed by that document and stay gated (Q3).
 *   - `order_delivery_fee` as a value: the NAME is corrected/confirmed, but the
 *     contract's totals are exclusive-VAT while ours are inclusive (Q9).
 */
export interface CreateOrderRequest {
  clientId: string;
  branchId: string | null;
  orderType: 'pickup' | 'delivery' | string;
  customerName: string;
  items: CreateOrderItemInputV2[];

  /** Master gate. Default OFF — nothing unconfirmed reaches the POS unless true. */
  allowAssumedFields?: boolean;

  // --- CONFIRMED customer/order fields (NOT gated as of 2026-08-24) ---
  customerId?: string | null;      // -> customer_id
  /**
   * Raw customer phone. Split into `customer_cell` (local subscriber) +
   * `country_code` — the contract does NOT take E.164 in customer_cell.
   */
  customerCell?: string | null;
  orderDetails?: string | null;    // -> order_details (orders.notes)
  isPaid?: boolean;                // -> is_paid

  // --- STILL-UNCONFIRMED delivery fields (gated) ---
  delivery?: {
    /**
     * -> delivery_address. The field NAME is confirmed (it appears, empty, on
     * the contract's pickup example); using it to carry a real delivery is what
     * remains unconfirmed, so it stays behind the gate with the rest.
     */
    address?: string | null;
    latitude?: number | null;      // -> latitude   [ASSUMPTION — absent from the contract]
    longitude?: number | null;     // -> longitude  [ASSUMPTION — absent from the contract]
    fee?: number | null;           // -> order_delivery_fee (name CORRECTED 2026-08-24)
  };

  /**
   * Escape hatch for any other unconfirmed field name. Also GATED and always
   * identity-stripped (order_ref/order_id/order_number/order_date removed).
   */
  extraAssumedFields?: Record<string, unknown>;
}

/** Map the v2 request onto the audited confirmed-builder input. */
function toConfirmedInput(req: CreateOrderRequest): CreateOrderInput {
  return {
    clientId: req.clientId,
    branchId: req.branchId,
    orderType: req.orderType,
    customerName: req.customerName,
    items: req.items,
    customerId: req.customerId,
    customerPhone: req.customerCell,
    orderDetails: req.orderDetails,
    isPaid: req.isPaid,
  };
}

/**
 * Build the Create Order body.
 *
 * Default (allowAssumedFields falsy) → EXACTLY the audited
 * `buildCreateOrderPayload` output (so the confirmed shape can never drift),
 * and delivery stays BLOCKED (`delivery_schema_unconfirmed`).
 *
 * With `allowAssumedFields: true` → the SAME confirmed body, plus the fields the
 * 2026-08-24 contract still does not settle. The confirmed half is built by the
 * one audited function in both modes, so the gated path cannot drift from it.
 */
export function serializeCreateOrder(req: CreateOrderRequest): BuildResult {
  const assumed = req.allowAssumedFields === true;

  if (!assumed) {
    // Confirmed, audited path. Pickup → payload; delivery → blocked.
    return buildCreateOrderPayload(toConfirmedInput(req));
  }

  // ---- Gated path (owner-authorized capability; still safe) ----------------
  // Build the confirmed body through the audited builder. `orderType` is forced
  // to 'pickup' ONLY so that builder's delivery block does not reject a
  // deliberately-gated delivery build; the caller's real order_type is restored
  // immediately below. Every mapping/validation check still runs.
  const confirmed = buildCreateOrderPayload({ ...toConfirmedInput(req), orderType: 'pickup' });
  if (!confirmed.ok) return confirmed;

  const payload: Record<string, unknown> = { ...confirmed.payload };
  // May be "delivery" here — STILL UNCONFIRMED (Q1).
  payload.order_type = req.orderType;

  const d = req.delivery;
  if (d) {
    if (d.address != null && String(d.address) !== '') payload.delivery_address = d.address;
    if (d.latitude != null) payload.latitude = d.latitude;                    // [ASSUMPTION]
    if (d.longitude != null) payload.longitude = d.longitude;                 // [ASSUMPTION]
    // CORRECTED 2026-08-24: the field is `order_delivery_fee`, not `delivery_fee`.
    if (d.fee != null) payload.order_delivery_fee = round2(d.fee);
  }

  // Escape hatch — identity fields can never be injected.
  Object.assign(payload, stripServerOwned(req.extraAssumedFields ?? {}));

  return { ok: true, payload };
}

/** POST /pos/orders/create — request spec (only when the body builds). */
export type CreateOrderRequestSpec =
  | { ok: true; spec: LazywaitRequestSpec }
  | { ok: false; blockedReason: string };

export function buildCreateOrderRequest(req: CreateOrderRequest): CreateOrderRequestSpec {
  const built = serializeCreateOrder(req);
  if (!built.ok) return built;
  return { ok: true, spec: { method: 'POST', path: '/pos/orders/create', body: built.payload, timeoutMs: 15_000 } };
}

/** POST /pos/orders/create — response classification (reuses the safety classifier). */
export interface CreateOrderApiResult {
  sent: boolean;                 // false when a duplicate-send guard blocked the POST
  blockedReason: string | null;  // set when the body could not be built or send was skipped
  outcome: CreateOrderOutcome | null;
  status: number;
  error: string | null;          // redacted
}

// ---------------------------------------------------------------------------
// Update Order (PUT /pos/orders/:order_ref) — order_items = FULL replacement
// ---------------------------------------------------------------------------
export interface UpdateOrderRequest {
  clientId: string;
  orderRef: string;                       // -> path param
  branchId?: string | null;
  /**
   * Full REPLACEMENT of the order's items (documented assumption — Lazywait has
   * not confirmed merge semantics, so we replace rather than merge).
   */
  orderItems: CreateOrderItemInputV2[];
  customerName?: string;
  allowAssumedFields?: boolean;
  extraAssumedFields?: Record<string, unknown>;
}
export function buildUpdateOrderRequest(req: UpdateOrderRequest): LazywaitRequestSpec {
  const assumed = req.allowAssumedFields === true;
  const body: Record<string, unknown> = {
    client_id: req.clientId,
    // order_items is a FULL replacement (see interface doc).
    order_items: req.orderItems.map(buildConfirmedOrderItem),
  };
  if (req.branchId != null && String(req.branchId) !== '') body.branch_id = req.branchId;
  if (req.customerName != null) body.customer_name = req.customerName;
  if (assumed) Object.assign(body, stripServerOwned(req.extraAssumedFields ?? {}));
  // NOTE: order_ref goes in the PATH, never the body (server-owned identity field).
  return {
    method: 'PUT',
    path: `/pos/orders/${encodeURIComponent(req.orderRef)}`,
    body,
    timeoutMs: 15_000,
  };
}

// ---------------------------------------------------------------------------
// GET /pos/order — one order by branch_id + order_ref
// ---------------------------------------------------------------------------
export interface GetOrderRequest { branchId: string; orderRef: string; }
export function buildGetOrderRequest(req: GetOrderRequest): LazywaitRequestSpec {
  return { method: 'GET', path: '/pos/order', query: { branch_id: req.branchId, order_ref: req.orderRef } };
}

// GET /pos/orders/active-orders — optional branch / user / lookback
export interface ActiveOrdersRequest {
  branchId?: string;
  userId?: string;
  lookbackMinutes?: number;
}
export function buildActiveOrdersRequest(req: ActiveOrdersRequest = {}): LazywaitRequestSpec {
  return {
    method: 'GET',
    path: '/pos/orders/active-orders',
    query: {
      branch_id: req.branchId,
      user_id: req.userId,
      lookback: req.lookbackMinutes != null ? String(req.lookbackMinutes) : undefined,
    },
  };
}

// GET /pos/orders/search — search orders (query text + optional branch + pagination)
export interface SearchOrdersRequest {
  query: string;
  branchId?: string;
  offset?: number;
  limit?: number;
}
export function buildSearchOrdersRequest(req: SearchOrdersRequest): LazywaitRequestSpec {
  return {
    method: 'GET',
    path: '/pos/orders/search',
    query: { query: req.query, branch_id: req.branchId, ...paginationQuery(req.offset, req.limit) },
  };
}

// POST /pos/orders — fetch multiple orders by reference IDs
export interface FetchOrdersRequest { orderRefs: string[]; branchId?: string; }
export function buildFetchOrdersRequest(req: FetchOrdersRequest): LazywaitRequestSpec {
  const body: Record<string, unknown> = { order_refs: req.orderRefs };
  if (req.branchId != null && String(req.branchId) !== '') body.branch_id = req.branchId;
  return { method: 'POST', path: '/pos/orders', body };
}

// ---------------------------------------------------------------------------
// Payment endpoints — TYPED/SERIALIZED/VALIDATED ONLY (Tap freeze, CLAUDE.md §6)
// Exact documented casing preserved: Trans_Amount, Approval_No, Card_Type,
// Card_Number, transaction_uuid.
// ---------------------------------------------------------------------------
export interface UpdateCashPaymentRequest {
  clientId: string;
  branchId: string;
  orderRef: string;
  transAmount: number;             // -> Trans_Amount (server-trusted)
  approvalNo?: string;             // -> Approval_No
  transactionUuid?: string;        // -> transaction_uuid (stable per gateway txn)
}
export function buildUpdateCashPaymentRequest(req: UpdateCashPaymentRequest): LazywaitRequestSpec {
  const body: Record<string, unknown> = {
    client_id: req.clientId,
    branch_id: req.branchId,
    order_ref: req.orderRef,
    Trans_Amount: round2(req.transAmount),
  };
  if (req.approvalNo != null) body.Approval_No = req.approvalNo;
  if (req.transactionUuid != null) body.transaction_uuid = req.transactionUuid;
  return { method: 'POST', path: '/pos/orders/update-cash-payment', body, timeoutMs: 12_000 };
}

export interface UpdateOnlinePaymentRequest {
  clientId: string;
  branchId: string;
  orderRef: string;
  transAmount: number;             // -> Trans_Amount (server-trusted)
  approvalNo: string;              // -> Approval_No
  cardType?: string;               // -> Card_Type
  cardNumber?: string;             // -> Card_Number (redacted from any log)
  transactionUuid?: string;        // -> transaction_uuid
}
export function buildUpdateOnlinePaymentRequest(req: UpdateOnlinePaymentRequest): LazywaitRequestSpec {
  const body: Record<string, unknown> = {
    client_id: req.clientId,
    branch_id: req.branchId,
    order_ref: req.orderRef,
    Trans_Amount: round2(req.transAmount),
    Approval_No: req.approvalNo,
  };
  if (req.cardType != null) body.Card_Type = req.cardType;
  if (req.cardNumber != null) body.Card_Number = req.cardNumber;
  if (req.transactionUuid != null) body.transaction_uuid = req.transactionUuid;
  return { method: 'POST', path: '/pos/orders/update-online-payment', body, timeoutMs: 12_000 };
}

// POST /pos/orders/void-all — void old unpaid orders (documented spelling)
export interface VoidAllRequest {
  clientId: string;
  branchId: string;
  cancelationReason?: string;      // -> cancelation_reason (documented spelling)
  olderThanMinutes?: number;
}
export function buildVoidAllRequest(req: VoidAllRequest): LazywaitRequestSpec {
  const body: Record<string, unknown> = { client_id: req.clientId, branch_id: req.branchId };
  if (req.cancelationReason != null) body.cancelation_reason = req.cancelationReason;
  if (req.olderThanMinutes != null) body.older_than = req.olderThanMinutes;
  return { method: 'POST', path: '/pos/orders/void-all', body, timeoutMs: 12_000 };
}

// ===========================================================================
// Menu products (6)
// ===========================================================================
export interface ListItemsRequest { branchId?: string; offset?: number; limit?: number; }
export function buildListItemsRequest(req: ListItemsRequest = {}): LazywaitRequestSpec {
  return {
    method: 'GET',
    path: '/menu/products/items',
    query: { branch_id: req.branchId, ...paginationQuery(req.offset, req.limit) },
  };
}

export interface GetItemRequest { menuItemId: string; }
export function buildGetItemRequest(req: GetItemRequest): LazywaitRequestSpec {
  return { method: 'GET', path: '/menu/products/item', query: { menu_item_id: req.menuItemId } };
}

/**
 * Product write body (create/upsert via POST, update-only via PUT — issue #104
 * caution to confirm). Names + prices reuse the catalog field names. The `user`
 * object schema for updates is UNCONFIRMED (issue caution) → typed as opaque.
 */
export interface ProductWriteRequest {
  menuItemId?: string;                 // present on update
  categoryId?: string | null;          // -> category_id
  nameEn?: string | null;
  nameAr?: string | null;
  prices?: Array<{ priceId?: string | null; name?: string | null; priceWithVat?: number | null }>;
  branchesIds?: string[];
  user?: Record<string, unknown>;      // UNCONFIRMED shape (issue caution)
  extra?: Record<string, unknown>;
}
function productWriteBody(req: ProductWriteRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (req.menuItemId != null) body.menu_item_id = req.menuItemId;
  if (req.categoryId != null) body.category_id = req.categoryId;
  if (req.nameEn != null) body.name_en = req.nameEn;
  if (req.nameAr != null) body.name_ar = req.nameAr;
  if (req.branchesIds) body.branches_ids = req.branchesIds;
  if (req.prices) {
    body.prices = req.prices.map((p) => {
      const o: Record<string, unknown> = {};
      if (p.priceId != null) o.price_id = p.priceId;
      if (p.name != null) o.name = p.name;
      if (p.priceWithVat != null) o.price_with_vat = round2(p.priceWithVat);
      return o;
    });
  }
  if (req.user) body.user = req.user;
  if (req.extra) Object.assign(body, req.extra);
  return body;
}
/** POST /menu/products/item — create/upsert (issue caution to confirm). */
export function buildCreateProductRequest(req: ProductWriteRequest): LazywaitRequestSpec {
  return { method: 'POST', path: '/menu/products/item', body: productWriteBody(req) };
}
/** PUT /menu/products/item — update-only (issue caution to confirm). */
export function buildUpdateProductRequest(req: ProductWriteRequest): LazywaitRequestSpec {
  return { method: 'PUT', path: '/menu/products/item', body: productWriteBody(req) };
}
/** DELETE /menu/products/item — plain-text `ok` acknowledgement. */
export interface DeleteItemRequest { menuItemId: string; }
export function buildDeleteProductRequest(req: DeleteItemRequest): LazywaitRequestSpec {
  return { method: 'DELETE', path: '/menu/products/item', query: { menu_item_id: req.menuItemId }, expectTextOk: true };
}
/** POST /menu/products/delete-items — bulk delete. */
export interface DeleteItemsBulkRequest { menuItemIds: string[]; }
export function buildDeleteProductsBulkRequest(req: DeleteItemsBulkRequest): LazywaitRequestSpec {
  return { method: 'POST', path: '/menu/products/delete-items', body: { menu_item_ids: req.menuItemIds } };
}

// ===========================================================================
// Menu categories (5)
// ===========================================================================
export function buildListCategoriesRequest(): LazywaitRequestSpec {
  return { method: 'GET', path: '/menu/products/categories' };
}
export interface CategoryWriteRequest {
  categoryId?: string;
  nameEn?: string | null;
  nameAr?: string | null;
  branchesIds?: string[];
  extra?: Record<string, unknown>;
}
function categoryWriteBody(req: CategoryWriteRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (req.categoryId != null) body.category_id = req.categoryId;
  if (req.nameEn != null) body.name_en = req.nameEn;
  if (req.nameAr != null) body.name_ar = req.nameAr;
  if (req.branchesIds) body.branches_ids = req.branchesIds;
  if (req.extra) Object.assign(body, req.extra);
  return body;
}
/** POST /menu/products/category — create/upsert. */
export function buildCreateCategoryRequest(req: CategoryWriteRequest): LazywaitRequestSpec {
  return { method: 'POST', path: '/menu/products/category', body: categoryWriteBody(req) };
}
/** PUT /menu/products/category — update. */
export function buildUpdateCategoryRequest(req: CategoryWriteRequest): LazywaitRequestSpec {
  return { method: 'PUT', path: '/menu/products/category', body: categoryWriteBody(req) };
}
/** DELETE /menu/products/category — plain-text `ok` acknowledgement. */
export interface DeleteCategoryRequest { categoryId: string; }
export function buildDeleteCategoryRequest(req: DeleteCategoryRequest): LazywaitRequestSpec {
  return { method: 'DELETE', path: '/menu/products/category', query: { category_id: req.categoryId }, expectTextOk: true };
}
/** POST /menu/products/delete-categories — bulk delete. */
export interface DeleteCategoriesBulkRequest { categoryIds: string[]; }
export function buildDeleteCategoriesBulkRequest(req: DeleteCategoriesBulkRequest): LazywaitRequestSpec {
  return { method: 'POST', path: '/menu/products/delete-categories', body: { category_ids: req.categoryIds } };
}

// ===========================================================================
// Addons (6)
// ===========================================================================
export function buildListAddonsRequest(): LazywaitRequestSpec {
  return { method: 'GET', path: '/menu/addons' };
}
export function buildListAddonGroupsRequest(): LazywaitRequestSpec {
  return { method: 'GET', path: '/menu/addons-groups' };
}
/**
 * POST /menu/addons — create/update an addon.
 * Exact documented types preserved: `alert_level` is NUMERIC, `consumption` is
 * an OBJECT (issue #104 cautions).
 */
export interface AddonWriteRequest {
  addonId?: string;
  addonsGroupId?: string | null;      // -> addons_group_id
  nameEn?: string | null;
  nameAr?: string | null;
  price?: number | null;
  alertLevel?: number | null;         // -> alert_level (NUMERIC)
  consumption?: Record<string, unknown>; // -> consumption (OBJECT)
  extra?: Record<string, unknown>;
}
export function buildCreateAddonRequest(req: AddonWriteRequest): LazywaitRequestSpec {
  const body: Record<string, unknown> = {};
  if (req.addonId != null) body.addon_id = req.addonId;
  if (req.addonsGroupId != null) body.addons_group_id = req.addonsGroupId;
  if (req.nameEn != null) body.name_en = req.nameEn;
  if (req.nameAr != null) body.name_ar = req.nameAr;
  if (req.price != null) body.price = round2(req.price);
  if (req.alertLevel != null) body.alert_level = req.alertLevel;        // numeric — not a string
  if (req.consumption != null) body.consumption = req.consumption;      // object — not a scalar
  if (req.extra) Object.assign(body, req.extra);
  return { method: 'POST', path: '/menu/addons', body };
}
/** DELETE /menu/addons/:addonId — path param. */
export interface DeleteAddonRequest { addonId: string; }
export function buildDeleteAddonRequest(req: DeleteAddonRequest): LazywaitRequestSpec {
  return { method: 'DELETE', path: `/menu/addons/${encodeURIComponent(req.addonId)}` };
}
/**
 * POST /menu/addons-groups — create/update an addon group.
 * `auto_selected_addons` and `included_custom_addons_ids` are STRING ARRAYS
 * (issue #104 cautions).
 */
export interface AddonGroupWriteRequest {
  addonsGroupId?: string;
  nameEn?: string | null;
  nameAr?: string | null;
  minSelection?: number | null;
  maxSelection?: number | null;
  multiMax?: number | null;
  autoSelectedAddons?: string[];         // -> auto_selected_addons (string[])
  includedCustomAddonsIds?: string[];    // -> included_custom_addons_ids (string[])
  extra?: Record<string, unknown>;
}
export function buildCreateAddonGroupRequest(req: AddonGroupWriteRequest): LazywaitRequestSpec {
  const body: Record<string, unknown> = {};
  if (req.addonsGroupId != null) body.addons_group_id = req.addonsGroupId;
  if (req.nameEn != null) body.name_en = req.nameEn;
  if (req.nameAr != null) body.name_ar = req.nameAr;
  if (req.minSelection != null) body.min_selection = req.minSelection;
  if (req.maxSelection != null) body.max_selection = req.maxSelection;
  if (req.multiMax != null) body.multi_max = req.multiMax;
  if (req.autoSelectedAddons) body.auto_selected_addons = asStringArray(req.autoSelectedAddons);
  if (req.includedCustomAddonsIds) body.included_custom_addons_ids = asStringArray(req.includedCustomAddonsIds);
  if (req.extra) Object.assign(body, req.extra);
  return { method: 'POST', path: '/menu/addons-groups', body };
}
/** DELETE /menu/addons-groups/:addonsGroupId — path param. */
export interface DeleteAddonGroupRequest { addonsGroupId: string; }
export function buildDeleteAddonGroupRequest(req: DeleteAddonGroupRequest): LazywaitRequestSpec {
  return { method: 'DELETE', path: `/menu/addons-groups/${encodeURIComponent(req.addonsGroupId)}` };
}

// ===========================================================================
// Platform (1)
// ===========================================================================
export function buildListBranchesRequest(): LazywaitRequestSpec {
  return { method: 'GET', path: '/platform/branches' };
}

// ===========================================================================
// The client — binds a config and executes the specs via lazywaitFetch
// ===========================================================================
export interface LazywaitApiClientOptions { defaultTimeoutMs?: number; }

function finalize<T>(res: LazywaitResponse<unknown>, validation: ValidationResult<T>): LazywaitApiResult<T> {
  return {
    ok: res.ok,
    status: res.status,
    valid: validation.ok,
    data: validation.ok ? validation.value : null,
    issues: validation.issues,
    error: res.error ? redactSecretsInString(res.error) : null,
  };
}

export function createLazywaitApiClient(cfg: LazywaitConfig, opts: LazywaitApiClientOptions = {}) {
  const baseCfg: LazywaitConfig = { ...cfg, baseUrl: cfg.baseUrl || DEFAULT_BASE_URL };
  const defTimeout = opts.defaultTimeoutMs ?? 15_000;

  async function run<T>(spec: LazywaitRequestSpec, parse: (res: LazywaitResponse<unknown>) => ValidationResult<T>): Promise<LazywaitApiResult<T>> {
    const res = await lazywaitFetch<unknown>(baseCfg, {
      method: spec.method, path: spec.path, query: spec.query, body: spec.body,
      timeoutMs: spec.timeoutMs ?? defTimeout,
    });
    return finalize(res, parse(res));
  }

  return {
    // ---- POS orders --------------------------------------------------------
    getOrder: (req: GetOrderRequest) => run(buildGetOrderRequest(req), (r) => parseOrderResponse(r.data)),
    getActiveOrders: (req?: ActiveOrdersRequest) => run(buildActiveOrdersRequest(req), (r) => parseOrderListResponse(r.data)),
    searchOrders: (req: SearchOrdersRequest) => run(buildSearchOrdersRequest(req), (r) => parseOrderListResponse(r.data)),
    fetchOrders: (req: FetchOrdersRequest) => run(buildFetchOrdersRequest(req), (r) => parseOrderListResponse(r.data)),
    updateOrder: (req: UpdateOrderRequest) => run(buildUpdateOrderRequest(req), (r) => parseOrderResponse(r.data)),

    /**
     * POST /pos/orders/create. Enforces the no-blind-resend invariant: if the
     * order already carries a Lazywait ref, it is NOT re-sent (Create Order has
     * no idempotency key). The HTTP outcome is classified with the shared
     * `classifyCreateOrderResult` safety classifier — a customer is never told
     * "confirmed" without a usable order_ref.
     */
    async createOrder(req: CreateOrderRequest, guard?: { existingRef?: string | null }): Promise<CreateOrderApiResult> {
      if (!shouldResendCreateOrder({ lazywait_ref: guard?.existingRef ?? null })) {
        return { sent: false, blockedReason: 'already_created_no_resend', outcome: null, status: 0, error: null };
      }
      const built = buildCreateOrderRequest(req);
      if (!built.ok) {
        return { sent: false, blockedReason: built.blockedReason, outcome: null, status: 0, error: null };
      }
      const res = await lazywaitFetch<{ success?: boolean; order?: Record<string, unknown> }>(baseCfg, {
        method: built.spec.method, path: built.spec.path, body: built.spec.body, timeoutMs: built.spec.timeoutMs ?? defTimeout,
      });
      const outcome = classifyCreateOrderResult({ status: res.status, data: res.data, error: res.error });
      return {
        sent: true, blockedReason: null, outcome, status: res.status,
        error: res.error ? redactSecretsInString(res.error) : null,
      };
    },

    // ---- Payments (Tap freeze — typed transport, not wired live) -----------
    updateCashPayment: (req: UpdateCashPaymentRequest) => run(buildUpdateCashPaymentRequest(req), (r) => parseSuccessResponse(r.data)),
    updateOnlinePayment: (req: UpdateOnlinePaymentRequest) => run(buildUpdateOnlinePaymentRequest(req), (r) => parseSuccessResponse(r.data)),
    voidAll: (req: VoidAllRequest) => run(buildVoidAllRequest(req), (r) => parseSuccessResponse(r.data)),

    // ---- Menu products -----------------------------------------------------
    listItems: (req?: ListItemsRequest) => run(buildListItemsRequest(req), (r) => parseCatalogListResponse('item', r.data)),
    getItem: (req: GetItemRequest) => run(buildGetItemRequest(req), (r) => parseCatalogListResponse('item', r.data)),
    createProduct: (req: ProductWriteRequest) => run(buildCreateProductRequest(req), (r) => parseSuccessResponse(r.data)),
    updateProduct: (req: ProductWriteRequest) => run(buildUpdateProductRequest(req), (r) => parseSuccessResponse(r.data)),
    deleteProduct: (req: DeleteItemRequest) => run(buildDeleteProductRequest(req), (r) => parseDeleteResponse(r)),
    deleteProductsBulk: (req: DeleteItemsBulkRequest) => run(buildDeleteProductsBulkRequest(req), (r) => parseSuccessResponse(r.data)),

    // ---- Menu categories ---------------------------------------------------
    listCategories: () => run(buildListCategoriesRequest(), (r) => parseCatalogListResponse('category', r.data)),
    createCategory: (req: CategoryWriteRequest) => run(buildCreateCategoryRequest(req), (r) => parseSuccessResponse(r.data)),
    updateCategory: (req: CategoryWriteRequest) => run(buildUpdateCategoryRequest(req), (r) => parseSuccessResponse(r.data)),
    deleteCategory: (req: DeleteCategoryRequest) => run(buildDeleteCategoryRequest(req), (r) => parseDeleteResponse(r)),
    deleteCategoriesBulk: (req: DeleteCategoriesBulkRequest) => run(buildDeleteCategoriesBulkRequest(req), (r) => parseSuccessResponse(r.data)),

    // ---- Addons ------------------------------------------------------------
    listAddons: () => run(buildListAddonsRequest(), (r) => parseCatalogListResponse('addon', r.data)),
    listAddonGroups: () => run(buildListAddonGroupsRequest(), (r) => parseCatalogListResponse('addon_group', r.data)),
    createAddon: (req: AddonWriteRequest) => run(buildCreateAddonRequest(req), (r) => parseSuccessResponse(r.data)),
    deleteAddon: (req: DeleteAddonRequest) => run(buildDeleteAddonRequest(req), (r) => parseSuccessResponse(r.data)),
    createAddonGroup: (req: AddonGroupWriteRequest) => run(buildCreateAddonGroupRequest(req), (r) => parseSuccessResponse(r.data)),
    deleteAddonGroup: (req: DeleteAddonGroupRequest) => run(buildDeleteAddonGroupRequest(req), (r) => parseSuccessResponse(r.data)),

    // ---- Platform ----------------------------------------------------------
    listBranches: () => run(buildListBranchesRequest(), (r) => parseCatalogListResponse('branch', r.data)),
  };
}

export type LazywaitApiClient = ReturnType<typeof createLazywaitApiClient>;
