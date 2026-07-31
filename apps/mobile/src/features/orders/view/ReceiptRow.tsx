/**
 * One labelled row on the receipt — either a value or a money amount.
 *
 * Mirrored in Arabic: the label sits on the reading edge and the value column
 * on the other side. `Price` itself is never mirrored — the riyal mark stays on
 * the left of the digits in both languages.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Price } from '../../../components/Price';
import { color, space, type as typeScale } from '../../../design-system/generated/tokens';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';

export function ReceiptRow({
  label, value, amount, negative, strong, big, muted,
}: {
  label: string;
  value?: string;
  amount?: number;
  negative?: boolean;
  strong?: boolean;
  big?: boolean;
  muted?: boolean;
}) {
  const { isRTL, rtlRow } = useI18n();
  return (
    <View style={[styles.row, rtlRow]}>
      <Text
        variant={muted ? 'caption' : 'body'}
        tone={muted ? 'tertiary' : 'secondary'}
        style={styles.label}
      >
        {label}
      </Text>
      <View style={[styles.valueCol, isRTL && styles.valueColRTL]}>
        {amount != null ? (
          <Price
            amount={amount}
            prefix={negative ? '−' : undefined}
            size={big ? typeScale.title.size : typeScale.body.size}
            color={negative ? color.mint : color.appText}
            weight={strong || big ? '700' : '600'}
          />
        ) : (
          <Text variant={big ? 'title' : strong ? 'heading' : 'body'}>{value}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: space.s3, paddingVertical: space.s1 + 2,
  },
  label: { flexShrink: 1 },
  valueCol: { alignItems: 'flex-end', flexShrink: 1 },
  valueColRTL: { alignItems: 'flex-start' },
});
