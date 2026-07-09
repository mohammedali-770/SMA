/**
 * Translation between the snake_case Supabase rows (api.ts / types/db.ts) and
 * the camelCase domain models the screens consume (types/models.ts). Mirrors
 * the customer slice of the web app's src/lib/mappers.ts.
 */
import type {
  DbAddress, DbAppSettings, DbBranch, DbBranchAvailability, DbBranchDeliveryZone, DbCategory,
  DbModifier, DbModifierGroup, DbOrderItem, DbOrderItemModifier, DbOrderWithItems,
  DbProduct, DbProductModifierGroup, DbProfile,
} from '../types/db';
import type {
  Branch, BrandSettings, Category, DeliveryZone, LoyaltySettings, Modifier, ModifierGroup,
  Order, OrderItem, OrderItemModifier, Product, SavedAddress, UserProfile,
} from '../types/models';
import type { PaymentMethodSettings } from './payment';

/** A neutral food image used when a product has no image_url. */
const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&h=400&q=80';

// --- Catalog ---------------------------------------------------------------
export function mapBranch(b: DbBranch): Branch {
  return {
    id: b.id,
    nameEn: b.name_en,
    nameAr: b.name_ar,
    addressEn: b.address_en ?? '',
    addressAr: b.address_ar ?? '',
    phone: b.phone ?? '',
    latitude: b.latitude ?? 0,
    longitude: b.longitude ?? 0,
    isActive: b.is_active,
    deliveryFee: Number(b.delivery_fee),
    minDeliveryOrder: Number(b.min_delivery_order),
    deliveryEnabled: b.delivery_enabled ?? true,
    pickupEnabled: b.pickup_enabled ?? true,
    deliveryTemporarilyClosed: b.delivery_temporarily_closed ?? false,
    estimatedDeliveryMinutes: b.estimated_delivery_minutes ?? undefined,
  };
}

/** DB delivery-zone row -> domain DeliveryZone (geojson kept for pre-check/render). */
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
    modifierGroupIds: links.filter((l) => l.product_id === p.id).map((l) => l.group_id),
  };
}

export function mapModifier(m: DbModifier): Modifier {
  return { id: m.id, groupId: m.group_id, nameEn: m.name_en, nameAr: m.name_ar, price: Number(m.price) };
}

export function mapModifierGroup(g: DbModifierGroup, modifiers: DbModifier[]): ModifierGroup {
  return {
    id: g.id,
    nameEn: g.name_en,
    nameAr: g.name_ar,
    minSelection: g.min_select,
    // null max_select == "no upper bound"; use a large sentinel that still
    // behaves as multi-select for the UI.
    maxSelection: g.max_select ?? 99,
    isRequired: g.is_required,
    modifiers: modifiers.filter((m) => m.group_id === g.id).map(mapModifier),
  };
}

/**
 * productId -> branchId -> available. The table stores only explicit rows; an
 * absent row means "available", so seed every pair true, then apply exceptions.
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

// --- Profile / address -----------------------------------------------------
export function mapProfile(p: DbProfile): UserProfile {
  return {
    id: p.id,
    fullName: p.full_name ?? '',
    phoneNumber: p.phone_number ?? '',
    email: p.email ?? undefined,
    role: p.role,
    loyaltyPoints: p.loyalty_points,
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

// --- Orders ----------------------------------------------------------------
function mapOrderItemModifier(m: DbOrderItemModifier): OrderItemModifier {
  return { id: m.id, modifierId: m.modifier_id ?? '', nameEn: m.name_en, nameAr: m.name_ar, price: Number(m.price) };
}

function mapOrderItem(i: DbOrderItem & { order_item_modifiers?: DbOrderItemModifier[] }): OrderItem {
  return {
    id: i.id,
    productId: i.product_id ?? '',
    nameEn: i.name_en,
    nameAr: i.name_ar,
    // unit_price already includes the selected modifiers (place_order sums them).
    price: Number(i.unit_price),
    quantity: i.quantity,
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
    discountAmount: Number(o.discount_amount),
    loyaltyDiscountAmount: Number(o.loyalty_discount_amount),
    vatAmount: Number(o.vat_amount),
    total: Number(o.total),
    loyaltyPointsEarned: o.loyalty_points_earned ?? 0,
    loyaltyPointsRedeemed: o.loyalty_points_redeemed ?? 0,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method ?? undefined,
    paymentProvider: o.payment_provider ?? undefined,
    paidAt: o.paid_at ?? undefined,
    couponCode: o.coupon_code ?? undefined,
    notes: o.notes ?? undefined,
    createdAt: o.created_at,
    address: o.address_snapshot ? mapAddressSnapshot(o.address_snapshot) : undefined,
    items: (o.order_items ?? []).map(mapOrderItem),
  };
}

// --- Settings (single app_settings row feeds brand + loyalty) --------------
export function mapBrandSettings(s: DbAppSettings): BrandSettings {
  return {
    primaryColor: s.primary_color,
    secondaryColor: s.secondary_color,
    vatPercentage: Number(s.vat_percentage),
    currency: s.currency,
    brandNameEn: s.brand_name_en,
    brandNameAr: s.brand_name_ar,
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

/** Admin-configurable payment availability (non-secret). Falls back to cash-on /
 *  online-off so a project without the migration still checks out safely. */
export function mapPaymentMethodSettings(s: DbAppSettings): PaymentMethodSettings {
  return {
    onlineEnabled: Boolean(s.online_payment_enabled),
    cashEnabled: s.cash_payment_enabled ?? true,
    defaultMethod: (s.default_payment_method ?? null) as 'online' | 'cash' | null,
    outageMode: Boolean(s.payment_outage_mode_enabled),
  };
}
