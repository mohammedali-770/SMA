/**
 * Design-system typography (mobile).
 *
 * One component for every piece of text so the IBM Plex faces, the type scale
 * and the reading-edge alignment are applied in exactly one place rather than
 * being restated in every screen's StyleSheet.
 */
import React from 'react';
import { Text as RNText, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { useI18n } from '../../i18n/I18nProvider';
import { useThemeColors } from '../../theme/ThemeProvider';
import { fontFamily, type as typeScale } from '../generated/tokens';

export type TextVariant = keyof typeof typeScale;
export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'ember' | 'success' | 'danger' | 'onEmber';

interface Props extends Omit<TextProps, 'style'> {
  variant?: TextVariant;
  tone?: TextTone;
  /** Align to the reading edge (right in Arabic). Default true for prose. */
  align?: 'reading' | 'center' | 'ltr-start';
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
}

/** Weight -> registered family, per language. */
function familyFor(lang: 'ar' | 'en', weight: string): string {
  const set = lang === 'ar' ? fontFamily.ar : fontFamily.en;
  if (weight === '700') return set.bold;
  if (weight === '600') return set.semibold;
  return set.regular;
}

export function Text({
  variant = 'body',
  tone = 'primary',
  align = 'reading',
  style,
  children,
  ...rest
}: Props) {
  const { lang, isRTL } = useI18n();
  const color = useThemeColors();
  const scale = typeScale[variant];
  const toneColor =
    tone === 'primary' ? color.appText
    : tone === 'secondary' ? color.appText2
    : tone === 'tertiary' ? color.appText3
    : tone === 'ember' ? color.ember
    : tone === 'success' ? color.mint
    : tone === 'danger' ? color.danger
    : color.onEmber;

  return (
    <RNText
      {...rest}
      style={[
        {
          fontSize: scale.size,
          lineHeight: scale.lineHeight,
          fontFamily: familyFor(lang, scale.weight),
          color: toneColor,
          textAlign:
            align === 'center' ? 'center'
            : align === 'ltr-start' ? 'left'
            : isRTL ? 'right' : 'left',
        },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
