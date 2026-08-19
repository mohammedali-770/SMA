/**
 * The receipt below the hero: order metadata, the payment note, and the
 * itemised summary. PRESENTATION ONLY — it receives an `Order` and renders it.
 *
 * Two rules survive from the original and are load-bearing:
 *
 * 1. ONLY the branch's own order number is ever shown, and only once the branch
 *    has issued one. The internal SM-… number identifies a database row, not an
 *    order the restaurant has accepted, so it is never rendered.
 * 2. The receipt is the detailed order record: every selected modifier stays
 *    visible in full — no line cap, no ellipsis.
 *
 * The payment note is a WARNING, never an error. "Have the cash ready" is not a
 * problem with the order.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AwardIcon } from '../../../components/Icons';
import { Price } from '../../../components/Price';
import { color, radius, space, type as typeScale } from '../../../design-system/generated/tokens';
import { Notice } from '../../../design-system/ui/Notice';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { orderDisplayNumber } from '../../../lib/mappers';
import { paymentDisplayState, paymentMethodLabel } from '../../../lib/payment';
import { formatRiyadhDateTime } from '../../../utils/format';
import { ReceiptRow } from './ReceiptRow';
import type { Order } from '../../../types/models';
import { makeStyles } from '../../../theme/makeStyles';
import { useThemeColors } from '../../../theme/ThemeProvider';

export function ReceiptBody({ order }: { order: Order }) {
  const styles = useStyles();
  const colors = useThemeColors();
  const { t, pick, rtlRow } = useI18n();

  const methodKey = paymentMethodLabel(order.paymentMethod, order.orderType);
  const methodText =
    methodKey === 'online' ? t('payOnline')
    : methodKey === 'cash_delivery' ? t('cashOnDelivery')
    : methodKey === 'cash_pickup' ? t('cashOnPickup')
    : methodKey === 'cash' ? pick('Cash Payment', 'دفع نقدي')
    : pick('Payment method not set', 'لم تُحدَّد طريقة الدفع');

  const payState = paymentDisplayState(order);
  const statusText =
    payState === 'paid' ? t('paymentPaid')
    : payState === 'pending_online' ? pick('Pending online payment', 'بانتظار الدفع الإلكتروني')
    : payState === 'cash_required' ? pick('Pay cash on receipt', 'يُدفع نقداً عند الاستلام')
    : t('paymentPending');

  const note =
    payState === 'cash_required' ? pick('Please have the cash amount ready on receipt.', 'يُرجى تجهيز المبلغ نقداً عند الاستلام.')
    : payState === 'pending_online' ? pick('Online payment has not been completed.', 'لم يكتمل الدفع الإلكتروني بعد.')
    : payState === 'unpaid' ? t('notPaidYet')
    : null;

  return (
    <View style={{ gap: space.s4 }}>
      <View style={styles.card}>
        {/* The branch number now leads the screen in ConfirmationHero, at a
            size a cashier can read across a counter. Repeating it here would
            just compete with it. */}
        <ReceiptRow label={t('paymentMethodTitle')} value={methodText} />
        <ReceiptRow label={t('paymentStatus')} value={statusText} />
        <ReceiptRow label={pick('Type', 'النوع')} value={order.orderType === 'delivery' ? t('delivery') : t('pickup')} />
        <ReceiptRow label={pick('Branch', 'الفرع')} value={pick(order.branchNameEn, order.branchNameAr)} />
        <ReceiptRow label={pick('Placed', 'وقت الطلب')} value={formatRiyadhDateTime(order.createdAt)} />
      </View>

      {/* Warning, not blocking: nothing has gone wrong. */}
      {note ? <Notice title={note} tone="warning" /> : null}

      <View style={{ gap: space.s2 }}>
        <Text variant="title">{t('orderSummary')}</Text>
        <View style={styles.card}>
          {order.items.map((it) => (
            <View key={it.id} style={[styles.itemRow, rtlRow]}>
              {/* Quantity in the mono face — a structured number, like every
                  other figure in the app. */}
              <Text variant="label" tone="ember" style={styles.qty}>{it.quantity}×</Text>
              <View style={styles.itemBody}>
                <Text variant="label" numberOfLines={2}>{pick(it.nameEn, it.nameAr)}</Text>
                {it.selectedModifiers.length > 0 ? (
                  <Text variant="caption" tone="secondary">
                    {it.selectedModifiers.map((m) => pick(m.nameEn, m.nameAr)).join(' · ')}
                  </Text>
                ) : null}
              </View>
              <Price
                amount={it.price * it.quantity}
                size={typeScale.body.size}
                color={colors.appText}
                weight="600"
              />
            </View>
          ))}

          <View style={styles.divider} />
          <ReceiptRow label={t('subtotal')} amount={order.subtotal} />
          {order.deliveryFee > 0 ? <ReceiptRow label={t('deliveryFee')} amount={order.deliveryFee} /> : null}
          {order.discountAmount > 0 ? <ReceiptRow label={t('discount')} amount={order.discountAmount} negative /> : null}
          {order.loyaltyDiscountAmount > 0 ? <ReceiptRow label={t('loyaltyDiscount')} amount={order.loyaltyDiscountAmount} negative /> : null}
          {/* The RECEIPT states the VAT actually charged, so unlike the checkout
              preview this row carries a real amount.

              It uses the RATE-FREE label. The checkout label now interpolates
              the branch's configured rate, but a receipt is a historical
              document: the order may have been charged at a rate the brand has
              since changed, and stamping today's rate onto it would replace one
              false claim with another. The amount is the truth here, and it is
              already shown. */}
          <ReceiptRow label={t('vatIncluded')} amount={order.vatAmount} muted />
          <View style={styles.divider} />
          <ReceiptRow label={t('total')} amount={order.total} strong big />

          {order.loyaltyPointsEarned > 0 ? (
            <View style={[styles.earned, rtlRow]}>
              <AwardIcon size={18} color={colors.saffron} />
              <Text variant="label" style={{ color: colors.amberInk }}>
                +{order.loyaltyPointsEarned} {t('loyaltyPoints')}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.appSurface, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.appLine, padding: space.s4,
  },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3, paddingVertical: space.s1 + 2 },
  qty: { minWidth: 28 },
  itemBody: { flex: 1, gap: 2 },
  divider: { height: 1, backgroundColor: colors.appLine, marginVertical: space.s2 },
  earned: { flexDirection: 'row', alignItems: 'center', gap: space.s2, marginTop: space.s2 },
}));
