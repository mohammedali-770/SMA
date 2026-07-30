/**
 * Design-system surface (mobile).
 *
 * A flat white panel on the cream ground — no gradient, no drop shadow by
 * default. "Ember on Cream" gets its structure from colour boundaries and
 * hairlines rather than elevation, which is also the only thing that renders
 * identically on iOS, Android and the web export.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { color, radius, space } from '../generated/tokens';

export type CardTone = 'surface' | 'warning' | 'danger' | 'info';

const TONE: Record<CardTone, { bg: string; border: string }> = {
  surface: { bg: color.appSurface, border: color.appLine },
  warning: { bg: color.warnTint, border: color.warnLine },
  danger: { bg: color.dangerTint, border: color.dangerLine },
  info: { bg: color.infoTint, border: color.infoLine },
};

interface Props {
  tone?: CardTone;
  /** Removes the border for cards that sit directly on a tinted parent. */
  borderless?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function Card({ tone = 'surface', borderless, style, children }: Props) {
  const t = TONE[tone];
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
