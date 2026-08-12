/**
 * Promo code entry.
 *
 * The result line is deliberately the field's own message rather than a
 * free-floating sentence: a rejected code is a validation error on the input
 * that caused it, so it belongs under that input, in the error colour, where
 * every other field error in the app lives. An accepted code is the opposite —
 * a confirmation with the amount saved — so it renders as a success line and
 * never as a Field error.
 *
 * The apply button stays live while a code is typed but empty-trimmed input is
 * refused by the caller, matching the original behaviour exactly.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Price } from '../../../components/Price';
import { color, space, type as typeScale } from '../../../design-system/generated/tokens';
import { Button } from '../../../design-system/ui/Button';
import { Field } from '../../../design-system/ui/Field';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { makeStyles } from '../../../theme/makeStyles';
import { useThemeColors } from '../../../theme/ThemeProvider';

export function CouponRow({
  code,
  onChangeCode,
  onApply,
  applying,
  label,
  placeholder,
  applyLabel,
  result,
  appliedLabel,
}: {
  code: string;
  onChangeCode: (v: string) => void;
  onApply: () => void;
  applying: boolean;
  label: string;
  placeholder: string;
  applyLabel: string;
  result: { ok: boolean; message: string; discount: number } | null;
  appliedLabel: string;
}) {
  const styles = useStyles();
  const colors = useThemeColors();
  const { rtlRow } = useI18n();
  const rejected = result && !result.ok ? result.message : null;

  return (
    <View style={{ gap: space.s2 }}>
      <View style={[styles.row, rtlRow]}>
        <Field
          id="checkout-coupon"
          label={label}
          value={code}
          onChangeText={onChangeCode}
          // The section heading directly above already says "Promo code".
          labelHidden
          placeholder={placeholder}
          autoCapitalize="characters"
          autoCorrect={false}
          containerStyle={styles.field}
        />
        <Button
          label={applyLabel}
          onPress={onApply}
          loading={applying}
          variant="secondary"
          size="md"
          style={styles.apply}
        />
      </View>

      {/* The rejection renders BELOW the row rather than inside the Field: the
          row is bottom-aligned, so a message growing inside the field would
          push the apply button down out of line with the input it applies to. */}
      {rejected ? (
        <Text variant="caption" style={{ color: colors.danger }}>{rejected}</Text>
      ) : null}

      {result?.ok ? (
        <View style={[styles.applied, rtlRow]}>
          <Text variant="label" style={{ color: colors.mint }}>{appliedLabel}</Text>
          <Price
            amount={result.discount}
            prefix="−"
            size={typeScale.label.size}
            color={colors.mint}
            weight="600"
          />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Bottom-aligned so the button sits level with the input, not the label.
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s2 },
  field: { flex: 1 },
  apply: { minWidth: 104, minHeight: 48 },
  applied: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
}));
