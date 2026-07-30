/**
 * The money column.
 *
 * Every number here is a PREVIEW — `place_order` recomputes all of it
 * server-side and is the only authority, which is why the footnote is part of
 * the card rather than an optional nicety.
 *
 * VAT is a NOTE, not an amount: prices are VAT-inclusive, so there is no line
 * to add. It renders as a label with no figure, exactly as before — the label
 * string itself carries "(15%, included)".
 *
 * Discount rows are mint and carry an explicit minus, so a reduction can never
 * be misread as a charge.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Price } from '../../../components/Price';
import { color, radius, space, type as typeScale } from '../../../design-system/generated/tokens';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import type { PreviewTotals } from '../previewTotals';

export function TotalsCard({
  totals,
  isDelivery,
  labels,
  serverNote,
}: {
  totals: PreviewTotals;
  isDelivery: boolean;
  labels: {
    subtotal: string; deliveryFee: string; discount: string;
    loyaltyDiscount: string; vat: string; total: string;
  };
  serverNote: string;
}) {
  // testID so the money column can be targeted directly — by the dev visual
  // review today, and by an end-to-end assertion later.
  return (
    <View style={styles.card} testID="checkout-totals">
      <MoneyRow label={labels.subtotal} amount={totals.subtotal} />
      {isDelivery ? <MoneyRow label={labels.deliveryFee} amount={totals.deliveryFee} /> : null}
      {totals.couponDiscount > 0 ? (
        <MoneyRow label={labels.discount} amount={totals.couponDiscount} negative />
      ) : null}
      {totals.loyaltyDiscount > 0 ? (
        <MoneyRow label={labels.loyaltyDiscount} amount={totals.loyaltyDiscount} negative />
      ) : null}
      {/* Label only — VAT is included in the prices above, so there is nothing
          to add. Rendering a 0.00 here would state the opposite. */}
      <NoteRow label={labels.vat} />
      <View style={styles.divider} />
      <MoneyRow label={labels.total} amount={totals.total} big />
      <Text variant="caption" tone="tertiary" style={{ marginTop: space.s1 }}>{serverNote}</Text>
    </View>
  );
}

function MoneyRow({
  label, amount, negative, big,
}: { label: string; amount: number; negative?: boolean; big?: boolean }) {
  const { rtlRow } = useI18n();
  return (
    <View style={[styles.row, rtlRow]}>
      <Text variant={big ? 'heading' : 'body'} tone={big ? 'primary' : 'secondary'}>{label}</Text>
      <Price
        amount={amount}
        prefix={negative ? '−' : undefined}
        size={big ? typeScale.title.size : typeScale.body.size}
        color={negative ? color.mint : color.appText}
        weight={big ? '700' : '600'}
      />
    </View>
  );
}

function NoteRow({ label }: { label: string }) {
  const { rtlRow } = useI18n();
  return (
    <View style={[styles.row, rtlRow]}>
      <Text variant="caption" tone="tertiary">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.appSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.appLine,
    padding: space.s4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: space.s1, gap: space.s3,
  },
  divider: { height: 1, backgroundColor: color.appLine, marginVertical: space.s2 },
});
