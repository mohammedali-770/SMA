/**
 * Primary / secondary / ghost button with a loading + disabled state.
 *
 * LEGACY VISUALS, SHARED BEHAVIOUR. This still renders the current purple
 * treatment and still backs almost every shipped screen — the "Ember on Cream"
 * replacement lives in `design-system/ui/Button`, and call sites move over
 * gradually (see docs/BUTTON_FIELD_INVENTORY.md).
 *
 * What changed here: the disabled / loading / accessibility RULES now come from
 * the shared framework-free `buttonState` module rather than being restated, so
 * the legacy and design-system buttons cannot disagree about what "disabled"
 * means. Critically, `onPress` is now GUARDED instead of being handed straight
 * to Pressable — previously nothing stopped a caller (or a Pressable edge case)
 * invoking the handler while the button was mid-flight, and on the
 * payment-retry and place-order call sites that is a double submit.
 *
 * Every pixel is unchanged: the background still greys for BOTH disabled and
 * loading, exactly as before.
 */
import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { resolveButtonState, shouldInvokePress, type ButtonVariant } from '../design-system/generated/buttonState';
import { colors, motion, radius, spacing, typography } from '../theme';

type Variant = ButtonVariant;

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function Button({ label, onPress, variant = 'primary', disabled, loading, style, accessibilityLabel }: Props) {
  const state = resolveButtonState({ variant, disabled, loading });
  // Same value as the previous `disabled || loading`, now derived in one place.
  const isDisabled = state.inert;
  // Guard the handler as well as setting Pressable's `disabled`: the prop alone
  // does not protect against a programmatic or direct call.
  // Depend on `state.inert`, not `state`: resolveButtonState returns a fresh
  // object every render, so a `[state, ...]` dependency never memoises anything
  // and quietly implies a stability it does not provide. `shouldInvokePress`
  // reads only `inert`, so the captured state stays consistent with the dep.
  const handlePress = useCallback(() => {
    if (shouldInvokePress(state)) onPress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.inert, onPress]);
  const bg =
    variant === 'primary' ? colors.purple
    : variant === 'danger' ? colors.red
    : variant === 'secondary' ? colors.white
    : 'transparent';
  const fg =
    variant === 'secondary' ? colors.purple
    : variant === 'ghost' ? colors.purple
    : colors.white;
  const borderColor = variant === 'secondary' ? colors.purple : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: state.accessibility.disabled, busy: state.accessibility.busy }}
      onPress={handlePress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: isDisabled ? colors.disabled : bg, borderColor },
        variant === 'secondary' && styles.bordered,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading && <ActivityIndicator size="small" color={fg} style={{ marginEnd: spacing.sm }} />}
        <Text style={[styles.label, { color: isDisabled && variant !== 'primary' ? colors.muted : fg }]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 0,
  },
  bordered: { borderWidth: 1.5 },
  pressed: { opacity: motion.pressedOpacity, transform: [{ scale: motion.pressedScale }] },
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { ...typography.button },
});
