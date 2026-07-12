import { describe, it, expect } from 'vitest';
import {
  LEGAL_DOCUMENT_TYPES, LEGAL_DOC_TITLES, legalDocOrder, activeLegalDocs, type ActiveLegalRow,
} from './legal';

describe('legal document registry', () => {
  it('defines exactly the 9 required document types', () => {
    expect(LEGAL_DOCUMENT_TYPES).toEqual([
      'privacy_policy', 'terms_conditions', 'cancellation_refund_policy', 'delivery_pickup_policy',
      'payment_policy', 'offers_loyalty_terms', 'account_data_deletion', 'allergen_food_notice', 'contact_support',
    ]);
  });
  it('has an EN + AR title for every type', () => {
    for (const t of LEGAL_DOCUMENT_TYPES) {
      expect(LEGAL_DOC_TITLES[t].en.length).toBeGreaterThan(0);
      expect(LEGAL_DOC_TITLES[t].ar.length).toBeGreaterThan(0);
    }
  });
});

describe('legalDocOrder', () => {
  it('returns the canonical position, unknown types last', () => {
    expect(legalDocOrder('privacy_policy')).toBe(0);
    expect(legalDocOrder('contact_support')).toBe(8);
    expect(legalDocOrder('nope')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('activeLegalDocs', () => {
  const rows: (ActiveLegalRow & { id: string })[] = [
    { id: '1', document_type: 'contact_support', is_active: true },
    { id: '2', document_type: 'privacy_policy', is_active: true },
    { id: '3', document_type: 'terms_conditions', is_active: false }, // inactive -> hidden
    { id: '4', document_type: 'payment_policy', is_active: true },
  ];
  it('hides inactive documents from customers', () => {
    expect(activeLegalDocs(rows).map((r) => r.document_type)).not.toContain('terms_conditions');
  });
  it('returns active docs in canonical order', () => {
    expect(activeLegalDocs(rows).map((r) => r.document_type)).toEqual([
      'privacy_policy', 'payment_policy', 'contact_support',
    ]);
  });
  it('empty in -> empty out', () => {
    expect(activeLegalDocs([])).toEqual([]);
  });
});
