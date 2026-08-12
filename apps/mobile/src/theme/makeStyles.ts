import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { useThemeColors } from './ThemeProvider';
import type { AppPalette } from './palette';

/**
 * React Native's StyleSheet.create captures colour values when a module loads.
 * Theme-aware screens therefore create their stylesheet from the active palette
 * inside a hook. This keeps the style object stable until the theme changes.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: AppPalette) => T,
): () => T {
  return function useStyles(): T {
    const colors = useThemeColors();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
