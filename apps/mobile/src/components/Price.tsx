/**
 * Money display: the official Saudi Riyal symbol followed by the amount, with
 * the symbol ALWAYS to the left in both Arabic (RTL) and English (LTR). Western
 * digits, two decimals — DISPLAY only; authoritative currency math stays
 * server-side and the machine-readable code stays "SAR".
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { SaudiRiyalSymbol } from './SaudiRiyalSymbol';
import { useI18n } from '../i18n/I18nProvider';
import { colors } from '../theme';

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

export function Price({ amount, size = 15, color = colors.text, weight = '800', prefix, style }: Props) {
  const { lang } = useI18n();
  const value = amount.toFixed(2);
  const currency = lang === 'ar' ? 'ريال سعودي' : 'Saudi Riyal';
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={(prefix ? prefix + ' ' : '') + value + ' ' + currency}>
      {prefix ? <Text style={{ fontSize: size, color, fontWeight: weight }}>{prefix}</Text> : null}
      <SaudiRiyalSymbol size={Math.round(size * 0.82)} color={color} />
      <Text style={[{ fontSize: size, color, fontWeight: weight }, style]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // `flexDirection: 'row'` (never rtlRow) keeps the symbol on the LEFT in both
  // languages: the app does not force native RTL, so a plain row is not mirrored.
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});