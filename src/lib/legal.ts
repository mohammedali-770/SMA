/**
 * Legal-document registry + pure helpers (no Supabase, no React). Shared by the
 * dashboard and the tests so the canonical document types, their order, and the
 * "active only" rule the mobile app relies on live in one place.
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

/** Canonical fallback titles (the DB row's title_en/ar win once seeded/edited). */
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

/** Position of a document type in the canonical list (unknown types sort last). */
export function legalDocOrder(type: string): number {
  const i = (LEGAL_DOCUMENT_TYPES as readonly string[]).indexOf(type);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

export interface ActiveLegalRow {
  document_type: string;
  is_active: boolean;
}

/** The documents a customer should see, in canonical display order (active only). */
export function activeLegalDocs<T extends ActiveLegalRow>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => r.is_active)
    .slice()
    .sort((a, b) => legalDocOrder(a.document_type) - legalDocOrder(b.document_type));
}
