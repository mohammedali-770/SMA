/**
 * R07#3: a menu card that opens the item's options is one button, and a
 * labelled button is announced as its label only. The label therefore has to
 * carry the price, and the card must not hold a second button.
 *
 * The helper is pure and is exercised directly. ProductCard needs a native
 * runtime to render, so its wiring is pinned at source level, with comments
 * stripped so prose cannot satisfy a check.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { productCardAccessibilityLabel } from './productCardA11y';

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('productCardAccessibilityLabel', () => {
  it('names the product and spells out the price, in English', () => {
    expect(productCardAccessibilityLabel('Burger Meal', 34.5, 'en')).toBe('Burger Meal, 34.50 Saudi Riyal');
  });

  it('in Arabic', () => {
    expect(productCardAccessibilityLabel('وجبة برجر', 34.5, 'ar')).toBe('وجبة برجر, 34.50 ريال سعودي');
  });

  it('keeps the "from" prefix when the tiers span a range', () => {
    expect(productCardAccessibilityLabel('Burger Meal', 14, 'en', 'from')).toBe(
      'Burger Meal, from 14.00 Saudi Riyal',
    );
  });
});

describe('ProductCard wiring', () => {
  const code = strip(readFileSync(new URL('./ProductCard.tsx', import.meta.url), 'utf8'));
  const cardBranch = code.slice(code.indexOf('if (needsChoice) {'));

  it('labels a choice card with name and price, not the name alone', () => {
    expect(cardBranch).toMatch(
      /accessibilityLabel=\{productCardAccessibilityLabel\(name, product\.price, lang, pricePrefix\)\}/,
    );
    expect(code).not.toMatch(/accessibilityLabel=\{name\}/);
  });

  it('draws Choose as a plain View, so the card holds no second button', () => {
    expect(code).toMatch(
      /\{available && needsChoice \? \(\s*<View style=\{styles\.add\}>\s*<Text variant="label" tone="onEmber" align="center">\{actionLabel\}<\/Text>\s*<\/View>/,
    );
  });

  it('keeps the one-tap Add a real button where the card is not', () => {
    expect(code).toMatch(
      /\) : available \? \(\s*<Pressable onPress=\{\(event\) => \{ event\.stopPropagation\(\); onAdd\(product, needsChoice\); \}\}/,
    );
  });
});
