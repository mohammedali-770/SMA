/**
 * Compact quantity stepper (− value +).
 *
 * `busy` is structural duplicate-tap protection rather than a debounce: while a
 * change is settling both controls stop firing, so a fast double-tap cannot
 * enqueue two mutations against the same line. Checkout needs this because a
 * quantity edit there moves the whole money column; the cart screen does not
 * pass it. This component never computes a price — the cart store is the only
 * writer.
 *
 * `min` is the value at which decrement is refused. Cart passes the default 1.
 * Checkout passes 0, because there minus-at-one means "remove this item" and
 * the caller confirms it — a real action, so the control must stay live.
 */
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
  /** Blocks both controls while a change is settling. */
  busy?: boolean;
  /** Accessible name of the line, e.g. the product name. Appended to each label. */
  itemLabel?: string;
}

export function QtyStepper({
  value, onIncrement, onDecrement, min = 1, small, busy = false, itemLabel,
}: Props) {
  const { t } = useI18n();
  const size = small ? 30 : 38;
  // Keep the compact visuals but guarantee a ≥44pt effective touch target.
  const slop = Math.ceil((44 - size) / 2);
  const decDisabled = busy || value <= min;
  const withItem = (base: string) => (itemLabel ? `${base}, ${itemLabel}` : base);

  return (
    <View
      style={[styles.wrap, { height: size }, busy && styles.busy]}
      // Announce the whole control as one adjustable value rather than letting
      // a screen reader read "minus, 2, plus" as three unrelated things.
      accessibilityRole={itemLabel ? 'adjustable' : undefined}
      accessibilityLabel={itemLabel ? `${t('quantity')}, ${itemLabel}` : undefined}
      accessibilityValue={itemLabel ? { now: value, min } : undefined}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={withItem(t('decreaseQty'))}
        accessibilityState={{ disabled: decDisabled }}
        onPress={onDecrement}
        disabled={decDisabled}
        hitSlop={slop}
        style={({ pressed }) => [styles.btn, { width: size, height: size }, pressed && styles.pressed]}
      >
        <Text style={[styles.sign, decDisabled && styles.signDisabled]}>−</Text>
      </Pressable>
      <Text
        style={styles.value}
        accessibilityElementsHidden={Boolean(itemLabel)}
        importantForAccessibility={itemLabel ? 'no' : 'auto'}
      >
        {value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={withItem(t('increaseQty'))}
        accessibilityState={{ disabled: busy }}
        onPress={onIncrement}
        disabled={busy}
        hitSlop={slop}
        style={({ pressed }) => [styles.btn, { width: size, height: size }, pressed && styles.pressed]}
      >
        <Text style={[styles.sign, busy && styles.signDisabled]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Row direction is intentionally fixed: −  n  + reads the same in Arabic, the
  // way a calculator or a lift panel does, so RTL must not mirror it.
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.appSurface2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.appLine,
  },
  busy: { opacity: 0.55 },
  btn: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  sign: { fontSize: typeScale.title.size, fontWeight: '700', color: color.ember, lineHeight: typeScale.title.size + 2 },
  // `disabledFg`, NOT `disabledBg` — a background token used as a foreground
  // made the disabled minus invisible against the stepper's own surface. A
  // disabled control still has to be readable; only its colour changes.
  signDisabled: { color: color.disabledFg },
  value: { minWidth: 24, textAlign: 'center', fontSize: typeScale.body.size, fontWeight: '700', color: color.appText },
});
