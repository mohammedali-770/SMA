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

// ---------------------------------------------------------------------------
// Row types (subset of columns the app uses).
// ---------------------------------------------------------------------------
export type UserRole = 'customer' | 'admin' | 'accountant';
export type OrderStatus =
  | 'received' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type OrderType = 'delivery' | 'pickup';

export interface DbBranch {
  id: string; name_en: string; name_ar: string;
  address_en: string | null; address_ar: string | null; phone: string | null;
  latitude: number | null; longitude: number | null;
  delivery_fee: number; min_delivery_order: number; is_active: boolean;
  lazywait_branch_id?: string | null;
  // Delivery-zone feature (admin-configured operational flags).
  delivery_enabled?: boolean;
  pickup_enabled?: boolean;
  delivery_temporarily_closed?: boolean;
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
}
export type LazywaitSyncState =
  | 'pending' | 'syncing' | 'synced' | 'failed' | 'blocked' | 'dead_letter' | 'skipped';

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
  /** Admin-only: Tap config readiness booleans (no secret values). */
  status: () => invokePaymentTestConfig<PaymentGatewayStatus>({ action: 'status' }),
  /** Admin-only: validate the selected-mode key against Tap (never creates a charge). */
  testConnection: () => invokePaymentTestConfig<{ ok: boolean; message?: string }>({ action: 'test_connection' }),
  /** Admin-only: re-verify an order's payment via Tap Retrieve Charge (only CAPTURED confirms). */
  adminVerify: (orderId: string) =>
    invokePaymentTestConfig<{ status: string; message?: string }>({ action: 'verify_order', orderId }),
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
export const orders = {
  /** Server-authoritative order creation (recomputes all amounts + coupon + VAT + loyalty). */
  async place(input: PlaceOrderInput): Promise<DbOrder> {
    return ok<DbOrder>(await supabase.rpc('place_order', {
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
  /** RLS returns own orders for a customer, all orders for staff. */
  list: async () =>
    ok<DbOrder[]>(await supabase.from('orders').select('*').order('created_at', { ascending: false })),
  /**
   * Same as list(), but embeds each order's items + item modifiers in one round
   * trip (PostgREST resource embedding). RLS is applied to the embedded tables
   * too, so a customer still only sees their own orders' lines.
   */
  listWithItems: async () =>
    ok<DbOrderWithItems[]>(await supabase
      .from('orders')
      .select('*, order_items(*, order_item_modifiers(*))')
      .order('created_at', { ascending: false })),
  items: async (orderId: string) =>
    ok<DbOrderItem[]>(await supabase.from('order_items').select('*').eq('order_id', orderId)),
  itemModifiers: async (orderItemId: string) =>
    ok<DbOrderItemModifier[]>(await supabase.from('order_item_modifiers').select('*').eq('order_item_id', orderItemId)),
  /** Admin only (RLS enforces). */
  async setStatus(orderId: string, status: OrderStatus) {
    const { error } = await supabase.from('orders').update({ status }).eq('id', orderId);
    if (error) throw new Error(error.message);
  },
  /** Admin-only: re-queue a failed/blocked/dead-lettered order for Lazywait sync. */
  async requeueLazywait(orderId: string): Promise<DbOrder> {
    return ok<DbOrder>(await supabase.rpc('requeue_lazywait_order', { p_order_id: orderId }));
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
