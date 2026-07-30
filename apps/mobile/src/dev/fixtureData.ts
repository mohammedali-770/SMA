/**
 * Deterministic mock state for the dev fixture provider.
 *
 * Pure data — no imports from services, no fetch, no Supabase, no Lazywait, no
 * payment SDK. Values are fixed constants (never Date.now(), never random) so a
 * fixture screenshot is reproducible and a visual diff means a real change.
 *
 * Framework-free so it can be asserted in unit tests.
 */
import type { OrderContext } from '../features/order/orderContext';
import type { Branch, CartItem, Product } from '../types/models';

/** Cast helpers: fixtures only populate the fields the screens actually read. */
const asProduct = (o: Partial<Product>): Product => o as unknown as Product;
const asCartItem = (o: Partial<CartItem>): CartItem => o as unknown as CartItem;
const asBranch = (o: Partial<Branch>): Branch => o as unknown as Branch;

export const FIXTURE_BRANCH = asBranch({
  id: 'br-fixture-olaya',
  nameEn: 'Olaya Branch',
  nameAr: 'فرع العليا',
  addressEn: 'Olaya St, Riyadh',
  addressAr: 'شارع العليا، الرياض',
  phone: '+966558124407',
  isActive: true,
  deliveryFee: 15,
  minDeliveryOrder: 40,
  estimatedDeliveryMinutes: 35,
  deliveryEnabled: true,
  pickupEnabled: true,
});

export const FIXTURE_PRODUCTS: Product[] = [
  asProduct({
    id: 'p-fixture-1',
    nameEn: 'Spicy Crispy Chicken Meal',
    nameAr: 'وجبة دجاج مقرمش حار',
    descriptionEn: 'Two crispy fillets, fries, coleslaw and a drink.',
    descriptionAr: 'قطعتان مقرمشتان، بطاطس، سلطة كول سلو ومشروب.',
    price: 34.5,
    calories: 890,
  }),
  asProduct({
    id: 'p-fixture-2',
    nameEn: 'Golden Fries',
    nameAr: 'بطاطس ذهبية',
    descriptionEn: 'Hand-cut and lightly salted.',
    descriptionAr: 'مقطعة يدوياً ومملحة قليلاً.',
    price: 9,
    calories: 320,
  }),
];

export const FIXTURE_CART_ITEMS: CartItem[] = [
  asCartItem({
    cartItemId: 'ci-fixture-1',
    product: FIXTURE_PRODUCTS[0],
    quantity: 2,
    unitPrice: 34.5,
    selectedModifiers: {},
  }),
  asCartItem({
    cartItemId: 'ci-fixture-2',
    product: FIXTURE_PRODUCTS[1],
    quantity: 1,
    unitPrice: 9,
    selectedModifiers: {},
  }),
];

/** 2 × 34.50 + 1 × 9.00 — fixed, so totals in a screenshot are checkable by hand. */
export const FIXTURE_SUBTOTAL = 78;
export const FIXTURE_CART_COUNT = 3;

export const FIXTURE_ORDER_CONTEXT = {
  orderType: 'delivery',
  branchId: FIXTURE_BRANCH.id,
  branchNameEn: FIXTURE_BRANCH.nameEn,
  branchNameAr: FIXTURE_BRANCH.nameAr,
  deliveryFee: 15,
  deliveryDescription: 'Al Nargis, King Abdulaziz Rd, Villa 24',
  deliveryLat: 24.7743,
  deliveryLng: 46.7386,
  shortAddress: 'RRBB1234',
} as unknown as OrderContext;

/** Brand/VAT settings the checkout money column reads. */
export const FIXTURE_BRAND_SETTINGS = {
  vatPercentage: 15,
  vatInclusive: true,
  primaryColor: '#E02D3D',
  secondaryColor: '#422E87',
} as const;

/** Loyalty settings — a balance large enough to exercise the redeem row. */
export const FIXTURE_LOYALTY = {
  enabled: true,
  discountPerPoint: 0.1,
  minPointsToRedeem: 100,
  earnRate: 1,
} as const;

/** Payment availability. Both methods on, so the selector renders in full. */
export const FIXTURE_PAYMENT = {
  onlineEnabled: true,
  cashEnabled: true,
  defaultMethod: 'cash',
  outage: false,
} as const;

/** Signed-in customer. */
export const FIXTURE_PROFILE = {
  id: 'pr-fixture-1',
  fullName: 'Nora Al Otaibi',
  phoneNumber: '+966558124407',
  phoneVerified: true,
  loyaltyPoints: 480,
  role: 'customer',
} as const;
