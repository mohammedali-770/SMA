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
  modifierGroupIds: string[]; // Association to modifier groups
  /** Orderable price tiers. Empty means the product has a single price. */
  variants: ProductVariant[];
}

export interface ProductBranchAvailability {
  productId: string;
  branchId: string;
  isAvailable: boolean;
  stockQuantity: number;
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
  selectedModifiers: OrderItemModifier[];
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

export interface LazywaitSettings {
  baseUrl: string;
  apiKey: string;
  clientId: string;
  isEnabled: boolean;
  isMenuSyncEnabled: boolean;
  isStockSyncEnabled: boolean;
  isOrderSyncEnabled: boolean;
}

export interface PaymentSettings {
  providerName: 'paytabs' | 'hyperpay' | 'moyasar' | 'sandbox';
  isLiveMode: boolean;
  publicKey: string;
  secretKey: string;
  isEnabled: boolean;
}

export interface SmsSettings {
  providerName: 'unifonic' | 'twilio' | 'mobily' | 'sandbox';
  apiKey: string;
  senderId: string;
  isEnabled: boolean;
}

export interface NotificationSettings {
  providerName: 'expo' | 'onesignal' | 'sandbox';
  apiKey: string;
  isEnabled: boolean;
}

/**
 * A simulated outbound message from the SMS or push-notification gateway,
 * recorded when an order is placed or its status changes — but only while the
 * relevant provider toggle is enabled. Surfaced in the admin activity log so
 * the SMS/push settings visibly do something instead of being dead config.
 */
export interface IntegrationEvent {
  id: string;
  createdAt: string; // ISO timestamp
  channel: 'sms' | 'push';
  provider: string;
  recipient: string;
  message: string;
}

export interface LoyaltySettings {
  isEnabled: boolean;
  pointsPerRiyal: number;
  minPointsToRedeem: number;
  discountPerPoint: number; // e.g. 100 points = 10 SAR, so 0.10 SAR per point
}

