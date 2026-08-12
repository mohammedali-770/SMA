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
  const color = useThemeColors();
  const t =
    tone === 'warning' ? { bg: color.warnTint, border: color.warnLine }
    : tone === 'danger' ? { bg: color.dangerTint, border: color.dangerLine }
    : tone === 'info' ? { bg: color.infoTint, border: color.infoLine }
    : { bg: color.appSurface, border: color.appLine };

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
