import { useMemo } from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { useThemeColors } from './ThemeProvider';
import type { AppPalette } from './palette';

/**
 * The shape a stylesheet factory returns. React Native 0.88's generated types
 * dropped `StyleSheet.NamedStyles`, which this constraint used to name; this is
 * its definition. It matters for more than tidiness: the constraint is what
 * keeps a literal such as `alignItems: 'center'` from widening to `string`.
 */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * React Native's StyleSheet.create captures colour values when a module loads.
 * Theme-aware screens therefore create their stylesheet from the active palette
 * inside a hook. This keeps the style object stable until the theme changes.
 */
export function makeStyles<T extends NamedStyles<T>>(
  factory: (colors: AppPalette) => T,
): () => T {
  return function useStyles(): T {
    const colors = useThemeColors();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
