/** Compact quantity stepper (− value +). */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius } from '../theme';

interface Props {
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
  min?: number;
  small?: boolean;
}

export function QtyStepper({ value, onIncrement, onDecrement, min = 1, small }: Props) {
  const size = small ? 30 : 38;
  return (
    <View style={[styles.wrap, { height: size }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        onPress={onDecrement}
        disabled={value <= min}
        style={({ pressed }) => [styles.btn, { width: size, height: size }, pressed && styles.pressed]}
      >
        <Text style={[styles.sign, value <= min && styles.signDisabled]}>−</Text>
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        onPress={onIncrement}
        style={({ pressed }) => [styles.btn, { width: size, height: size }, pressed && styles.pressed]}
      >
        <Text style={styles.sign}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgAlt,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btn: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  sign: { fontSize: font.xl, fontWeight: '700', color: colors.purple, lineHeight: font.xl + 2 },
  signDisabled: { color: colors.disabled },
  value: { minWidth: 24, textAlign: 'center', fontSize: font.md, fontWeight: '700', color: colors.text },
});
