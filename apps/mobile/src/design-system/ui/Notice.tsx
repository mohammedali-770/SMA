/** Design-system Notice — blocking/attention messaging. */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Price } from '../../components/Price';
import { useI18n } from '../../i18n/I18nProvider';
import { useThemeColors } from '../../theme/ThemeProvider';
import { priceAccessibilityLabel } from '../generated/money';
import { radius, space, type as typeScale } from '../generated/tokens';
import { Text } from './Text';
import { makeStyles } from '../../theme/makeStyles';

export type NoticeTone = 'blocking' | 'warning' | 'info' | 'success';

interface Props {
  title: string;
  action?: string | null;
  amount?: number | null;
  amountLabel?: string;
  tone?: NoticeTone;
  style?: StyleProp<ViewStyle>;
}

export function Notice({ title, action, amount, amountLabel, tone = 'blocking', style }: Props) {
  const styles = useStyles();
  const colors = useThemeColors();
  const { lang, rtlRow } = useI18n();
  const c =
    // The bar keeps the hue; the title is an ink. A 17px title is not "large
    // text", and the hues measure 3.01-4.23:1 on their own tints (R07#2).
    tone === 'warning' ? { bg: colors.warnTint, bar: colors.warn, title: colors.amberInk }
    : tone === 'info' ? { bg: colors.infoTint, bar: colors.sky, title: colors.skyInk }
    : tone === 'success' ? { bg: colors.mintTint, bar: colors.mint, title: colors.mintInk }
    : { bg: colors.dangerTint, bar: colors.danger, title: colors.dangerInk };
  const showAmount = amount != null && amountLabel;

  return (
    <View
      style={[styles.wrap, { backgroundColor: c.bg, borderStartColor: c.bar }, style]}
      accessibilityRole="alert"
      accessible
      accessibilityLabel={[
        title,
        showAmount ? `${amountLabel}: ${priceAccessibilityLabel(amount, lang)}` : null,
        action,
      ].filter(Boolean).join('. ')}
      accessibilityLanguage={lang}
    >
      <Text variant="heading" style={{ color: c.title }}>{title}</Text>
      {showAmount ? (
        <View style={[styles.amountRow, rtlRow]}>
          <Text variant="body" tone="secondary">{amountLabel}</Text>
          <Price amount={amount} size={typeScale.body.size} color={c.title} weight="700" />
        </View>
      ) : null}
      {action ? <Text variant="body" tone="secondary">{action}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderStartWidth: 4,
    paddingVertical: space.s3,
    paddingHorizontal: space.s3,
    gap: 2,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2, marginVertical: 2 },
}));
