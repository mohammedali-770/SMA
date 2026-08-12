/** Design-system Field (mobile): label + control + at most ONE line underneath. */
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
import { fontFamily, hitTarget, radius, space, type } from '../generated/tokens';
import { useI18n } from '../../i18n/I18nProvider';
import { useThemeColors } from '../../theme/ThemeProvider';

interface Props extends Omit<TextInputProps, 'style' | 'editable'> {
  id: string;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  hint?: string;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  labelHidden?: boolean;
  numeric?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
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
  const color = useThemeColors();
  const [focused, setFocused] = useState(false);
  const state = resolveFieldState({ id, hint, error, focused, disabled, required });

  const textFamily = lang === 'ar' ? fontFamily.ar.regular : fontFamily.en.regular;
  const labelFamily = lang === 'ar' ? fontFamily.ar.semibold : fontFamily.en.semibold;
  const valueFamily = numeric ? fontFamily.num.regular : textFamily;
  const borderColor = state.tone === 'error' ? color.danger : state.tone === 'focus' ? color.ember : color.appLine;

  return (
    <View style={[styles.container, containerStyle]}>
      {labelHidden ? null : (
        <Text nativeID={state.labelId} style={[styles.label, rtlText, { fontFamily: labelFamily, color: color.appText2 }]}>
          {label}
          {required ? <Text style={{ color: color.danger }}> *</Text> : null}
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
        accessibilityLabelledBy={labelHidden ? undefined : state.labelId}
        accessibilityState={{ disabled: state.disabled }}
        accessibilityValue={state.messageIsError ? { text: state.message ?? undefined } : undefined}
        placeholderTextColor={color.appText3}
        style={[
          styles.input,
          {
            borderColor,
            fontFamily: valueFamily,
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
  label: { fontSize: type.label.size, lineHeight: type.label.lineHeight },
  input: {
    minHeight: hitTarget + 4,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.s4,
    fontSize: type.body.size,
  },
  message: { fontSize: type.caption.size, lineHeight: type.caption.lineHeight },
});
