/**
 * Translation layer between the Supabase/Postgres row shapes (snake_case,
 * normalized) exposed by `api.ts` and the app's domain types (camelCase, with
 * modifiers nested inside groups / items). Keeping the mapping in one place lets
 * every screen keep consuming the existing `types.ts` shapes unchanged while the
 * data now comes from Supabase instead of localStorage.
 */
import {
  Branch, Category, Product, ModifierGroup, Modifier, Order, OrderItem,
  OrderItemModifier, SavedAddress, UserProfile, BrandSettings, LoyaltySettings, SyncStatus,
  DeliveryZone,
} from '../types';
import {
  DbBranch, DbCategory, DbProduct, DbModifierGroup, DbModifier, DbProductModifierGroup,
  DbBranchAvailability, DbAppSettings, DbProfile, DbAddress, DbOrderWithItems, DbOrderItem,
  DbOrderItemModifier, DbSyncStatus, DbBranchDeliveryZone,
} from './api';
import { INITIAL_BRAND_SETTINGS, INITIAL_LOYALTY_SETTINGS } from '../data/initialData';
import { PaymentMethodSettings } from './payment';

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&h=400&q=80';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
export function mapBranch(b: DbBranch): Branch {
  return {
    id: b.id,
    nameEn: b.name_en,
    nameAr: b.name_ar,
    addressEn: b.address_en ?? '',
    addressAr: b.address_ar ?? '',
    phone: b.phone ?? '',
    email: b.email ?? undefined,
    latitude: b.latitude ?? 0,
    longitude: b.longitude ?? 0,
    isActive: b.is_active,
    deliveryFee: Number(b.delivery_fee),
    minDeliveryOrder: Number(b.min_delivery_order),
    lazywaitBranchId: b.lazywait_branch_id ?? undefined,
    deliveryEnabled: b.delivery_enabled ?? true,
    pickupEnabled: b.pickup_enabled ?? true,
    deliveryTemporarilyClosed: b.delivery_temporarily_closed ?? false,
    deliveryClosedUntil: b.delivery_closed_until ?? null,
    estimatedDeliveryMinutes: b.estimated_delivery_minutes ?? undefined,
  };
}

/** DB delivery-zone row -> domain DeliveryZone (geojson kept as-is for rendering). */
export function mapDeliveryZone(z: DbBranchDeliveryZone): DeliveryZone {
  return {
    id: z.id,
    branchId: z.branch_id,
    name: z.name ?? undefined,
    geojson: z.zone_geojson as DeliveryZone['geojson'],
    isActive: z.is_active,
  };
}

export function mapCategory(c: DbCategory): Category {
  return { id: c.id, nameEn: c.name_en, nameAr: c.name_ar, sortOrder: c.sort_order };
}

/** A product needs the ids of the modifier groups linked to it (M:N join). */
export function mapProduct(p: DbProduct, links: DbProductModifierGroup[]): Product {
  return {
    id: p.id,
    categoryId: p.category_id,
    nameEn: p.name_en,
    nameAr: p.name_ar,
    descriptionEn: p.description_en ?? '',
    descriptionAr: p.description_ar ?? '',
    price: Number(p.price),
    imageUrl: p.image_url ?? FALLBACK_IMAGE,
    calories: p.calories ?? 0,
    isActive: p.is_active,
    modifierGroupIds: links.filter(l => l.product_id === p.id).map(l => l.group_id),
  };
}

export function mapModifier(m: DbModifier): Modifier {
  return {
    id: m.id,
    groupId: m.group_id,
    nameEn: m.name_en,
    nameAr: m.name_ar,
    price: Number(m.price),
  };
}

/** Nests each group's active modifiers under it (the app renders them together). */
export function mapModifierGroup(g: DbModifierGroup, modifiers: DbModifier[]): ModifierGroup {
  return {
    id: g.id,
    nameEn: g.name_en,
    nameAr: g.name_ar,
    minSelection: g.min_select,
    // A null max_select means "no upper bound"; the app expects a number, so use
    // a large sentinel that still behaves as multi-select.
    maxSelection: g.max_select ?? 99,
    isRequired: g.is_required,
    modifiers: modifiers.filter(m => m.group_id === g.id).map(mapModifier),
  };
}

/**
 * Builds the availability matrix the app expects (productId -> branchId -> bool).
 * The table only stores explicit rows; an absent row means "available", so we
 * seed every product/branch pair to true and then apply the stored exceptions.
 */
export function buildAvailabilityMatrix(
  products: DbProduct[], branches: DbBranch[], rows: DbBranchAvailability[],
): { [productId: string]: { [branchId: string]: boolean } } {
  const matrix: { [productId: string]: { [branchId: string]: boolean } } = {};
  for (const p of products) {
    matrix[p.id] = {};
    for (const b of branches) matrix[p.id][b.id] = true;
  }
  for (const r of rows) {
    if (!matrix[r.product_id]) matrix[r.product_id] = {};
    matrix[r.product_id][r.branch_id] = r.is_available;
  }
  return matrix;
}

// ---------------------------------------------------------------------------
// Profiles / addresses
// ---------------------------------------------------------------------------
export function mapProfile(p: DbProfile): UserProfile {
  return {
    id: p.id,
    fullName: p.full_name ?? '',
    phoneNumber: p.phone_number ?? '',
    role: p.role,
    email: p.email ?? undefined,
    createdAt: '',
    loyaltyPoints: p.loyalty_points,
    phoneVerified: Boolean(p.phone_verified),
  };
}

export function mapAddress(a: DbAddress): SavedAddress {
  return {
    id: a.id,
    label: a.label ?? '',
    description: a.description ?? '',
    nationalShortAddress: a.national_short_address ?? '',
    lat: a.latitude ?? 0,
    lng: a.longitude ?? 0,
    isDefault: a.is_default,
  };
}

/** The order carries its delivery address as a jsonb snapshot (snake_case row). */
function mapAddressSnapshot(snap: Record<string, unknown>): SavedAddress {
  return {
    id: String(snap.id ?? ''),
    label: (snap.label as string) ?? '',
    description: (snap.description as string) ?? '',
    nationalShortAddress: (snap.national_short_address as string) ?? '',
    lat: Number(snap.latitude ?? 0),
    lng: Number(snap.longitude ?? 0),
    isDefault: Boolean(snap.is_default),
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
/** DB sync_status enum -> the app's SyncStatus labels. */
export function mapSyncStatus(s: DbSyncStatus): SyncStatus {
  switch (s) {
    case 'syncing': return 'pending_sync';
    case 'failed': return 'sync_failed';
    case 'synced': return 'synced';
    default: return 'not_synced';
  }
}

function mapOrderItemModifier(m: DbOrderItemModifier): OrderItemModifier {
  return {
    id: m.id,
    modifierId: m.modifier_id ?? '',
    nameEn: m.name_en,
    nameAr: m.name_ar,
    price: Number(m.price),
  };
}

function mapOrderItem(i: DbOrderItem & { order_item_modifiers?: DbOrderItemModifier[] }): OrderItem {
  return {
    id: i.id,
    productId: i.product_id ?? '',
    nameEn: i.name_en,
    nameAr: i.name_ar,
    // unit_price already includes the selected modifiers (place_order sums them),
    // so `price * quantity` matches the persisted line_total on receipts.
    price: Number(i.unit_price),
    quantity: i.quantity,
    note: (i as { note?: string | null }).note?.trim() || undefined,
    selectedModifiers: (i.order_item_modifiers ?? []).map(mapOrderItemModifier),
  };
}

export function mapOrder(o: DbOrderWithItems): Order {
  return {
    id: o.id,
    orderNumber: o.order_number,
    customerId: o.customer_id ?? '',
    customerName: o.customer_name ?? '',
    customerPhone: o.customer_phone ?? '',
    branchId: o.branch_id,
    branchNameEn: o.branch_name_en ?? '',
    branchNameAr: o.branch_name_ar ?? '',
    status: o.status,
    orderType: o.order_type,
    subtotal: Number(o.subtotal),
    deliveryFee: Number(o.delivery_fee),
    couponCode: o.coupon_code ?? undefined,
    discountAmount: Number(o.discount_amount),
    loyaltyDiscountAmount: Number(o.loyalty_discount_amount),
    // Persisted by place_order at the instant the order is priced. Historical
    // receipts/reports must render this value rather than applying today's rate.
    vatAmount: Number(o.vat_amount),
    total: Number(o.total),
    loyaltyPointsEarned: o.loyalty_points_earned ?? 0,
    loyaltyPointsRedeemed: o.loyalty_points_redeemed ?? 0,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method ?? undefined,
    paymentProvider: o.payment_provider ?? undefined,
    paidAt: o.paid_at ?? undefined,
    orderSyncStatus: mapSyncStatus(o.sync_status),
    lazywaitSyncState: o.lazywait_sync_state ?? undefined,
    lazywaitRef: o.lazywait_ref ?? undefined,
    lazywaitOrderNumber: o.lazywait_order_number ?? undefined,
    lazywaitStatus: o.lazywait_status ?? undefined,
    syncAttemptCount: o.sync_attempt_count ?? undefined,
    syncLastError: o.sync_last_error ?? undefined,
    syncBlockedReason: o.sync_blocked_reason ?? undefined,
    syncedAt: o.synced_at ?? undefined,
    createdAt: o.created_at,
    address: o.address_snapshot ? mapAddressSnapshot(o.address_snapshot) : undefined,
    items: (o.order_items ?? []).map(mapOrderItem),
    // Trimmed so a whitespace-only note does not render an empty highlighted
    // panel that looks like a missing instruction.
    notes: o.notes?.trim() ? o.notes.trim() : undefined,
  };
}

/**
 * The order number to display so the customer, dashboard, and Lazywait POS all
 * reference the same ticket. Once an order has synced, the Lazywait POS number
 * (e.g. "#1") is the primary reference and the internal SM-… number becomes a
 * secondary reference; before sync / for delivery / when POS is off there is no
 * POS number, so the internal SM-… number is shown alone. The SM-… number stays
 * the canonical id used everywhere else.
 */
export function orderDisplayNumber(
  o: { orderNumber: string; lazywaitOrderNumber?: string | null },
): { primary: string; secondary: string | null } {
  const pos = (o.lazywaitOrderNumber ?? '').trim();
  return pos ? { primary: pos, secondary: o.orderNumber } : { primary: o.orderNumber, secondary: null };
}

// ---------------------------------------------------------------------------
// Settings (the single app_settings row feeds both brand + loyalty config)
// ---------------------------------------------------------------------------
export function mapBrandSettings(s: DbAppSettings): BrandSettings {
  // Only colour + VAT are modelled server-side; the rest (logo, socials, legal
  // text, support numbers) have no backend yet, so keep the bundled defaults.
  return {
    ...INITIAL_BRAND_SETTINGS,
    primaryColor: s.primary_color,
    secondaryColor: s.secondary_color,
    vatPercentage: Number(s.vat_percentage),
  };
}

export function mapLoyaltySettings(s: DbAppSettings): LoyaltySettings {
  return {
    isEnabled: s.loyalty_enabled,
    pointsPerRiyal: Number(s.points_per_riyal),
    minPointsToRedeem: s.min_points_to_redeem,
    discountPerPoint: Number(s.discount_per_point),
  };
}

/** Admin-configurable payment-method availability (non-secret). Cash defaults ON,
 *  online OFF, so a project without the migration still behaves safely. */
export function mapPaymentMethodSettings(s: DbAppSettings): PaymentMethodSettings {
  return {
    onlineEnabled: Boolean(s.online_payment_enabled),
    cashEnabled: s.cash_payment_enabled ?? true,
    defaultMethod: (s.default_payment_method ?? null) as 'online' | 'cash' | null,
    outageMode: Boolean(s.payment_outage_mode_enabled),
  };
}

/** Reverse map: brand-settings patch -> app_settings columns we can persist. */
export function brandPatchToDb(patch: Partial<BrandSettings>): Partial<DbAppSettings> {
  const out: Partial<DbAppSettings> = {};
  if (patch.primaryColor !== undefined) out.primary_color = patch.primaryColor;
  if (patch.secondaryColor !== undefined) out.secondary_color = patch.secondaryColor;
  if (patch.vatPercentage !== undefined) out.vat_percentage = patch.vatPercentage;
  return out;
}

export function loyaltyPatchToDb(patch: Partial<LoyaltySettings>): Partial<DbAppSettings> {
  const out: Partial<DbAppSettings> = {};
  if (patch.isEnabled !== undefined) out.loyalty_enabled = patch.isEnabled;
  if (patch.pointsPerRiyal !== undefined) out.points_per_riyal = patch.pointsPerRiyal;
  if (patch.discountPerPoint !== undefined) out.discount_per_point = patch.discountPerPoint;
  if (patch.minPointsToRedeem !== undefined) out.min_points_to_redeem = patch.minPointsToRedeem;
  return out;
}

// ---------------------------------------------------------------------------
// Reverse maps: app catalog shapes -> DB insert/update payloads (admin writes)
// ---------------------------------------------------------------------------
export function productToDbInsert(p: Omit<Product, 'id'>, sortOrder: number): Partial<DbProduct> {
  return {
    category_id: p.categoryId,
    name_en: p.nameEn,
    name_ar: p.nameAr,
    description_en: p.descriptionEn,
    description_ar: p.descriptionAr,
    price: p.price,
    calories: p.calories,
    image_url: p.imageUrl,
    is_active: p.isActive,
    sort_order: sortOrder,
  };
}

export function productToDbUpdate(p: Product): Partial<DbProduct> {
  return {
    category_id: p.categoryId,
    name_en: p.nameEn,
    name_ar: p.nameAr,
    description_en: p.descriptionEn,
    description_ar: p.descriptionAr,
    price: p.price,
    calories: p.calories,
    image_url: p.imageUrl,
    // Activation is deliberately NOT part of the generic edit contract. The
    // current product modal has no active/inactive control, so accepting its
    // reconstructed `isActive` value would let an ordinary text/price edit
    // silently reactivate a disabled menu item. A future activation control must
    // use an explicit, auditable path instead of piggybacking on generic edits.
  };
}

export function categoryToDbInsert(nameEn: string, nameAr: string, sortOrder: number): Partial<DbCategory> {
  return { name_en: nameEn, name_ar: nameAr, sort_order: sortOrder };
}

export function branchPatchToDb(patch: Partial<Branch>): Partial<DbBranch> {
  const out: Partial<DbBranch> = {};
  if (patch.deliveryFee !== undefined) out.delivery_fee = patch.deliveryFee;
  if (patch.minDeliveryOrder !== undefined) out.min_delivery_order = patch.minDeliveryOrder;
  if (patch.isActive !== undefined) out.is_active = patch.isActive;
  if (patch.nameEn !== undefined) out.name_en = patch.nameEn;
  if (patch.nameAr !== undefined) out.name_ar = patch.nameAr;
  // Address / phone / branch location — needed by the branch Edit modal and the
  // "Set branch location" flow. Persisted only through the admin-only path
  // (branches RLS: is_admin()). Previously these were silently dropped, which is
  // why setting a branch location did nothing.
  if (patch.addressEn !== undefined) out.address_en = patch.addressEn;
  if (patch.addressAr !== undefined) out.address_ar = patch.addressAr;
  if (patch.phone !== undefined) out.phone = patch.phone;
  if (patch.email !== undefined) out.email = patch.email || null;
  if (patch.latitude !== undefined) out.latitude = patch.latitude;
  if (patch.longitude !== undefined) out.longitude = patch.longitude;
  if (patch.lazywaitBranchId !== undefined) out.lazywait_branch_id = patch.lazywaitBranchId || null;
  if (patch.deliveryEnabled !== undefined) out.delivery_enabled = patch.deliveryEnabled;
  if (patch.pickupEnabled !== undefined) out.pickup_enabled = patch.pickupEnabled;
  if (patch.deliveryTemporarilyClosed !== undefined) out.delivery_temporarily_closed = patch.deliveryTemporarilyClosed;
  // `deliveryClosedUntil` is DELIBERATELY absent, unlike every other branch
  // field above. The pause timer is server-owned: `set_branch_delivery_pause`
  // writes it, `clear_branch_delivery_pause` and the sweeper clear it, and a
  // BEFORE trigger nulls it whenever the pause lifts. Letting a client patch
  // carry it would let a stale form strand a timer on a running branch, or
  // forge a resume time nothing will honour. Read-only on this side, on purpose.
  if (patch.estimatedDeliveryMinutes !== undefined) {
    out.estimated_delivery_minutes = patch.estimatedDeliveryMinutes ?? null;
  }
  return out;
}