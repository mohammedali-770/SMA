/**
 * Contrast contract for the DARK palette.
 *
 * `src/design-system/contrastContract.test.ts` pins the light inks at WCAG AA.
 * It could not pin the dark ones: the dark palette does not live in the
 * generated token set, it is hand-authored here as the `AppPalette` override.
 * So for as long as that file was the whole contract, dark mode was the half of
 * the system with no contrast floor at all — and a 2026-09-10 sweep found real
 * failures in it.
 *
 * What that sweep measured, and what this file therefore pins:
 *
 *   1. `ember` IS NOT AN INK, in either theme. As normal-size text it measures
 *      4.08:1 at worst in light and 3.15:1 in dark, against the grounds text
 *      actually lands on. `emberText` exists for that job and is asserted here.
 *      `ember` itself is still asserted where it IS correct — as a fill, under
 *      white — so this file cannot be read as "ember is bad".
 *   2. THE SAME GROUND LIST as the light contract, for the same reason.
 *      `appSurface3` is excluded there because it is the image-placeholder
 *      fill and never a text ground; excluding it here keeps the two halves
 *      comparable, and `heatOff` — the placeholder-icon ink that sits on it —
 *      is deliberately not asserted, because a decorative placeholder is not a
 *      contrast obligation.
 *   3. `disabledFg` is checked but NOT required to clear AA. WCAG 1.4.3
 *      exempts inactive controls, and it measures 4.44:1 — close enough that a
 *      naive "fix" would be churn. Pinned as a floor of 3:1 so it cannot rot
 *      much further, and recorded here so the number is not mistaken for a
 *      defect next time somebody sweeps.
 *
 * Large text is a separate threshold (3:1) and is asserted separately: the
 * 28pt chevron, the 72pt confirmation number and the quantity signs are all
 * `ember` and all legitimate at that size.
 */
import { describe, expect, it } from 'vitest';

import { darkPalette, lightPalette } from './palette';

/** WCAG 2.1 relative luminance. Same maths as the light contract. */
function luminance(hex: string): number {
  const s = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_NORMAL = 4.5;
const AA_LARGE = 3;

/**
 * Every DARK ground text actually lands on.
 *
 * `appSurface3` is absent for the same reason it is absent from the light
 * contract: it is the image-placeholder fill, not a text ground.
 */
const DARK_GROUNDS = ['appBg', 'appSurface', 'appSurface2', 'conBg', 'conSurface', 'conSurface2'] as const;

describe('dark inks clear WCAG AA for normal text', () => {
  it.each(DARK_GROUNDS)('appText3 on %s is at least 4.5:1', (ground) => {
    expect(contrast(darkPalette.appText3, darkPalette[ground])).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each(DARK_GROUNDS)('appText2 on %s is at least 4.5:1', (ground) => {
    expect(contrast(darkPalette.appText2, darkPalette[ground])).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('primary ink clears AA everywhere by a wide margin', () => {
    for (const ground of DARK_GROUNDS) {
      expect(contrast(darkPalette.appText, darkPalette[ground])).toBeGreaterThan(10);
    }
  });
});

describe('emberText is the brand ink, and ember is not', () => {
  it.each(DARK_GROUNDS)('emberText on %s clears AA for normal text', (ground) => {
    expect(contrast(darkPalette.emberText, darkPalette[ground])).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('emberText clears AA in the LIGHT palette too', () => {
    // The token exists to be theme-agnostic at call sites. If only one half
    // held, every consumer would need to know which theme it was in.
    for (const ground of DARK_GROUNDS) {
      expect(contrast(lightPalette.emberText, lightPalette[ground])).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('ember does NOT clear AA as normal text, which is why emberText exists', () => {
    // Asserted as a FAILURE on purpose. If a future palette edit made `ember`
    // legible as an ink, this test fails and somebody gets to decide
    // deliberately whether the second token is still earning its place —
    // rather than leaving a token nobody remembers the reason for.
    expect(contrast(darkPalette.ember, darkPalette.appSurface2)).toBeLessThan(AA_NORMAL);
    expect(contrast(lightPalette.ember, lightPalette.appSurface2)).toBeLessThan(AA_NORMAL);
  });

  it('ember is still valid as LARGE text and as a fill', () => {
    // The three surviving `color.ember` text sites are 28pt, 72pt and title
    // size. Large text answers to 3:1, and ember clears it on every ground.
    for (const ground of DARK_GROUNDS) {
      expect(contrast(darkPalette.ember, darkPalette[ground])).toBeGreaterThanOrEqual(AA_LARGE);
    }
    expect(contrast(darkPalette.onEmber, darkPalette.ember)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrast(lightPalette.onEmber, lightPalette.ember)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('emberText is NOT aliased to emberDeep', () => {
    // They share a value in light and diverge in dark. Pointing one at the
    // other would look like a tidy-up and would silently retie an ink to a
    // fill — the same trap disabledFg/text-3 records in the light contract.
    expect(darkPalette.emberText).not.toBe(darkPalette.emberDeep);
  });
});

describe('status tints stay legible in dark', () => {
  it.each([
    ['danger', 'dangerTint'],
    ['warn', 'warnTint'],
    ['mint', 'mintTint'],
    ['sky', 'infoTint'],
  ] as const)('%s on %s clears AA', (ink, tint) => {
    expect(contrast(darkPalette[ink], darkPalette[tint])).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('disabled foreground is exempt from AA but still floored', () => {
  it('measures below AA and that is accepted, not a defect', () => {
    // WCAG 1.4.3 exempts inactive components. Recorded so a future sweep does
    // not "discover" this and repaint a disabled state for no benefit.
    const ratio = contrast(darkPalette.disabledFg, darkPalette.disabledBg);
    expect(ratio).toBeLessThan(AA_NORMAL);
    expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
  });
});
