/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Branch, Category, Product, ModifierGroup, Banner, UserProfile, SavedAddress, Order, BrandSettings, LazywaitSettings, PaymentSettings, SmsSettings, NotificationSettings, LoyaltySettings } from '../types';

export const INITIAL_BRANCHES: Branch[] = [
  {
    id: 'b-riyadh-olaya',
    nameEn: 'Olaya District, Riyadh',
    nameAr: 'حي العليا، الرياض',
    addressEn: 'Olaya Street, Near Kingdom Tower, Riyadh',
    addressAr: 'شارع العليا، بالقرب من برج المملكة، الرياض',
    phone: '+966 11 482 1234',
    latitude: 24.7136,
    longitude: 46.6753,
    isActive: true,
    deliveryFee: 15.00,
    minDeliveryOrder: 30.00,
  },
  {
    id: 'b-jeddah-corniche',
    nameEn: 'Corniche, Jeddah',
    nameAr: 'كورنيش جدة',
    addressEn: 'Al-Hamra District, Corniche Road, Jeddah',
    addressAr: 'حي الحمراء، طريق الكورنيش، جدة',
    phone: '+966 12 665 4321',
    latitude: 21.5169,
    longitude: 39.1558,
    isActive: true,
    deliveryFee: 12.00,
    minDeliveryOrder: 25.00,
  },
  {
    id: 'b-dammam-khobar',
    nameEn: 'Al-Hizam Al-Thahabi, Khobar',
    nameAr: 'الحزام الذهبي، الخبر',
    addressEn: 'Prince Faisal Bin Fahd Road, Khobar',
    addressAr: 'طريق الأمير فيصل بن فهد، الخبر',
    phone: '+966 13 894 5678',
    latitude: 26.2974,
    longitude: 50.2033,
    isActive: true,
    deliveryFee: 18.00,
    minDeliveryOrder: 40.00,
  },
  {
    id: 'b-riyadh-yasmin',
    nameEn: 'Al-Yasmin District, Riyadh (Closed for Maintenance)',
    nameAr: 'حي الياسمين، الرياض (مغلق للصيانة)',
    addressEn: 'Anas Bin Malik Road, Riyadh',
    addressAr: 'طريق أنس بن مالك، الرياض',
    phone: '+966 11 205 9900',
    latitude: 24.8190,
    longitude: 46.6430,
    isActive: false, // Closed branch
    deliveryFee: 15.00,
    minDeliveryOrder: 30.00,
  }
];

export const INITIAL_CATEGORIES: Category[] = [
  {
    id: 'cat-burgers',
    nameEn: 'Spicy Burgers',
    nameAr: 'برجرات حارة',
    sortOrder: 1,
  },
  {
    id: 'cat-sides',
    nameEn: 'Sides & Bites',
    nameAr: 'المقبلات والجانبية',
    sortOrder: 2,
  },
  {
    id: 'cat-drinks',
    nameEn: 'Cold Drinks',
    nameAr: 'المشروبات الباردة',
    sortOrder: 3,
  },
  {
    id: 'cat-desserts',
    nameEn: 'Sweet Treats',
    nameAr: 'الحلويات',
    sortOrder: 4,
  }
];

export const INITIAL_MODIFIER_GROUPS: ModifierGroup[] = [
  {
    id: 'mg-drink-choice',
    nameEn: 'Choose Your Drink',
    nameAr: 'اختر المشروب',
    minSelection: 1,
    maxSelection: 1,
    isRequired: true,
    modifiers: [
      { id: 'm-cola', groupId: 'mg-drink-choice', nameEn: 'Spicy Cola', nameAr: 'سبايسي كولا', price: 0 },
      { id: 'm-cola-diet', groupId: 'mg-drink-choice', nameEn: 'Spicy Cola Diet', nameAr: 'سبايسي كولا دايت', price: 0 },
      { id: 'm-orange', groupId: 'mg-drink-choice', nameEn: 'Mirinda Orange', nameAr: 'ميرندا برتقال', price: 0 },
      { id: 'm-citrus', groupId: 'mg-drink-choice', nameEn: 'Mountain Dew Citrus', nameAr: 'ماونتن ديو حمضيات', price: 0 },
      { id: 'm-water', groupId: 'mg-drink-choice', nameEn: 'Arwa Mineral Water', nameAr: 'مياه أروى المعدنية', price: -2.00 }, // Deduct price
    ]
  },
  {
    id: 'mg-cheese',
    nameEn: 'Extra Cheese Options',
    nameAr: 'إضافات الجبنة',
    minSelection: 0,
    maxSelection: 2,
    isRequired: false,
    modifiers: [
      { id: 'm-cheddar', groupId: 'mg-cheese', nameEn: 'Sliced Cheddar Cheese', nameAr: 'شريحة جبن تشيدر', price: 3.00 },
      { id: 'm-swiss', groupId: 'mg-cheese', nameEn: 'Melted Swiss Cheese', nameAr: 'جبنة سويسرية ذائبة', price: 4.00 },
      { id: 'm-mozzarella', groupId: 'mg-cheese', nameEn: 'Crispy Mozzarella Patty', nameAr: 'قرص موزاريلا مقرمش', price: 8.00 }
    ]
  },
  {
    id: 'mg-heat-level',
    nameEn: 'Choose Your Spice Level',
    nameAr: 'درجة الحرارة (السبايسي)',
    minSelection: 1,
    maxSelection: 1,
    isRequired: true,
    modifiers: [
      { id: 'm-mild', groupId: 'mg-heat-level', nameEn: 'Mild (Warm Kick)', nameAr: 'خفيف (حرارة هادئة)', price: 0 },
      { id: 'm-spicy', groupId: 'mg-heat-level', nameEn: 'Spicy (Brand Signature)', nameAr: 'سبايسي (التوقيع الخاص)', price: 0 },
      { id: 'm-volcano', groupId: 'mg-heat-level', nameEn: 'Volcano Blowout (+2 SAR)', nameAr: 'البركان الحارق (+٢ ر.س)', price: 2.00 }
    ]
  },
  {
    id: 'mg-burger-adds',
    nameEn: 'Add Toppings',
    nameAr: 'إضافات علوية',
    minSelection: 0,
    maxSelection: 4,
    isRequired: false,
    modifiers: [
      { id: 'm-jalapenos', groupId: 'mg-burger-adds', nameEn: 'Spicy Jalapeño Slices', nameAr: 'شرائح هلابينو حار', price: 2.00 },
      { id: 'm-onion-crisp', groupId: 'mg-burger-adds', nameEn: 'Crispy Caramelized Onions', nameAr: 'بصل مكرمل مقرمش', price: 3.00 },
      { id: 'm-beef-bacon', groupId: 'mg-burger-adds', nameEn: 'Halal Beef Bacon Slices', nameAr: 'شرائح بيكن بقري حلال', price: 6.00 },
      { id: 'm-spicy-sauce', groupId: 'mg-burger-adds', nameEn: 'Extra Volcano Dip Sauce', nameAr: 'صلصة بركانية إضافية', price: 1.50 }
    ]
  }
];

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-spicy-double',
    categoryId: 'cat-burgers',
    nameEn: 'Spicy Double Beef Burger',
    nameAr: 'سبايسي دبل لحم بقري',
    descriptionEn: 'Two premium halal Angus beef patties with spicy cheese, fresh jalapeños, and our signature Volcano spicy sauce on a toasted brioche bun.',
    descriptionAr: 'شريحتان من لحم الأنجوس البقري الحلال الفاخر مع الجبن الحار، الهلابينو الطازج، وصلصة البركان الحارة الخاصة بنا في خبز البريوش المحمص.',
    price: 34.00, // VAT inclusive (includes 15% VAT)
    imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&h=400&q=80',
    calories: 820,
    isActive: true,
    modifierGroupIds: ['mg-heat-level', 'mg-cheese', 'mg-burger-adds']
  },
  {
    id: 'prod-volcano-chicken',
    categoryId: 'cat-burgers',
    nameEn: 'Crispy Volcano Chicken',
    nameAr: 'فولكانو دجاج مقرمش',
    descriptionEn: 'Super crispy hand-breaded chicken breast dipped in our special spicy glaze, shredded lettuce, pickles, and fiery garlic mayo.',
    descriptionAr: 'صدر دجاج مقرمش ومغطى بخلطتنا يدوياً ومغمس في تتبيلتنا الحارة الخاصة، خس مبشور، مخلل، ومايونيز الثوم الحار الفائق.',
    price: 29.00,
    imageUrl: 'https://images.unsplash.com/photo-1627662236973-4f8259149f71?auto=format&fit=crop&w=600&h=400&q=80',
    calories: 710,
    isActive: true,
    modifierGroupIds: ['mg-heat-level', 'mg-cheese']
  },
  {
    id: 'prod-smoke-spicy',
    categoryId: 'cat-burgers',
    nameEn: 'Smokey Spicy Angus',
    nameAr: 'سموكي سبايسي أنجوس',
    descriptionEn: 'Juicy Angus beef patty, hickory smoked halal bacon, crispy onion rings, cheddar cheese, and a smokey chipotle spicy sauce.',
    descriptionAr: 'شريحة لحم أنجوس بقري عصارية، بيكن بقري حلال مدخن بالهيكوري، حلقات بصل مقرمشة، جبنة شيدر، وصلصة الشيبوتلي المدخنة الحارة.',
    price: 38.00,
    imageUrl: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=600&h=400&q=80',
    calories: 940,
    isActive: true,
    modifierGroupIds: ['mg-heat-level', 'mg-cheese', 'mg-burger-adds']
  },
  {
    id: 'prod-spicy-fries',
    categoryId: 'cat-sides',
    nameEn: 'Spicy Criss-Cut Fries',
    nameAr: 'بطاطس كريس-كت متبلة',
    descriptionEn: 'Crispy criss-cut waffle fries dusted with our signature spicy Cajun herb shake. Served with spicy cheese dip.',
    descriptionAr: 'بطاطس وافل كريس-كت مقرمشة مرشوشة ببهارات الكاجون والأعشاب الحارة المميزة. تقدم مع غمس الجبن الحار.',
    price: 14.00,
    imageUrl: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=600&h=400&q=80',
    calories: 380,
    isActive: true,
    modifierGroupIds: ['mg-burger-adds']
  },
  {
    id: 'prod-volcano-bites',
    categoryId: 'cat-sides',
    nameEn: 'Volcano Cheese Bites (6pcs)',
    nameAr: 'لقيمات الجبنة البركانية (٦ قطع)',
    descriptionEn: 'Golden melted cheese bites stuffed with chopped green jalapeños and red chilies, breaded and fried to absolute perfection.',
    descriptionAr: 'قطع جبنة ذائبة ذهبية محشوة بقطع الهلابينو الأخضر والفلفل الأحمر الحار، مغطاة بالبقسماط ومقلية بشكل مثالي.',
    price: 16.00,
    imageUrl: 'https://images.unsplash.com/photo-1639024471283-2bc7b3c6a267?auto=format&fit=crop&w=600&h=400&q=80',
    calories: 420,
    isActive: true,
    modifierGroupIds: []
  },
  {
    id: 'prod-spicy-cola',
    categoryId: 'cat-drinks',
    nameEn: 'Spicy Signature Cola',
    nameAr: 'سبايسي كولا المميز',
    descriptionEn: 'Our special blend of standard classic cola infused with subtle hints of sweet cinnamon and spice, served ice cold with lemon.',
    descriptionAr: 'مزيجنا الخاص من الكولا الكلاسيكية الغنية بنفحات خفيفة من القرفة الحلوة والبهارات، تقدم باردة ومثلجة مع الليمون.',
    price: 8.00,
    imageUrl: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=600&h=400&q=80',
    calories: 140,
    isActive: true,
    modifierGroupIds: []
  },
  {
    id: 'prod-strawberry-shake',
    categoryId: 'cat-drinks',
    nameEn: 'Spiced Strawberry Shake',
    nameAr: 'ميلك شيك فراولة مبهرة',
    descriptionEn: 'Creamy premium strawberry milkshake blended with fresh strawberries and a tiny touch of spicy vanilla extracts.',
    descriptionAr: 'ميلك شيك الفراولة الفاخر الغني الممزوج بالفراولة الطازجة ولمسة صغيرة من مستخلصات الفانيليا الدافئة.',
    price: 15.00,
    imageUrl: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=600&h=400&q=80',
    calories: 450,
    isActive: true,
    modifierGroupIds: []
  },
  {
    id: 'prod-apple-pie',
    categoryId: 'cat-desserts',
    nameEn: 'Hot Spicy Apple Pie',
    nameAr: 'فطيرة تفاح حارة وساخنة',
    descriptionEn: 'Deep-fried golden pastry crust oozing with warm spiced sweet apples, cinnamon sauce, and a hint of sweet ginger.',
    descriptionAr: 'عجينة ذهبية مقلية ومقرمشة محشوة بالتفاح الحلو المتبل الدافئ، صلصة القرفة، ولمسة من الزنجبيل الحلو.',
    price: 12.00,
    imageUrl: 'https://images.unsplash.com/photo-1519869325930-281384150729?auto=format&fit=crop&w=600&h=400&q=80',
    calories: 320,
    isActive: true,
    modifierGroupIds: []
  }
];

export const INITIAL_BANNERS: Banner[] = [
  {
    id: 'ban-1',
    titleEn: 'Double The Heat, Double The Flavor!',
    titleAr: 'ضعف الحرارة، ضعف النكهة الرائعة!',
    imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1200&h=500&q=80',
    productId: 'prod-spicy-double'
  },
  {
    id: 'ban-2',
    titleEn: 'Halal Bacon Smokey Angus Launch',
    titleAr: 'إطلاق برجر سموكي أنجوس البقري المدخن!',
    imageUrl: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=1200&h=500&q=80',
    productId: 'prod-smoke-spicy'
  },
  {
    id: 'ban-3',
    titleEn: 'Spiced Strawberry Milkshakes',
    titleAr: 'جديد: ميلك شيك فراولة بنكهة دافئة مميزة',
    imageUrl: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=1200&h=500&q=80',
    productId: 'prod-strawberry-shake'
  }
];

export const INITIAL_PROFILES: UserProfile[] = [
  {
    id: 'usr-customer-1',
    fullName: 'Mohammed Ali',
    phoneNumber: '+966 55 123 4567',
    role: 'customer',
    email: 'mohammed.ali@1sttaste.com',
    createdAt: '2026-01-10T14:30:00Z'
  },
  {
    id: 'usr-admin-1',
    fullName: 'Yousef Al-Harbi',
    phoneNumber: '+966 50 987 6543',
    role: 'admin',
    email: 'admin@spicymeal.com.sa',
    createdAt: '2025-12-01T08:00:00Z'
  },
  {
    id: 'usr-accountant-1',
    fullName: 'Amr El-Gindy',
    phoneNumber: '+966 53 456 7890',
    role: 'accountant',
    email: 'finance@spicymeal.com.sa',
    createdAt: '2026-02-15T09:00:00Z'
  }
];

export const INITIAL_ADDRESSES: SavedAddress[] = [
  {
    id: 'adr-1',
    label: 'Home (المنزل)',
    description: 'Olaya District, Prince Muhammad Bin Abdulaziz Rd, Riyadh',
    nationalShortAddress: 'RRBB4321',
    lat: 24.7082,
    lng: 46.6641,
    isDefault: true
  },
  {
    id: 'adr-2',
    label: 'Head Office (المكتب)',
    description: 'Digital City, Building MU04, Riyadh',
    nationalShortAddress: 'DCBD8899',
    lat: 24.7291,
    lng: 46.6268,
    isDefault: false
  }
];

export const INITIAL_ORDERS: Order[] = [
  {
    id: 'ord-1001',
    orderNumber: 'SM-2026-000412',
    customerId: 'usr-customer-1',
    customerName: 'Mohammed Ali',
    customerPhone: '+966 55 123 4567',
    branchId: 'b-riyadh-olaya',
    branchNameEn: 'Olaya District, Riyadh',
    branchNameAr: 'حي العليا، الرياض',
    status: 'delivered',
    orderType: 'delivery',
    subtotal: 48.00,
    deliveryFee: 15.00,
    total: 63.00,
    paymentStatus: 'paid',
    orderSyncStatus: 'synced',
    createdAt: '2026-07-05T20:15:00-07:00',
    address: INITIAL_ADDRESSES[0],
    items: [
      {
        id: 'oi-1',
        productId: 'prod-spicy-double',
        nameEn: 'Spicy Double Beef Burger',
        nameAr: 'سبايسي دبل لحم بقري',
        price: 34.00,
        quantity: 1,
        selectedModifiers: [
          { id: 'm-spicy', modifierId: 'm-spicy', nameEn: 'Spicy (Brand Signature)', nameAr: 'سبايسي (التوقيع الخاص)', price: 0 }
        ]
      },
      {
        id: 'oi-2',
        productId: 'prod-spicy-fries',
        nameEn: 'Spicy Criss-Cut Fries',
        nameAr: 'بطاطس كريس-كت متبلة',
        price: 14.00,
        quantity: 1,
        selectedModifiers: []
      }
    ]
  },
  {
    id: 'ord-1002',
    orderNumber: 'SM-2026-000413',
    customerId: 'usr-customer-1',
    customerName: 'Mohammed Ali',
    customerPhone: '+966 55 123 4567',
    branchId: 'b-riyadh-olaya',
    branchNameEn: 'Olaya District, Riyadh',
    branchNameAr: 'حي العليا، الرياض',
    status: 'preparing',
    orderType: 'pickup',
    subtotal: 44.00,
    deliveryFee: 0.00,
    total: 44.00,
    paymentStatus: 'paid',
    orderSyncStatus: 'pending_sync',
    createdAt: '2026-07-06T02:45:00-07:00',
    items: [
      {
        id: 'oi-3',
        productId: 'prod-volcano-chicken',
        nameEn: 'Crispy Volcano Chicken',
        nameAr: 'فولكانو دجاج مقرمش',
        price: 29.00,
        quantity: 1,
        selectedModifiers: [
          { id: 'm-volcano', modifierId: 'm-volcano', nameEn: 'Volcano Blowout (+2 SAR)', nameAr: 'البركان الحارق (+٢ ر.س)', price: 2.00 }
        ]
      },
      {
        id: 'oi-4',
        productId: 'prod-strawberry-shake',
        nameEn: 'Spiced Strawberry Shake',
        nameAr: 'ميلك شيك فراولة مبهرة',
        price: 15.00,
        quantity: 1,
        selectedModifiers: []
      }
    ]
  },
  {
    id: 'ord-1003',
    orderNumber: 'SM-2026-000414',
    customerId: 'usr-customer-jeddah',
    customerName: 'Aisha Al-Otaibi',
    customerPhone: '+966 54 888 2211',
    branchId: 'b-jeddah-corniche',
    branchNameEn: 'Corniche, Jeddah',
    branchNameAr: 'كورنيش جدة',
    status: 'received',
    orderType: 'delivery',
    subtotal: 38.00,
    deliveryFee: 12.00,
    total: 50.00,
    paymentStatus: 'pending',
    orderSyncStatus: 'not_synced',
    createdAt: '2026-07-06T03:10:00-07:00',
    address: {
      id: 'adr-mock-3',
      label: 'Apartment 4 (الشقة)',
      description: 'Corniche Road, Al-Hamra District, Jeddah',
      nationalShortAddress: 'JDDA1122',
      lat: 21.5160,
      lng: 39.1550,
      isDefault: true
    },
    items: [
      {
        id: 'oi-5',
        productId: 'prod-smoke-spicy',
        nameEn: 'Smokey Spicy Angus',
        nameAr: 'سموكي سبايسي أنجوس',
        price: 38.00,
        quantity: 1,
        selectedModifiers: [
          { id: 'm-spicy', modifierId: 'm-spicy', nameEn: 'Spicy', nameAr: 'سبايسي', price: 0 }
        ]
      }
    ]
  }
];

export const INITIAL_BRAND_SETTINGS: BrandSettings = {
  logoUrl: '/logo.png',
  primaryColor: '#422e87',
  secondaryColor: '#e02d3d',
  vatPercentage: 15,
  vatIncluded: true,
  supportPhone: '+966 11 482 1234',
  whatsappNumber: '+966 50 123 4567',
  instagram: 'spicymeal_sa',
  twitter: 'spicymeal_sa',
  privacyPolicyEn: 'This Privacy Policy describes how Spicy Meal collects, uses, and shares your personal information when you use our mobile and web applications in Saudi Arabia.',
  privacyPolicyAr: 'توضح سياسة الخصوصية هذه كيفية قيام سبايسي ميل بجمع معلوماتك الشخصية واستخدامها ومشاركتها عند استخدام تطبيقات الهاتف المحمول والويب الخاصة بنا في المملكة العربية السعودية.',
  termsEn: 'By placing an order on our platform, you agree to comply with and be bound by the Terms & Conditions of Spicy Meal, subject to the regulations of Saudi Arabian E-Commerce.',
  termsAr: 'بتقديم طلب عبر منصتنا، فإنك توافق على الالتزام بشروط وأحكام سبايسي ميل، الخاضعة لأنظمة التجارة الإلكترونية المعمول بها في المملكة العربية السعودية.'
};

export const INITIAL_LAZYWAIT_SETTINGS: LazywaitSettings = {
  baseUrl: 'https://api.lazywait.com/v1',
  apiKey: 'lw_sk_9a8b7c6d5e4f3g2h1i',
  clientId: 'client_spicymeal_riyadh',
  isEnabled: true,
  isMenuSyncEnabled: true,
  isStockSyncEnabled: true,
  isOrderSyncEnabled: true
};

export const INITIAL_PAYMENT_SETTINGS: PaymentSettings = {
  providerName: 'moyasar',
  isLiveMode: false,
  publicKey: 'pk_test_a1b2c3d4e5f6g7h8i9j0',
  secretKey: 'sk_test_z9y8x7w6v5u4t3s2r1q0',
  isEnabled: true
};

export const INITIAL_SMS_SETTINGS: SmsSettings = {
  providerName: 'unifonic',
  apiKey: 'unifonic_test_key_552199',
  senderId: 'SPICYMEAL',
  isEnabled: true
};

export const INITIAL_NOTIFICATION_SETTINGS: NotificationSettings = {
  providerName: 'onesignal',
  apiKey: 'os_app_id_99228833-abcd-1234',
  // Push is the primary customer-messaging channel (free, in-app), so it is on
  // by default; SMS is only a fallback for when push is disabled.
  isEnabled: true
};

export const INITIAL_LOYALTY_SETTINGS: LoyaltySettings = {
  isEnabled: true,
  pointsPerRiyal: 1,
  minPointsToRedeem: 100,
  discountPerPoint: 0.10 // 100 points = 10 SAR
};

