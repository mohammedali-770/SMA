/**
 * The checkout VAT label states the CONFIGURED rate.
 *
 * The copy used to hardcode "15%" in both languages while `brand.vatPercentage`
 * is admin-configurable, so a branch on any other rate showed customers a false
 * tax rate. The substitution is a single `.replace` at the call site — the i18n
 * layer has no interpolation and this change does not add one for one string.
 *
 * The RECEIPT keeps a rate-free label on purpose. It is a historical document:
 * an order may have been charged at a rate the brand has since changed, and
 * stamping today's rate onto it would swap one false claim for another. The
 * amount is the truth there and is already shown.
 */
import { describe, expect, it } from 'vitest';

import { STRINGS } from '../../i18n/strings';

/** Mirrors CheckoutScreen: `t('vat').replace('{rate}', …)`. */
const label = (lang: 'en' | 'ar', rate: number | undefined) =>
  STRINGS[lang].vat.replace('{rate}', String(rate ?? 15));

describe('the checkout VAT label carries the configured rate', () => {
  it('renders 15 when the brand is on 15', () => {
    expect(label('en', 15)).toBe('VAT (15%, included)');
    expect(label('ar', 15)).toBe('ضريبة القيمة المضافة (15٪ شاملة)');
  });

  it('renders a DIFFERENT configured rate, in both languages', () => {
    // The whole point: 5% must not display as 15%.
    expect(label('en', 5)).toBe('VAT (5%, included)');
    expect(label('ar', 5)).toBe('ضريبة القيمة المضافة (5٪ شاملة)');
  });

  it('falls back to 15 when the brand has not loaded yet', () => {
    expect(label('en', undefined)).toBe('VAT (15%, included)');
    expect(label('ar', undefined)).toBe('ضريبة القيمة المضافة (15٪ شاملة)');
  });

  it('leaves no placeholder behind in either language', () => {
    for (const lang of ['en', 'ar'] as const) {
      expect(label(lang, 15)).not.toContain('{rate}');
      expect(label(lang, 5)).not.toContain('{rate}');
    }
  });

  it('the raw strings contain the placeholder, not a hardcoded rate', () => {
    // Guards the regression directly: if someone re-inlines "15" here, the
    // substitution above becomes a no-op and every branch reads 15% again.
    expect(STRINGS.en.vat).toContain('{rate}');
    expect(STRINGS.ar.vat).toContain('{rate}');
    expect(STRINGS.en.vat).not.toContain('15');
    expect(STRINGS.ar.vat).not.toContain('15');
  });

  it('Arabic uses the Arabic percent sign', () => {
    expect(STRINGS.ar.vat).toContain('٪');
  });
});

describe('the receipt label states no rate at all', () => {
  it('has no percentage and no placeholder', () => {
    for (const lang of ['en', 'ar'] as const) {
      expect(STRINGS[lang].vatIncluded).not.toContain('%');
      expect(STRINGS[lang].vatIncluded).not.toContain('٪');
      expect(STRINGS[lang].vatIncluded).not.toContain('{rate}');
    }
  });

  it('still says VAT is included', () => {
    expect(STRINGS.en.vatIncluded).toBe('VAT (included)');
    expect(STRINGS.ar.vatIncluded).toBe('ضريبة القيمة المضافة (شاملة)');
  });
});
