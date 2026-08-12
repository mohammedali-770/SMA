/**
 * Safe-area-aware screen container. Wraps content with the correct insets and
 * the app background. Use `edges` to opt a screen out of a given inset (e.g. a
 * screen with its own sticky footer handles the bottom inset itself).
 */
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useThemeColors } from '../theme/ThemeProvider';
import { makeStyles } from '../theme/makeStyles';

interface Props {
  children: React.ReactNode;
  edges?: readonly Edge[];
  style?: ViewStyle;
  background?: string;
}

export function Screen({ children, edges = ['top', 'left', 'right'], style, background }: Props) {
  const styles = useStyles();
  const colors = useThemeColors();
  return (
    <SafeAreaView edges={edges} style={[styles.safe, { backgroundColor: background ?? colors.appBg }]}>
      <View style={[styles.inner, style]}>{children}</View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1 },
  inner: { flex: 1 },
}));
