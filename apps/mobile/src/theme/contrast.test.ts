/**
 * WCAG 2.1 contrast guards for both palettes.
 *
 * The status colours were once below AA for body text — success measured 3.13:1
 * and warning 2.99:1 against their own tints, where 4.5:1 is required. They read
 * as "green enough" and "amber enough" by eye, which is exactly why this needs a
 * test rather than a review: nothing about the old values looked wrong, they
 * were just unreadable for anyone with reduced contrast sensitivity.
 *
 * The same table now runs against the dark palette, because dark mode is where
 * a plausible-looking value is most likely to be wrong. Every pair is asserted
 * for BOTH themes; the role splits (accent vs purple, surface vs white) are
 * asserted separately, since their whole reason to exist is that one value
 * cannot satisfy both jobs on a dark ground.
 *
 * Framework-free on purpose so it runs in the root vitest suite (see
 * vitest.config.ts — no React Native or Expo imports in this file).
 */
import { describe, expect, it } from 'vitest';

import { darkColors, lightColors, type Palette } from './index';

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG 2.1 contrast ratio between two opaque colours. */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const AA_BODY = 4.5; // 1.4.3 — normal-size text
const AA_UI = 3.0; // 1.4.11 — icons and control boundaries

/** Every pairing the app actually renders, named so a failure reads plainly. */
function bodyPairs(c: Palette): [string, string, string][] {
  return [
    ['success on its tint', c.success, c.successBg],
    ['success on a card', c.success, c.surface],
    ['danger on its tint', c.danger, c.dangerBg],
    ['danger on a card', c.danger, c.surface],
    ['warning on a card', c.warning, c.surface],
    ['warning on the alt surface', c.warning, c.bgAlt],
    ['body text on the screen ground', c.text, c.bg],
    ['body text on a card', c.text, c.surface],
    ['heading on a card', c.ink, c.surface],
    ['secondary text on a card', c.muted, c.surface],
    ['secondary text on the ground', c.muted, c.bg],
    ['accent text on its tint', c.accent, c.purpleBg],
    ['accent text on a card', c.accent, c.surface],
    ['accent text on the ground', c.accent, c.bg],
  ];
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
] as const)('%s palette contrast (WCAG 2.1)', (_theme, c) => {
  // Status text is small (font.xs / font.sm at weight 700-800 in the badges and
  // chips), so it is normal-size text and owes the full 4.5:1 — not the 3:1
  // large-text allowance.
  it.each(bodyPairs(c))('%s meets AA for body text', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  // `purple` and `red` are FILL colours: they carry white text on the primary
  // and destructive buttons. They are deliberately not required to work as text
  // on a tint — `accent` and `danger` exist for that.
  it('white text on the brand purple fill meets AA', () => {
    expect(contrastRatio(c.white, c.purple)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('white text on the brand red fill meets AA', () => {
    expect(contrastRatio(c.white, c.red)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('keeps danger distinct from the brand red', () => {
    // If these ever converge, error text on the tint silently drops below AA.
    // The split is the fix, so assert it directly.
    expect(c.danger).not.toBe(c.red);
    expect(contrastRatio(c.danger, c.dangerBg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('status icons meet the 3:1 non-text minimum on their tints', () => {
    expect(contrastRatio(c.success, c.successBg)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrastRatio(c.danger, c.dangerBg)).toBeGreaterThanOrEqual(AA_UI);
  });

  it('control boundaries meet the 3:1 non-text minimum', () => {
    // A selected card's border and the stepper's glyph bars are drawn in accent
    // on a surface; 1.4.11 governs them, not 1.4.3.
    expect(contrastRatio(c.accent, c.surface)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrastRatio(c.accent, c.purpleBg)).toBeGreaterThanOrEqual(AA_UI);
  });

  it('the two palettes expose exactly the same keys', () => {
    expect(Object.keys(c).sort()).toEqual(Object.keys(lightColors).sort());
  });
});

describe('palette invariants', () => {
  it('brand colours are unchanged in light mode', () => {
    // The brief fixes these. A contrast fix must never quietly restyle the brand.
    expect(lightColors.purple).toBe('#422e87');
    expect(lightColors.red).toBe('#e02d3d');
  });

  it('light mode collapses the role splits, so nothing there changed', () => {
    // accent === purple and surface === white in light mode, which is what makes
    // the split invisible to every existing screen.
    expect(lightColors.accent).toBe(lightColors.purple);
    expect(lightColors.accentAlt).toBe(lightColors.red);
    expect(lightColors.surface).toBe(lightColors.white);
  });

  it('dark mode pulls the role splits apart, which is why they exist', () => {
    // If these ever converged, one of the two jobs would silently fail: a purple
    // readable as text on #1e1a2e cannot carry white text, and vice versa.
    expect(darkColors.accent).not.toBe(darkColors.purple);
    expect(darkColors.surface).not.toBe(darkColors.white);
    // The proof: the fill purple is NOT readable as body text on a card, and the
    // accent purple does NOT carry white text. Each needs the other.
    expect(contrastRatio(darkColors.purple, darkColors.surface)).toBeLessThan(AA_BODY);
    expect(contrastRatio(darkColors.white, darkColors.accent)).toBeLessThan(AA_BODY);
  });
});
