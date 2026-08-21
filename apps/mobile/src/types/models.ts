/**
 * App-facing domain types (camelCase, modifiers nested), mirroring the web
 * app's src/types.ts for the customer subset. Screens consume these; the
 * mappers translate the snake_case DB rows into them.
 */
import type { OrderStatus, OrderType, UserRole } from './db';

export type { OrderStatus, OrderType, UserRole };

export interface UserProfile {
  id: string;
  fullName: string;
  phoneNumber: string;
  email?: string;
  role: UserRole;
  loyaltyPoints: number;
  phoneVerified: boolean;
}

export interface Branch {
  id: string;
  nameEn: string;
  nameAr: string;
  addressEn: string;
  addressAr: string;
  phone: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  deliveryFee: number;
  minDeliveryOrder: number;
  // Delivery-zone feature (admin-configured). Optional; mapBranch always sets
  // them and consumers default (?? true / ?? false).
  deliveryEnabled?: boolean;
  pickupEnabled?: boolean;
  deliveryTemporarilyClosed?: boolean;
  estimatedDeliveryMinutes?: number;
}

/** An active per-branch delivery coverage polygon (GeoJSON Geometry). */
export interface DeliveryZone {
  id: string;
  branchId: string;
  name?: string;
  geojson: import('../lib/geo').GeoJSONGeometry;
  isActive: boolean;
}

export interface Category {
  id: string;
  nameEn: string;
  nameAr: string;
  sortOrder: number;
}

export interface HomeBanner {
  id: string;
  titleEn: string;
  titleAr: string;
  imageUrl: string;
  actionType: 'none' | 'category' | 'product';
  actionValue: string | null;
}

export interface LegalDoc {
  id: string;
  type: string;
  titleEn: string;
  titleAr: string;
  contentEn: string;
  contentAr: string;
  version: string;
  effectiveDate: string | null;
}

export interface Product {
  id: string;
  categoryId: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  price: number; // VAT-inclusive (Saudi 15% VAT)
  imageUrl: string;
  calories: number;
  isActive: boolean;
  modifierGroupIds: string[];
}

export interface Modifier {
  id: string;
  groupId: string;
  nameEn: string;
  nameAr: string;
  price: number;
}

export interface ModifierGroup {
  id: string;
  nameEn: string;
  nameAr: string;
  minSelection: number;
  maxSelection: number;
  isRequired: boolean;
  modifiers: Modifier[];
}

export interface SavedAddress {
  id: string;
  label: string;
  description: string;
  nationalShortAddress: string;
  lat: number;
  lng: number;
  isDefault: boolean;
}

export interface OrderItemModifier {
  id: string;
  nameEn: string;
  nameAr: string;
  price: number;
}

export interface OrderItem {
  id: string;
  /** The customer's instruction for this line, when they left one. */
  note?: string;
  // productId / modifierId are NOT fetched for a customer order (they are catalog
  // joins the receipt never uses) — see lib/orderSelect.ts.
  nameEn: string;
  nameAr: string;
  price: number; // unit price incl. selected modifiers
  quantity: number;
  selectedModifiers: OrderItemModifier[];
}

/**
 * The CUSTOMER view of an order. Deliberately narrower than the table: the
 * internal `SM-…` order number, customer-identity copies, the coupon code, the
 * address snapshot and every operational column are neither fetched nor
 * representable here (Issue #94). See lib/orderSelect.ts. The customer's own
 * kitchen note IS carried — it is their text, on their order.
 */
export interface Order {
  id: string;
  branchId: string;
  branchNameEn: string;
  branchNameAr: string;
  status: OrderStatus;
  orderType: OrderType;
  subtotal: number;
  deliveryFee: number;
  discountAmount: number;
  loyaltyDiscountAmount: number;
  vatAmount: number;
  total: number;
  loyaltyPointsEarned: number;
  paymentStatus: 'pending' | 'paid';
  paymentMethod?: string; // 'online' | 'cash' (admin-configured availability)
  createdAt: string;
  /** The kitchen note the customer attached at checkout, shown back on the receipt. */
  notes?: string;
  /** Branch (POS) order number once accepted — the ONLY number ever shown. */
  lazywaitOrderNumber?: string;
  // Confirmation state-machine inputs (see features/orders/orderConfirmation.ts).
  lazywaitSyncState?: string;
  lazywaitRef?: string; // POS order reference; REQUIRED to show "confirmed"
  /** Distinguishes "no POS channel for this order" from a real send failure. */
  syncBlockedReason?: string;
  syncNextAttemptAt?: string;
  /** May-have-been-sent phase marker; blocks any resend when set. */
  posCreateAttemptedAt?: string;
  /** SERVER-counted manual resends. Never rendered — see CUSTOMER_RESEND_LIMIT. */
  posCustomerRetryCount?: number;
  /** 'none' | 'pending' | 'processing' | 'refunded' | 'failed'. */
  refundState?: string;
  items: OrderItem[];
}

/** A configured product in the cart (product + the modifiers chosen per group). */
export interface CartItem {
  cartItemId: string; // product.id + sorted modifier ids + the note
  product: Product;
  selectedModifiers: { [groupId: string]: Modifier[] };
  quantity: number;
  unitPrice: number; // base price + selected modifier prices (per single item)
  /**
   * Optional instruction for THIS line ("no onion"). Part of `cartItemId`, so
   * the same dish ordered twice with different notes stays two lines.
   * Bounded by ITEM_NOTE_MAX_LENGTH; absent rather than '' when there is none.
   */
  note?: string;
}

export interface BrandSettings {
  primaryColor: string;
  secondaryColor: string;
  vatPercentage: number;
  currency: string;
  brandNameEn: string;
  brandNameAr: string;
}

export interface LoyaltySettings {
  isEnabled: boolean;
  pointsPerRiyal: number;
  minPointsToRedeem: number;
  discountPerPoint: number;
}
