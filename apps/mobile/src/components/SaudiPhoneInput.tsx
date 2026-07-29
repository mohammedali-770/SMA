/**
 * Saudi mobile number field — a fixed `+966` prefix plus the 9-digit national
 * part. The country code is not editable: the app is Saudi-only, so there is no
 * country to pick and no way to type a foreign number by accident.
 *
 * Whatever the customer types or pastes — `05…`, `5…`, `966…`, `00966…`,
 * `+966…`, spaced, dashed, or in Arabic-Indic digits — is folded to a clean
 * `5XXXXXXXX` by `sanitizeSaudiNationalInput`, so every Saudi pattern works
 * without the customer having to reformat anything.
 */
import React from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { useI18n } from '../i18n/I18nProvider';
import { KSA_DIAL_CODE, sanitizeSaudiNationalInput } from '../lib/phone';
import { colors, font, radius, spacing } from '../theme';
import { useThemeColors } from '../theme/ThemeProvider';
import { makeStyles } from '../theme/makeStyles';

interface Props {
  /** The national part only (`5XXXXXXXX`) — never the country code. */
  value: string;
  onChangeText: (national: string) => void;
  editable?: boolean;
  autoFocus?: boolean;
  /** Field label; defaults to the shared "Mobile number" string. */
  label?: string;
  /** Set false to hide the "Saudi numbers only" helper line. */
  showHint?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function SaudiPhoneInput({
  value, onChangeText, editable = true, autoFocus, label, showHint = true, style,
}: Props) {
  const colors = useThemeColors();
  const styles = useStyles();
  const { t, rtlText } = useI18n();
  const fieldLabel = label ?? t('phoneNumberLabel');

  return (
    <View style={style}>
      <Text style={[styles.label, rtlText]}>{fieldLabel}</Text>

      {/* Deliberately NOT mirrored in Arabic: a phone number reads
          left-to-right, country code first, in both languages. */}
      <View style={[styles.row, !editable && styles.rowMuted]}>
        <Text style={[styles.dial, !editable && styles.textMuted]}>{KSA_DIAL_CODE}</Text>
        <View style={styles.divider} />
        <TextInput
          value={value}
          // No maxLength: the sanitizer caps the value at 9 digits *after*
          // absorbing a pasted country code, which a maxLength would truncate.
          onChangeText={(v) => onChangeText(sanitizeSaudiNationalInput(v))}
          editable={editable}
          keyboardType="phone-pad"
          inputMode="tel"
          autoComplete="tel"
          textContentType="telephoneNumber"
          autoFocus={autoFocus}
          placeholder="5XXXXXXXX"
          placeholderTextColor={colors.muted}
          accessibilityLabel={fieldLabel}
          style={[styles.input, !editable && styles.textMuted]}
        />
      </View>

      {showHint ? <Text style={[styles.hint, rtlText]}>{t('saudiNumbersOnly')}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  label: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    paddingHorizontal: spacing.lg,
  },
  rowMuted: { backgroundColor: colors.bg },
  dial: { fontSize: font.md, fontWeight: '800', color: colors.text, writingDirection: 'ltr' },
  divider: {
    width: 1,
    alignSelf: 'stretch',
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.border,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: font.md,
    letterSpacing: 1,
    color: colors.text,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  textMuted: { color: colors.muted },
  hint: { fontSize: font.xs, color: colors.muted, marginTop: spacing.xs },
}));
