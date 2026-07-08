/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'customer' | 'admin' | 'accountant';

export interface UserProfile {
  id: string;
  fullName: string;
  phoneNumber: string;
  role: UserRole;
  email?: string;
  createdAt: string;
  loyaltyPoints?: number; // Phase 11: Customer rewards
}

export interface Branch {
  id: string;
  nameAr: string;
  nameEn: string;
  addressAr: string;
  addressEn: string;
  phone: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  deliveryFee: number;
  minDeliveryOrder: number;
  lazywaitBranchId?: string; // Lazywait POS branch mapping (admin-set)
}

export interface Category {
  id: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
}

export interface Product {
  id: string;
  categoryId: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  price: number; // VAT-inclusive in Saudi Arabia (15% VAT)
  imageUrl: string;
  calories: number;
  isActive: boolean;
  modifierGroupIds: string[]; // Association to modifier groups
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
  discountAmount?: number; // coupon discount applied at checkout
  loyaltyDiscountAmount?: number; // value of loyalty points redeemed at checkout
  loyaltyPointsEarned?: number; // points credited by place_order for this order
  loyaltyPointsRedeemed?: number; // points spent on this order
  total: number; // subtotal + deliveryFee - discountAmount - loyaltyDiscountAmount
  paymentStatus: 'pending' | 'paid';
  paymentMethod?: string; // display label, e.g. "Moyasar (Test)" or "Cash on Delivery"
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

