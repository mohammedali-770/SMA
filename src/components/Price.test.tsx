// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Price } from './Price';

afterEach(cleanup);

/**
 * The console renders money beside Arabic labels. These assertions lock in the
 * two properties that break silently: the bidi isolation, and the fact that we
 * never fall back to the letters "SAR".
 */
describe('Price (web)', () => {
  it('renders the two-decimal amount exactly as before this PR', () => {
    // Regression lock: admin KPIs and reports render values well above 1000.
    // Grouping is the migration switch, not the default — see money.ts.
    const { container } = render(<Price amount={1234.5} />);
    expect(container.textContent).toContain('1234.50');
    expect(container.textContent).not.toContain('1,234.50');
  });

  it('pins the price LTR and isolates it from surrounding Arabic', () => {
    const { container } = render(<Price amount={24} />);
    const el = container.querySelector('span') as HTMLElement;
    expect(el.getAttribute('dir')).toBe('ltr');
    expect(el.style.unicodeBidi).toBe('isolate');
  });

  it('announces the currency in English by default', () => {
    render(<Price amount={24.5} />);
    expect(screen.getByLabelText('24.50 Saudi Riyal')).toBeTruthy();
  });

  it('announces the currency in Arabic when the language is passed', () => {
    render(<Price amount={24.5} lang="ar" />);
    expect(screen.getByLabelText('24.50 ريال سعودي')).toBeTruthy();
  });

  it('renders the official SAMA symbol, never the letters SAR', () => {
    const { container } = render(<Price amount={10} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.textContent).not.toMatch(/SAR/);
  });

  it('keeps a sign prefix outside the amount', () => {
    render(<Price amount={10} prefix="-" />);
    expect(screen.getByLabelText('- 10.00 Saudi Riyal')).toBeTruthy();
  });
});
