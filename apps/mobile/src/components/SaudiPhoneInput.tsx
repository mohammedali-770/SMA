/**
 * Saudi mobile number field — a fixed `+966` prefix plus the 9-digit national
 * part. The country code is not editable: the app is Saudi-only, so there is no
 * country to pick and no way to type a foreign number by accident.
 *
 * Whatever the customer types or pastes — `05…`, `5…`, `966…`, `00966…`,
 * `+966…`, spaced, dashed, or in Arabic-Indic digits — is folded to a clean
 * `5XXXXXXXX` by `sanitizeSaudiNationalInput`, so every Saudi pattern works
 * without the customer having to reformat anything.
 *
 * Presentation is the design system: cream ground, IBM Plex, mono digits
 * (structured numbers are always mono), ember focus edge. The sanitiser and the
 * keyboard/autofill wiring are untouched — this is a re-skin, not a rewrite.
 */
import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, fontFamily, hitTarget, radius, space, type as typeScale } from '../design-system/generated/tokens';
import { Text } from '../design-system/ui/Text';
import { useI18n } from '../i18n/I18nProvider';
import { KSA_DIAL_CODE, sanitizeSaudiNationalInput } from '../lib/phone';

interface Props {
  /** The national part only (`5XXXXXXXX`) — never the country code. */
  value: string;
  onChangeText: (national: string) => void;
  editable?: boolean;
  autoFocus?: boolean;
  /** Field label; defaults to the shared "Mobile number" string. */
  label?: string;
  /** Inline error. Keep it three to five words. */
  error?: string | null;
  style?: StyleProp<ViewStyle>;
}

export function SaudiPhoneInput({
  value, onChangeText, editable = true, autoFocus, label, error, style,
}: Props) {
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  const fieldLabel = label ?? t('phoneNumberLabel');

  const borderColor = error ? color.danger : focused ? color.ember : color.appLine;

  return (
    <View style={[styles.wrap, style]}>
      <Text variant="label" tone="secondary">{fieldLabel}</Text>

      {/* Deliberately NOT mirrored in Arabic: a phone number reads
          left-to-right, country code first, in both languages. */}
      <View
        style={[
          styles.row,
          { borderColor, backgroundColor: editable ? color.appSurface : color.disabledBg },
        ]}
      >
        <Text
          variant="body"
          tone={editable ? 'primary' : 'tertiary'}
          align="ltr-start"
          style={styles.dial}
        >
          {KSA_DIAL_CODE}
        </Text>
        <View style={styles.divider} />
        <TextInput
          value={value}
          // No maxLength: the sanitizer caps the value at 9 digits *after*
          // absorbing a pasted country code, which a maxLength would truncate.
          onChangeText={(v) => onChangeText(sanitizeSaudiNationalInput(v))}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="phone-pad"
          inputMode="tel"
          autoComplete="tel"
          textContentType="telephoneNumber"
          autoFocus={autoFocus}
          placeholder="5XXXXXXXX"
          placeholderTextColor={color.appText3}
          accessibilityLabel={fieldLabel}
          style={[styles.input, { color: editable ? color.appText : color.disabledFg }]}
        />
      </View>

      {/* No "Saudi numbers only" helper line any more. The +966 prefix and the
          phone keypad already say it, and the design system's voice rule is
          that a field never explains the format in advance — only when the
          input is actually wrong. */}
      {error ? <Text variant="caption" tone="danger">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.s4,
    minHeight: hitTarget + 8,
  },
  dial: { fontFamily: fontFamily.num.semibold, writingDirection: 'ltr' },
  divider: {
    width: 1,
    alignSelf: 'stretch',
    marginHorizontal: space.s3,
    marginVertical: space.s2,
    backgroundColor: color.appLine,
  },
  input: {
    flex: 1,
    paddingVertical: space.s3,
    fontSize: typeScale.body.size,
    // Structured numbers are always mono in this system.
    fontFamily: fontFamily.num.regular,
    letterSpacing: 1,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
});
