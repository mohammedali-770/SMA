/**
 * Multi-box OTP entry — the robust MANUAL fallback that works when autofill is
 * unavailable, and the surface autofill fills when it is.
 *
 * Behavior (logic lives in the pure otpAutofill.ts, so it is unit-tested):
 *   - one box per digit; typing a digit auto-advances to the next box;
 *   - Backspace clears the current box, or steps back and clears the previous
 *     one when the current box is already empty;
 *   - pasting or autofilling the whole code into any box distributes the digits
 *     across the remaining boxes;
 *   - `onComplete` fires once every box is filled (the screens use it to verify).
 *
 * Direction: the digit row is intentionally NOT mirrored in Arabic. Exactly like
 * SaudiPhoneInput, a numeric code reads left-to-right (box 1 is the first digit)
 * in both languages; only the label above follows the reading edge (rtlText).
 *
 * Autofill hooks (declarative, native): box 0 carries textContentType
 * "oneTimeCode" (iOS QuickType) and autoComplete "sms-otp" (Android). The web
 * WebOTP path is driven separately by useOtpAutofill, which feeds the code in
 * via `value`.
 */
import React, { useMemo, useRef } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from 'react-native';

import { colors, font, radius, spacing } from '../../theme';
import { useThemeColors } from '../../theme/ThemeProvider';
import { makeStyles } from '../../theme/makeStyles';
import { applyBackspace, applyBoxInput, joinBoxes, splitCodeToBoxes } from './otpAutofill';

interface Props {
  /** The joined code; the parent owns this state (single source of truth). */
  value: string;
  onChange: (code: string) => void;
  length?: number;
  editable?: boolean;
  autoFocus?: boolean;
  /** Fired once all `length` boxes are filled. */
  onComplete?: (code: string) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function OtpCodeInput({
  value,
  onChange,
  length = 6,
  editable = true,
  autoFocus = false,
  onComplete,
  accessibilityLabel,
  style,
}: Props) {
  const colors = useThemeColors();
  const styles = useStyles();
  const inputs = useRef<Array<TextInput | null>>([]);
  const boxes = useMemo(() => splitCodeToBoxes(value, length), [value, length]);

  const focus = (index: number) => {
    const clamped = Math.max(0, Math.min(index, length - 1));
    inputs.current[clamped]?.focus();
  };

  const commit = (nextBoxes: string[], focusIndex: number) => {
    const code = joinBoxes(nextBoxes);
    onChange(code);
    focus(focusIndex);
    if (code.length === length && onComplete) onComplete(code);
  };

  const handleChange = (index: number, text: string) => {
    const { boxes: next, focusIndex } = applyBoxInput(boxes, index, text, length);
    commit(next, focusIndex);
  };

  const handleKeyPress = (index: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key !== 'Backspace') return;
    // Only special-case an already-empty box; RN clears a filled box itself,
    // which flows through handleChange with an empty string.
    if (boxes[index]) return;
    const { boxes: next, focusIndex } = applyBackspace(boxes, index);
    commit(next, focusIndex);
  };

  return (
    <View style={[styles.row, style]} accessibilityLabel={accessibilityLabel}>
      {boxes.map((digit, index) => (
        <TextInput
          key={index}
          ref={(el) => {
            inputs.current[index] = el;
          }}
          value={digit}
          onChangeText={(text) => handleChange(index, text)}
          onKeyPress={(e) => handleKeyPress(index, e)}
          editable={editable}
          keyboardType="number-pad"
          inputMode="numeric"
          // maxLength = length (not 1) so a pasted/autofilled full code is
          // captured on the first box instead of being truncated to one digit.
          maxLength={length}
          autoFocus={autoFocus && index === 0}
          // Declarative OTP autofill lands on the first box, then distributes.
          textContentType={index === 0 ? 'oneTimeCode' : 'none'}
          autoComplete={index === 0 ? 'sms-otp' : 'off'}
          selectTextOnFocus
          accessibilityLabel={`${accessibilityLabel ?? 'One-time code'} ${index + 1}`}
          style={[styles.box, digit ? styles.boxFilled : null, !editable ? styles.boxMuted : null]}
          placeholderTextColor={colors.muted}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Never mirrored: the code always reads left-to-right in both languages.
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    writingDirection: 'ltr',
  },
  box: {
    width: 44,
    height: 54,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    textAlign: 'center',
    fontSize: font.xl,
    fontWeight: '800',
    color: colors.text,
    writingDirection: 'ltr',
  },
  boxFilled: {
    borderColor: colors.purple,
    backgroundColor: colors.surface,
  },
  boxMuted: {
    backgroundColor: colors.bg,
    color: colors.muted,
  },
}));
