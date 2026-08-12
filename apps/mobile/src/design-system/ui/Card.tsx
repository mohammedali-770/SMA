/** Design-system surface (mobile). */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space } from '../generated/tokens';
import { useThemeColors } from '../../theme/ThemeProvider';

export type CardTone = 'surface' | 'warning' | 'danger' | 'info';

interface Props {
  tone?: CardTone;
  borderless?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function Card({ tone = 'surface', borderless, style, children }: Props) {
  const colors = useThemeColors();
  const t =
    tone === 'warning' ? { bg: colors.warnTint, border: colors.warnLine }
    : tone === 'danger' ? { bg: colors.dangerTint, border: colors.dangerLine }
    : tone === 'info' ? { bg: colors.infoTint, border: colors.infoLine }
    : { bg: colors.appSurface, border: colors.appLine };

  return (
    <View
      style={[
        {
          backgroundColor: t.bg,
          borderRadius: radius.lg,
          padding: space.s4,
          gap: space.s2,
          borderWidth: borderless ? 0 : 1,
          borderColor: t.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
