// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Price } from './Price';
import { formatSAR } from '../utils/calculations';

afterEach(cleanup);

/**
 * REGRESSION LOCK for the Price migration.
 *
 * Report tables, the loyalty ledger and the database inspector previously
 * rendered `amount.toFixed(2)` directly. Routing them through <Price> must not
 * change a single digit — in particular a value like 48200 must stay
 * "48200.00" and must NOT silently acquire thousands separators.
 *
 * Grouping is a deliberate, separately-reviewed change (issue #119 item 3).
 * If someone flips the default, these tests fail. Do not "fix" them by
 * updating the expectations.
 */

/** Values that actually occur in admin reports and receipts. */
const REAL_WORLD = [0, 6, 24.5, 99.99, 999.99, 1000, 1234.5, 48200, 123456.78, 1234567.89];

describe('Price migration — displayed values are byte-identical to toFixed(2)', () => {
  it.each(REAL_WORLD)('renders %d exactly as before', (value) => {
    const { container } = render(<Price amount={value} />);
    expect(container.textContent).toContain(value.toFixed(2));
  });

  it('does NOT group thousands — 48200 stays 48200.00', () => {
    const { container } = render(<Price amount={48200} />);
    expect(container.textContent).toContain('48200.00');
    expect(container.textContent).not.toContain('48,200.00');
  });

  it('does not group at any magnitude that appears in reports', () => {
    for (const v of REAL_WORLD) {
      const { container } = render(<Price amount={v} />);
      expect(container.textContent).not.toMatch(/\d,\d/);
      cleanup();
    }
  });

  it('keeps the exact minus glyph the migrated call site used', () => {
    // Report tables rendered `-{x.toFixed(2)}` with an ASCII hyphen; receipts
    // use U+2212. Migration must preserve each site's own glyph, not unify it.
    const hyphen = render(<Price amount={10} prefix="-" />).container.textContent;
    expect(hyphen).toContain('-');
    cleanup();
    const minus = render(<Price amount={10} prefix="−" />).container.textContent;
    expect(minus).toContain('−');
  });

  it('renders the SAMA symbol, never a text currency code', () => {
    const { container } = render(<Price amount={48200} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.textContent).not.toMatch(/SAR|ر\.س/);
  });
});

describe('Arabic and English rendering', () => {
  it('shows identical digits in both languages', () => {
    const en = render(<Price amount={48200} lang="en" />).container.textContent;
    cleanup();
    const ar = render(<Price amount={48200} lang="ar" />).container.textContent;
    expect(en).toBe(ar);
  });

  it('announces the currency in the active language', () => {
    const { container } = render(<Price amount={48200} lang="ar" />);
    const el = container.querySelector('span[aria-label]') as HTMLElement;
    expect(el.getAttribute('aria-label')).toBe('48200.00 ريال سعودي');
  });

  it('keeps RTL/LTR isolation on every migrated price', () => {
    const { container } = render(<Price amount={48200} lang="ar" />);
    const el = container.querySelector('span') as HTMLElement;
    expect(el.getAttribute('dir')).toBe('ltr');
    expect(el.style.unicodeBidi).toBe('isolate');
  });
});

describe('formatSAR — the string-context fallback', () => {
  /**
   * Sentences and alert bodies cannot host a React element, so they keep a text
   * label. The NUMBER must still come from the shared money module so the two
   * paths can never disagree.
   */
  it('matches Price digit-for-digit', () => {
    for (const v of REAL_WORLD) {
      const { container } = render(<Price amount={v} />);
      const priceDigits = (container.textContent ?? '').trim();
      expect(formatSAR(v, 'en')).toBe(`${priceDigits} SAR`);
      cleanup();
    }
  });

  it('does not group either', () => {
    expect(formatSAR(48200, 'en')).toBe('48200.00 SAR');
    expect(formatSAR(48200, 'ar')).toBe('48200.00 ر.س');
  });
});
