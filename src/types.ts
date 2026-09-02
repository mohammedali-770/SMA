/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UserRole } from './lib/roles';

export type { UserRole };

export interface UserProfile {
  id: string;
  fullName: string;
  phoneNumber: string;
  role: UserRole;
  email?: string;
  createdAt: string;
  loyaltyPoints?: number; // Phase 11: Customer rewards
  phoneVerified?: boolean; // set server-side after WhatsApp OTP verification
}

export interface Branch {
  id: string;
  nameAr: string;
  nameEn: string;
  addressAr: string;
  addressEn: string;
  phone: string;
  /** Public branch contact address. Readable by anonymous customers, like phone. */
  email?: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  deliveryFee: number;
  minDeliveryOrder: number;
  lazywaitBranchId?: string; // Lazywait POS branch mapping (admin-set)
  // Delivery-zone feature: per-branch channel controls (admin-configured).
  // Optional so bundled demo branches stay valid; mapBranch always sets them,
  // and consumers default (?? true / ?? false) when reading.
  deliveryEnabled?: boolean;
  pickupEnabled?: boolean;
  deliveryTemporarilyClosed?: boolean;
  /**
   * When a timed delivery pause lifts itself. Null means the pause has no timer
   * (the admin's plain toggle) — NOT that delivery is running; read
   * `deliveryTemporarilyClosed` for that.
   */
  deliveryClosedUntil?: string | null;
  estimatedDeliveryMinutes?: number; // display-only ETA; not used in pricing
}

/** An active per-branch delivery coverage polygon (GeoJSON Geometry). */
export interface DeliveryZone {
  id: string;
  branchId: string;
  name?: string;
  geojson: import('./lib/geo').GeoJSONGeometry;
  isActive: boolean;
}

export interface Category {
  id: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
}

/**
 * A named price tier of a product — "Small"/"Large", "Spicy"/"Regular".
 *
 * The local mirror of a Lazywait item PRICE. Lazywait models a menu as
 * category -> item -> price, and this is that third level: it is what carries
 * `lazywait_price_id`, the id the POS ticket must name.
 */
export interface ProductVariant {
  id: string;
  productId: string;
  nameAr: string;
  nameEn: string;
  price: number; // VAT-inclusive, like Product.price
  calories: number | null;
  sortOrder: number;
  isActive: boolean;
  lazywaitPriceId?: string | null;
}

export interface Product {
  id: string;
  categoryId: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  /**
   * VAT-inclusive. With variants this is the CHEAPEST tier — the "from" price —
   * and an order line is priced from the chosen variant instead.
   */
  price: number;
  imageUrl: string;
  calories: number;
  isActive: boolean;
  /**
   * Display rank WITHIN its category, set by an administrator through
   * `reorder_products`. Compared only against products in the SAME category.
   *
   * Optional because this type doubles as the view model for products that do
   * not exist yet — a parsed CSV row, a half-filled form — where a rank is
   * genuinely absent rather than zero. Readers treat absent as 0.
   */
  sortOrder?: number;
  modifierGroupIds: string[]; // Association to modifier groups
  /** Orderable price tiers. Empty means the product has a single price. */
  variants: ProductVariant[];
}

export interface ModifierGroup {
  id: string;
  nameAr: string;
  nameEn: string;
  minSelection: number;
  maxSelection: number;
  isRequired: boolean;
  modifiers: Modifier[];
}

export interface Modifier {
  id: string;
  groupId: string;
  nameAr: string;
  nameEn: string;
  price: number;
}

export interface SavedAddress {
  id: string;
  label: string; // e.g. "Home", "Work", "أمي"
  description: string; // Street description
  nationalShortAddress: string; // e.g. RRBB1234
  lat: number;
  lng: number;
  isDefault: boolean;
}

export type OrderStatus = 'received' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type SyncStatus = 'not_synced' | 'pending_sync' | 'synced' | 'sync_failed';

export interface OrderItemModifier {
  id: string;
  modifierId: string;
  nameEn: string;
  nameAr: string;
  price: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  nameEn: string;
  nameAr: string;
  price: number;
  quantity: number;
  /** The customer's instruction for THIS line ("no onion"), when they left one. */
  note?: string;
  /**
   * The price tier this line was ordered at, snapshotted onto the line at
   * checkout. Absent for an untiered product and for any order placed before
   * `20260824120000_product_variants`. Two lines both reading "Coral" may be
   * different food at different prices, so the tier is what makes a ticket
   * unambiguous — see `orderLineLabel`.
   */
  variantId?: string;
  variantNameEn?: string;
  variantNameAr?: string;
  selectedModifiers: OrderItemModifier[];
}

/**
 * How a line is named to staff and on a receipt: "Coral — Large".
 *
 * Falls back to the bare product name when the line has no tier, or when the
 * tier name merely repeats it, so an untiered product reads exactly as it did
 * before variants existed.
 */
export function orderLineLabel(item: OrderItem, isRTL: boolean): string {
  const base = isRTL ? item.nameAr : item.nameEn;
  const tier = (isRTL ? item.variantNameAr : item.variantNameEn)?.trim();
  return !tier || tier === base ? base : `${base} — ${tier}`;
}

export interface Order {
  id: string;
  orderNumber: string; // format: SM-2026-XXXXXX
  customerId: string;
  customerName: string;
  customerPhone: string;
  branchId: string;
  branchNameEn: string;
  branchNameAr: string;
  status: OrderStatus;
  orderType: 'delivery' | 'pickup';
  subtotal: number;
  deliveryFee: number;
  couponCode?: string; // the actual coupon code applied at checkout, if any
  discountAmount?: number; // coupon discount applied at checkout
  loyaltyDiscountAmount?: number; // value of loyalty points redeemed at checkout
  loyaltyPointsEarned?: number; // points credited by place_order for this order
  loyaltyPointsRedeemed?: number; // points spent on this order
  /** VAT component persisted by place_order at order time. Historical receipts
   * must prefer this snapshot over recomputing from today's configured rate. */
  vatAmount?: number;
  total: number; // subtotal + deliveryFee - discountAmount - loyaltyDiscountAmount
  paymentStatus: 'pending' | 'paid';
  paymentMethod?: string; // how the customer pays: 'online' | 'cash' (admin-configured availability)
  paymentProvider?: string; // verified gateway label once an online payment is confirmed (server-set)
  paidAt?: string; // ISO timestamp an online payment was verified (server-set); null for unpaid/cash
  orderSyncStatus: SyncStatus;
  // Lazywait POS sync detail (admin visibility).
  lazywaitSyncState?: string; // pending|syncing|synced|failed|blocked|dead_letter|skipped
  lazywaitRef?: string;
  lazywaitOrderNumber?: string;
  lazywaitStatus?: string;
  syncAttemptCount?: number;
  syncLastError?: string;
  syncBlockedReason?: string;
  syncedAt?: string;
  createdAt: string;
  address?: SavedAddress;
  items: OrderItem[];
  /**
   * Free-text note the customer attached at checkout — allergies, "no onions",
   * door codes. The column has always existed and `admin_list_orders_with_items`
   * has always returned it, but it was never mapped into this type, so no staff
   * member could read it. The POS handoff does not carry it either, which makes
   * the dashboard the ONLY place this text can reach a human.
   */
  notes?: string;
}

export interface CartItem {
  cartItemId: string; // product.id + sorted modifier ids stringified
  product: Product;
  selectedModifiers: { [groupId: string]: Modifier[] };
  quantity: number;
  totalPrice: number; // base price + selected modifiers prices
}

export interface Banner {
  id: string;
  titleEn: string;
  titleAr: string;
  imageUrl: string;
  productId?: string; // Tapping this can go directly to product
}

export interface BrandSettings {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  vatPercentage: number;
  vatIncluded: boolean;
  supportPhone: string;
  whatsappNumber: string;
  instagram: string;
  twitter: string;
  privacyPolicyEn: string;
  privacyPolicyAr: string;
  termsEn: string;
  termsAr: string;
}

// (Removed ProductBranchAvailability, LazywaitSettings, SmsSettings,
//  NotificationSettings and IntegrationEvent on 2026-09-02 — each occurred
//  exactly once in the repository, at its own declaration. They are prototype-era
//  shapes: the three *Settings ones modelled provider credentials as CLIENT types
//  (`apiKey`), which is the same defect recorded in src/data/initialData.ts, and
//  IntegrationEvent described a SIMULATED gateway message for the retired
//  emulator. Real provider config lives in integration_settings; the admin UI
//  reads only the non-secret projection. PaymentSettings is deliberately left in
//  place — it is unused too, but it is payment-shaped and CLAUDE.md §6 is
//  cheaper to respect than to argue with.)

export interface PaymentSettings {
  providerName: 'paytabs' | 'hyperpay' | 'moyasar' | 'sandbox';
  isLiveMode: boolean;
  publicKey: string;
  secretKey: string;
  isEnabled: boolean;
}

export interface LoyaltySettings {
  isEnabled: boolean;
  pointsPerRiyal: number;
  minPointsToRedeem: number;
  discountPerPoint: number; // e.g. 100 points = 10 SAR, so 0.10 SAR per point
}

