/** Design-system Button (mobile). */
import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  resolveButtonState,
  shouldInvokePress,
  type ButtonSize,
  type ButtonVariant,
} from '../generated/buttonState';
import { fontFamily, hitTarget, motion, radius, space, type } from '../generated/tokens';
import { useI18n } from '../../i18n/I18nProvider';
import { useThemeColors } from '../../theme/ThemeProvider';

interface Props {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  leading?: React.ReactNode;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant,
  size,
  disabled,
  loading,
  style,
  accessibilityLabel,
  leading,
  testID,
}: Props) {
  const { lang } = useI18n();
  const color = useThemeColors();
  const state = resolveButtonState({ variant, size, disabled, loading });
  const surface =
    state.variant === 'primary' ? { bg: color.ember, fg: color.onEmber, border: 'transparent' }
    : state.variant === 'secondary' ? { bg: color.appSurface, fg: color.ember, border: color.ember }
    : state.variant === 'ghost' ? { bg: 'transparent', fg: color.appText, border: 'transparent' }
    : { bg: color.danger, fg: color.onEmber, border: 'transparent' };

  const handlePress = useCallback(() => {
    if (shouldInvokePress(state)) onPress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.inert, onPress]);

  const bg = state.muted ? color.disabledBg : surface.bg;
  const fg = state.muted ? color.disabledFg : surface.fg;
  const family = lang === 'ar' ? fontFamily.ar.bold : fontFamily.en.bold;

  return (
    <Pressable
      testID={testID}
      accessibilityRole={state.accessibility.role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: state.accessibility.disabled, busy: state.accessibility.busy }}
      onPress={handlePress}
      disabled={state.inert}
      style={({ pressed }) => [
        styles.base,
        state.size === 'md' ? styles.md : styles.lg,
        { backgroundColor: bg, borderColor: state.muted ? color.disabledBg : surface.border },
        state.variant === 'secondary' && styles.bordered,
        pressed && state.allowPressFeedback && styles.pressed,
        style,
      ]}
    >
      <View style={styles.row}>
        {state.showSpinner ? <ActivityIndicator size="small" color={fg} style={styles.spinner} /> : leading}
        <Text style={[styles.label, { color: fg, fontFamily: family }]} numberOfLines={1}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s5,
    borderWidth: 0,
  },
  lg: { minHeight: 52 },
  md: { minHeight: hitTarget },
  bordered: { borderWidth: 1.5 },
  pressed: { opacity: motion.pressedOpacity, transform: [{ scale: motion.pressedScale }] },
  row: { flexDirection: 'row', alignItems: 'center' },
  spinner: { marginEnd: space.s2 },
  label: { fontSize: type.button.size, lineHeight: type.button.lineHeight },
});
