/**
 * Preview-only stand-in for src/services/api.
 *
 * The customer app is gated behind a real Supabase session, so its screens
 * cannot be seen without credentials — and pointing a screenshot harness at
 * Production is not something to do casually. This supplies the same module
 * contract from demo rows instead, so the REAL screens render through the REAL
 * providers, with the REAL theme, and only the data is synthetic.
 *
 * Wired in by metro.config.js, and only when SPICY_MEAL_PREVIEW=1 is set in the
 * environment. Nothing here ships: without that variable Metro never resolves
 * this file, so the released bundle is byte-for-byte unaffected.
 *
 * Writes resolve without persisting. Nothing in this file talks to a network.
 */
import type {
  DbAddress, DbAppSettings, DbBranch, DbBranchAvailability, DbBranchDeliveryZone,
  DbCategory, DbCustomerOrderWithItems, DbHomepageBanner, DbLegalDocument, DbModifier,
  DbModifierGroup, DbProduct, DbProductModifierGroup, DbProfile,
} from '../src/types/db';

const NOW = '2026-07-29T18:00:00Z';
const CUSTOMER_ID = 'preview-customer';

/**
 * Food photography as an inline SVG data URI: no binary in the repo, no request
 * leaving the device, and each dish gets a distinguishable colour so cards are
 * telling apart at a glance in a screenshot.
 */
const dish = (from: string, to: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">' +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      '</linearGradient></defs><rect width="400" height="400" fill="url(#g)"/></svg>',
  );

const banner = (from: string, to: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="450">' +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      '</linearGradient></defs><rect width="1200" height="450" fill="url(#g)"/></svg>',
  );

const BRANCHES: DbBranch[] = [
  {
    id: 'b-olaya', name_en: 'Olaya', name_ar: 'فرع العليا',
    address_en: 'Olaya General Road, Al Olaya', address_ar: 'طريق العليا العام، حي العليا',
    phone: '+966114820000', latitude: 24.6944, longitude: 46.6853,
    delivery_fee: 0, min_delivery_order: 50, is_active: true,
    delivery_enabled: true, pickup_enabled: true, delivery_temporarily_closed: false,
    estimated_delivery_minutes: 30,
  },
  {
    id: 'b-nakheel', name_en: 'Al Nakheel', name_ar: 'فرع النخيل',
    address_en: 'King Fahd Road, Al Nakheel', address_ar: 'طريق الملك فهد، حي النخيل',
    phone: '+966114820001', latitude: 24.7500, longitude: 46.6400,
    delivery_fee: 5, min_delivery_order: 40, is_active: true,
    delivery_enabled: true, pickup_enabled: true, delivery_temporarily_closed: false,
    estimated_delivery_minutes: 35,
  },
  {
    id: 'b-malqa', name_en: 'Al Malqa', name_ar: 'فرع الملقا',
    address_en: 'Anas Bin Malik Road, Al Malqa', address_ar: 'شارع أنس بن مالك، حي الملقا',
    phone: '+966114820002', latitude: 24.8000, longitude: 46.6200,
    delivery_fee: 8, min_delivery_order: 40, is_active: true,
    delivery_enabled: true, pickup_enabled: true, delivery_temporarily_closed: false,
    estimated_delivery_minutes: 40,
  },
  {
    id: 'b-suwaidi', name_en: 'Al Suwaidi', name_ar: 'فرع السويدي',
    address_en: 'Prince Sultan Street, Al Suwaidi', address_ar: 'شارع الأمير سلطان، حي السويدي',
    phone: '+966114820003', latitude: 24.6100, longitude: 46.6700,
    delivery_fee: 12, min_delivery_order: 60, is_active: false,
    delivery_enabled: true, pickup_enabled: true, delivery_temporarily_closed: false,
    estimated_delivery_minutes: 45,
  },
];

const CATEGORIES: DbCategory[] = [
  { id: 'c-burgers', name_en: 'Burgers', name_ar: 'برجر', sort_order: 1, is_active: true },
  { id: 'c-chicken', name_en: 'Chicken', name_ar: 'دجاج', sort_order: 2, is_active: true },
  { id: 'c-sides', name_en: 'Sides', name_ar: 'مقبلات', sort_order: 3, is_active: true },
  { id: 'c-drinks', name_en: 'Drinks', name_ar: 'مشروبات', sort_order: 4, is_active: true },
];

const PRODUCTS: DbProduct[] = [
  {
    id: 'p-classic', category_id: 'c-burgers',
    name_en: 'Classic Burger', name_ar: 'برجر كلاسيكي',
    description_en: 'Grilled Angus beef with cheddar and fresh vegetables.',
    description_ar: 'لحم أنغوس مشوي مع جبن شيدر وخضروات طازجة',
    price: 35, calories: 480, image_url: dish('#b06a3a', '#7a4321'),
    is_active: true, sort_order: 1,
  },
  {
    id: 'p-spicy', category_id: 'c-burgers',
    name_en: 'Spicy Burger', name_ar: 'برجر سبايسي',
    description_en: 'Beef with our house hot sauce and crispy jalapeño.',
    description_ar: 'لحم مع صوص حار خاص وهالبينو مقرمش',
    price: 40, calories: 520, image_url: dish('#c0392b', '#7d1f16'),
    is_active: true, sort_order: 2,
  },
  {
    id: 'p-crispy', category_id: 'c-chicken',
    name_en: 'Crispy Chicken', name_ar: 'دجاج مقرمش',
    description_en: 'Crispy chicken pieces with honey mustard sauce.',
    description_ar: 'قطع دجاج مقرمشة مع صوص العسل والمسترد',
    price: 30, calories: 380, image_url: dish('#c89430', '#8a5f14'),
    is_active: true, sort_order: 3,
  },
  {
    id: 'p-fries', category_id: 'c-sides',
    name_en: 'Golden Fries', name_ar: 'بطاطس ذهبية',
    description_en: 'Hand-cut and lightly salted.',
    description_ar: 'مقطعة يدوياً ومملحة قليلاً',
    price: 12, calories: 320, image_url: dish('#e0b840', '#b3872a'),
    is_active: true, sort_order: 4,
  },
  {
    id: 'p-lemon', category_id: 'c-drinks',
    name_en: 'Lemon Mint', name_ar: 'ليمون بالنعناع',
    description_en: 'Fresh, blended, no added sugar.',
    description_ar: 'طازج ومخفوق بدون سكر مضاف',
    price: 14, calories: 140, image_url: dish('#8ec46a', '#4e8c3c'),
    is_active: true, sort_order: 5,
  },
];

const MODIFIER_GROUPS: DbModifierGroup[] = [
  { id: 'g-size', name_en: 'Size', name_ar: 'الحجم', min_select: 1, max_select: 1, is_required: true },
  { id: 'g-extras', name_en: 'Extras', name_ar: 'إضافات', min_select: 0, max_select: 3, is_required: false },
];

const MODIFIERS: DbModifier[] = [
  { id: 'm-single', group_id: 'g-size', name_en: 'Single', name_ar: 'مفرد', price: 0, sort_order: 1, is_active: true },
  { id: 'm-double', group_id: 'g-size', name_en: 'Double', name_ar: 'مزدوج', price: 12, sort_order: 2, is_active: true },
  { id: 'm-cheese', group_id: 'g-extras', name_en: 'Extra cheese', name_ar: 'جبن إضافي', price: 4, sort_order: 1, is_active: true },
  { id: 'm-jalapeno', group_id: 'g-extras', name_en: 'Jalapeño', name_ar: 'هالبينو', price: 3, sort_order: 2, is_active: true },
  { id: 'm-bacon', group_id: 'g-extras', name_en: 'Smoked beef', name_ar: 'لحم مدخن', price: 8, sort_order: 3, is_active: true },
];

const LINKS: DbProductModifierGroup[] = [
  { product_id: 'p-classic', group_id: 'g-size', sort_order: 1 },
  { product_id: 'p-classic', group_id: 'g-extras', sort_order: 2 },
  { product_id: 'p-spicy', group_id: 'g-size', sort_order: 1 },
  { product_id: 'p-spicy', group_id: 'g-extras', sort_order: 2 },
];

/** Everything available everywhere except the drink at the closed branch. */
const AVAILABILITY: DbBranchAvailability[] = BRANCHES.flatMap((b) =>
  PRODUCTS.map((p) => ({
    branch_id: b.id, product_id: p.id,
    is_available: !(b.id === 'b-suwaidi' && p.id === 'p-lemon'),
  })),
);

const SETTINGS: DbAppSettings = {
  id: true, brand_name_en: 'Spicy Meal', brand_name_ar: 'سبايسي ميل',
  primary_color: '#422e87', secondary_color: '#e02d3d', currency: 'SAR',
  vat_percentage: 15, loyalty_enabled: true,
  points_per_riyal: 1, discount_per_point: 0.05, min_points_to_redeem: 100,
  online_payment_enabled: true, cash_payment_enabled: true,
  default_payment_method: 'cash', payment_outage_mode_enabled: false,
  support_phone: '+966114821234', support_whatsapp: '+966501234567',
  support_email: 'help@spicymeal.sa',
  support_hours_en: 'Daily 10:00–02:00', support_hours_ar: 'يومياً ١٠:٠٠ – ٠٢:٠٠',
  support_desc_en: 'We reply within a few minutes.', support_desc_ar: 'نرد خلال دقائق.',
  support_phone_enabled: true, support_whatsapp_enabled: true, support_email_enabled: true,
};

/** A square around each branch, large enough that the demo address falls inside. */
const ZONES: DbBranchDeliveryZone[] = BRANCHES.map((b) => ({
  id: `z-${b.id}`, branch_id: b.id, name: null, is_active: true,
  zone_geojson: {
    type: 'Polygon',
    coordinates: [[
      [(b.longitude ?? 0) - 0.1, (b.latitude ?? 0) - 0.1],
      [(b.longitude ?? 0) + 0.1, (b.latitude ?? 0) - 0.1],
      [(b.longitude ?? 0) + 0.1, (b.latitude ?? 0) + 0.1],
      [(b.longitude ?? 0) - 0.1, (b.latitude ?? 0) + 0.1],
      [(b.longitude ?? 0) - 0.1, (b.latitude ?? 0) - 0.1],
    ]],
  },
}));

const BANNERS: DbHomepageBanner[] = [
  {
    id: 'ban-1', title_en: 'Summer Combo', title_ar: 'عرض الصيف',
    image_url: banner('#e02d3d', '#422e87'), is_active: true, sort_order: 0,
    starts_at: null, ends_at: null, action_type: 'category', action_value: 'c-burgers',
    created_at: NOW,
  },
  {
    id: 'ban-2', title_en: 'Crispy Chicken launch', title_ar: 'إطلاق الدجاج المقرمش',
    image_url: banner('#422e87', '#6d4fd0'), is_active: true, sort_order: 1,
    starts_at: null, ends_at: null, action_type: 'product', action_value: 'p-crispy',
    created_at: NOW,
  },
];

const PROFILE: DbProfile = {
  id: CUSTOMER_ID, full_name: 'Mohammed Al-Ali', phone_number: '+966501234567',
  email: null, role: 'customer', loyalty_points: 240,
  phone_verified: true, phone_verified_at: NOW,
};

const ADDRESSES: DbAddress[] = [
  {
    id: 'a-home', customer_id: CUSTOMER_ID, label: 'Home',
    description: 'Al Salam grocery, next to the mosque',
    national_short_address: 'RRRA2929', latitude: 24.6950, longitude: 46.6860, is_default: true,
  },
  {
    id: 'a-work', customer_id: CUSTOMER_ID, label: 'Work',
    description: 'Tower B, 4th floor reception',
    national_short_address: null, latitude: 24.7100, longitude: 46.6750, is_default: false,
  },
];

const line = (id: string, en: string, ar: string, price: number, qty: number) => ({
  id, name_en: en, name_ar: ar, unit_price: price, quantity: qty, order_item_modifiers: [],
});

const ORDERS: DbCustomerOrderWithItems[] = [
  {
    id: 'o-1', status: 'preparing', order_type: 'delivery', created_at: '2026-07-29T17:40:00Z',
    branch_id: 'b-olaya', branch_name_en: 'Olaya', branch_name_ar: 'فرع العليا',
    subtotal: 75, delivery_fee: 0, discount_amount: 0, loyalty_discount_amount: 0,
    vat_amount: 9.78, total: 75, loyalty_points_earned: 75,
    payment_status: 'paid', payment_method: 'online',
    lazywait_order_number: '5', lazywait_sync_state: 'synced', lazywait_ref: 'LW-5',
    order_items: [line('i-1', 'Classic Burger', 'برجر كلاسيكي', 35, 1),
                  line('i-2', 'Spicy Burger', 'برجر سبايسي', 40, 1)],
  },
  {
    id: 'o-2', status: 'delivered', order_type: 'pickup', created_at: '2026-07-27T13:05:00Z',
    branch_id: 'b-nakheel', branch_name_en: 'Al Nakheel', branch_name_ar: 'فرع النخيل',
    subtotal: 42, delivery_fee: 0, discount_amount: 0, loyalty_discount_amount: 0,
    vat_amount: 5.48, total: 42, loyalty_points_earned: 42,
    payment_status: 'paid', payment_method: 'cash',
    lazywait_order_number: '18', lazywait_sync_state: 'synced', lazywait_ref: 'LW-18',
    order_items: [line('i-3', 'Crispy Chicken', 'دجاج مقرمش', 30, 1),
                  line('i-4', 'Golden Fries', 'بطاطس ذهبية', 12, 1)],
  },
  {
    id: 'o-3', status: 'cancelled', order_type: 'delivery', created_at: '2026-07-21T20:15:00Z',
    branch_id: 'b-malqa', branch_name_en: 'Al Malqa', branch_name_ar: 'فرع الملقا',
    subtotal: 30, delivery_fee: 8, discount_amount: 0, loyalty_discount_amount: 0,
    vat_amount: 4.96, total: 38, loyalty_points_earned: 0,
    payment_status: 'pending', payment_method: 'cash',
    lazywait_sync_state: 'skipped', sync_blocked_reason: 'branch has no POS channel',
    order_items: [line('i-5', 'Crispy Chicken', 'دجاج مقرمش', 30, 1)],
  },
];

const legalDoc = (
  type: string, en: string, ar: string, contentEn: string, contentAr: string, version: string,
): DbLegalDocument => ({
  id: `l-${type}`, document_type: type, title_en: en, title_ar: ar,
  content_en: contentEn, content_ar: contentAr, version,
  effective_date: '2026-01-01', is_active: true,
});

const LEGAL: DbLegalDocument[] = [
  legalDoc('terms', 'Terms & Conditions', 'الشروط والأحكام',
    'By placing an order on Spicy Meal you agree to these terms, which are governed by the e-commerce regulations of the Kingdom of Saudi Arabia.\n\nOrders are prepared by the branch you select at checkout. Prices are shown in Saudi Riyals and include 15% VAT.',
    'بتقديم طلب عبر تطبيق سبايسي ميل فإنك توافق على هذه الشروط، الخاضعة لأنظمة التجارة الإلكترونية في المملكة العربية السعودية.\n\nتُحضَّر الطلبات في الفرع الذي تختاره عند إتمام الطلب. الأسعار بالريال السعودي وشاملة ضريبة القيمة المضافة ١٥٪.',
    '2.1'),
  legalDoc('privacy', 'Privacy Policy', 'سياسة الخصوصية',
    'This policy describes what Spicy Meal collects, why, and how long it is kept. Your phone number is used for order verification and delivery contact only.',
    'توضح هذه السياسة ما تجمعه سبايسي ميل ولماذا ومدة الاحتفاظ به. يُستخدم رقم هاتفك للتحقق من الطلب والتواصل عند التوصيل فقط.',
    '2.0'),
  legalDoc('refund', 'Refund Policy', 'سياسة الاسترجاع',
    'Refunds are issued to the original payment method. Card refunds settle with the issuing bank and may take up to 14 working days.',
    'تُعاد المبالغ إلى وسيلة الدفع الأصلية. تتم تسوية المبالغ المعادة على البطاقات مع البنك المُصدِر وقد تستغرق حتى ١٤ يوم عمل.',
    '1.4'),
  legalDoc('delivery', 'Delivery Policy', 'سياسة التوصيل',
    'Delivery is available inside each branch delivery area. The fee and minimum order are set per branch and shown before you confirm.',
    'التوصيل متاح داخل نطاق توصيل كل فرع. تُحدَّد الرسوم والحد الأدنى للطلب لكل فرع وتُعرض قبل تأكيد الطلب.',
    '1.2'),
];

// ---------------------------------------------------------------------------
// The module contract. Same names and shapes as src/services/api.
// ---------------------------------------------------------------------------

export const auth = {
  getSession: async () => ({ user: { id: CUSTOMER_ID } }),
  onChange: (cb: (userId: string | null) => void) => {
    cb(CUSTOMER_ID);
    return { data: { subscription: { unsubscribe: () => {} } } };
  },
  signInWithPhone: async (_phone: string) => {},
  verifyPhone: async (_phone: string, _token: string) => ({ user: { id: CUSTOMER_ID } }),
  signOut: async () => {},
  myProfile: async (): Promise<DbProfile | null> => PROFILE,
  whatsappLoginAvailability: async () => 'enabled' as const,
};

export const catalog = {
  branches: async () => BRANCHES,
  categories: async () => CATEGORIES,
  banners: async () => BANNERS,
  products: async () => PRODUCTS,
  modifierGroups: async () => MODIFIER_GROUPS,
  modifiers: async () => MODIFIERS,
  productModifierGroups: async () => LINKS,
  availability: async () => AVAILABILITY,
  settings: async () => SETTINGS,
  deliveryZones: async () => ZONES,
  all: async () => ({
    branches: BRANCHES, categories: CATEGORIES, products: PRODUCTS,
    modifierGroups: MODIFIER_GROUPS, modifiers: MODIFIERS, links: LINKS,
    availability: AVAILABILITY, settings: SETTINGS, deliveryZones: ZONES,
  }),
};

export const legal = {
  list: async () => LEGAL,
  byType: async (type: string) => LEGAL.find((d) => d.document_type === type) ?? null,
};

export const orders = {
  listWithItems: async () => ORDERS,
  byId: async (id: string) => ORDERS.find((o) => o.id === id) ?? null,
  placeAndSync: async () => ORDERS[0],
  requestResend: async () => ({ status: 'queued' as const }),
};

export const checkout = {
  create: async () => ({ id: 'sess-preview', status: 'open' }),
  byId: async () => null,
};

export const payments = {
  initiate: async () => ({ status: 'unavailable' as const }),
  verify: async () => ({ status: 'unpaid' as const }),
};

export const coupons = {
  validate: async () => ({ valid: false, discount: 0 }),
};

export const addresses = {
  listMine: async () => ADDRESSES,
  create: async (input: Record<string, unknown>) => ({ ...ADDRESSES[0], ...input, id: 'a-new' }),
  update: async (id: string, patch: Record<string, unknown>) => ({ ...ADDRESSES[0], ...patch, id }),
  remove: async (_id: string) => {},
};

export const whatsappOtp = {
  send: async () => ({ status: 'sent' as const }),
  verify: async () => ({ status: 'verified' as const }),
};

export const pushDevices = {
  mine: async () => [],
  register: async () => {},
  update: async () => {},
  deactivate: async () => {},
};

export const accountDeletion = {
  current: async () => null,
  sendOtp: async () => ({ status: 'sent' as const, reauthAvailable: false }),
  submit: async () => ({ status: 'queued' as const }),
};
