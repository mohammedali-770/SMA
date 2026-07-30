/**
 * Deterministic mock state for the dev fixture provider.
 *
 * Pure data — no imports from services, no fetch, no Supabase, no Lazywait, no
 * payment SDK. Values are fixed constants (never Date.now(), never random) so a
 * fixture screenshot is reproducible and a visual diff means a real change.
 *
 * Framework-free so it can be asserted in unit tests.
 *
 * TYPED, NOT CAST-TO-ANY. Earlier revisions of this file used loose object
 * literals behind `as unknown as T`, and three of them were silently wrong:
 * `enabled` instead of `isEnabled` meant the loyalty section never rendered in
 * any screenshot, `outage` instead of `outageMode` left the payment settings
 * incomplete, and the branch carried no coordinates so the map always opened on
 * the Riyadh default rather than the fixture pin. The helpers below still allow
 * partial objects (fixtures only populate what the screens read), but every
 * field name that IS present is now checked against the real model.
 */
import type { OrderContext } from '../features/order/orderContext';
import type {
  Branch,
  CartItem,
  DeliveryZone,
  LoyaltySettings,
  Product,
  UserProfile,
} from '../types/models';
import type { PaymentMethodSettings } from '../lib/payment';

/**
 * Partial-but-checked: keys must exist on the model and hold the right type,
 * while fields the screens never read may be omitted.
 */
const fixture = <T,>(o: Partial<T>): T => o as T;

export const FIXTURE_BRANCH = fixture<Branch>({
  id: 'br-fixture-olaya',
  nameEn: 'Olaya Branch',
  nameAr: 'فرع العليا',
  addressEn: 'Olaya St, Riyadh',
  addressAr: 'شارع العليا، الرياض',
  phone: '+966558124407',
  // Without these the delivery map opened on the Riyadh city default instead of
  // the branch, so the pin in a screenshot meant nothing.
  latitude: 24.6931,
  longitude: 46.6858,
  isActive: true,
  deliveryFee: 15,
  minDeliveryOrder: 40,
  estimatedDeliveryMinutes: 35,
  deliveryEnabled: true,
  pickupEnabled: true,
  deliveryTemporarilyClosed: false,
});

/** A branch with delivery switched off — the "delivery closed" review state. */
export const FIXTURE_BRANCH_DELIVERY_OFF = fixture<Branch>({
  ...FIXTURE_BRANCH,
  deliveryTemporarilyClosed: true,
});

/**
 * Delivery coverage containing FIXTURE_DELIVERY_POINT. Without a zone the
 * serviceability pre-check always resolved to "not available for this
 * location", so the VALID delivery checkout state was unreachable and every
 * delivery screenshot showed a blocked footer.
 */
export const FIXTURE_DELIVERY_POINT = { lat: 24.7743, lng: 46.7386 };

export const FIXTURE_DELIVERY_ZONE = fixture<DeliveryZone>({
  id: 'dz-fixture-1',
  branchId: FIXTURE_BRANCH.id,
  name: 'Olaya coverage',
  isActive: true,
  geojson: {
    type: 'Polygon',
    // GeoJSON is [lng, lat]. A box comfortably around the fixture pin.
    coordinates: [[
      [46.70, 24.74],
      [46.78, 24.74],
      [46.78, 24.81],
      [46.70, 24.81],
      [46.70, 24.74],
    ]],
  },
});

export const FIXTURE_PRODUCTS: Product[] = [
  fixture<Product>({
    id: 'p-fixture-1',
    nameEn: 'Spicy Crispy Chicken Meal',
    nameAr: 'وجبة دجاج مقرمش حار',
    descriptionEn: 'Two crispy fillets, fries, coleslaw and a drink.',
    descriptionAr: 'قطعتان مقرمشتان، بطاطس، سلطة كول سلو ومشروب.',
    price: 34.5,
    calories: 890,
  }),
  fixture<Product>({
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
  fixture<CartItem>({
    cartItemId: 'ci-fixture-1',
    product: FIXTURE_PRODUCTS[0],
    quantity: 2,
    unitPrice: 34.5,
    selectedModifiers: {},
  }),
  fixture<CartItem>({
    cartItemId: 'ci-fixture-2',
    product: FIXTURE_PRODUCTS[1],
    quantity: 1,
    unitPrice: 9,
    selectedModifiers: {},
  }),
];

/**
 * A cart UNDER the branch minimum (40), so the below-minimum block and its
 * "add N more, or switch to pickup" action can be reviewed.
 */
export const FIXTURE_CART_BELOW_MIN: CartItem[] = [
  fixture<CartItem>({
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
export const FIXTURE_SUBTOTAL_BELOW_MIN = 9;
export const FIXTURE_CART_COUNT_BELOW_MIN = 1;

const BASE_CONTEXT = {
  branchId: FIXTURE_BRANCH.id,
  branchNameEn: FIXTURE_BRANCH.nameEn,
  branchNameAr: FIXTURE_BRANCH.nameAr,
  addressId: null,
  deliveryLandmark: null,
  minOrder: FIXTURE_BRANCH.minDeliveryOrder,
  // Fixed epoch (2026-01-01T00:00:00Z), never Date.now() — see the docblock.
  lastValidatedAt: 1767225600000,
};

export const FIXTURE_ORDER_CONTEXT = fixture<OrderContext>({
  ...BASE_CONTEXT,
  orderType: 'delivery',
  deliveryFee: FIXTURE_BRANCH.deliveryFee,
  deliveryLat: FIXTURE_DELIVERY_POINT.lat,
  deliveryLng: FIXTURE_DELIVERY_POINT.lng,
  deliveryDescription: 'Al Nargis, King Abdulaziz Rd — blue villa gate beside the pharmacy',
});

/** Pickup: no address, no fee, no landmark requirement. */
export const FIXTURE_ORDER_CONTEXT_PICKUP = fixture<OrderContext>({
  ...BASE_CONTEXT,
  orderType: 'pickup',
  deliveryFee: null,
  deliveryLat: null,
  deliveryLng: null,
  deliveryDescription: null,
});

/** Delivery chosen but no pin and no landmark yet — the missing-address state. */
export const FIXTURE_ORDER_CONTEXT_NO_ADDRESS = fixture<OrderContext>({
  ...BASE_CONTEXT,
  orderType: 'delivery',
  deliveryFee: FIXTURE_BRANCH.deliveryFee,
  deliveryLat: null,
  deliveryLng: null,
  deliveryDescription: null,
});

/** Brand/VAT settings the checkout money column reads. */
export const FIXTURE_BRAND_SETTINGS = {
  vatPercentage: 15,
  vatInclusive: true,
  primaryColor: '#E02D3D',
  secondaryColor: '#422E87',
} as const;

/**
 * Loyalty. `isEnabled` — NOT `enabled`, which is what this said before and is
 * why the loyalty toggle never appeared in a single fixture screenshot.
 * 480 points at 0.10 clears the 100-point floor, so the redeem row renders.
 */
export const FIXTURE_LOYALTY = fixture<LoyaltySettings>({
  isEnabled: true,
  pointsPerRiyal: 1,
  discountPerPoint: 0.1,
  minPointsToRedeem: 100,
});

/** Both methods on, so the selector renders in full. */
export const FIXTURE_PAYMENT = fixture<PaymentMethodSettings>({
  onlineEnabled: true,
  cashEnabled: true,
  defaultMethod: 'cash',
  outageMode: false,
});

/** Online off, cash on — drives the "online unavailable" notice. */
export const FIXTURE_PAYMENT_ONLINE_OFF = fixture<PaymentMethodSettings>({
  onlineEnabled: false,
  cashEnabled: true,
  defaultMethod: 'cash',
  outageMode: true,
});

/** Nothing enabled — checkout must block outright. */
export const FIXTURE_PAYMENT_NONE = fixture<PaymentMethodSettings>({
  onlineEnabled: false,
  cashEnabled: false,
  defaultMethod: null,
  outageMode: true,
});

/** Signed-in customer. */
export const FIXTURE_PROFILE = fixture<UserProfile>({
  id: 'pr-fixture-1',
  fullName: 'Nora Al Otaibi',
  phoneNumber: '+966558124407',
  role: 'customer',
  phoneVerified: true,
  loyaltyPoints: 480,
});
