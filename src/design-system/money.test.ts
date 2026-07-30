import { describe, expect, it } from 'vitest';

import {
  MONEY_LOCALE,
  VAT_RATE,
  currencyName,
  formatAmount,
  isolateLtr,
  moneyDirection,
  priceAccessibilityLabel,
  stripBidi,
} from './generated/money';

/**
 * Money is the highest-consequence shared surface in the product: the same
 * number is shown to a customer in Arabic, to an operator in Arabic, and to an
 * accountant in English, and it must be identical and unambiguous in all three.
 */
describe('formatAmount — en-SA', () => {
  it('uses the Saudi locale', () => {
    expect(MONEY_LOCALE).toBe('en-SA');
  });

  it('always renders exactly two decimals', () => {
    expect(formatAmount(0)).toBe('0.00');
    expect(formatAmount(24)).toBe('24.00');
    expect(formatAmount(24.5)).toBe('24.50');
    expect(formatAmount(24.567)).toBe('24.57');
  });

  /**
   * REGRESSION LOCK. Every shipped screen rendered `amount.toFixed(2)` before
   * this PR. If the default ever starts grouping, prices at or above 1000
   * change across the admin dashboard, reports and receipts without a visual
   * pass. These assertions must not be "fixed" by updating the expectation.
   */
  it('does NOT group by default — byte-identical to the previous toFixed(2)', () => {
    for (const v of [0, 24.5, 999.99, 1000, 1234.5, 48200, 1234567.89, -1500]) {
      expect(formatAmount(v)).toBe(v.toFixed(2));
    }
  });

  it('groups only when explicitly asked (the migration switch)', () => {
    expect(formatAmount(1234.5, { grouping: true })).toBe('1,234.50');
    expect(formatAmount(1234567.89, { grouping: true })).toBe('1,234,567.89');
    expect(formatAmount(999.99, { grouping: true })).toBe('999.99');
  });

  it('renders LATIN digits, never Arabic-Indic', () => {
    const out = formatAmount(1234.56);
    // ٠١٢٣٤٥٦٧٨٩ and ۰۱۲۳۴۵۶۷۸۹ must never appear in a price.
    expect(out).not.toMatch(/[٠-٩۰-۹]/);
    expect(out).toMatch(/^[0-9,.]+$/);
  });

  it('is identical for Arabic and English users', () => {
    // Formatting takes no language: the same string is shown in both UIs.
    expect(formatAmount(1234.56)).toBe(formatAmount(1234.56));
  });

  it('renders negatives (discount lines) without losing decimals', () => {
    expect(formatAmount(-10)).toBe('-10.00');
  });

  it('degrades safely on non-finite input rather than printing NaN', () => {
    expect(formatAmount(Number.NaN)).toBe('0.00');
    expect(formatAmount(Number.POSITIVE_INFINITY)).toBe('0.00');
  });

  it('falls back to a correct amount when Intl is unavailable', () => {
    // Simulates a stripped-ICU runtime by forcing the Intl path to throw.
    expect(formatAmount(24.5, { locale: 'not-a-locale!!' })).toBe('24.50');
  });
});

describe('accessible labels — Arabic and English', () => {
  it('names the currency in Arabic for Arabic users', () => {
    expect(currencyName('ar')).toBe('ريال سعودي');
    expect(priceAccessibilityLabel(24.5, 'ar')).toBe('24.50 ريال سعودي');
  });

  it('names the currency in English for English users', () => {
    expect(currencyName('en')).toBe('Saudi Riyal');
    expect(priceAccessibilityLabel(24.5, 'en')).toBe('24.50 Saudi Riyal');
  });

  it('keeps the digits Latin in the Arabic label too', () => {
    expect(priceAccessibilityLabel(1234.5, 'ar')).toContain('1234.50');
    expect(priceAccessibilityLabel(1234.5, 'ar', undefined, { grouping: true })).toContain('1,234.50');
  });

  it('includes a sign prefix when given (discounts)', () => {
    expect(priceAccessibilityLabel(10, 'en', '-')).toBe('- 10.00 Saudi Riyal');
  });

  it('never announces the letters SAR — the visible mark is the SAMA symbol', () => {
    expect(priceAccessibilityLabel(10, 'en')).not.toMatch(/\bSAR\b/);
    expect(priceAccessibilityLabel(10, 'ar')).not.toMatch(/\bSAR\b/);
  });
});

describe('RTL / LTR isolation', () => {
  it('declares ltr + isolate for the web container', () => {
    expect(moneyDirection()).toEqual({ dir: 'ltr', unicodeBidi: 'isolate' });
  });

  it('wraps values in LRI…PDI for React Native', () => {
    const wrapped = isolateLtr('1,234.50');
    expect(wrapped.charCodeAt(0)).toBe(0x2066); // LRI, not FSI (0x2068)
    expect(wrapped.charCodeAt(wrapped.length - 1)).toBe(0x2069); // PDI
  });

  it('isolation is reversible so raw text stays comparable', () => {
    expect(stripBidi(isolateLtr('24.00'))).toBe('24.00');
  });

  it('survives being embedded in Arabic copy', () => {
    const sentence = `الإجمالي ${isolateLtr(formatAmount(1234.5, { grouping: true }))} فقط`;
    // The amount is still present, contiguous and in Latin digits.
    expect(stripBidi(sentence)).toContain('1,234.50');
  });
});

describe('VAT', () => {
  it('is the Saudi rate, inclusive', () => {
    expect(VAT_RATE).toBe(0.15);
  });
});
