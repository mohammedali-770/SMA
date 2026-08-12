/** Compact quantity stepper (− value +). */
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { useI18n } from '../i18n/I18nProvider';
import { radius, type as typeScale } from '../design-system/generated/tokens';
import { makeStyles } from '../theme/makeStyles';

interface Props {
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
  min?: number;
  small?: boolean;
  busy?: boolean;
  itemLabel?: string;
}

export function QtyStepper({
  value, onIncrement, onDecrement, min = 1, small, busy = false, itemLabel,
}: Props) {
  const { t } = useI18n();
  const styles = useStyles();
  const size = small ? 30 : 38;
  const slop = Math.ceil((44 - size) / 2);
  const decDisabled = busy || value <= min;
  const withItem = (base: string) => (itemLabel ? `${base}, ${itemLabel}` : base);

  return (
    <View
      style={[styles.wrap, { height: size }, busy && styles.busy]}
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

const useStyles = makeStyles((color) => ({
  wrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: color.appSurface2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.appLine,
  },
  busy: { opacity: 0.55 },
  btn: { alignItems: 'center' as const, justifyContent: 'center' as const },
  pressed: { opacity: 0.6 },
  sign: { fontSize: typeScale.title.size, fontWeight: '700' as const, color: color.ember, lineHeight: typeScale.title.size + 2 },
  signDisabled: { color: color.disabledFg },
  value: { minWidth: 24, textAlign: 'center' as const, fontSize: typeScale.body.size, fontWeight: '700' as const, color: color.appText },
}));
