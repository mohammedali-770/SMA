/** Multi-box OTP entry and native autofill surface. */
import React, { useMemo, useRef } from 'react';
import {
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from 'react-native';

import { fontFamily, radius, space, type as typeScale } from '../../design-system/generated/tokens';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';
import { applyBackspace, applyBoxInput, joinBoxes, splitCodeToBoxes } from './otpAutofill';

interface Props {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  editable?: boolean;
  autoFocus?: boolean;
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
    if (boxes[index]) return;
    const { boxes: next, focusIndex } = applyBackspace(boxes, index);
    commit(next, focusIndex);
  };

  return (
    <View style={[styles.row, style]} accessibilityLabel={accessibilityLabel}>
      {boxes.map((digit, index) => (
        <TextInput
          key={index}
          ref={(el) => { inputs.current[index] = el; }}
          value={digit}
          onChangeText={(text) => handleChange(index, text)}
          onKeyPress={(e) => handleKeyPress(index, e)}
          editable={editable}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={length}
          autoFocus={autoFocus && index === 0}
          textContentType={index === 0 ? 'oneTimeCode' : 'none'}
          autoComplete={index === 0 ? 'sms-otp' : 'off'}
          selectTextOnFocus
          accessibilityLabel={`${accessibilityLabel ?? 'One-time code'} ${index + 1}`}
          style={[styles.box, digit ? styles.boxFilled : null, !editable ? styles.boxMuted : null]}
          placeholderTextColor={colors.appText3}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: space.s2,
    writingDirection: 'ltr' as const,
  },
  box: {
    width: 44,
    height: 54,
    borderWidth: 1.5,
    borderColor: color.appLine,
    borderRadius: radius.md,
    backgroundColor: color.appSurface,
    textAlign: 'center' as const,
    fontSize: typeScale.title.size,
    fontFamily: fontFamily.num.semibold,
    color: color.appText,
    writingDirection: 'ltr' as const,
  },
  boxFilled: { borderColor: color.ember, backgroundColor: color.appSurface2 },
  boxMuted: { backgroundColor: color.disabledBg, color: color.disabledFg },
}));
