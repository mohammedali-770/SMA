/**
 * Official Saudi Riyal symbol (SAMA). Rendered from the official SVG asset
 * (assets/saudi-riyal-symbol.svg) — the path data is used VERBATIM, never
 * redrawn or modified. Inherits the surrounding text color via
 * react-native-svg's `color` prop + fill="currentColor", and scales to the
 * price font size so it aligns with the digits. Decorative by default (the
 * Price component carries the accessible amount + currency label).
 */
import React from 'react';
import { type ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '../theme';

const D1 = 'M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z';
const D2 = 'M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z';
// Official proportions from the asset viewBox (width / height).
const RATIO = 1124.14 / 1256.39;

interface Props {
  /** Symbol height in px; width scales to keep the official proportions. */
  size?: number;
  /** Fill color; pass the surrounding text color. Defaults to the ink token. */
  color?: ColorValue;
  /** When set, the symbol is announced on its own; otherwise decorative. */
  label?: string;
}

export function SaudiRiyalSymbol({ size = 16, color = colors.text, label }: Props) {
  // Only attach accessibility props when the symbol stands alone; otherwise it
  // is decorative (the Price component announces the full amount + currency).
  // Passing `accessible={false}` would leak a non-boolean DOM attribute on web.
  const a11y = label
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }
    : {};
  return (
    <Svg
      width={size * RATIO}
      height={size}
      viewBox="0 0 1124.14 1256.39"
      color={color}
      {...a11y}
    >
      <Path d={D1} fill="currentColor" />
      <Path d={D2} fill="currentColor" />
    </Svg>
  );
}