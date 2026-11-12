/**
 * R07#2: the design-system components draw status TEXT in the inks.
 *
 * The contrast contracts prove the ink tokens clear WCAG AA; they cannot prove
 * a component uses them. StatusPill drew `mint` on `mintTint` (3.01:1) while
 * `amberInk` sat one line below it, and Text's `ember` tone drew the fill
 * colour while `emberText` existed for exactly that job. These components need
 * a native runtime to render, so the wiring is pinned at source level, with
 * comments stripped so prose cannot satisfy a check.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const read = (name: string) => strip(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));

describe('StatusPill foregrounds are inks', () => {
  const chip = read('Chip.tsx');
  const pill = chip.slice(chip.indexOf('export function StatusPill'));

  it.each([
    ['success', 'mintTint', 'mintInk'],
    ['danger', 'dangerTint', 'dangerInk'],
    ['warning', 'warnTint', 'amberInk'],
    ['info', 'infoTint', 'skyInk'],
  ])('%s draws %s with %s', (tone, tint, ink) => {
    expect(pill).toMatch(
      new RegExp(`tone === '${tone}' \\? \\{ bg: colors\\.${tint}, fg: colors\\.${ink} \\}`),
    );
  });

  it('no pill foreground is a bare hue', () => {
    expect(pill).not.toMatch(/fg: colors\.(mint|sky|danger|ember)\b/);
  });
});

describe('Text tones resolve to inks', () => {
  const text = read('Text.tsx');

  it.each([
    ['ember', 'emberText'],
    ['success', 'mintInk'],
    ['danger', 'dangerInk'],
  ])("tone '%s' maps to colors.%s", (tone, ink) => {
    expect(text).toMatch(new RegExp(`tone === '${tone}' \\? colors\\.${ink}\\b`));
  });

  it('no tone maps to a fill or a bare hue', () => {
    expect(text).not.toMatch(/\? colors\.(ember|mint|danger|sky)\s*$/m);
  });
});

describe('Notice titles are inks', () => {
  const notice = read('Notice.tsx');

  it('every title is an ink, and every bar keeps its hue', () => {
    expect(notice).toMatch(/bar: colors\.sky, title: colors\.skyInk/);
    expect(notice).toMatch(/bar: colors\.mint, title: colors\.mintInk/);
    expect(notice).toMatch(/bar: colors\.danger, title: colors\.dangerInk/);
    expect(notice).not.toMatch(/title: colors\.(mint|sky|danger)\b/);
  });
});

describe('screen text drawn straight from a hue, found by the same sweep', () => {
  const screen = (rel: string) => strip(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));

  it("the cart's Remove label is dangerInk on its dangerTint button", () => {
    expect(screen('features/cart/CartScreen.tsx')).toMatch(
      /style=\{\{ color: colors\.dangerInk \}\}>\{removeLabel\}/,
    );
  });

  it("the menu's branch-closed notice is dangerInk on dangerTint", () => {
    expect(screen('features/menu/HomeMenuScreen.tsx')).toMatch(
      /<View style=\{styles\.closedNotice\}>\s*<Text variant="label" style=\{\{ color: colors\.dangerInk \}\}>/,
    );
  });

  it("a modifier's +price is emberText, not the ember fill", () => {
    expect(screen('features/product/ProductDetailScreen.tsx')).toMatch(
      /prefix="\+" size=\{typeScale\.label\.size\} color=\{colors\.emberText\}/,
    );
  });
});
