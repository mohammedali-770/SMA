/**
 * Money display: the official Saudi Riyal symbol followed by the amount, with
 * the symbol ALWAYS to the left in both Arabic (RTL) and English (LTR). Western
 * digits, two decimals — DISPLAY only; authoritative currency math stays
 * server-side and the machine-readable code stays "SAR".
 *
 * Formatting and the accessible label now come from the shared design-system
 * money module (`design-system/money.ts`) so the admin console and the app
 * cannot drift apart on grouping, decimals, digit shape or how a price is
 * announced. Visual defaults are unchanged — this is a consolidation, not a
 * restyle.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { formatAmount, isolateLtr, priceAccessibilityLabel } from '../design-system/generated/money';
import { SaudiRiyalSymbol } from './SaudiRiyalSymbol';
import { useI18n } from '../i18n/I18nProvider';
// Aliased: these components take a `color` PROP, which would shadow the
// token import and make the default value reference itself.
import { color as token, fontFamily } from '../design-system/generated/tokens';

/**
 * Weight → mono face.
 *
 * `fontFamily.num` ships two faces, regular and semibold. On React Native the
 * FAMILY NAME carries the weight, so `fontWeight` is dropped at every call site
 * below rather than left to be synthesised — an 800 request against a family
 * with no 800 face produces a faux-bold on Android and nothing on iOS.
 */
function monoFace(weight: TextStyle['fontWeight']): string {
  const n = Number(weight ?? 400);
  return Number.isFinite(n) && n >= 600 ? fontFamily.num.semibold : fontFamily.num.regular;
}
interface Props {
  amount: number;
  /** Font size of the amount; the symbol matches it. Default 15. */
  size?: number;
  color?: string;
  weight?: TextStyle['fontWeight'];
  /** Optional +/- prefix rendered before the symbol (e.g. discounts). */
  prefix?: string;
  /** Extra style for the amount text. */
  style?: StyleProp<TextStyle>;
}

export function Price({ amount, size = 15, color = token.appText, weight = '800', prefix, style }: Props) {
  const { lang } = useI18n();
  const value = formatAmount(amount);
  // Money is the most prominent structured number in the product, and it was
  // the one place the design system's "structured numbers are mono" rule was
  // not applied — `fontFamily` was never set, so RN fell through to the
  // platform default. Fixed HERE so every call site inherits it; the value,
  // decimals, grouping, glyph position and accessibility label are untouched.
  const family = monoFace(weight);
  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={priceAccessibilityLabel(amount, lang, prefix)}
    >
      {prefix ? <Text style={{ fontSize: size, color, fontFamily: family }}>{prefix}</Text> : null}
      <SaudiRiyalSymbol size={Math.round(size * 0.82)} color={color} />
      {/* React Native has no `unicode-bidi`, so the digits are wrapped in
          LRI…PDI. Without it a grouped amount inside Arabic copy can have its
          separators reordered by the bidi algorithm. */}
      <Text style={[{ fontSize: size, color, fontFamily: family }, style]}>{isolateLtr(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // `flexDirection: 'row'` (never rtlRow) keeps the symbol on the LEFT in both
  // languages: the app does not force native RTL, so a plain row is not mirrored.
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});