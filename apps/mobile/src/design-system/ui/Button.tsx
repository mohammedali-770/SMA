/**
 * Design-system Button (mobile).
 *
 * NOT a replacement for `components/Button.tsx` yet — that one still backs
 * every shipped screen and keeps the current purple primary. This is the
 * "Ember on Cream" button: red is the only interactive colour. Screens migrate
 * in a follow-up PR; until then both exist on purpose.
 *
 * All behaviour (what counts as disabled, whether a press may fire, what
 * assistive tech is told) lives in the framework-free `buttonState` module so
 * it is unit-tested for both platforms at once.
 */
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
import { color, fontFamily, hitTarget, motion, radius, space, type } from '../generated/tokens';
import { useI18n } from '../../i18n/I18nProvider';

interface Props {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Rendered before the label (already mirrored by the row's writing order). */
  leading?: React.ReactNode;
  testID?: string;
}

const SURFACE: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: color.ember, fg: color.onEmber, border: 'transparent' },
  secondary: { bg: color.appSurface, fg: color.ember, border: color.ember },
  ghost: { bg: 'transparent', fg: color.appText, border: 'transparent' },
  danger: { bg: color.danger, fg: color.onEmber, border: 'transparent' },
};

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
  const state = resolveButtonState({ variant, size, disabled, loading });
  const surface = SURFACE[state.variant];

  // Guard the handler rather than trusting `disabled` alone: a Pressable whose
  // disabled prop is forgotten downstream would otherwise double-submit.
  const handlePress = useCallback(() => {
    if (shouldInvokePress(state)) onPress();
  }, [state, onPress]);

  const bg = state.muted ? color.disabledBg : surface.bg;
  const fg = state.muted ? color.disabledFg : surface.fg;
  const family = lang === 'ar' ? fontFamily.ar.bold : fontFamily.en.bold;

  return (
    <Pressable
      testID={testID}
      accessibilityRole={state.accessibility.role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{
        disabled: state.accessibility.disabled,
        busy: state.accessibility.busy,
      }}
      onPress={handlePress}
      disabled={state.inert}
      style={({ pressed }) => [
        styles.base,
        size === 'md' ? styles.md : styles.lg,
        { backgroundColor: bg, borderColor: state.muted ? color.disabledBg : surface.border },
        state.variant === 'secondary' && styles.bordered,
        pressed && state.allowPressFeedback && styles.pressed,
        style,
      ]}
    >
      <View style={styles.row}>
        {state.showSpinner ? (
          // marginEnd (not marginRight) so the gap mirrors in Arabic.
          <ActivityIndicator size="small" color={fg} style={styles.spinner} />
        ) : (
          leading
        )}
        <Text style={[styles.label, { color: fg, fontFamily: family }]} numberOfLines={1}>
          {label}
        </Text>
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
