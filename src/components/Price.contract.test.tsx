// @vitest-environment jsdom
/**
 * Money display contract — the parts a restyle must never quietly change.
 *
 * `Price` never applied a font family, so money — the most prominent structured
 * number in the product — rendered in whatever the platform default was. It is
 * the one place the design system's "structured numbers are mono" rule was not
 * applied. Applying it centrally changes glyph WIDTHS, which is why the value,
 * the decimals, the grouping, the glyph position and the accessible label are
 * all pinned here: the visual fix must not move any of them.
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Price } from './Price';

afterEach(cleanup);

const priceEl = () => screen.getByLabelText(/Saudi Riyal|ريال سعودي/);

describe('digits render mono', () => {
  it('carries the num class, which binds IBM Plex Mono and tabular figures', () => {
    render(<Price amount={93} />);
    expect(priceEl().className.split(/\s+/)).toContain('num');
  });

  it('keeps a caller className alongside it rather than replacing it', () => {
    render(<Price amount={93} className="text-ember" />);
    const classes = priceEl().className.split(/\s+/);
    expect(classes).toContain('num');
    expect(classes).toContain('text-ember');
  });

  it('does not emit a stray leading space when no className is given', () => {
    render(<Price amount={93} />);
    expect(priceEl().className).toBe('num');
  });
});

describe('values, decimals and grouping are untouched', () => {
  it('always shows two decimals', () => {
    render(<Price amount={93} />);
    expect(priceEl().textContent).toContain('93.00');
  });

  it('does NOT group thousands', () => {
    // `formatAmount` defaults to `grouping: false` and `Price` passes no
    // options. Pinned as the existing rule rather than assumed: a separator
    // added here would change every price in both apps, and inside Arabic copy
    // it is the separator the bidi algorithm is most likely to reorder.
    render(<Price amount={1234567.5} />);
    expect(priceEl().textContent).toContain('1234567.50');
    expect(priceEl().textContent).not.toContain(',');
  });

  it('renders a large amount without truncation', () => {
    render(<Price amount={9999999.99} />);
    expect(priceEl().textContent).toContain('9999999.99');
  });

  it('renders a negative amount via the prefix, not a minus in the digits', () => {
    // Discounts pass prefix="−"; the amount itself stays positive so the digits
    // never carry a sign the accessible label does not.
    render(<Price amount={12.5} prefix="−" />);
    expect(priceEl().textContent).toContain('−');
    expect(priceEl().textContent).toContain('12.50');
  });

  it('renders zero as 0.00, not as blank', () => {
    render(<Price amount={0} />);
    expect(priceEl().textContent).toContain('0.00');
  });
});

describe('glyph position and direction', () => {
  it('puts the SAMA glyph before the digits, isolated LTR', () => {
    const { container } = render(<Price amount={93} />);
    const el = priceEl();
    expect(el.getAttribute('dir')).toBe('ltr');
    // The svg glyph precedes the text node carrying the amount.
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(el.textContent!.trim().startsWith('93')).toBe(true);
  });

  it('never spells the currency in letters', () => {
    // The design system requires the SAMA glyph; "SAR" and "ر.س" are banned.
    render(<Price amount={93} />);
    expect(priceEl().textContent).not.toContain('SAR');
    expect(priceEl().textContent).not.toContain('ر.س');
  });
});

describe('accessibility label', () => {
  it('announces the amount in English', () => {
    render(<Price amount={93} />);
    expect(screen.getByLabelText(/93.*Saudi Riyal/)).toBeTruthy();
  });

  it('announces the amount in Arabic when the language is passed', () => {
    render(<Price amount={93} lang="ar" />);
    expect(screen.getByLabelText(/ريال سعودي/)).toBeTruthy();
  });

  it('includes the prefix so a discount is not announced as a charge', () => {
    render(<Price amount={12.5} prefix="−" />);
    expect(priceEl().getAttribute('aria-label')).toContain('−');
  });
});
