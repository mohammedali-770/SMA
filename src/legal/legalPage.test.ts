import { describe, it, expect } from 'vitest';

import { LEGAL_DOCUMENT_TYPES } from '../lib/legal';
import {
  docTitle,
  metaLine,
  orderDocs,
  pickText,
  preferredLang,
  slugForType,
  typeForSlug,
  typeFromPath,
  type PublicLegalDoc,
} from './legalPage';

const doc = (over: Partial<PublicLegalDoc> = {}): PublicLegalDoc => ({
  document_type: 'privacy_policy',
  title_en: 'Privacy Policy',
  title_ar: 'سياسة الخصوصية',
  content_en: 'English body',
  content_ar: 'النص العربي',
  version: '1.0',
  effective_date: '2026-08-18',
  ...over,
});

describe('slug mapping', () => {
  it('round-trips every registered document type', () => {
    for (const type of LEGAL_DOCUMENT_TYPES) {
      expect(typeForSlug(slugForType(type))).toBe(type);
    }
  });

  it('produces hyphenated slugs, which is what a store listing URL wants', () => {
    expect(slugForType('privacy_policy')).toBe('privacy-policy');
    expect(slugForType('cancellation_refund_policy')).toBe('cancellation-refund-policy');
  });

  it('accepts mixed case and percent-encoding', () => {
    expect(typeForSlug('Privacy-Policy')).toBe('privacy_policy');
    expect(typeForSlug('privacy%2Dpolicy')).toBe('privacy_policy');
  });

  it('REFUSES an unknown slug rather than guessing', () => {
    // A reviewer following a stale or mistyped link must land on the index, not
    // on a confidently wrong document. Returning null is what routes them there.
    expect(typeForSlug('privacy')).toBeNull();
    expect(typeForSlug('refunds')).toBeNull();
    expect(typeForSlug('')).toBeNull();
    expect(typeForSlug('../../etc/passwd')).toBeNull();
  });
});

describe('typeFromPath', () => {
  it('treats the bare page as the index', () => {
    expect(typeFromPath('/legal')).toBeNull();
    expect(typeFromPath('/legal/')).toBeNull();
  });

  it('resolves a document path', () => {
    expect(typeFromPath('/legal/privacy-policy')).toBe('privacy_policy');
    expect(typeFromPath('/legal/contact-support/')).toBe('contact_support');
    expect(typeFromPath('/LEGAL/Terms-Conditions')).toBe('terms_conditions');
  });

  it('resolves the store-listing aliases', () => {
    // These are pasted into App Store Connect and Play Console once and are then
    // effectively permanent, so they must keep resolving.
    expect(typeFromPath('/privacy')).toBe('privacy_policy');
    expect(typeFromPath('/terms')).toBe('terms_conditions');
    expect(typeFromPath('/support')).toBe('contact_support');
    expect(typeFromPath('/privacy/')).toBe('privacy_policy');
  });

  it('falls back to the index for anything else', () => {
    expect(typeFromPath('/legal/nope')).toBeNull();
    expect(typeFromPath('/')).toBeNull();
  });
});

describe('preferredLang', () => {
  it('chooses Arabic only when the browser asks for it', () => {
    expect(preferredLang(['ar-SA', 'en'])).toBe('ar');
    expect(preferredLang(['ar'])).toBe('ar');
  });

  it('defaults to English, which is what a store reviewer reads', () => {
    expect(preferredLang(['en-GB'])).toBe('en');
    expect(preferredLang([])).toBe('en');
    expect(preferredLang(undefined)).toBe('en');
    expect(preferredLang(['fr-FR'])).toBe('en');
  });
});

describe('pickText', () => {
  it('returns the requested language', () => {
    expect(pickText('en', 'ar', 'en')).toBe('en');
    expect(pickText('en', 'ar', 'ar')).toBe('ar');
  });

  it('FALLS BACK rather than rendering an empty policy', () => {
    // A half-translated row must still show something: a blank privacy policy is
    // a rejected submission, not a cosmetic problem.
    expect(pickText('English only', '', 'ar')).toBe('English only');
    expect(pickText('English only', null, 'ar')).toBe('English only');
    expect(pickText('   ', 'عربي', 'en')).toBe('عربي');
  });

  it('returns an empty string when neither language has content', () => {
    expect(pickText(null, null, 'en')).toBe('');
  });
});

describe('docTitle', () => {
  it('prefers the row title', () => {
    expect(docTitle(doc(), 'en')).toBe('Privacy Policy');
    expect(docTitle(doc(), 'ar')).toBe('سياسة الخصوصية');
  });

  it('falls back to the canonical registry title when the row has none', () => {
    expect(docTitle(doc({ title_en: null, title_ar: null }), 'en')).toBe('Privacy Policy');
  });

  it('falls back to the raw type for a document the registry does not know', () => {
    const unknown = doc({ document_type: 'franchise_terms', title_en: null, title_ar: null });
    expect(docTitle(unknown, 'en')).toBe('franchise_terms');
  });
});

describe('orderDocs', () => {
  it('sorts into canonical registry order regardless of input order', () => {
    const rows = [
      { document_type: 'contact_support' },
      { document_type: 'privacy_policy' },
      { document_type: 'payment_policy' },
    ];
    expect(orderDocs(rows).map((r) => r.document_type)).toEqual([
      'privacy_policy',
      'payment_policy',
      'contact_support',
    ]);
  });

  it('KEEPS a document the registry does not know, sorted last', () => {
    // Dropping it would make a document published from the admin console silently
    // invisible on the public page — the worst possible failure for a legal notice.
    const rows = [{ document_type: 'franchise_terms' }, { document_type: 'privacy_policy' }];
    expect(orderDocs(rows).map((r) => r.document_type)).toEqual(['privacy_policy', 'franchise_terms']);
  });

  it('does not mutate its input', () => {
    const rows = [{ document_type: 'contact_support' }, { document_type: 'privacy_policy' }];
    orderDocs(rows);
    expect(rows[0].document_type).toBe('contact_support');
  });
});

describe('metaLine', () => {
  it('joins version and effective date', () => {
    expect(metaLine(doc(), 'en')).toBe('Version 1.0 · Effective 2026-08-18');
  });

  it('omits whichever field is absent, and is empty when both are', () => {
    expect(metaLine(doc({ effective_date: null }), 'en')).toBe('Version 1.0');
    expect(metaLine(doc({ version: null }), 'en')).toBe('Effective 2026-08-18');
    expect(metaLine(doc({ version: null, effective_date: null }), 'en')).toBe('');
  });

  it('localises the labels', () => {
    expect(metaLine(doc(), 'ar')).toBe('الإصدار 1.0 · ساري من 2026-08-18');
  });
});
