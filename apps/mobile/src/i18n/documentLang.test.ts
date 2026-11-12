/**
 * R07#1: the web export's `<html lang>` follows the app's language.
 *
 * Two halves. The helper is pure and is exercised directly. The provider needs
 * a native runtime to render, so its wiring is pinned at source level, with
 * comments stripped so prose about `lang` cannot satisfy a check.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { applyDocumentLang } from './documentLang';

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('applyDocumentLang', () => {
  it('sets lang on the root element, in both directions', () => {
    const doc = { documentElement: { lang: 'en' } };
    expect(applyDocumentLang('ar', doc)).toBe(true);
    expect(doc.documentElement.lang).toBe('ar');
    expect(applyDocumentLang('en', doc)).toBe(true);
    expect(doc.documentElement.lang).toBe('en');
  });

  it('is a no-op when the language already matches', () => {
    const doc = { documentElement: { lang: 'ar' } };
    expect(applyDocumentLang('ar', doc)).toBe(false);
    expect(doc.documentElement.lang).toBe('ar');
  });

  it('never writes dir, which would double-flip every rtlRow', () => {
    const root = { lang: 'en', dir: '' };
    applyDocumentLang('ar', { documentElement: root });
    expect(root.dir).toBe('');
  });

  it('does nothing without a document (native)', () => {
    expect(applyDocumentLang('ar', undefined)).toBe(false);
    expect(applyDocumentLang('ar', null)).toBe(false);
    expect(applyDocumentLang('ar', { documentElement: null })).toBe(false);
  });
});

describe('I18nProvider wiring', () => {
  const code = strip(readFileSync(new URL('./I18nProvider.tsx', import.meta.url), 'utf8'));

  it('applies the language to the document from an effect keyed on lang', () => {
    expect(code).toMatch(
      /useEffect\(\(\) => \{[^}]*Platform\.OS !== 'web'[^}]*applyDocumentLang\(lang, document\);\s*\}, \[lang\]\)/,
    );
  });

  it('touches lang only — never dir — on the document', () => {
    expect(code).not.toMatch(/documentElement\.dir|\.dir\s*=|setAttribute\(\s*['"]dir/);
  });
});
