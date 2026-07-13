/**
 * RTL style helpers — PURE and framework-free so the direction rules are
 * unit-tested under Node (rtl.test.ts) and exposed app-wide via I18nProvider.
 *
 * The app deliberately does NOT call I18nManager.forceRTL (a native flip needs
 * an app reload and risks a half-mirrored session — see I18nProvider). Instead,
 * screens compose these two styles into their own:
 *   - rtlText: aligns body copy to the reading edge (right in Arabic).
 *   - rtlRow:  mirrors a horizontal row (label/value, info/badge/action…).
 */
export function rtlText(isRTL: boolean): { textAlign: 'left' | 'right' } {
  return { textAlign: isRTL ? 'right' : 'left' };
}

export function rtlRow(isRTL: boolean): { flexDirection: 'row' | 'row-reverse' } {
  return { flexDirection: isRTL ? 'row-reverse' : 'row' };
}
