/**
 * REGRESSION LOCK for the mobile side of the Price migration.
 *
 * `formatSAR` now derives its digits from the shared design-system money
 * module instead of a local `toFixed(2)`. That must be invisible: every value
 * the app displays has to render exactly as it did before, and a report-sized
 * number like 48200 must NOT acquire thousands separators.
 *
 * Framework-free on purpose — vitest.config.ts runs mobile tests under Node and
 * forbids React Native / Expo imports here.
 */
import { describe, expect, it } from 'vitest';

import { formatAmount, priceAccessibilityLabel } from '../design-system/generated/money';
import { formatSAR } from './format';

const REAL_WORLD = [0, 6, 24.5, 99.99, 999.99, 1000, 1234.5, 48200, 123456.78, 1234567.89];

describe('formatSAR after migration', () => {
  it.each(REAL_WORLD)('formats %d exactly as the old toFixed(2) did', (value) => {
    expect(formatSAR(value, 'en')).toBe(`${value.toFixed(2)} SAR`);
    expect(formatSAR(value, 'ar')).toBe(`${value.toFixed(2)} ر.س`);
  });

  it('does NOT group thousands — 48200 stays 48200.00', () => {
    expect(formatSAR(48200, 'en')).toBe('48200.00 SAR');
    expect(formatSAR(48200, 'en')).not.toContain('48,200');
  });

  it('never groups at any magnitude the app shows', () => {
    for (const v of REAL_WORLD) {
      expect(formatSAR(v, 'en')).not.toMatch(/\d,\d/);
    }
  });

  it('shares its digits with the Price component', () => {
    for (const v of REAL_WORLD) {
      expect(formatSAR(v, 'en')).toBe(`${formatAmount(v)} SAR`);
    }
  });

  it('defaults to English when no language is given', () => {
    expect(formatSAR(24.5)).toBe('24.50 SAR');
  });
});

describe('order-list accessibility label', () => {
  /**
   * OrdersScreen's card announces the total via priceAccessibilityLabel rather
   * than formatSAR: the visible total is the Price component, whose riyal SVG
   * has no text equivalent, so assistive tech should hear the currency spoken
   * rather than the code "SAR".
   */
  it('speaks the currency instead of the code', () => {
    expect(priceAccessibilityLabel(48200, 'en')).toBe('48200.00 Saudi Riyal');
    expect(priceAccessibilityLabel(48200, 'ar')).toBe('48200.00 ريال سعودي');
  });

  it('is not grouped either', () => {
    expect(priceAccessibilityLabel(48200, 'ar')).not.toContain('48,200');
  });
});
