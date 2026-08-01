/**
 * Contrast contract for the design-system inks.
 *
 * `text-3` shipped at `#9C93AB` and measured **2.33–2.93:1** against every
 * ground it is used on — below WCAG AA (4.5:1) for normal text, at the 11.5px
 * caption size it is mostly used at. This file exists so it cannot go back.
 *
 * What is pinned, and why each part is here:
 *
 *   1. The RATIOS, ground by ground, so a change to a *tint* (not just to the
 *      ink) that pushes a pairing under AA fails here rather than in someone's
 *      eyes six months later.
 *   2. The HIERARCHY, so a future "let's just darken it more" does not collapse
 *      the third ink into the second.
 *   3. The FOUR MIRRORS agreeing. `design-system/tokens.ts` is canonical and
 *      `sync-design-system.mjs` writes the two generated copies — but
 *      `src/index.css` holds the same value BY HAND and the sync script does
 *      not reach it. That hand-maintained fourth copy is the one that can drift
 *      silently, so it is compared here against the canonical source.
 *   4. `disabledFg` SEPARATELY. It was fixed in an earlier PR for a different
 *      reason (2.2:1 on `disabledBg`) and now measures close to `text-3` by
 *      coincidence. Aliasing them would look harmless and break the next time
 *      either moves.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { color } from './generated/tokens';

/** WCAG 2.1 relative luminance. */
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

/**
 * Every LIGHT ground muted text actually lands on.
 *
 * `appSurface3` (#FCE1C9) is deliberately NOT here: it is the image-placeholder
 * fill in ProductCard and CartScreen, never a text ground. Including it would
 * force the ink below `text-2` and inverting the hierarchy is worse than the
 * problem. If tertiary text is ever placed on it, add it here and re-solve.
 */
const LIGHT_GROUNDS: Record<string, string> = {
  appBg: color.appBg,
  appSurface: color.appSurface,
  appSurface2: color.appSurface2,
  conBg: color.conBg,
  conSurface: color.conSurface,
  conSurface2: color.conSurface2,
  warnTint: color.warnTint,
  dangerTint: color.dangerTint,
  infoTint: color.infoTint,
  mintTint: color.mintTint,
};

describe('muted ink clears WCAG AA for normal text', () => {
  it.each(Object.entries(LIGHT_GROUNDS))(
    'text-3 on %s is at least 4.5:1',
    (_name, ground) => {
      expect(contrast(color.conText3, ground)).toBeGreaterThanOrEqual(AA_NORMAL);
    },
  );

  it.each(Object.entries(LIGHT_GROUNDS))(
    'text-2 on %s is at least 4.5:1',
    (_name, ground) => {
      expect(contrast(color.conText2, ground)).toBeGreaterThanOrEqual(AA_NORMAL);
    },
  );

  it('primary ink clears AA everywhere by a wide margin', () => {
    for (const ground of Object.values(LIGHT_GROUNDS)) {
      expect(contrast(color.conText, ground)).toBeGreaterThan(10);
    }
  });

  it('the worst pairing is dangerTint, and it still passes', () => {
    // Named so the tightest margin in the system is visible rather than buried
    // in a parameterised list. If a future tint edit moves this, it fails here.
    expect(contrast(color.conText3, color.dangerTint)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrast(color.conText3, color.dangerTint)).toBeLessThan(5);
  });
});

describe('the ink hierarchy stays ordered', () => {
  it('text-3 is lighter than text-2, which is lighter than text', () => {
    // Darkening text-3 until it clears AA "more comfortably" would collapse it
    // into text-2 and flatten three levels into two.
    expect(luminance(color.conText3)).toBeGreaterThan(luminance(color.conText2));
    expect(luminance(color.conText2)).toBeGreaterThan(luminance(color.conText));
  });

  it('app and console inks stay in lockstep', () => {
    expect(color.appText).toBe(color.conText);
    expect(color.appText2).toBe(color.conText2);
    expect(color.appText3).toBe(color.conText3);
  });
});

describe('disabled foreground is independent and still legible', () => {
  it('clears AA against the disabled surface', () => {
    expect(contrast(color.disabledFg, color.disabledBg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('is NOT aliased to the tertiary ink', () => {
    // They measure similarly today. That coincidence is exactly why pointing
    // one at the other would look safe and then break silently.
    expect(color.disabledFg).not.toBe(color.conText3);
  });
});

describe('the hand-maintained CSS mirror matches the canonical token', () => {
  // `sync-design-system.mjs` writes src/design-system/generated and
  // apps/mobile/src/design-system/generated. It does NOT write index.css, so
  // that copy is the one that can drift.
  const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

  const cssVar = (name: string): string => {
    const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`));
    if (!m) throw new Error(`--color-${name} not found in src/index.css`);
    return m[1].toUpperCase();
  };

  it.each([
    ['con-text', 'conText'],
    ['con-text-2', 'conText2'],
    ['con-text-3', 'conText3'],
    ['con-bg', 'conBg'],
    ['con-surface-2', 'conSurface2'],
    ['warn-tint', 'warnTint'],
    ['danger-tint', 'dangerTint'],
    ['info-tint', 'infoTint'],
    ['mint-tint', 'mintTint'],
    ['disabled-bg', 'disabledBg'],
    ['disabled-fg', 'disabledFg'],
  ] as const)('--color-%s equals tokens.%s', (varName, tokenKey) => {
    expect(cssVar(varName)).toBe((color as Record<string, string>)[tokenKey].toUpperCase());
  });
});
