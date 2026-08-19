/**
 * OTP entry — ONE real input, six presentation boxes.
 *
 * WHY NOT SIX INPUTS (iOS 26 regression): iOS hands an autofilled one-time code
 * to a SINGLE field. Against a row of six separate TextInputs the system pastes
 * the whole code into one of them and the change events fire unreliably, so the
 * keyboard suggestion either never appears or fills nothing. The fix is a single
 * controlled TextInput that owns the entire code, with the boxes reduced to
 * presentation Views.
 *
 * The input MUST stay mounted, laid out and focusable — iOS skips fields it
 * considers non-visible, so `display:none`, zero width/height and off-screen
 * positioning all defeat autofill. It is therefore rendered at `opacity: 0`
 * stretched over the box row, which keeps it a real, hit-testable, system-
 * visible field while the boxes below provide the visuals.
 *
 * Memoized: the OTP screens re-render once per second while the resend
 * countdown runs, and the iOS 26 bug involves the field losing focused state on
 * re-render. With stable callbacks from the caller this subtree re-renders only
 * when the code itself changes.
 */
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text as RNText, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontFamily, radius, space, type as typeScale } from '../../design-system/generated/tokens';
import { makeStyles } from '../../theme/makeStyles';
import { normalizeCode, splitCodeToBoxes } from './otpAutofill';

/**
 * iOS 26 drops the field's focused state across re-renders that land in the
 * same tick as mount, which is exactly when `autoFocus` fires. Focusing on a
 * short delay instead lets the screen settle first.
 */
const FOCUS_DELAY_MS = 300;

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

function OtpCodeInputImpl({
  value,
  onChange,
  length = 6,
  editable = true,
  autoFocus = false,
  onComplete,
  accessibilityLabel,
  style,
}: Props) {
  const styles = useStyles();
  const input = useRef<TextInput | null>(null);
  const [focused, setFocused] = useState(false);
  const boxes = useMemo(() => splitCodeToBoxes(value, length), [value, length]);

  // Latest callbacks without re-subscribing anything below.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!autoFocus || !editable) return;
    const timer = setTimeout(() => input.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoFocus, editable]);

  // Autofill delivers ALL SIX characters in a single call — this must therefore
  // never assume one keystroke. normalizeCode folds Arabic-Indic digits (the app
  // is Arabic-first) and caps the length.
  const handleChange = (text: string) => {
    const code = normalizeCode(text, length);
    onChange(code);
    if (code.length === length) onCompleteRef.current?.(code);
  };

  // The next box to be filled, so the caret has a visible analogue.
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <Pressable
      onPress={() => input.current?.focus()}
      accessible={false}
      style={[styles.wrap, style]}
    >
      {/* Presentation only — the real field is the transparent input above it. */}
      <View style={styles.row} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        {boxes.map((digit, index) => (
          <View
            key={index}
            style={[
              styles.box,
              digit ? styles.boxFilled : null,
              focused && editable && index === activeIndex && !digit ? styles.boxActive : null,
              !editable ? styles.boxMuted : null,
            ]}
          >
            <RNText style={styles.digit}>{digit}</RNText>
          </View>
        ))}
      </View>

      <TextInput
        ref={input}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={editable}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={length}
        // iOS autofill contract.
        textContentType="oneTimeCode"
        // 'one-time-code' is the cross-platform value in RN 0.86, but Android's
        // documented OTP hint is 'sms-otp' and that is what shipped before this
        // change — keep Android byte-identical rather than assume the native
        // hint mapping is the same.
        //
        // `default` matters: Platform.select with only ios/android keys returns
        // undefined on web, which would emit NO autocomplete attribute at all.
        // 'one-time-code' is the value the HTML spec actually defines, so web
        // gets the standard token rather than Android's native hint.
        autoComplete={Platform.select({
          ios: 'one-time-code', android: 'sms-otp', default: 'one-time-code',
        })}
        importantForAutofill="yes"
        autoCorrect={false}
        caretHidden
        contextMenuHidden={false}
        accessibilityLabel={accessibilityLabel}
        // Transparent, but a REAL laid-out field: never display:none, never
        // zero-sized, never off-screen, or iOS stops offering the code.
        style={styles.field}
      />
    </Pressable>
  );
}

/** Stable across the resend countdown's 1 Hz re-render (see file header). */
export const OtpCodeInput = memo(OtpCodeInputImpl);

const useStyles = makeStyles((color) => ({
  wrap: { position: 'relative' as const },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: space.s2,
    // A verification code reads left-to-right in EVERY locale: digit 1 stays on
    // the far left in Arabic. The app never calls I18nManager.forceRTL, so a
    // plain 'row' does not mirror — this must never become `rtlRow` or
    // 'row-reverse'.
    writingDirection: 'ltr' as const,
  },
  box: {
    width: 44,
    height: 54,
    borderWidth: 1.5,
    borderColor: color.appLine,
    borderRadius: radius.md,
    borderCurve: 'continuous' as const,
    backgroundColor: color.appSurface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  boxFilled: { borderColor: color.ember, backgroundColor: color.appSurface2 },
  boxActive: { borderColor: color.ember },
  boxMuted: { backgroundColor: color.disabledBg },
  digit: {
    fontSize: typeScale.title.size,
    lineHeight: typeScale.title.lineHeight,
    fontFamily: fontFamily.num.semibold,
    color: color.appText,
    textAlign: 'center' as const,
  },
  field: {
    // Explicit box rather than a spread helper: the field must be a REAL,
    // full-size, laid-out element for iOS to offer the code into it.
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    // Kept legible to the system even though it is invisible to the eye.
    fontSize: typeScale.title.size,
    color: color.appText,
    textAlign: 'center' as const,
  },
}));
