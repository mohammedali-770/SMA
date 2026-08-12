/**
 * Money display: official Saudi Riyal symbol followed by the amount, with the
 * symbol ALWAYS to the left in both Arabic and English.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { formatAmount, isolateLtr, priceAccessibilityLabel } from '../design-system/generated/money';
import { SaudiRiyalSymbol } from './SaudiRiyalSymbol';
import { useI18n } from '../i18n/I18nProvider';
import { fontFamily } from '../design-system/generated/tokens';
import { useThemeColors } from '../theme/ThemeProvider';

function monoFace(weight: TextStyle['fontWeight']): string {
  const n = Number(weight ?? 400);
  return Number.isFinite(n) && n >= 600 ? fontFamily.num.semibold : fontFamily.num.regular;
}

interface Props {
  amount: number;
  size?: number;
  color?: string;
  weight?: TextStyle['fontWeight'];
  prefix?: string;
  style?: StyleProp<TextStyle>;
}

export function Price({ amount, size = 15, color: colorProp, weight = '800', prefix, style }: Props) {
  const { lang } = useI18n();
  const palette = useThemeColors();
  const color = colorProp ?? palette.appText;
  const value = formatAmount(amount);
  const family = monoFace(weight);

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={priceAccessibilityLabel(amount, lang, prefix)}>
      {prefix ? <Text style={{ fontSize: size, color, fontFamily: family }}>{prefix}</Text> : null}
      <SaudiRiyalSymbol size={Math.round(size * 0.82)} color={color} />
      <Text style={[{ fontSize: size, color, fontFamily: family }, style]}>{isolateLtr(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
