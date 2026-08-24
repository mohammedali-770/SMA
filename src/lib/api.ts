/**
 * Typed data-access layer over Supabase (PostgREST + RLS + RPCs).
 *
 * Every function here maps to a table/RPC created by the supabase/ migrations.
 * RLS is enforced server-side, so these calls are safe to run from the client:
 * anon can read active catalog + settings; authenticated customers see only
 * their own orders/addresses; admins manage catalog/coupons and advance order
 * status; accountants read-only. Orders are created only via the place_order
 * RPC, which recomputes all amounts server-side.
 */
import { supabase } from './supabase';
import { BANNER_BUCKET, bannerStoragePath } from './banners';
import { classifyWatchdogProbe, WatchdogCapability } from './orderIntegrityCapability';
import {
  BranchDependencyCounts, BranchHasDependenciesError,
  branchHasBlockingDependencies, isBranchDependencyError,
} from './branchDeletion';

// ---------------------------------------------------------------------------
// Row types (subset of columns the app uses).
// ---------------------------------------------------------------------------
export type { UserRole } from './roles';
import type { UserRole } from './roles';
export type OrderStatus =
  | 'received' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type OrderType = 'delivery' | 'pickup';

export interface DbBranch {
  id: string; name_en: string; name_ar: string;
  address_en: string | null; address_ar: string | null; phone: string | null;
  email?: string | null;
  latitude: number | null; longitude: number | null;
  delivery_fee: number; min_delivery_order: number; is_active: boolean;
  lazywait_branch_id?: string | null;
  // Delivery-zone feature (admin-configured operational flags).
  delivery_enabled?: boolean;
  pickup_enabled?: boolean;
  delivery_temporarily_closed?: boolean;
  /**
   * Scheduled resume time for a TIMED pause. Null on the admin's untimed toggle.
   * `delivery_temporarily_closed` stays the authoritative flag; this is only when
   * the sweeper will lift it. Public-safe by design — the reason code and the
   * staff actor live on `branch_delivery_events`, which anon cannot read.
   */
  delivery_closed_until?: string | null;
  estimated_delivery_minutes?: number | null;
}
/** An active per-branch delivery coverage polygon (non-secret; safe columns only). */
export interface DbBranchDeliveryZone {
  id: string;
  branch_id: string;
  name: string | null;
  zone_geojson: unknown; // GeoJSON Geometry (Polygon | MultiPolygon)
  is_active: boolean;
}
export interface DbCategory { id: string; name_en: string; name_ar: string; sort_order: number; is_active: boolean; lazywait_category_id?: string | null; }
export interface DbProduct {
  id: string; category_id: string; name_en: string; name_ar: string;
  description_en: string | null; description_ar: string | null;
  price: number; calories: number | null; image_url: string | null;
  is_active: boolean; sort_order: number;
  lazywait_item_id?: string | null; lazywait_price_id?: string | null;
  lazywait_price_ref?: LazywaitPriceRef | null;
}
export interface DbModifierGroup {
  id: string; name_en: string; name_ar: string;
  min_select: number; max_select: number | null; is_required: boolean;
  lazywait_group_id?: string | null;
}
export interface DbModifier {
  id: string; group_id: string; name_en: string; name_ar: string;
  price: number; sort_order: number; is_active: boolean;
  lazywait_addon_id?: string | null;
}
export interface DbProductModifierGroup { product_id: string; group_id: string; sort_order: number; }
export interface DbBranchAvailability { branch_id: string; product_id: string; is_available: boolean; }
export interface DbAppSettings {
  id: boolean; brand_name_en: string; brand_name_ar: string;
  primary_color: string; secondary_color: string; currency: string;
  vat_percentage: number; loyalty_enabled: boolean;
  points_per_riyal: number; discount_per_point: number; min_points_to_redeem: number;
  // Payment-method availability (non-secret; admin-editable, public-readable).
  online_payment_enabled?: boolean; cash_payment_enabled?: boolean;
  default_payment_method?: 'online' | 'cash' | null; payment_outage_mode_enabled?: boolean;
  // Contact & Support channels (non-secret; admin-editable, public-readable;
  // each channel is hidden in the app until configured AND enabled).
  support_phone?: string | null; support_whatsapp?: string | null; support_email?: string | null;
  support_hours_en?: string | null; support_hours_ar?: string | null;
  support_desc_en?: string | null; support_desc_ar?: string | null;
  support_phone_enabled?: boolean; support_whatsapp_enabled?: boolean; support_email_enabled?: boolean;
}
export interface DbProfile {
  id: string; full_name: string | null; phone_number: string | null;
  email: string | null; role: UserRole; loyalty_points: number;
  phone_verified?: boolean; phone_verified_at?: string | null;
}
export interface DbAddress {
  id: string; customer_id: string; label: string | null; description: string | null;
  national_short_address: string | null; latitude: number | null; longitude: number | null;
  is_default: boolean;
}
export type DbSyncStatus = 'not_synced' | 'syncing' | 'synced' | 'failed';
export interface DbOrder {
  id: string; order_number: string; customer_id: string | null;
  customer_name: string | null; customer_phone: string | null;
  branch_id: string; branch_name_en: string | null; branch_name_ar: string | null;
  status: OrderStatus; order_type: OrderType;
  subtotal: number; delivery_fee: number; discount_amount: number;
  loyalty_discount_amount: number; vat_amount: number; total: number;
  payment_status: 'pending' | 'paid'; payment_method: string | null;
  payment_provider?: string | null; paid_at?: string | null;
  coupon_code: string | null; notes: string | null; created_at: string;
  // Extra columns returned by `select('*')` that the app maps for display.
  sync_status: DbSyncStatus; address_snapshot: Record<string, unknown> | null;
  loyalty_points_earned: number; loyalty_points_redeemed: number;
  // Lazywait POS sync tracking (see 20260708130000_lazywait_integration).
  lazywait_sync_state?: LazywaitSyncState; lazywait_ref?: string | null;
  lazywait_order_id?: string | null; lazywait_order_number?: string | null;
  lazywait_status?: string | null; sync_attempt_count?: number;
  sync_next_attempt_at?: string | null; sync_last_error?: string | null;
  sync_blocked_reason?: string | null; synced_at?: string | null;
  // Customer-confirmation lifecycle (see 20260721120000). Drive the deadline-safe
  // manual-retry eligibility check; never customer secrets.
  pos_sync_deadline_at?: string | null; pos_create_attempted_at?: string | null;
}
export type LazywaitSyncState =
  | 'pending' | 'syncing' | 'synced' | 'failed' | 'blocked' | 'dead_letter' | 'skipped'
  | 'awaiting_payment' | 'confirmation_required';

// ---- Ranged report feed ----------------------------------------------------
/**
 * One order line item as the REPORT feed returns it. Deliberately narrower than
 * `DbOrderItem`: no id, no order_id and no modifiers, because the reports
 * aggregate by product and never render a line.
 */
export interface DbReportOrderItem {
  product_id: string | null;
  name_en: string; name_ar: string;
  unit_price: number; quantity: number;
}
/**
 * One order as the REPORT feed returns it (`admin_list_orders_for_range`).
 *
 * NOT a subset of `DbOrder` by accident — the missing fields are the point.
 * There is no customer_name, customer_phone, customer_id, notes or
 * address_snapshot here because running a financial report has no business
 * pulling customer PII into a browser.
 */
export interface DbReportOrder {
  id: string; order_number: string;
  branch_id: string; branch_name_en: string | null; branch_name_ar: string | null;
  status: OrderStatus; order_type: OrderType;
  subtotal: number; delivery_fee: number; discount_amount: number;
  loyalty_discount_amount: number; vat_amount: number; total: number;
  coupon_code: string | null; created_at: string;
  sync_status: DbSyncStatus;
  lazywait_sync_state?: LazywaitSyncState | null;
  lazywait_ref?: string | null; lazywait_order_number?: string | null;
  sync_last_error?: string | null; sync_blocked_reason?: string | null;
  order_items: DbReportOrderItem[];
}
/**
 * The report-feed envelope. `limit_exceeded` means the window held more orders
 * than `max_rows` and the server returned NONE of them — `orders` is empty and
 * `row_count` is the true size, so the console can say how far over it is.
 */
export interface AdminOrderRange {
  row_count: number;
  max_rows: number;
  limit_exceeded: boolean;
  orders: DbReportOrder[];
}

// ---- Aggregate dashboard stats ---------------------------------------------
export interface AdminBranchStats {
  branch_id: string;
  sales: number;
  order_count: number;
}
/**
 * Server-side equivalents of the sums StatsPanel used to compute over the whole
 * in-memory order list. `total_amount` spans EVERY status, including cancelled,
 * because that is what the average-ticket tile has always divided by.
 */
export interface AdminOrderStats {
  total_orders: number;
  total_amount: number;
  delivered_revenue: number;
  active_orders: number;
  branches: AdminBranchStats[];
}

// ---- Lazywait catalog mapping ---------------------------------------------
/** Reference-only price snapshot chosen from a Lazywait item's price list. */
export interface LazywaitPriceRef {
  price_id?: string | null; name?: string | null;
  price_with_vat?: number | null; price_excl_vat?: number | null;
}
export type LazywaitCatalogEntity = 'branch' | 'category' | 'item' | 'addon' | 'addon_group';
/** Local entity a mapping is confirmed onto (maps to set/clear_lazywait_mapping). */
export type LazywaitMappingEntity = 'branch' | 'category' | 'product' | 'modifier_group' | 'modifier';
/** A pulled Lazywait catalog record (cache; non-secret names/ids/prices only). */
export interface DbLazywaitCatalogItem {
  id: string; entity_type: LazywaitCatalogEntity; lazywait_id: string;
  name_en: string | null; name_ar: string | null; name_other: string | null;
  parent_id: string | null; prices: LazywaitPriceRef[] | null; branches_ids: string[] | null;
  min_selection: number | null; max_selection: number | null; multi_max: number | null;
  pulled_at: string;
}
export interface LazywaitMappingCount { mapped: number; total: number; }
export interface LazywaitMappingStatus {
  branches: LazywaitMappingCount; categories: LazywaitMappingCount; products: LazywaitMappingCount;
  modifier_groups: LazywaitMappingCount; modifiers: LazywaitMappingCount;
  blocked_orders: number; secrets_configured: boolean; last_pull_at: string | null;
  readiness: {
    secrets: boolean; branch_mapped: boolean; active_products_mapped: boolean;
    no_blocked_orders: boolean; ready: boolean;
  };
}
export interface LazywaitPullResult {
  status: 'success' | 'partial' | 'error';
  counts: Record<string, number>;
  errors: { endpoint: string; message: string }[];
  pulled_at: string;
}
/** Result of import_lazywait_catalog() — Lazywait catalog applied to the local menu. */
export interface LazywaitImportResult {
  categories: { created: number; updated: number; deactivated: number };
  products: { created: number; updated: number; deactivated: number };
  branches: { created: number; updated: number };
}
export interface DbLoyaltyTransaction {
  id: string; profile_id: string; order_id: string | null;
  type: 'earn' | 'redeem' | 'adjustment'; points: number;
  balance_after: number | null; reason: string | null; created_at: string;
}
/** NON-secret projection of an integration_settings row (secrets never sent). */
export interface DbIntegrationSetting {
  provider_type: 'payment' | 'sms' | 'push' | 'lazywait' | 'whatsapp' | 'email';
  provider_name: string | null;
  enabled: boolean;
  public_config: Record<string, unknown>;
  has_secret: boolean;
  updated_at: string;
}
export interface DbOrderItem {
  id: string; order_id: string; product_id: string | null;
  name_en: string; name_ar: string; unit_price: number; quantity: number; line_total: number;
}
export interface DbOrderItemModifier {
  id: string; order_item_id: string; modifier_id: string | null;
  name_en: string; name_ar: string; price: number;
}
/** An order row with its items + modifiers embedded via PostgREST resource embedding. */
export type DbOrderWithItems = DbOrder & {
  order_items: (DbOrderItem & { order_item_modifiers: DbOrderItemModifier[] })[];
};
export interface DbCoupon {
  id: string; code: string; type: 'percentage' | 'fixed'; value: number;
  is_active: boolean; min_order_amount: number; max_discount_amount: number | null;
  usage_limit: number | null; usage_count: number;
}

/**
 * Whether an error is PostgREST failing to find an RPC, rather than the RPC
 * failing.
 *
 * These two are worth telling apart in the UI. A missing function means a
 * migration in the repository has not been applied to this project yet — an
 * operational state with a known fix — whereas anything else is a real fault.
 * Raw, it surfaces as "Could not find the function public.x in the schema
 * cache", which reads to an operator as a bug.
 */
export function isMissingFunctionError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /could not find the function/i.test(message)
    || /PGRST202/.test(message);
}

/** Small wrapper so callers get a value or a thrown Error (never a silent null). */
function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// ---------------------------------------------------------------------------
// Auth / session
// ---------------------------------------------------------------------------
export const auth = {
  async getSession() {
    return (await supabase.auth.getSession()).data.session;
  },
  onChange(cb: (userId: string | null) => void) {
    return supabase.auth.onAuthStateChange((_e, session) => cb(session?.user?.id ?? null));
  },
  async signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  },
  async signUp(email: string, password: string, fullName: string, phone?: string) {
    const { error } = await supabase.auth.signUp({
      email, password, options: { data: { full_name: fullName, phone } },
    });
    if (error) throw new Error(error.message);
  },
  async signOut() { await supabase.auth.signOut(); },
  async myProfile(): Promise<DbProfile | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    return ok(await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle());
  },
};

// ---------------------------------------------------------------------------
// Profiles (RLS: a customer reads only their own row; staff read all)
// ---------------------------------------------------------------------------
export const profiles = {
  list: async () =>
    ok<DbProfile[]>(await supabase.from('profiles').select('*').order('full_name')),
};

// ---------------------------------------------------------------------------
// Loyalty (server-authoritative point mutations)
// ---------------------------------------------------------------------------
export const loyalty = {
  /**
   * Admin-only manual point adjustment (delta may be negative). RLS/`is_admin()`
   * inside the RPC rejects non-admins. Earning + checkout redemption are handled
   * atomically inside place_order, not here. Writes a ledger row.
   */
  async adjustPoints(customerId: string, delta: number, reason?: string): Promise<DbProfile> {
    return ok<DbProfile>(await supabase.rpc('adjust_loyalty_points', {
      p_customer_id: customerId, p_delta: delta, p_reason: reason ?? null,
    }));
  },
  /** The signed-in customer's loyalty ledger (RLS: own rows; staff see all). */
  myLedger: async () =>
    ok<DbLoyaltyTransaction[]>(await supabase
      .from('loyalty_transactions').select('*').order('created_at', { ascending: false })),
};

// ---------------------------------------------------------------------------
// Integration settings (admin-only; secrets never returned — see migration)
// ---------------------------------------------------------------------------
export interface UpsertIntegrationInput {
  providerType: DbIntegrationSetting['provider_type'];
  providerName: string;
  enabled: boolean;
  publicConfig: Record<string, unknown>;
  /** Only send when the admin entered a NEW secret; omit/null keeps the stored one. */
  secretConfig?: Record<string, unknown> | null;
}
export const integrations = {
  /** Admin-only. Returns the non-secret projection (`has_secret` flag only). */
  list: async () => ok<DbIntegrationSetting[]>(await supabase.rpc('list_integration_settings')),
  async upsert(input: UpsertIntegrationInput): Promise<DbIntegrationSetting> {
    const rows = ok<DbIntegrationSetting[]>(await supabase.rpc('upsert_integration_settings', {
      p_provider_type: input.providerType,
      p_provider_name: input.providerName,
      p_enabled: input.enabled,
      p_public_config: input.publicConfig,
      p_secret_config: input.secretConfig ?? null,
    }));
    return rows[0];
  },
};

// ---------------------------------------------------------------------------
// WhatsApp OTP admin controls (status + test send via Edge Function). No secret
// ever crosses this boundary — the function returns booleans / generic results.
// ---------------------------------------------------------------------------
export interface WhatsAppOtpStatus {
  status: string;
  enabled: boolean;
  provider: string;
  graph_api_version: string | null;
  phone_number_id_set: boolean;
  business_account_id_set: boolean;
  template_ar_set: boolean;
  template_en_set: boolean;
  access_token_set: boolean;
  app_secret_set: boolean;
  webhook_verify_token_set: boolean;
  pepper_set: boolean;
  login_enabled?: boolean;
  send_sms_hook_secret_set?: boolean;
}
async function invokeWhatsAppTestConfig<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('whatsapp-test-config', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try { const b = ctx?.json ? await ctx.json() : null; if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return data as T;
}
export const whatsappOtp = {
  /** Admin-only: config status booleans (no secret values). */
  status: () => invokeWhatsAppTestConfig<WhatsAppOtpStatus>({ action: 'status' }),
  /** Admin-only: send a test OTP (never reveals the code). */
  testSend: (phone: string, language: 'ar' | 'en') =>
    invokeWhatsAppTestConfig<{ ok: boolean; message?: string; status?: string }>({ action: 'test_send', phone, language }),
};

// ---------------------------------------------------------------------------
// Email server (SMTP) admin controls (status + test send via Edge Function).
// The SMTP password never crosses this boundary — only booleans / generic results.
// ---------------------------------------------------------------------------
export interface EmailServerStatus {
  status: string;
  enabled: boolean;
  provider: string;
  host_set: boolean;
  port: string | null;
  secure: boolean;
  username_set: boolean;
  from_email_set: boolean;
  from_name: string | null;
  reply_to_set: boolean;
  password_set: boolean;
}
async function invokeEmailTestConfig<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('email-test-config', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try { const b = ctx?.json ? await ctx.json() : null; if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return data as T;
}
export const emailServer = {
  /** Admin-only: SMTP config status booleans (no secret values). */
  status: () => invokeEmailTestConfig<EmailServerStatus>({ action: 'status' }),
  /** Admin-only: send a test email via the stored SMTP settings. */
  testSend: (to: string) =>
    invokeEmailTestConfig<{ ok: boolean; message?: string }>({ action: 'test_send', to }),
};

// ---------------------------------------------------------------------------
// Tap Payments admin controls. Secret keys never cross this boundary — only
// readiness booleans / generic results. `record` is a staff read of the safe
// payment_records columns (no raw provider payload, no secrets).
// ---------------------------------------------------------------------------
export interface PaymentGatewayStatus {
  status: string;
  provider: string | null;
  enabled: boolean;
  mode: 'test' | 'live';
  currency: string;
  source_id: string;
  merchant_id_set: boolean;
  test_key_set: boolean;
  live_key_set: boolean;
  active_key_set: boolean;
  expiry_minutes: number;
  /**
   * Moyasar-only readiness. Optional because the Tap branch of
   * payment-test-config does not emit them; a Tap status simply leaves them
   * undefined rather than reporting a value that would mean nothing.
   */
  webhook_secret_set?: boolean;
  key_prefix_ok?: boolean;
  config_ok?: boolean;
  config_reason?: string | null;
}
export interface DbPaymentRecord {
  id: string;
  order_id: string;
  provider: string;
  provider_ref: string | null;
  status: 'initiated' | 'authorized' | 'paid' | 'failed' | 'refunded';
  amount: number;
  currency: string;
  mode: 'test' | 'live' | null;
  card_scheme: string | null;
  card_last_four: string | null;
  failure_code: string | null;
  failure_message_safe: string | null;
  confirmed_at: string | null;
  last_verified_at: string | null;
  created_at: string;
}
async function invokePaymentTestConfig<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('payment-test-config', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try { const b = ctx?.json ? await ctx.json() : null; if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return data as T;
}
export const paymentGateway = {
  /** Admin-only: active payment provider's config readiness booleans (no secret values). */
  status: () => invokePaymentTestConfig<PaymentGatewayStatus>({ action: 'status' }),
  /** Admin-only: validate the selected-mode key against Tap (never creates a charge). */
  testConnection: () => invokePaymentTestConfig<{ ok: boolean; message?: string }>({ action: 'test_connection' }),
  /** Admin-only: re-verify an order's payment via Tap Retrieve Charge (only CAPTURED confirms). */
  adminVerify: (orderId: string) =>
    invokePaymentTestConfig<{ status: string; message?: string }>({ action: 'verify_order', orderId }),
  /**
   * Admin-only: create an isolated 1 SAR TEST checkout (no order created).
   * Returns the hosted URL. Tap creates a charge; Moyasar creates an invoice and
   * echoes its id in BOTH `chargeId` and `invoiceId`, so the result lookup below
   * takes the same argument for either provider.
   */
  testCheckout: () =>
    invokePaymentTestConfig<{ ok: boolean; message?: string; chargeId?: string; invoiceId?: string; checkoutUrl?: string; mode?: string; tapErrorCode?: string | null; tapErrorDescription?: string | null; providerErrorCode?: string | null; providerErrorDescription?: string | null; httpStatus?: number }>({ action: 'test_checkout' }),
  /** Admin-only: verify the admin test charge/invoice server-side (display only — never confirms an order). */
  testCheckoutResult: (chargeId: string) =>
    invokePaymentTestConfig<{ ok: boolean; message?: string; chargeId?: string; invoiceId?: string; status?: string; amount?: number; currency?: string; mode?: string; messageKey?: string }>({ action: 'test_checkout_result', chargeId }),
  /** Staff read of the latest safe payment record for an order (no raw/secret). */
  async record(orderId: string): Promise<DbPaymentRecord | null> {
    const rows = ok<DbPaymentRecord[]>(await supabase
      .from('payment_records')
      .select('id, order_id, provider, provider_ref, status, amount, currency, mode, card_scheme, card_last_four, failure_code, failure_message_safe, confirmed_at, last_verified_at, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1));
    return rows[0] ?? null;
  },
};

// ---------------------------------------------------------------------------
// Lazywait catalog mapping (admin pull + confirm; secrets stay server-side)
// ---------------------------------------------------------------------------
export const lazywaitCatalog = {
  /** Staff read of the pulled catalog cache (RLS: is_staff). */
  items: async () =>
    ok<DbLazywaitCatalogItem[]>(await supabase.from('lazywait_catalog_items').select('*')),
  /** Staff readiness + mapped/total summary (never returns secrets). */
  status: async () => ok<LazywaitMappingStatus>(await supabase.rpc('lazywait_mapping_status')),
  /** Admin-only: trigger the server-side catalog pull (Edge Function). */
  async pull(): Promise<LazywaitPullResult> {
    const { data, error } = await supabase.functions.invoke('lazywait-catalog', { body: { action: 'pull' } });
    if (error) {
      let msg = error.message;
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      try { const body = ctx?.json ? await ctx.json() : null; if (body?.error) msg = body.error; } catch { /* keep msg */ }
      throw new Error(msg);
    }
    return data as LazywaitPullResult;
  },
  /**
   * Admin-only: import the pulled Lazywait catalog INTO the local menu (Lazywait
   * = source of truth). Creates/updates categories + products, syncs branch
   * names, and deactivates local rows not present in the latest pull. Reversible
   * (deactivates, never deletes); place_order still prices server-side.
   */
  async importToApp(): Promise<LazywaitImportResult> {
    return ok<LazywaitImportResult>(await supabase.rpc('import_lazywait_catalog'));
  },
  /** Admin-only: confirm a mapping id onto a local record (+ optional product price ref). */
  async setMapping(entity: LazywaitMappingEntity, localId: string, lazywaitId: string, priceRef?: LazywaitPriceRef | null) {
    const { error } = await supabase.rpc('set_lazywait_mapping', {
      p_entity: entity, p_local_id: localId, p_lazywait_id: lazywaitId, p_price_ref: priceRef ?? null,
    });
    if (error) throw new Error(error.message);
  },
  /** Admin-only: clear a mapping (+ price ref for products). */
  async clearMapping(entity: LazywaitMappingEntity, localId: string) {
    const { error } = await supabase.rpc('clear_lazywait_mapping', { p_entity: entity, p_local_id: localId });
    if (error) throw new Error(error.message);
  },
};

// ---------------------------------------------------------------------------
// Catalog (public reads)
// ---------------------------------------------------------------------------
export const catalog = {
  branches: async () => ok<DbBranch[]>(await supabase.from('branches').select('*').order('name_en')),
  categories: async () => ok<DbCategory[]>(await supabase.from('categories').select('*').order('sort_order')),
  products: async () => ok<DbProduct[]>(await supabase.from('products').select('*').order('sort_order')),
  modifierGroups: async () => ok<DbModifierGroup[]>(await supabase.from('modifier_groups').select('*')),
  modifiers: async () => ok<DbModifier[]>(await supabase.from('modifiers').select('*').order('sort_order')),
  productModifierGroups: async () =>
    ok<DbProductModifierGroup[]>(await supabase.from('product_modifier_groups').select('*')),
  availability: async () =>
    ok<DbBranchAvailability[]>(await supabase.from('branch_product_availability').select('*')),
  settings: async () =>
    ok<DbAppSettings>(await supabase.from('app_settings').select('*').eq('id', true).single()),
  /** Active delivery zones (safe columns only — never `updated_by`). RLS returns
   *  active zones to everyone and all zones to staff. */
  deliveryZones: async () =>
    ok<DbBranchDeliveryZone[]>(await supabase
      .from('branch_delivery_zones')
      .select('id, branch_id, name, zone_geojson, is_active')
      .eq('is_active', true)),
  /** Fetch the whole menu graph in parallel. */
  async all() {
    const [branches, categories, products, modifierGroups, modifiers, links, availability, settings, deliveryZones] =
      await Promise.all([
        this.branches(), this.categories(), this.products(), this.modifierGroups(),
        this.modifiers(), this.productModifierGroups(), this.availability(), this.settings(),
        this.deliveryZones(),
      ]);
    return { branches, categories, products, modifierGroups, modifiers, links, availability, settings, deliveryZones };
  },
};

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Recent-orders window the admin live poll fetches to keep the frequent refetch
 *  bounded. The full load (which the reports read from) is intentionally UNBOUNDED
 *  so no delivered order is ever dropped from a report. */
export const ORDERS_POLL_LIMIT = 500;

export interface PlaceOrderInput {
  branchId: string;
  orderType: OrderType;
  items: { product_id: string; quantity: number; modifier_ids?: string[] }[];
  addressId?: string | null;
  couponCode?: string | null;
  notes?: string | null;
  loyaltyPoints?: number;
  /** Retry-safe key: a repeated submit with the same key returns the same order. */
  idempotencyKey?: string | null;
  /** 'online' | 'cash' — validated server-side against admin payment settings. */
  paymentMethod?: 'online' | 'cash' | null;
}
/** One row of the read-only "Orders Requiring Verification" admin feed (safe fields only). */
export interface PosConfirmationRequiredItem {
  id: string;
  order_number: string;
  order_type: string;
  total: number;
  created_at: string;
  pos_sync_started_at: string | null;
  first_pos_sync_failure_at: string | null;
  /** Stable machine reason: timeout | connection | missing_ref | ambiguous_response | provider_5xx. */
  reason: string;
}
export interface PosConfirmationRequired {
  total: number;
  items: PosConfirmationRequiredItem[];
}

// The columns a CUSTOMER holds SELECT privilege on for `public.orders` after
// migration 20260724200000. Mirrors the column grant EXACTLY. `select('*')` is
// no longer valid for a customer — it would request columns they cannot read and
// PostgREST would return a privilege error. The internal `SM-…` order number and
// every operational column are absent.
// Typed `string` (not a string literal) on purpose: supabase-js infers the row
// TYPE from a literal select, which would then be a narrow subset that no longer
// satisfies DbOrderWithItems. The subset is CORRECT at runtime (mapOrder reads
// the internal fields as undefined, which the web customer path never renders —
// it redirects to /app), so we keep the shared DbOrderWithItems shape and let
// the string stay loose. The DB grant is the real enforcement point.
const CUSTOMER_ORDER_COLUMNS =
  'id, status, order_type, created_at, branch_id, branch_name_en, branch_name_ar, subtotal, delivery_fee, discount_amount, loyalty_discount_amount, vat_amount, total, loyalty_points_earned, payment_status, payment_method, lazywait_order_number, lazywait_sync_state, lazywait_ref, sync_blocked_reason, sync_next_attempt_at, pos_create_attempted_at, pos_customer_retry_count, refund_state';
const CUSTOMER_ORDER_WITH_ITEMS_SELECT: string =
  `${CUSTOMER_ORDER_COLUMNS}, order_items(*, order_item_modifiers(*))`;

export const orders = {
  /**
   * Server-authoritative order creation. Calls `place_customer_order`, a thin
   * wrapper over the UNCHANGED `place_order`: identical pricing, coupon, VAT,
   * loyalty, transactionality and idempotency, but it returns an explicit
   * customer-safe projection (no order_number, no pos_create_attempt_token, no
   * internals) instead of the whole `public.orders` row. `place_order` itself is
   * no longer granted to `authenticated` (20260724200000).
   */
  async place(input: PlaceOrderInput): Promise<DbOrder> {
    return ok<DbOrder>(await supabase.rpc('place_customer_order', {
      p_branch_id: input.branchId,
      p_order_type: input.orderType,
      p_items: input.items,
      p_address_id: input.addressId ?? null,
      p_coupon_code: input.couponCode ?? null,
      p_notes: input.notes ?? null,
      p_loyalty_points: input.loyaltyPoints ?? 0,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_payment_method: input.paymentMethod ?? null,
    }));
  },
  /**
   * STAFF flat order feed (no line items) — the Lazywait operations panel. Goes
   * through the SECURITY DEFINER `admin_list_orders` RPC, which enforces
   * `is_staff()` server-side and returns the staff column set (including
   * order_number and the POS diagnostics staff need). Staff hold NO direct SELECT
   * privilege on `public.orders` any more, so this RPC — not a table read — is
   * the staff contract. It runs with the staff member's own JWT; no service-role
   * key is involved.
   */
  list: async () =>
    ok<DbOrder[]>(await supabase.rpc('admin_list_orders', { p_limit: null })),
  /**
   * CUSTOMER order feed with items. `public.orders` no longer grants table-wide
   * SELECT to `authenticated`; a customer holds column privileges for exactly the
   * safe columns above, so `select('*')` would now fail. Embedded item/modifier
   * relations stay scoped to the owner by RLS. Staff must use
   * `adminListWithItems()` instead.
   */
  listWithItems: async (limit?: number) => {
    let q = supabase
      .from('orders')
      .select(CUSTOMER_ORDER_WITH_ITEMS_SELECT)
      .order('created_at', { ascending: false });
    if (limit) q = q.limit(limit);
    // The select is a loose `string` (see CUSTOMER_ORDER_COLUMNS), so supabase-js
    // yields GenericStringError instead of a row type; the runtime rows are the
    // customer-safe subset, mapped as the shared DbOrderWithItems shape (internal
    // fields read as undefined and are never rendered on the web customer path).
    const res = (await q) as unknown as { data: DbOrderWithItems[] | null; error: { message: string } | null };
    return ok<DbOrderWithItems[]>(res);
  },
  /**
   * STAFF order feed with items + modifiers — the dashboard's full load and live
   * poll. Goes through the SECURITY DEFINER `admin_list_orders_with_items` RPC
   * (is_staff enforced), returning the staff column set with items embedded. It
   * never returns pos_create_attempt_token. Uses the staff member's own JWT.
   *
   * ALWAYS pass a limit. The unbounded arm still exists server-side, but no
   * console surface calls it any more: the reports fetch their own date range
   * through `listForRange` and the dashboard tiles read `stats`, so nothing
   * needs the whole table in memory. Leaving `limit` off re-creates the
   * every-order-on-every-sign-in download this replaced.
   */
  adminListWithItems: async (limit?: number) =>
    ok<DbOrderWithItems[]>(
      await supabase.rpc('admin_list_orders_with_items', { p_limit: limit ?? null }),
    ),
  /**
   * Report feed for one half-open `[from, to)` window, optionally one branch.
   *
   * Separate from the live feed on purpose. Its projection carries no customer
   * name, phone, notes, address snapshot or item modifiers — the reports read
   * none of them — so a financial report is both a much smaller payload and no
   * longer a reason for customer PII to reach the browser.
   *
   * Returns an ENVELOPE. When the window holds more than `max_rows` orders the
   * server returns NONE of them and sets `limit_exceeded`, rather than the first
   * N: a truncated financial report is a wrong number that looks right.
   */
  listForRange: async (fromIso: string, toIso: string, branchId?: string | null) =>
    ok<AdminOrderRange>(
      await supabase.rpc('admin_list_orders_for_range', {
        p_from: fromIso, p_to: toIso, p_branch: branchId ?? null,
      }),
    ),
  /**
   * Aggregate order figures for the dashboard tiles and the per-branch chart.
   * Constant-size payload — the client no longer sums the whole table to render
   * four numbers.
   */
  stats: async () => ok<AdminOrderStats>(await supabase.rpc('admin_order_stats')),
  items: async (orderId: string) =>
    ok<DbOrderItem[]>(await supabase.from('order_items').select('*').eq('order_id', orderId)),
  itemModifiers: async (orderItemId: string) =>
    ok<DbOrderItemModifier[]>(await supabase.from('order_item_modifiers').select('*').eq('order_item_id', orderItemId)),
  /**
   * Admin only — enforced INSIDE the SECURITY DEFINER `admin_set_order_status`
   * RPC (`is_admin()`), the same predicate the old `orders_admin_update` policy
   * used, so staff authorization is unchanged. Goes through an RPC because staff
   * no longer hold any direct privilege on `public.orders` (an `UPDATE … WHERE
   * id` would otherwise require a grant on the table).
   */
  async setStatus(orderId: string, status: OrderStatus) {
    const { error } = await supabase.rpc('admin_set_order_status', {
      p_order_id: orderId, p_status: status,
    });
    if (error) throw new Error(error.message);
    // Fire-and-forget push notification for the customer. Push is LIVE, so this
    // really does reach the customer's phone. Server-side push-dispatch
    // re-verifies the caller is an admin, re-reads the order's REAL status
    // (anti-spoof), and is idempotent per (order,status) — a push failure never
    // fails the status change itself, and a repeated call never double-sends.
    void supabase.functions.invoke('push-dispatch', {
      body: { action: 'order_status', orderId, status },
    }).catch(() => {});
  },
  /** Admin-only: re-queue a failed/blocked/dead-lettered order for Lazywait sync. */
  async requeueLazywait(orderId: string): Promise<DbOrder> {
    return ok<DbOrder>(await supabase.rpc('requeue_lazywait_order', { p_order_id: orderId }));
  },
  /**
   * Admin-only READ-ONLY feed for the "Orders Requiring Verification" card:
   * ambiguous POS outcomes (state 'confirmation_required'), oldest-first, top N,
   * with only safe fields (no phone, no secrets, no payment refs). The RPC is
   * is_admin()-gated server-side.
   */
  async posConfirmationRequired(limit = 20): Promise<PosConfirmationRequired> {
    return ok<PosConfirmationRequired>(
      await supabase.rpc('list_pos_confirmation_required', { p_limit: limit }),
    );
  },
};

// ---------------------------------------------------------------------------
// Addresses (customer-owned)
// ---------------------------------------------------------------------------
export const addresses = {
  listMine: async () => ok<DbAddress[]>(await supabase.from('addresses').select('*').order('created_at')),
  async add(a: Partial<DbAddress> & { customer_id: string }) {
    return ok<DbAddress>(await supabase.from('addresses').insert(a).select().single());
  },
  async update(id: string, patch: Partial<DbAddress>) {
    const { error } = await supabase.from('addresses').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async remove(id: string) {
    const { error } = await supabase.from('addresses').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

// ---------------------------------------------------------------------------
// Coupons (admin) + validation RPC (any authenticated user)
// ---------------------------------------------------------------------------
export const coupons = {
  async validate(code: string, subtotal: number) {
    const rows = ok<any[]>(await supabase.rpc('validate_coupon', { p_code: code, p_subtotal: subtotal }));
    return rows[0] as { valid: boolean; code: string; discount_amount: number; message: string };
  },
  list: async () => ok<DbCoupon[]>(await supabase.from('coupons').select('*').order('code')),
  async create(c: Partial<DbCoupon>) { return ok<DbCoupon>(await supabase.from('coupons').insert(c).select().single()); },
  async update(id: string, patch: Partial<DbCoupon>) {
    const { error } = await supabase.from('coupons').update(patch).eq('id', id); if (error) throw new Error(error.message);
  },
  async remove(id: string) { const { error } = await supabase.from('coupons').delete().eq('id', id); if (error) throw new Error(error.message); },
};

// ---------------------------------------------------------------------------
// Admin catalog + settings writes (RLS admin-only)
// ---------------------------------------------------------------------------
export const admin = {
  createProduct: (p: Partial<DbProduct>) => wrapInsert('products', p),
  updateProduct: (id: string, patch: Partial<DbProduct>) => wrapUpdate('products', id, patch),
  deleteProduct: (id: string) => wrapDelete('products', id),
  createCategory: (c: Partial<DbCategory>) => wrapInsert('categories', c),
  updateCategory: (id: string, patch: Partial<DbCategory>) => wrapUpdate('categories', id, patch),
  deleteCategory: (id: string) => wrapDelete('categories', id),
  updateBranch: (id: string, patch: Partial<DbBranch>) => wrapUpdate('branches', id, patch),
  /**
   * Admin-only branch delete with a friendly dependent-data guard.
   *
   * The delete CASCADES the branch's delivery zone + product-availability rows,
   * but `orders.branch_id` (ON DELETE RESTRICT) and `checkout_sessions.branch_id`
   * (NO ACTION) HARD-BLOCK deleting any branch that owns order history — that FK,
   * plus the admin-only RLS, is the real guarantee. This wrapper only adds UX:
   *   1. Advisory pre-check: count orders + checkout sessions and, if any exist,
   *      block locally with a typed {@link BranchHasDependenciesError} (carrying
   *      the counts) instead of firing a delete the FK would reject anyway.
   *   2. Hard backstop: if a delete still trips the FK (an order/session landed
   *      between the count and the delete, or the pre-count was RLS-limited),
   *      map the Postgres 23503 violation to the same typed error rather than
   *      leaking the raw constraint string.
   * Non-admins are still blocked server-side by RLS (their delete matches 0
   * rows); this wrapper never weakens that.
   */
  async deleteBranch(id: string): Promise<void> {
    const counts = await countBranchDependencies(id);
    if (branchHasBlockingDependencies(counts)) {
      throw new BranchHasDependenciesError(counts);
    }
    const { error } = await supabase.from('branches').delete().eq('id', id);
    if (error) {
      if (isBranchDependencyError(error)) throw new BranchHasDependenciesError();
      throw new Error(error.message);
    }
  },
  async setAvailability(branchId: string, productId: string, isAvailable: boolean) {
    const { error } = await supabase.from('branch_product_availability')
      .upsert({ branch_id: branchId, product_id: productId, is_available: isAvailable });
    if (error) throw new Error(error.message);
  },
  async updateSettings(patch: Partial<DbAppSettings>) {
    const { error } = await supabase.from('app_settings').update(patch).eq('id', true);
    if (error) throw new Error(error.message);
  },
  /** Admin-only: set payment-method availability. The RPC re-checks is_admin() server-side. */
  async setPaymentSettings(input: {
    onlineEnabled: boolean; cashEnabled: boolean;
    defaultMethod: 'online' | 'cash' | null; outageMode: boolean;
  }) {
    return ok<DbAppSettings>(await supabase.rpc('set_payment_settings', {
      p_online_enabled: input.onlineEnabled,
      p_cash_enabled: input.cashEnabled,
      p_default_method: input.defaultMethod,
      p_outage_mode: input.outageMode,
    }));
  },
  /** Admin-only: upsert a branch's active delivery zone. `geojson` is a GeoJSON
   *  Geometry (Polygon | MultiPolygon). The RPC validates geometry + is_admin(). */
  async setBranchDeliveryZone(input: { branchId: string; geojson: unknown; name?: string | null }) {
    return ok<DbBranchDeliveryZone>(await supabase.rpc('set_branch_delivery_zone', {
      p_branch_id: input.branchId,
      p_geojson: input.geojson,
      p_name: input.name ?? null,
      p_is_active: true,
    }));
  },
  /** Admin-only: deactivate a branch's active delivery zone. */
  async clearBranchDeliveryZone(branchId: string) {
    const { error } = await supabase.rpc('clear_branch_delivery_zone', { p_branch_id: branchId });
    if (error) throw new Error(error.message);
  },
};

async function wrapInsert(table: string, row: any) {
  const { error } = await supabase.from(table).insert(row); if (error) throw new Error(error.message);
}
async function wrapUpdate(table: string, id: string, patch: any) {
  const { error } = await supabase.from(table).update(patch).eq('id', id); if (error) throw new Error(error.message);
}
async function wrapDelete(table: string, id: string) {
  const { error } = await supabase.from(table).delete().eq('id', id); if (error) throw new Error(error.message);
}

/**
 * Count the FK-protected dependents of a branch (orders + checkout sessions) that
 * block its deletion. Admin/staff RLS lets an admin SELECT every such row, so
 * this advisory count is accurate for the admin performing the delete. Cascade
 * tables (delivery zones, product availability) are deliberately not counted —
 * they are removed with the branch. `head: true` fetches counts only (no rows).
 */
async function countBranchDependencies(branchId: string): Promise<BranchDependencyCounts> {
  const [ordersRes, sessionsRes] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('branch_id', branchId),
    supabase.from('checkout_sessions').select('id', { count: 'exact', head: true }).eq('branch_id', branchId),
  ]);
  return {
    orders: ordersRes.count ?? 0,
    checkoutSessions: sessionsRes.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Homepage banners (admin-managed marketing banners shown in the mobile app).
// RLS: staff (admin+accountant) read all; only admins write. Images live in the
// public `banner-images` bucket (public read, admin-only upload).
// ---------------------------------------------------------------------------
export interface DbHomepageBanner {
  id: string;
  title_en: string | null;
  title_ar: string | null;
  image_url: string;
  storage_path: string | null;
  is_active: boolean;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  action_type: 'none' | 'category' | 'product';
  action_value: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export const banners = {
  /** Staff read of ALL banners for management (RLS returns all for admin/accountant). */
  list: async () =>
    ok<DbHomepageBanner[]>(
      await supabase
        .from('homepage_banners')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false }),
    ),
  create: async (b: Partial<DbHomepageBanner>) =>
    ok<DbHomepageBanner>(await supabase.from('homepage_banners').insert(b).select('*').single()),
  update: async (id: string, patch: Partial<DbHomepageBanner>) =>
    ok<DbHomepageBanner>(await supabase.from('homepage_banners').update(patch).eq('id', id).select('*').single()),
  async remove(id: string) {
    const { error } = await supabase.from('homepage_banners').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
  /**
   * Admin-only: upload an image to the public banner-images bucket and return
   * its stored path + public URL. RLS on storage.objects enforces admin. Uses a
   * unique path (no overwrite). `upsert:false` also guards against collisions.
   */
  async uploadImage(file: File): Promise<{ path: string; publicUrl: string }> {
    const unique = `${Date.now()}-${crypto.randomUUID()}`;
    const path = bannerStoragePath(file.name, unique);
    const { error } = await supabase.storage
      .from(BANNER_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from(BANNER_BUCKET).getPublicUrl(path);
    return { path, publicUrl: data.publicUrl };
  },
  /** Best-effort delete of a stored image (used when replacing / cleaning up). */
  async removeImage(path: string) {
    const { error } = await supabase.storage.from(BANNER_BUCKET).remove([path]);
    if (error) throw new Error(error.message);
  },
};

// ---------------------------------------------------------------------------
// Legal documents (admin-editable policies shown in the mobile app).
// RLS: staff (admin+accountant) read all; only admins write. Customers/anon
// read only active rows.
// ---------------------------------------------------------------------------
export interface DbLegalDocument {
  id: string;
  document_type: string;
  title_ar: string;
  title_en: string;
  content_ar: string;
  content_en: string;
  version: string;
  effective_date: string | null;
  is_active: boolean;
  requires_acceptance: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export const legalDocs = {
  /** Staff read of ALL documents for management (RLS returns all for admin/accountant). */
  list: async () => ok<DbLegalDocument[]>(await supabase.from('legal_documents').select('*')),
  update: async (id: string, patch: Partial<DbLegalDocument>) =>
    ok<DbLegalDocument>(await supabase.from('legal_documents').update(patch).eq('id', id).select('*').single()),
};

// ---------------------------------------------------------------------------
// Push notifications (admin tools). All calls hit the push-dispatch Edge
// Function with the ADMIN's JWT; the function re-verifies role AND MFA
// assurance level server-side by asking Postgres for is_admin().
// Push is LIVE: `broadcast` reaches every opted-in customer device immediately
// and cannot be recalled. The master flag remains the server-side kill switch.
// ---------------------------------------------------------------------------
export interface PushSendResult { status: string; targeted?: number; sent?: number; failed?: number; deactivated?: number; hint?: string; reason?: string }

/**
 * Edge Function errors arrive as a generic "non-2xx status" message with the
 * useful text in the response BODY, so unwrap it — the same way
 * staffAccountsApi.ts does. Without this the panel shows "Edge Function returned
 * a non-2xx status code" instead of the server's actual sentence, which now
 * includes the one telling an admin to complete their two-factor step.
 */
async function invokePush(body: Record<string, unknown>): Promise<PushSendResult> {
  const { data, error } = await supabase.functions.invoke('push-dispatch', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try { const b = ctx?.json ? await ctx.json() : null; if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return data as PushSendResult;
}

export const pushAdmin = {
  async test(): Promise<PushSendResult> {
    return invokePush({ action: 'test' });
  },
  async broadcast(input: { titleEn: string; titleAr: string; bodyEn: string; bodyAr: string }): Promise<PushSendResult> {
    return invokePush({ action: 'broadcast', ...input });
  },
  /** Device / opt-in counts for the panel (admin-only RLS select). */
  async deviceCounts(): Promise<{ activeDevices: number; promoOptIns: number }> {
    const [{ count: active }, { count: promos }] = await Promise.all([
      supabase.from('push_devices').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('push_devices').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('promos_enabled', true),
    ]);
    return { activeDevices: active ?? 0, promoOptIns: promos ?? 0 };
  },
};

// ---------------------------------------------------------------------------
// Order Integrity Watchdog (observe-only). All access is via SECURITY DEFINER,
// is_admin()/is_staff()-gated RPCs that return SAFE (no-PII) projections only.
// ---------------------------------------------------------------------------
export interface OrderIntegrityHealth {
  overall_state: 'healthy' | 'degraded' | 'failing' | 'configuration_error';
  watchdog_cron_active: boolean;
  latest_run_at: string | null;
  latest_successful_run_at: string | null;
  latest_run_age_seconds: number | null;
  open_critical_count: number;
  open_warning_count: number;
  acknowledged_count: number;
  suppressed_count: number;
  oldest_open_critical_at: string | null;
  latest_incident: Record<string, unknown> | null;
  incidents_opened_last_24h: number;
  incidents_resolved_last_24h: number;
}
export interface OrderIntegrityIncident {
  id: string;
  rule_code: string;
  severity: 'warning' | 'critical';
  entity_type: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'suppressed';
  order_id: string | null;
  order_number: string | null;
  branch_id: string | null;
  first_detected_at: string;
  last_detected_at: string;
  occurrence_count: number;
  consecutive_detection_count: number;
  consecutive_clean_count: number;
  acknowledged_at: string | null;
  suppression_until: string | null;
  suppression_reason: string | null;
  resolved_at: string | null;
  safe_details: Record<string, unknown>;
}

export const orderIntegrity = {
  /**
   * Capability probe used to gate the admin tab before the migration is applied.
   * 'available' = RPC works; 'absent' = confirmed missing function (migration not
   * applied yet); 'unknown' = transient/auth/other error (do NOT treat as absent).
   */
  probeAvailability: async (): Promise<WatchdogCapability> => {
    const { error } = await supabase.rpc('order_integrity_admin_summary');
    return classifyWatchdogProbe(error);
  },
  /** Safe aggregate health for the panel (is_staff gated). */
  summary: async (): Promise<OrderIntegrityHealth> =>
    ok<OrderIntegrityHealth>(await supabase.rpc('order_integrity_admin_summary')),
  /** Safe incident list with optional filters (is_staff gated). */
  list: async (filters: {
    status?: string | null; severity?: string | null; ruleCode?: string | null;
    branchId?: string | null; limit?: number;
  } = {}): Promise<OrderIntegrityIncident[]> =>
    ok<OrderIntegrityIncident[]>(await supabase.rpc('order_integrity_list_incidents', {
      p_status: filters.status ?? null, p_severity: filters.severity ?? null,
      p_rule_code: filters.ruleCode ?? null, p_branch_id: filters.branchId ?? null,
      p_limit: filters.limit ?? 100,
    })),
  /** Safe incident timeline / audit history (is_staff gated). */
  timeline: async (incidentId: string): Promise<Record<string, unknown>> =>
    ok<Record<string, unknown>>(await supabase.rpc('order_integrity_incident_timeline', { p_incident_id: incidentId })),
  /** Acknowledge an open incident (admin-only, audited). */
  acknowledge: async (incidentId: string, note?: string): Promise<Record<string, unknown>> =>
    ok<Record<string, unknown>>(await supabase.rpc('order_integrity_acknowledge_incident', {
      p_incident_id: incidentId, p_note: note ?? null,
    })),
  /** Suppress an incident until a future time, with a required reason (admin-only, audited). */
  suppress: async (incidentId: string, until: string, reason: string): Promise<Record<string, unknown>> =>
    ok<Record<string, unknown>>(await supabase.rpc('order_integrity_suppress_incident', {
      p_incident_id: incidentId, p_until: until, p_reason: reason,
    })),
};
