/**
 * Quantity stepper — plus/minus for one cart line.
 *
 * Used on Checkout so a customer who is told "below the delivery minimum" can
 * fix it in place instead of navigating back to the cart and losing their
 * payment method, coupon and pin.
 *
 * Duplicate-tap protection is structural rather than debounced: while `busy` is
 * set both controls stop firing, so a fast double-tap cannot enqueue two
 * mutations against the same line. The cart store is the only writer — this
 * component never computes a price.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, spacing } from '../theme';
import { makeStyles } from '../theme/makeStyles';

interface QuantityStepperProps {
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  /** Blocks both controls while a change is settling. */
  busy?: boolean;
  /** Accessible name of the line, e.g. the product name. */
  itemLabel: string;
  labels: { increase: string; decrease: string; quantity: string };
}

export function QuantityStepper({
  quantity, onIncrement, onDecrement, busy = false, itemLabel, labels,
}: QuantityStepperProps) {
  const styles = useStyles();
  // At 1, minus means "remove this item" — the caller confirms before removing.
  const decrementLabel = `${labels.decrease}, ${itemLabel}`;
  const incrementLabel = `${labels.increase}, ${itemLabel}`;

  return (
    <View style={styles.wrap} accessibilityRole="adjustable" accessibilityLabel={`${labels.quantity}, ${itemLabel}`} accessibilityValue={{ now: quantity, min: 0 }}>
      <Pressable
        onPress={busy ? undefined : onDecrement}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={decrementLabel}
        // 44x44 minimum target even though the visual control is smaller.
        hitSlop={10}
        style={({ pressed }) => [styles.btn, pressed && !busy && styles.btnPressed, busy && styles.btnDisabled]}
      >
        <View style={styles.minusBar} />
      </Pressable>

      <Text style={styles.qty} accessibilityElementsHidden importantForAccessibility="no">
        {quantity}
      </Text>

      <Pressable
        onPress={busy ? undefined : onIncrement}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={incrementLabel}
        hitSlop={10}
        style={({ pressed }) => [styles.btn, pressed && !busy && styles.btnPressed, busy && styles.btnDisabled]}
      >
        <View style={styles.minusBar} />
        <View style={styles.plusBar} />
      </Pressable>
    </View>
  );
}

const BTN = 32;

const useStyles = makeStyles((colors) => ({
  // Row direction is intentionally fixed: −  n  + reads the same in Arabic, the
  // way a calculator or a lift panel does, so RTL must not mirror it.
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.bg, borderRadius: radius.pill, padding: 3,
  },
  btn: {
    width: BTN, height: BTN, borderRadius: BTN / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  btnPressed: { backgroundColor: colors.purpleBg, borderColor: colors.accent },
  btnDisabled: { opacity: 0.45 },
  minusBar: { width: 12, height: 2, borderRadius: 1, backgroundColor: colors.accent },
  plusBar: { position: 'absolute', width: 2, height: 12, borderRadius: 1, backgroundColor: colors.accent },
  qty: {
    minWidth: 24, textAlign: 'center',
    fontSize: font.md, fontWeight: '800', color: colors.text,
    fontVariant: ['tabular-nums'],
  },
}));
