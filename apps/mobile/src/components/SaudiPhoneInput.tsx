/** Saudi mobile number field — fixed +966 prefix plus national part. */
import React, { useState } from 'react';
import { TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontFamily, hitTarget, radius, space, type as typeScale } from '../design-system/generated/tokens';
import { Text } from '../design-system/ui/Text';
import { useI18n } from '../i18n/I18nProvider';
import { KSA_DIAL_CODE, sanitizeSaudiNationalInput } from '../lib/phone';
import { makeStyles } from '../theme/makeStyles';
import { useThemeColors } from '../theme/ThemeProvider';

interface Props {
  value: string;
  onChangeText: (national: string) => void;
  editable?: boolean;
  autoFocus?: boolean;
  label?: string;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
}

export function SaudiPhoneInput({
  value, onChangeText, editable = true, autoFocus, label, error, style,
}: Props) {
  const { t } = useI18n();
  const color = useThemeColors();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  const fieldLabel = label ?? t('phoneNumberLabel');
  const borderColor = error ? color.danger : focused ? color.ember : color.appLine;

  return (
    <View style={[styles.wrap, style]}>
      <Text variant="label" tone="secondary">{fieldLabel}</Text>
      <View style={[styles.row, { borderColor, backgroundColor: editable ? color.appSurface : color.disabledBg }]}>
        <Text variant="body" tone={editable ? 'primary' : 'tertiary'} align="ltr-start" style={styles.dial}>
          {KSA_DIAL_CODE}
        </Text>
        <View style={styles.divider} />
        <TextInput
          value={value}
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
      {error ? <Text variant="caption" tone="danger">{error}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.s2 },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.s4,
    minHeight: hitTarget + 8,
  },
  dial: { fontFamily: fontFamily.num.semibold, writingDirection: 'ltr' as const },
  divider: {
    width: 1,
    alignSelf: 'stretch' as const,
    marginHorizontal: space.s3,
    marginVertical: space.s2,
    backgroundColor: color.appLine,
  },
  input: {
    flex: 1,
    paddingVertical: space.s3,
    fontSize: typeScale.body.size,
    fontFamily: fontFamily.num.regular,
    letterSpacing: 1,
    textAlign: 'left' as const,
    writingDirection: 'ltr' as const,
  },
}));
