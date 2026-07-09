/**
 * Typed data-access layer over Supabase for the CUSTOMER mobile app.
 *
 * This mirrors the customer-relevant slice of the web app's src/lib/api.ts and
 * calls the EXACT SAME tables and RPCs created by supabase/migrations. RLS is
 * enforced server-side, so these calls are safe from the client:
 *   - anon/customer read the active catalog + app_settings,
 *   - a customer sees only their own orders / addresses / loyalty ledger,
 *   - orders are created ONLY via the place_order RPC, which recomputes every
 *     amount (subtotal, modifiers, delivery fee, coupon, VAT, loyalty) server-side.
 *
 * Deliberately absent (customer app must never touch these): admin catalog
 * writes, coupon management, integration_settings, and any service-role /
 * payment / SMS / Lazywait call. Those stay server-side behind Edge Functions.
 */
import { supabase } from '../lib/supabase';
import type {
  DbAddress, DbAppSettings, DbBranch, DbBranchAvailability, DbBranchDeliveryZone, DbCategory,
  DbLoyaltyTransaction, DbModifier, DbModifierGroup, DbOrder, DbOrderWithItems,
  DbProduct, DbProductModifierGroup, DbProfile, OrderType,
} from '../types/db';

/** Return the data or throw the PostgREST error (never a silent null). */
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
  async signOut() {
    await supabase.auth.signOut();
  },
  async myProfile(): Promise<DbProfile | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    return ok(await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle());
  },
};

// ---------------------------------------------------------------------------
// Catalog (public reads under RLS)
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
  /** Active delivery zones (safe columns only — never `updated_by`). */
  deliveryZones: async () =>
    ok<DbBranchDeliveryZone[]>(await supabase
      .from('branch_delivery_zones')
      .select('id, branch_id, name, zone_geojson, is_active')
      .eq('is_active', true)),
  /** Fetch the whole menu graph in parallel (one app-open round of requests). */
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
  /** 'online' | 'cash' — availability is admin-controlled; place_order re-validates. */
  paymentMethod?: 'online' | 'cash' | null;
}
export const orders = {
  /** Server-authoritative order creation (place_order RPC). */
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
  /** RLS returns only the signed-in customer's own orders, newest first. */
  listWithItems: async () =>
    ok<DbOrderWithItems[]>(await supabase
      .from('orders')
      .select('*, order_items(*, order_item_modifiers(*))')
      .order('created_at', { ascending: false })),
  /** A single order with its lines (RLS still scopes it to the owner). */
  byId: async (id: string) =>
    ok<DbOrderWithItems>(await supabase
      .from('orders')
      .select('*, order_items(*, order_item_modifiers(*))')
      .eq('id', id)
      .single()),
};

// ---------------------------------------------------------------------------
// Coupons (validation RPC only — codes are never client-readable)
// ---------------------------------------------------------------------------
export const coupons = {
  async validate(code: string, subtotal: number) {
    const rows = ok<{ valid: boolean; code: string; discount_amount: number; message: string }[]>(
      await supabase.rpc('validate_coupon', { p_code: code, p_subtotal: subtotal }),
    );
    return rows[0];
  },
};

// ---------------------------------------------------------------------------
// Addresses (customer-owned, RLS-isolated)
// ---------------------------------------------------------------------------
export interface AddressInput {
  label?: string | null;
  description?: string | null;
  nationalShortAddress?: string | null;
  latitude: number;
  longitude: number;
  isDefault?: boolean;
}
export const addresses = {
  listMine: async () => ok<DbAddress[]>(await supabase.from('addresses').select('*').order('created_at')),
  /** Create an address for the signed-in customer (RLS forces customer_id). The
   *  map picker writes the coordinates place_order validates against zones. */
  async create(input: AddressInput): Promise<DbAddress> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('You must be signed in to save an address.');
    return ok<DbAddress>(await supabase.from('addresses').insert({
      customer_id: user.id,
      label: input.label ?? null,
      description: input.description ?? null,
      national_short_address: input.nationalShortAddress ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      is_default: input.isDefault ?? false,
    }).select('*').single());
  },
  /** Update an existing address (RLS scopes it to the owner). */
  async update(id: string, patch: Partial<AddressInput>): Promise<DbAddress> {
    const row: Record<string, unknown> = {};
    if (patch.label !== undefined) row.label = patch.label;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.nationalShortAddress !== undefined) row.national_short_address = patch.nationalShortAddress;
    if (patch.latitude !== undefined) row.latitude = patch.latitude;
    if (patch.longitude !== undefined) row.longitude = patch.longitude;
    if (patch.isDefault !== undefined) row.is_default = patch.isDefault;
    return ok<DbAddress>(await supabase.from('addresses').update(row).eq('id', id).select('*').single());
  },
};

// ---------------------------------------------------------------------------
// Loyalty (read-only for the customer; points mutate only inside place_order)
// ---------------------------------------------------------------------------
export const loyalty = {
  myLedger: async () =>
    ok<DbLoyaltyTransaction[]>(await supabase
      .from('loyalty_transactions').select('*').order('created_at', { ascending: false })),
};

// ---------------------------------------------------------------------------
// WhatsApp OTP (phone verification). The app never generates or trusts the code;
// send/verify happen server-side via Edge Functions (rate-limited, hashed). The
// user JWT is auto-attached by supabase-js so a successful verify can mark the
// signed-in user's phone verified. No provider token ever reaches the app.
// ---------------------------------------------------------------------------
export const whatsappOtp = {
  async send(phone: string, language: 'ar' | 'en', purpose = 'phone_verification'): Promise<{ status: string; message?: string }> {
    const { data, error } = await supabase.functions.invoke('whatsapp-send-otp', { body: { phone, purpose, language } });
    if (error) throw new Error(error.message);
    return data as { status: string; message?: string };
  },
  async verify(phone: string, code: string, purpose = 'phone_verification'): Promise<{ verified: boolean; session?: boolean; message?: string }> {
    const { data, error } = await supabase.functions.invoke('whatsapp-verify-otp', { body: { phone, code, purpose } });
    if (error) throw new Error(error.message);
    return data as { verified: boolean; session?: boolean; message?: string };
  },
};
