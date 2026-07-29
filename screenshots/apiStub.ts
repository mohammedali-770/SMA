/**
 * Screenshot-only stand-in for src/lib/api.
 *
 * Two panels — Banners and Legal Documents — read straight from Supabase rather
 * than through AppContext, so with no session they sat on "Loading…" forever and
 * could not be reviewed at all. This re-exports the real module unchanged and
 * overrides only those two read paths with demo rows, so the REAL components
 * render with the REAL stylesheet and only the data is synthetic.
 *
 * Wired in by vite.screenshots.config.ts. Nothing here ships: the alias exists
 * only in that config.
 */
export * from '../src/lib/api';

import type { DbHomepageBanner, DbLegalDocument } from '../src/lib/api';

const STAMP = '2026-07-20T09:00:00Z';

/**
 * A 1200x450 banner as an inline SVG data URI — no network fetch, no binary in
 * the repo, and it renders at the real aspect ratio so the card layout is
 * honest about how much room a banner takes.
 */
const placeholder = (from: string, to: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="450">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      `</linearGradient></defs>` +
      `<rect width="1200" height="450" fill="url(#g)"/>` +
      `<text x="60" y="250" font-family="Inter,sans-serif" font-size="64" font-weight="800" fill="#ffffff">${label}</text>` +
    `</svg>`,
  );

const BANNERS: DbHomepageBanner[] = [
  {
    id: 'demo-banner-1',
    title_en: 'Summer Combo', title_ar: 'عرض الصيف',
    image_url: placeholder('#422e87', '#6d4fd0', 'Summer Combo'),
    storage_path: 'demo/summer-combo.png',
    is_active: true, sort_order: 0,
    starts_at: null, ends_at: null,
    action_type: 'category', action_value: 'spicy-burgers',
    created_at: STAMP, updated_at: STAMP, updated_by: null,
  },
  {
    id: 'demo-banner-2',
    title_en: 'Volcano Chicken launch', title_ar: 'إطلاق دجاج فولكانو',
    image_url: placeholder('#e02d3d', '#ff7a45', 'Volcano Chicken'),
    storage_path: 'demo/volcano.png',
    is_active: true, sort_order: 1,
    starts_at: '2026-07-01T00:00:00Z', ends_at: '2026-08-31T20:59:00Z',
    action_type: 'product', action_value: 'p-volcano-chicken',
    created_at: STAMP, updated_at: STAMP, updated_by: null,
  },
  {
    id: 'demo-banner-3',
    title_en: 'Eid hours (scheduled)', title_ar: 'ساعات العيد (مجدول)',
    image_url: placeholder('#1c1630', '#422e87', 'Eid hours'),
    storage_path: 'demo/eid.png',
    is_active: false, sort_order: 2,
    starts_at: '2026-09-10T00:00:00Z', ends_at: null,
    action_type: 'none', action_value: null,
    created_at: STAMP, updated_at: STAMP, updated_by: null,
  },
];

const doc = (
  id: string, type: string, en: string, ar: string,
  contentEn: string, contentAr: string,
  version: string, active: boolean, acceptance: boolean,
): DbLegalDocument => ({
  id, document_type: type,
  title_en: en, title_ar: ar,
  content_en: contentEn, content_ar: contentAr,
  version, effective_date: '2026-01-01',
  is_active: active, requires_acceptance: acceptance,
  created_at: STAMP, updated_at: STAMP, updated_by: null,
});

const LEGAL: DbLegalDocument[] = [
  doc('demo-legal-1', 'terms', 'Terms & Conditions', 'الشروط والأحكام',
    'By placing an order on Spicy Meal you agree to these terms, which are governed by the e-commerce regulations of the Kingdom of Saudi Arabia.\n\nOrders are prepared by the branch you select at checkout. Prices are shown in Saudi Riyals and include 15% VAT.',
    'بتقديم طلب عبر تطبيق سبايسي ميل فإنك توافق على هذه الشروط، الخاضعة لأنظمة التجارة الإلكترونية في المملكة العربية السعودية.\n\nتُحضَّر الطلبات في الفرع الذي تختاره عند إتمام الطلب. الأسعار بالريال السعودي وشاملة ضريبة القيمة المضافة ١٥٪.',
    '2.1', true, true),
  doc('demo-legal-2', 'privacy', 'Privacy Policy', 'سياسة الخصوصية',
    'This policy describes what Spicy Meal collects, why, and how long it is kept. Phone numbers are used for order verification and delivery contact only.',
    'توضح هذه السياسة ما تجمعه سبايسي ميل ولماذا ومدة الاحتفاظ به. تُستخدم أرقام الهواتف للتحقق من الطلب والتواصل عند التوصيل فقط.',
    '2.0', true, true),
  doc('demo-legal-3', 'refund', 'Refund Policy', 'سياسة الاسترجاع',
    'Refunds are issued to the original payment method. Card refunds settle with the issuing bank and may take up to 14 working days.',
    'تُعاد المبالغ إلى وسيلة الدفع الأصلية. تتم تسوية المبالغ المعادة على البطاقات مع البنك المُصدِر وقد تستغرق حتى ١٤ يوم عمل.',
    '1.4', true, false),
  doc('demo-legal-4', 'delivery', 'Delivery Policy', 'سياسة التوصيل',
    'Delivery is available inside each branch delivery area. The fee and minimum order are set per branch and shown before you confirm.',
    'التوصيل متاح داخل نطاق توصيل كل فرع. تُحدَّد الرسوم والحد الأدنى للطلب لكل فرع وتُعرض قبل تأكيد الطلب.',
    '1.2', true, false),
  doc('demo-legal-5', 'cookies', 'Cookie Notice', 'إشعار ملفات الارتباط',
    'The web app stores a session token and your language preference. No advertising or cross-site tracking cookies are set.',
    'يخزّن تطبيق الويب رمز الجلسة وتفضيل اللغة فقط. لا تُستخدم ملفات ارتباط إعلانية أو تتبّع عبر المواقع.',
    '1.0', false, false),
];

/** Writes resolve without persisting — nothing here talks to a real project. */
export const banners = {
  list: async () => BANNERS,
  create: async (b: Partial<DbHomepageBanner>) => ({ ...BANNERS[0], ...b }),
  update: async (id: string, patch: Partial<DbHomepageBanner>) => ({ ...BANNERS[0], ...patch, id }),
  remove: async (_id: string) => {},
  uploadImage: async (_file: File) => ({ path: 'demo/upload.png', publicUrl: BANNERS[0].image_url }),
  removeImage: async (_path: string) => {},
};

export const legalDocs = {
  list: async () => LEGAL,
  update: async (id: string, patch: Partial<DbLegalDocument>) => ({ ...LEGAL[0], ...patch, id }),
};
