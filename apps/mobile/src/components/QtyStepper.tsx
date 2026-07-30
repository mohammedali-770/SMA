/** Compact quantity stepper (− value +). */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n/I18nProvider';
import { color, radius, type as typeScale } from '../design-system/generated/tokens';

interface Props {
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
  min?: number;
  small?: boolean;
}

export function QtyStepper({ value, onIncrement, onDecrement, min = 1, small }: Props) {
  const { t } = useI18n();
  const size = small ? 30 : 38;
  // Keep the compact visuals but guarantee a ≥44pt effective touch target.
  const slop = Math.ceil((44 - size) / 2);
  return (
    <View style={[styles.wrap, { height: size }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('decreaseQty')}
        onPress={onDecrement}
        disabled={value <= min}
        hitSlop={slop}
        style={({ pressed }) => [styles.btn, { width: size, height: size }, pressed && styles.pressed]}
      >
        <Text style={[styles.sign, value <= min && styles.signDisabled]}>−</Text>
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('increaseQty')}
        onPress={onIncrement}
        hitSlop={slop}
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
    backgroundColor: color.appSurface2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.appLine,
  },
  btn: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  sign: { fontSize: typeScale.title.size, fontWeight: '700', color: color.ember, lineHeight: typeScale.title.size + 2 },
  signDisabled: { color: color.disabledBg },
  value: { minWidth: 24, textAlign: 'center', fontSize: typeScale.body.size, fontWeight: '700', color: color.appText },
});
