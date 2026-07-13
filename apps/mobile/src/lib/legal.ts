/**
 * Canonical legal-document types + fallback titles for the mobile app. Mirrors
 * the web app's src/lib/legal.ts. Used to order the Legal & Support list and to
 * label the login/checkout policy links without waiting on a network fetch (the
 * DB row's title still wins inside the document viewer).
 */
export const LEGAL_DOCUMENT_TYPES = [
  'privacy_policy',
  'terms_conditions',
  'cancellation_refund_policy',
  'delivery_pickup_policy',
  'payment_policy',
  'offers_loyalty_terms',
  'account_data_deletion',
  'allergen_food_notice',
  'contact_support',
] as const;

export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

export const LEGAL_DOC_TITLES: Record<LegalDocumentType, { en: string; ar: string }> = {
  privacy_policy: { en: 'Privacy Policy', ar: 'سياسة الخصوصية' },
  terms_conditions: { en: 'Terms & Conditions', ar: 'الشروط والأحكام' },
  cancellation_refund_policy: { en: 'Cancellation & Refund Policy', ar: 'سياسة الإلغاء والاسترجاع' },
  delivery_pickup_policy: { en: 'Delivery & Pickup Policy', ar: 'سياسة التوصيل والاستلام' },
  payment_policy: { en: 'Payment Policy', ar: 'سياسة الدفع' },
  offers_loyalty_terms: { en: 'Offers & Loyalty Terms', ar: 'شروط العروض والولاء' },
  account_data_deletion: { en: 'Account & Data Deletion', ar: 'حذف الحساب والبيانات' },
  allergen_food_notice: { en: 'Food Allergy Notice', ar: 'تنبيه الحساسية الغذائية' },
  contact_support: { en: 'Contact & Support', ar: 'التواصل والدعم' },
};

export function legalDocOrder(type: string): number {
  const i = (LEGAL_DOCUMENT_TYPES as readonly string[]).indexOf(type);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

export function legalTitle(type: string, lang: 'en' | 'ar'): string {
  const t = LEGAL_DOC_TITLES[type as LegalDocumentType];
  return t ? t[lang] : type;
}
