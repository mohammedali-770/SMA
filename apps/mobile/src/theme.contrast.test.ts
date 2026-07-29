/**
 * WCAG 2.1 contrast guards for the palette.
 *
 * The status colours were previously below AA for body text — success measured
 * 3.13:1 and warning 2.99:1 against their own tints, where 4.5:1 is required.
 * They read as "green enough" and "amber enough" by eye, which is exactly why
 * this needs a test rather than a review: nothing about the old values looked
 * wrong, they were just unreadable for anyone with reduced contrast sensitivity.
 *
 * Framework-free on purpose so it runs in the root vitest suite (see
 * vitest.config.ts — no React Native or Expo imports in this file).
 */
import { describe, expect, it } from 'vitest';

import { colors } from './theme';

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

describe('palette contrast (WCAG 2.1)', () => {
  // Status text is small (font.xs / font.sm at weight 700-800 in the badges and
  // chips), so it is normal-size text and owes the full 4.5:1 — not the 3:1
  // large-text allowance.
  const bodyPairs: [string, string, string][] = [
    ['success on its tint', colors.success, colors.successBg],
    ['success on a card', colors.success, colors.surface],
    ['danger on its tint', colors.danger, colors.dangerBg],
    ['danger on a card', colors.danger, colors.surface],
    ['warning on a card', colors.warning, colors.surface],
    ['warning on the alt surface', colors.warning, colors.bgAlt],
    ['body text on the screen ground', colors.text, colors.bg],
    ['body text on a card', colors.text, colors.surface],
    ['secondary text on a card', colors.muted, colors.surface],
    ['primary on its tint', colors.purple, colors.purpleBg],
  ];

  it.each(bodyPairs)('%s meets AA for body text', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  // The brand red is a FILL colour: it carries white text on destructive
  // buttons. It is deliberately lighter than `danger` and is not required to
  // work as text on a tint — `danger` exists for that.
  it('white text on the brand red fill meets AA', () => {
    expect(contrastRatio(colors.white, colors.red)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('white text on the brand purple fill meets AA', () => {
    expect(contrastRatio(colors.white, colors.purple)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('keeps danger distinct from the brand red', () => {
    // If these ever converge again, error text on the pink tint silently drops
    // back to 3.94:1. The split is the fix, so assert it directly.
    expect(colors.danger).not.toBe(colors.red);
    expect(contrastRatio(colors.red, colors.dangerBg)).toBeLessThan(AA_BODY);
    expect(contrastRatio(colors.danger, colors.dangerBg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('status icons meet the 3:1 non-text minimum on their tints', () => {
    expect(contrastRatio(colors.success, colors.successBg)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrastRatio(colors.danger, colors.dangerBg)).toBeGreaterThanOrEqual(AA_UI);
  });

  it('brand colours are unchanged', () => {
    // The brief fixes these. A contrast fix must never quietly restyle the brand.
    expect(colors.purple).toBe('#422e87');
    expect(colors.red).toBe('#e02d3d');
  });
});
