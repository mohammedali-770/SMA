import { describe, it, expect } from 'vitest';

import { LEGAL_DOCUMENT_TYPES } from '../lib/legal';
import {
  docTitle,
  findBySlug,
  metaLine,
  orderDocs,
  pickText,
  preferredLang,
  requestFromPath,
  slugForType,
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

/** The page's real resolution: path -> slug -> fetched row. */
const resolve = <T extends { document_type: string }>(path: string, rows: readonly T[]) => {
  const req = requestFromPath(path);
  return req.kind === 'doc' ? findBySlug(rows, req.slug) : undefined;
};

describe('slugForType', () => {
  it('produces hyphenated lowercase slugs, which is what a store listing URL wants', () => {
    expect(slugForType('privacy_policy')).toBe('privacy-policy');
    expect(slugForType('cancellation_refund_policy')).toBe('cancellation-refund-policy');
  });

  it('round-trips every registered document type back to its row', () => {
    const rows = LEGAL_DOCUMENT_TYPES.map((t) => ({ document_type: t }));
    for (const type of LEGAL_DOCUMENT_TYPES) {
      expect(findBySlug(rows, slugForType(type))?.document_type).toBe(type);
    }
  });
});

describe('requestFromPath', () => {
  it('treats the bare page as the index', () => {
    expect(requestFromPath('/legal')).toEqual({ kind: 'index' });
    expect(requestFromPath('/legal/')).toEqual({ kind: 'index' });
    expect(requestFromPath('/')).toEqual({ kind: 'index' });
  });

  it('resolves a document path', () => {
    expect(requestFromPath('/legal/privacy-policy')).toEqual({ kind: 'doc', slug: 'privacy-policy' });
    expect(requestFromPath('/legal/contact-support/')).toEqual({
      kind: 'doc',
      slug: 'contact-support',
    });
    expect(requestFromPath('/LEGAL/Terms-Conditions')).toEqual({
      kind: 'doc',
      slug: 'terms-conditions',
    });
  });

  it('resolves the store-listing aliases', () => {
    // Pasted into App Store Connect and Play Console once and then effectively
    // permanent, so these must keep resolving.
    expect(requestFromPath('/privacy')).toEqual({ kind: 'doc', slug: 'privacy-policy' });
    expect(requestFromPath('/terms')).toEqual({ kind: 'doc', slug: 'terms-conditions' });
    expect(requestFromPath('/support')).toEqual({ kind: 'doc', slug: 'contact-support' });
    expect(requestFromPath('/privacy/')).toEqual({ kind: 'doc', slug: 'privacy-policy' });
  });

  it('decodes percent-escaped slugs', () => {
    expect(requestFromPath('/legal/privacy%2Dpolicy')).toEqual({
      kind: 'doc',
      slug: 'privacy-policy',
    });
  });

  it('REGRESSION: a malformed percent escape falls back to the index instead of throwing', () => {
    // decodeURIComponent('privacy%') raises URIError. This runs on the render path
    // AFTER the fetch resolves, so an uncaught throw left the page on "Loading…"
    // forever — to a reviewer, indistinguishable from a broken policy URL.
    expect(() => requestFromPath('/legal/privacy%')).not.toThrow();
    expect(requestFromPath('/legal/privacy%')).toEqual({ kind: 'index' });
    expect(requestFromPath('/legal/%E0%A4%A')).toEqual({ kind: 'index' });
  });
});

describe('findBySlug', () => {
  it('matches case-insensitively', () => {
    const rows = [{ document_type: 'privacy_policy' }];
    expect(findBySlug(rows, 'PRIVACY-POLICY')?.document_type).toBe('privacy_policy');
  });

  it('returns undefined for an unknown slug rather than guessing', () => {
    // A reviewer following a stale or mistyped link must land on the index, not
    // on a confidently wrong document.
    const rows = [{ document_type: 'privacy_policy' }];
    expect(findBySlug(rows, 'refunds')).toBeUndefined();
    expect(findBySlug(rows, '')).toBeUndefined();
    expect(findBySlug(rows, '../../etc/passwd')).toBeUndefined();
  });
});

describe('REGRESSION: a document type this build does not know is reachable end to end', () => {
  // orderDocs deliberately keeps such a row and renderIndex links to it. Resolving
  // the slug against the compiled-in registry made that visible link bounce back
  // to the index — a document you could see but could not open.
  const rows = [{ document_type: 'privacy_policy' }, { document_type: 'franchise_terms' }];

  it('keeps it in the index', () => {
    expect(orderDocs(rows).map((r) => r.document_type)).toContain('franchise_terms');
  });

  it('opens the link the index builds for it', () => {
    const href = `/legal/${slugForType('franchise_terms')}`;
    expect(href).toBe('/legal/franchise-terms');
    expect(resolve(href, rows)?.document_type).toBe('franchise_terms');
  });

  it('still refuses a slug that matches nothing', () => {
    expect(resolve('/legal/nope', rows)).toBeUndefined();
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
