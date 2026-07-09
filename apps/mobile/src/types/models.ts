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
  price: number; // unit price incl. selected modifiers
  quantity: number;
  selectedModifiers: OrderItemModifier[];
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
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
  loyaltyPointsRedeemed: number;
  paymentStatus: 'pending' | 'paid';
  paymentMethod?: string; // 'online' | 'cash' (admin-configured availability)
  paymentProvider?: string; // gateway label once an online payment is verified (server-set)
  paidAt?: string; // ISO time an online payment was verified; null for unpaid/cash
  couponCode?: string;
  notes?: string;
  createdAt: string;
  lazywaitOrderNumber?: string; // POS number once synced; primary display ref
  address?: SavedAddress;
  items: OrderItem[];
}

/** A configured product in the cart (product + the modifiers chosen per group). */
export interface CartItem {
  cartItemId: string; // product.id + sorted modifier ids
  product: Product;
  selectedModifiers: { [groupId: string]: Modifier[] };
  quantity: number;
  unitPrice: number; // base price + selected modifier prices (per single item)
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
