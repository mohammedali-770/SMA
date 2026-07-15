/**
 * Typed data-access layer over Supabase for the CUSTOMER mobile app.
 *
 * This mirrors the customer-relevant slice of the web app's src/lib/api.ts and
 * calls the EXACT SAME tables and RPCs created by supabase/migrations. RLS is
 * enforced server-side, so these calls are safe from the client:
 *   - anon/customer read the active catalog + app_settings,
 *   - a customer sees only their own orders / addresses,
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
  DbHomepageBanner, DbLegalDocument, DbModifier, DbModifierGroup, DbOrder, DbOrderWithItems,
  DbProduct, DbProductModifierGroup, DbProfile, DbPushDevice, OrderType,
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
  // --- Customer WhatsApp login (Supabase Phone Auth is the login authority) ---
  // signInWithOtp asks Supabase Auth to GENERATE the login OTP; Supabase then
  // calls our `auth-send-sms-whatsapp` Send SMS Hook to deliver it over WhatsApp.
  // No code is generated here and no custom OTP table is involved in login.
  async signInWithPhone(phone: string) {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw new Error(error.message);
  },
  // verifyOtp with type 'sms' returns a REAL authenticated session (persisted by
  // the existing supabase-js session handling). This — not whatsapp-verify-otp —
  // is what logs a customer in.
  async verifyPhone(phone: string, token: string) {
    const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) throw new Error(error.message);
    return data.session;
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
  // Anon-safe feature flag (boolean only, no secrets) telling the pre-login UI
  // whether WhatsApp login is fully configured + enabled. Falls back to false.
  async whatsappLoginEnabled(): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('whatsapp_login_enabled');
      if (error) return false;
      return data === true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Catalog (public reads under RLS)
// ---------------------------------------------------------------------------
export const catalog = {
  branches: async () => ok<DbBranch[]>(await supabase.from('branches').select('*').order('name_en')),
  categories: async () => ok<DbCategory[]>(await supabase.from('categories').select('*').order('sort_order')),
  // Homepage banners: RLS returns only ACTIVE, in-window rows to anon/customers.
  // Ordered here (sort_order asc, then newest) so the carousel needs no client filtering.
  banners: async () => ok<DbHomepageBanner[]>(await supabase
    .from('homepage_banners')
    .select('id, title_en, title_ar, image_url, is_active, sort_order, starts_at, ends_at, action_type, action_value, created_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })),
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
// ---------------------------------------------------------------------------
// Legal / policy documents — RLS returns only ACTIVE rows to anon/customers.
// ---------------------------------------------------------------------------
export const legal = {
  list: async () => ok<DbLegalDocument[]>(await supabase
    .from('legal_documents')
    .select('id, document_type, title_ar, title_en, content_ar, content_en, version, effective_date, is_active')),
  byType: async (type: string) => {
    const { data, error } = await supabase
      .from('legal_documents')
      .select('id, document_type, title_ar, title_en, content_ar, content_en, version, effective_date, is_active')
      .eq('document_type', type)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as DbLegalDocument | null;
  },
};

/** Order + nested lines/modifiers — the one nested order shape the app reads. */
const ORDER_WITH_ITEMS_SELECT = '*, order_items(*, order_item_modifiers(*))';

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
  /**
   * Create the order AND synchronously sync it to Lazywait POS via the
   * `order-intake` Edge Function, so the receipt can show the POS order number
   * (e.g. "#5"). The server bounds the wait (~10s) and, if the POS is slow/down,
   * returns the order WITHOUT a POS number — the order is still placed and the
   * background worker finishes the sync, so the app just falls back to the SM-…
   * number. place_order stays the authoritative order creation inside it.
   */
  async placeAndSync(input: PlaceOrderInput): Promise<DbOrder> {
    const { data, error } = await supabase.functions.invoke('order-intake', {
      body: {
        branchId: input.branchId,
        orderType: input.orderType,
        items: input.items,
        addressId: input.addressId ?? null,
        couponCode: input.couponCode ?? null,
        notes: input.notes ?? null,
        loyaltyPoints: input.loyaltyPoints ?? 0,
        idempotencyKey: input.idempotencyKey ?? null,
        paymentMethod: input.paymentMethod ?? null,
      },
    });
    if (error) throw new Error(error.message);
    const res = (data ?? {}) as { order?: DbOrder; error?: string };
    if (res.error) throw new Error(res.error);
    if (!res.order) throw new Error('Order was not created.');
    return res.order;
  },
  /**
   * RLS returns only the signed-in customer's own orders, newest first, capped
   * to a recent page (`limit`) — My Orders is a recent-history view and must
   * not re-download the customer's entire nested history on every tab focus.
   *
   * An unpaid ONLINE order is a checkout-in-progress, not a real order, and must
   * never surface in My Orders until the backend has verified payment. We hide
   * exactly those rows (payment_method = 'online' AND payment_status <> 'paid').
   * Cash orders and paid online orders always show; a null payment_method
   * (legacy rows) is treated as not-online and shown. RLS is intentionally NOT
   * tightened — payment-verify, the retry flow, and the receipt screen still
   * read the pending order by id.
   */
  listWithItems: async (limit = 20) =>
    ok<DbOrderWithItems[]>(await supabase
      .from('orders')
      .select(ORDER_WITH_ITEMS_SELECT)
      .or('payment_method.is.null,payment_method.neq.online,payment_status.eq.paid')
      .order('created_at', { ascending: false })
      .limit(limit)),
  /** A single order with its lines (RLS still scopes it to the owner). */
  byId: async (id: string) =>
    ok<DbOrderWithItems>(await supabase
      .from('orders')
      .select(ORDER_WITH_ITEMS_SELECT)
      .eq('id', id)
      .single()),
};

/** A temporary, pre-payment checkout session (NOT an order). */
export interface DbCheckoutSession {
  id: string;
  total: number | string;
  currency: string;
  status: string;
  order_id: string | null;
}

export const checkout = {
  /**
   * Online only: validate + price the cart server-side and open a temporary
   * checkout session. NO order is created here — the order is created only after
   * the payment is verified. Retry-safe via the cart idempotency key.
   */
  begin: async (input: PlaceOrderInput): Promise<DbCheckoutSession> =>
    ok<DbCheckoutSession>(await supabase.rpc('begin_checkout_session', {
      p_branch_id: input.branchId,
      p_order_type: input.orderType,
      p_items: input.items,
      p_address_id: input.addressId ?? null,
      p_coupon_code: input.couponCode ?? null,
      p_notes: input.notes ?? null,
      p_loyalty_points: input.loyaltyPoints ?? 0,
      p_idempotency_key: input.idempotencyKey ?? null,
    })),
};

// ---------------------------------------------------------------------------
// Tap Payments (online checkout). The app NEVER trusts the redirect result — it
// opens the Tap hosted checkout URL, then calls payment-verify, which retrieves
// the charge server-side and confirms only on CAPTURED. No secret key ever
// reaches the app; amounts/status are always server-authoritative.
// ---------------------------------------------------------------------------
export interface PaymentInitiateResult {
  provider?: string;
  status?: string;            // 'disabled' | 'already_paid' | undefined
  mode?: string;              // 'test' | 'live'
  chargeId?: string;
  checkoutUrl?: string | null;
  needsVerify?: boolean;
  orderNumber?: string;
  checkoutSessionId?: string;
  orderId?: string | null;    // set when status === 'already_paid' (session flow)
}
export interface PaymentVerifyResult { status: string; messageKey?: string; orderNumber?: string | null; orderId?: string | null; }
async function invokePaymentFn<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try { const b = ctx?.json ? await ctx.json() : null; if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return data as T;
}
export const payments = {
  /** Start (or reuse) a Tap charge for an online order. Returns the hosted URL. */
  initiate: (orderId: string, language: 'ar' | 'en') =>
    invokePaymentFn<PaymentInitiateResult>('payment-initiate', { orderId, language }),
  /** Server-authoritative verification after returning from checkout. */
  verify: (orderId: string) => invokePaymentFn<PaymentVerifyResult>('payment-verify', { orderId }),
  /** Start (or reuse) a Tap charge for a CHECKOUT SESSION (order not yet created). */
  initiateSession: (checkoutSessionId: string, language: 'ar' | 'en') =>
    invokePaymentFn<PaymentInitiateResult>('payment-initiate', { checkoutSessionId, language }),
  /** Verify a session's charge; on 'paid' the response carries the created orderId. */
  verifySession: (checkoutSessionId: string) =>
    invokePaymentFn<PaymentVerifyResult>('payment-verify', { checkoutSessionId }),
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

// ---------------------------------------------------------------------------
// Push devices (customer-owned rows; RLS restricts every operation to
// auth.uid() = customer_id). Registration happens ONLY after the customer
// turns a notification toggle on (clear-context permission flow); sending is
// entirely server-side (push-dispatch) and admin/master-flag gated.
// ---------------------------------------------------------------------------
export const pushDevices = {
  /** All of MY device rows (RLS-scoped). */
  mine: async () => ok<DbPushDevice[]>(await supabase.from('push_devices').select('*')),
  /**
   * Register or refresh THIS device. SECURITY DEFINER RPC: upserts by token
   * and reassigns the row to the calling user when the device changed hands
   * (a shared phone must never keep receiving the previous account's pushes).
   */
  async register(input: {
    token: string; platform: 'android' | 'ios'; lang: 'en' | 'ar';
    orderUpdatesEnabled: boolean; promosEnabled: boolean;
  }): Promise<DbPushDevice> {
    return ok<DbPushDevice>(await supabase.rpc('register_push_device', {
      p_token: input.token,
      p_platform: input.platform,
      p_lang: input.lang,
      p_order_updates: input.orderUpdatesEnabled,
      p_promos: input.promosEnabled,
    }));
  },
  // NOTE: there is intentionally NO direct update() — RLS exposes no client
  // write path. Preference changes re-register through the RPC (which owns
  // the token-format guard and ownership rules); turning everything off goes
  // through deactivateToken.
  /** Deactivate THIS device's token (sign-out path; works across owners). */
  async deactivateToken(token: string): Promise<void> {
    const { error } = await supabase.rpc('deactivate_push_device', { p_token: token });
    if (error) throw new Error(error.message);
  },
};

// ---------------------------------------------------------------------------
// Account deletion (customer self-service). The mobile app NEVER performs the
// destructive deletion — it only re-verifies identity and enqueues a request via
// the `account-delete-request` Edge Function (JWT identity is the source of
// truth). Reading the request state is RLS-scoped to the caller's own row.
// ---------------------------------------------------------------------------
export interface DeletionRequestState { id: string; status: string }
export interface DeletionSubmitResult {
  status?: string; requestId?: string | null; verified?: boolean; existing?: boolean; code?: string;
}
export const accountDeletion = {
  /** My current in-flight deletion request, if any (RLS returns only my row). */
  current: async (): Promise<DeletionRequestState | null> => {
    const { data, error } = await supabase
      .from('account_deletion_requests')
      .select('id, status')
      .in('status', ['queued', 'waiting_for_active_order', 'waiting_for_financial_process', 'processing', 'retry_scheduled', 'manual_review'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as DeletionRequestState | null) ?? null;
  },
  /** Send an OTP to the account's REGISTERED phone (server-derived). */
  sendOtp: async (language: 'ar' | 'en'): Promise<{ status: 'sent' | 'disabled' | 'rate_limited' | 'error' | 'no_phone' }> => {
    const { data, error } = await supabase.functions.invoke('account-delete-request', {
      body: { action: 'send_otp', language },
    });
    if (error) throw new Error(error.message);
    return data as { status: 'sent' | 'disabled' | 'rate_limited' | 'error' | 'no_phone' };
  },
  /** Re-verify identity (OTP code or account password) and enqueue the request. */
  submit: async (method: 'otp' | 'reauth', factors: { code?: string; password?: string }): Promise<DeletionSubmitResult> => {
    const { data, error } = await supabase.functions.invoke('account-delete-request', {
      body: { action: 'submit', method, code: factors.code, password: factors.password },
    });
    if (error) throw new Error(error.message);
    return data as DeletionSubmitResult;
  },
};
