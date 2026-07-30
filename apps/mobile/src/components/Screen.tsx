/**
 * Safe-area-aware screen container. Wraps content with the correct insets and
 * the app background. Use `edges` to opt a screen out of a given inset (e.g. a
 * screen with its own sticky footer handles the bottom inset itself).
 */
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { color } from '../design-system/generated/tokens';

interface Props {
  children: React.ReactNode;
  edges?: readonly Edge[];
  style?: ViewStyle;
  background?: string;
}

export function Screen({ children, edges = ['top', 'left', 'right'], style, background }: Props) {
  return (
    <SafeAreaView edges={edges} style={[styles.safe, { backgroundColor: background ?? color.appBg }]}>
      <View style={[styles.inner, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  inner: { flex: 1 },
});
