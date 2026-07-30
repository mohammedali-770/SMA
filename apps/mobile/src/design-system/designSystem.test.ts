/**
 * Proves the MOBILE mirror is real and framework-free.
 *
 * `vitest.config.ts` runs mobile tests in the Node environment and forbids
 * React Native / Expo / Supabase imports, so this file imports the generated
 * modules directly rather than through `../design-system` (whose barrel pulls
 * in React Native components).
 *
 * If the generator ever emitted something that only works under Metro, this
 * suite fails immediately instead of at app boot.
 */
import { describe, expect, it } from 'vitest';

import { resolveButtonState } from './generated/buttonState';
import { validateShortAddress } from './generated/fieldState';
import { formatAmount, priceAccessibilityLabel } from './generated/money';
import { color, fontFamily, radius, space } from './generated/tokens';

describe('mobile design-system mirror', () => {
  it('formats money identically to the console', () => {
    // Compat default: ungrouped, byte-identical to the previous toFixed(2).
    expect(formatAmount(1234.5)).toBe('1234.50');
    expect(formatAmount(1234.5, { grouping: true })).toBe('1,234.50');
    expect(priceAccessibilityLabel(24.5, 'ar')).toBe('24.50 ريال سعودي');
  });

  it('shares the button rules with the console', () => {
    expect(resolveButtonState({ loading: true }).inert).toBe(true);
  });

  it('shares the validators with the console', () => {
    expect(validateShortAddress('RRBB1234').valid).toBe(true);
  });

  it('exposes the token scales the RN components consume', () => {
    expect(color.ember).toBe('#E02D3D'); // design-system-allow — pinning the token value is the point
    expect(space.s4).toBe(16);
    expect(radius.md).toBe(14);
  });

  it('names one registered font family per weight (RN does not synthesise them)', () => {
    // Every value must be a concrete family that expo-font registers; a bare
    // "IBMPlexSans" would silently render the system face at bold weights.
    const families = [
      fontFamily.ar.regular,
      fontFamily.ar.semibold,
      fontFamily.ar.bold,
      fontFamily.en.regular,
      fontFamily.en.semibold,
      fontFamily.en.bold,
      fontFamily.num.regular,
      fontFamily.num.semibold,
    ];
    for (const f of families) expect(f).toMatch(/_\d{3}[A-Za-z]+$/);
    expect(new Set(families).size).toBe(families.length);
  });
});
