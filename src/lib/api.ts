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
}
export interface DbCategory { id: string; name_en: string; name_ar: string; sort_order: number; is_active: boolean; }
export interface DbProduct {
  id: string; category_id: string; name_en: string; name_ar: string;
  description_en: string | null; description_ar: string | null;
  price: number; calories: number | null; image_url: string | null;
  is_active: boolean; sort_order: number;
}
export interface DbModifierGroup {
  id: string; name_en: string; name_ar: string;
  min_select: number; max_select: number | null; is_required: boolean;
}
export interface DbModifier {
  id: string; group_id: string; name_en: string; name_ar: string;
  price: number; sort_order: number; is_active: boolean;
}
export interface DbProductModifierGroup { product_id: string; group_id: string; sort_order: number; }
export interface DbBranchAvailability { branch_id: string; product_id: string; is_available: boolean; }
export interface DbAppSettings {
  id: boolean; brand_name_en: string; brand_name_ar: string;
  primary_color: string; secondary_color: string; currency: string;
  vat_percentage: number; loyalty_enabled: boolean;
  points_per_riyal: number; discount_per_point: number; min_points_to_redeem: number;
}
export interface DbProfile {
  id: string; full_name: string | null; phone_number: string | null;
  email: string | null; role: UserRole; loyalty_points: number;
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
  coupon_code: string | null; notes: string | null; created_at: string;
  // Extra columns returned by `select('*')` that the app maps for display.
  sync_status: DbSyncStatus; address_snapshot: Record<string, unknown> | null;
  loyalty_points_earned: number; loyalty_points_redeemed: number;
}
export interface DbLoyaltyTransaction {
  id: string; profile_id: string; order_id: string | null;
  type: 'earn' | 'redeem' | 'adjustment'; points: number;
  balance_after: number | null; reason: string | null; created_at: string;
}
/** NON-secret projection of an integration_settings row (secrets never sent). */
export interface DbIntegrationSetting {
  provider_type: 'payment' | 'sms' | 'push' | 'lazywait';
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
  /** Fetch the whole menu graph in parallel. */
  async all() {
    const [branches, categories, products, modifierGroups, modifiers, links, availability, settings] =
      await Promise.all([
        this.branches(), this.categories(), this.products(), this.modifierGroups(),
        this.modifiers(), this.productModifierGroups(), this.availability(), this.settings(),
      ]);
    return { branches, categories, products, modifierGroups, modifiers, links, availability, settings };
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
