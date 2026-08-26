/**
 * The money column.
 *
 * Every number here is a PREVIEW — `place_order` recomputes all of it
 * server-side and is the only authority, which is why the footnote is part of
 * the card rather than an optional nicety.
 *
 * VAT is a NOTE, not an amount: prices are VAT-inclusive, so there is no line
 * to add. It renders as a label with no figure, and the label carries the rate
 * — the CONFIGURED `brand.vatPercentage`, interpolated by the caller. It used
 * to hardcode 15%, which stated a false rate for any branch on another.
 *
 * The delivery-fee row shows 0.00 for an EMPTY cart rather than the branch fee.
 * That is decided upstream in `computePreviewTotals`, not hidden here: hiding
 * the row alone would have left the total unexplained.
 *
 * Discount rows are mint and carry an explicit minus, so a reduction can never
 * be misread as a charge.
 *
 * A COMPED customer (`public.comp_members`) gets one more row, and it is the
 * last one: the comp is applied after coupon and loyalty and covers the
 * delivery fee too, so the total lands on 0.00. `subtotal` still shows the real
 * value of the goods — the customer sees what the meal was worth as well as
 * what they owe.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Price } from '../../../components/Price';
import { color, radius, space, type as typeScale } from '../../../design-system/generated/tokens';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import type { PreviewTotals } from '../previewTotals';
import { makeStyles } from '../../../theme/makeStyles';
import { useThemeColors } from '../../../theme/ThemeProvider';

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
    loyaltyDiscount: string; compDiscount: string; compNote: string;
    vat: string; total: string;
  };
  serverNote: string;
}) {
  const styles = useStyles();
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
      {/* The comp is its own row, below coupon and loyalty, because it is the
          last thing applied and it swallows the delivery fee as well as the
          goods. It is deliberately NOT folded into the discount row: a comp is
          not a coupon, and the admin coupon report would be wrong if it were. */}
      {totals.compDiscount > 0 ? (
        <MoneyRow label={labels.compDiscount} amount={totals.compDiscount} negative />
      ) : null}
      {/* Label only — VAT is included in the prices above, so there is nothing
          to add. Rendering a 0.00 here would state the opposite. */}
      <NoteRow label={labels.vat} />
      <View style={styles.divider} />
      <MoneyRow label={labels.total} amount={totals.total} big />
      {totals.compDiscount > 0 ? (
        <Text variant="caption" tone="tertiary" style={{ marginTop: space.s1 }}>{labels.compNote}</Text>
      ) : null}
      <Text variant="caption" tone="tertiary" style={{ marginTop: space.s1 }}>{serverNote}</Text>
    </View>
  );
}

function MoneyRow({
  label, amount, negative, big,
}: { label: string; amount: number; negative?: boolean; big?: boolean }) {
  const styles = useStyles();
  const colors = useThemeColors();
  const { rtlRow } = useI18n();
  return (
    <View style={[styles.row, rtlRow]}>
      <Text variant={big ? 'heading' : 'body'} tone={big ? 'primary' : 'secondary'}>{label}</Text>
      <Price
        amount={amount}
        prefix={negative ? '−' : undefined}
        size={big ? typeScale.title.size : typeScale.body.size}
        color={negative ? colors.mint : colors.appText}
        weight={big ? '700' : '600'}
      />
    </View>
  );
}

function NoteRow({ label }: { label: string }) {
  const styles = useStyles();
  const { rtlRow } = useI18n();
  return (
    <View style={[styles.row, rtlRow]}>
      <Text variant="caption" tone="tertiary">{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.appSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.appLine,
    padding: space.s4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: space.s1, gap: space.s3,
  },
  divider: { height: 1, backgroundColor: colors.appLine, marginVertical: space.s2 },
}));
