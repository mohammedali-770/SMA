/**
 * Design-system Field (mobile): label + control + at most ONE line underneath.
 *
 * Voice rule ("Say less"): no instructional helper text explaining what to
 * type. `resolveFieldState` guarantees an error REPLACES the hint rather than
 * stacking two lines of prose under one input.
 *
 * Direction: the label and the message align to the reading edge via the
 * existing `rtlText` helper from I18nProvider, and the input itself sets
 * `writingDirection` so Arabic entry is not left-aligned. The app deliberately
 * does not call I18nManager.forceRTL — see I18nProvider.
 */
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { resolveFieldState } from '../generated/fieldState';
import { color, fontFamily, hitTarget, radius, space, type } from '../generated/tokens';
import { useI18n } from '../../i18n/I18nProvider';

interface Props extends Omit<TextInputProps, 'style' | 'editable'> {
  /** Stable id — also used to build the accessibility relationships. */
  id: string;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  hint?: string;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  /**
   * Hide the visible label when a section heading directly above already says
   * the same thing — printing it twice is noise. The label is still applied to
   * the input for assistive tech, so this changes what is SEEN, never what is
   * announced.
   */
  labelHidden?: boolean;
  /** Renders the value in the mono face: money, phone, OTP, short address. */
  numeric?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * Extra style for the input box itself. Applied AFTER the resolved state, so
   * it can set height/padding for a multiline field but cannot silently
   * override the error/focus/disabled colours those states depend on.
   */
  inputStyle?: StyleProp<TextStyle>;
}

export function Field({
  id,
  label,
  value,
  onChangeText,
  hint,
  error,
  required,
  disabled,
  labelHidden,
  numeric,
  containerStyle,
  inputStyle,
  ...inputProps
}: Props) {
  const { lang, isRTL, rtlText } = useI18n();
  const [focused, setFocused] = useState(false);
  const state = resolveFieldState({ id, hint, error, focused, disabled, required });

  const textFamily = lang === 'ar' ? fontFamily.ar.regular : fontFamily.en.regular;
  const labelFamily = lang === 'ar' ? fontFamily.ar.semibold : fontFamily.en.semibold;
  const valueFamily = numeric ? fontFamily.num.regular : textFamily;

  const borderColor =
    state.tone === 'error' ? color.danger : state.tone === 'focus' ? color.ember : color.appLine;

  return (
    <View style={[styles.container, containerStyle]}>
      {labelHidden ? null : (
        <Text
          nativeID={state.labelId}
          style={[styles.label, rtlText, { fontFamily: labelFamily }]}
        >
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      )}

      <TextInput
        {...inputProps}
        value={value}
        onChangeText={onChangeText}
        editable={!state.disabled}
        onFocus={(e) => {
          setFocused(true);
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          inputProps.onBlur?.(e);
        }}
        accessibilityLabel={label}
        // Only point at the label element when one is actually rendered — a
        // dangling nativeID reference is worse than no reference at all.
        accessibilityLabelledBy={labelHidden ? undefined : state.labelId}
        // RN maps this to the platform "invalid" trait; VoiceOver/TalkBack then
        // announce the field as erroneous instead of the user hearing nothing.
        accessibilityState={{ disabled: state.disabled }}
        accessibilityValue={state.messageIsError ? { text: state.message ?? undefined } : undefined}
        placeholderTextColor={color.appText3}
        style={[
          styles.input,
          {
            borderColor,
            fontFamily: valueFamily,
            // Numbers stay LTR even in Arabic; prose follows the language.
            writingDirection: numeric ? 'ltr' : isRTL ? 'rtl' : 'ltr',
            textAlign: numeric ? 'left' : isRTL ? 'right' : 'left',
            backgroundColor: state.disabled ? color.disabledBg : color.appSurface,
            color: state.disabled ? color.disabledFg : color.appText,
          },
          inputStyle,
        ]}
      />

      {state.message ? (
        <Text
          nativeID={state.describedById ?? undefined}
          accessibilityLiveRegion={state.accessibility.liveRegion}
          style={[
            styles.message,
            rtlText,
            { fontFamily: textFamily, color: state.messageIsError ? color.danger : color.appText3 },
          ]}
        >
          {state.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.s2 },
  label: { fontSize: type.label.size, lineHeight: type.label.lineHeight, color: color.appText2 },
  required: { color: color.danger },
  input: {
    minHeight: hitTarget + 4,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.s4,
    fontSize: type.body.size,
  },
  message: { fontSize: type.caption.size, lineHeight: type.caption.lineHeight },
});
