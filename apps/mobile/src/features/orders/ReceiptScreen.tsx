/**
 * Order confirmation / receipt. Loads the just-placed order (RLS scopes it to
 * the owner) and shows the server-authoritative amounts. Payment stays pending
 * — no payment is faked (payment integration is a later, server-side track).
 */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { orders } from '../../services/api';
import { isTerminalOrderStatus, RECEIPT_POLL_MS } from './ordersRefresh';
import { mapOrder, orderDisplayNumber } from '../../lib/mappers';
import { paymentDisplayState, paymentMethodLabel } from '../../lib/payment';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { formatRiyadhDateTime, formatSAR } from '../../utils/format';
import type { Order } from '../../types/models';

export function ReceiptScreen({ orderId }: { orderId: string }) {
  const { t, pick, lang, rtlText, rtlRow } = useI18n();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Mirror for the focus/poll callbacks (stable identities, no stale closures).
  const orderRef = useRef<Order | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    orders.byId(orderId)
      .then((row) => { const o = mapOrder(row); orderRef.current = o; setOrder(o); })
      .catch((e) => setError(e instanceof Error ? e.message : t('somethingWentWrong')))
      .finally(() => setLoading(false));
  };
  useEffect(load, [orderId]);

  // Silent status refresh: re-reads the order without blanking what's on
  // screen; a failed tick is ignored (the next tick/focus retries). Read-only —
  // no payment or order-creation logic is involved.
  const refreshSilently = useCallback(async () => {
    try {
      const row = await orders.byId(orderId);
      const o = mapOrder(row);
      orderRef.current = o;
      setOrder(o);
    } catch { /* keep the receipt currently shown */ }
  }, [orderId]);

  // While the receipt is FOCUSED: refresh once on focus, then poll lightly so
  // the status (received → preparing → …) doesn't sit stale. Ticks no-op once
  // the order is terminal (delivered/cancelled), and the interval is torn down
  // on blur/unmount — Supabase is never polled from the background.
  useFocusEffect(useCallback(() => {
    if (orderRef.current) void refreshSilently();
    const id = setInterval(() => {
      const current = orderRef.current;
      if (current && !isTerminalOrderStatus(current.status)) void refreshSilently();
    }, RECEIPT_POLL_MS);
    return () => clearInterval(id);
  }, [refreshSilently]));

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} background={colors.bg}>
      {loading ? (
        <LoadingView label={t('loading')} />
      ) : error || !order ? (
        <ErrorView message={error ?? t('somethingWentWrong')} onRetry={load} retryLabel={t('retry')} />
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              <Text style={styles.check}>✅</Text>
              <Text style={styles.title}>{t('orderPlaced')}</Text>
              <Text style={styles.sub}>{t('orderPlacedSub')}</Text>
            </View>

            {(() => {
              const methodKey = paymentMethodLabel(order.paymentMethod, order.orderType);
              const methodText =
                methodKey === 'online' ? t('payOnline')
                : methodKey === 'cash_delivery' ? t('cashOnDelivery')
                : methodKey === 'cash_pickup' ? t('cashOnPickup')
                : methodKey === 'cash' ? pick('Cash Payment', 'دفع نقدي')
                : pick('Payment method not set', 'لم تُحدَّد طريقة الدفع');
              const state = paymentDisplayState(order);
              const statusText =
                state === 'paid' ? t('paymentPaid')
                : state === 'pending_online' ? pick('Pending online payment', 'بانتظار الدفع الإلكتروني')
                : state === 'cash_required' ? pick('Pay cash on receipt', 'يُدفع نقداً عند الاستلام')
                : t('paymentPending');
              const note =
                state === 'cash_required' ? pick('Please have the cash amount ready on receipt.', 'يُرجى تجهيز المبلغ نقداً عند الاستلام.')
                : state === 'pending_online' ? pick('Online payment has not been completed.', 'لم يكتمل الدفع الإلكتروني بعد.')
                : state === 'unpaid' ? t('notPaidYet')
                : null;
              return (
                <>
                  <View style={[styles.card, shadow.card]}>
                    {(() => { const d = orderDisplayNumber(order); return (
                      <Row
                        label={t('orderNumber')}
                        value={d.primary}
                        secondary={d.secondary ? `${t('orderRef')}: ${d.secondary}` : undefined}
                        strong
                      />
                    ); })()}
                    <Row label={t('paymentMethodTitle')} value={methodText} />
                    <Row label={t('paymentStatus')} value={statusText} />
                    <Row label={pick('Type', 'النوع')} value={order.orderType === 'delivery' ? t('delivery') : t('pickup')} />
                    <Row label={pick('Branch', 'الفرع')} value={pick(order.branchNameEn, order.branchNameAr)} />
                    <Row label={pick('Placed', 'وقت الطلب')} value={formatRiyadhDateTime(order.createdAt)} />
                  </View>
                  {note ? <Text style={styles.notPaid}>⚠ {note}</Text> : null}
                </>
              );
            })()}

            <Text style={[styles.summaryTitle, rtlText]}>{t('orderSummary')}</Text>
            <View style={[styles.card, shadow.card]}>
              {order.items.map((it) => (
                <View key={it.id} style={[styles.itemRow, rtlRow]}>
                  <Text style={styles.itemQty}>{it.quantity}×</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemName, rtlText]}>{pick(it.nameEn, it.nameAr)}</Text>
                    {it.selectedModifiers.length > 0 ? (
                      <Text style={[styles.itemMods, rtlText]}>
                        {it.selectedModifiers.map((m) => pick(m.nameEn, m.nameAr)).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.itemPrice}>{formatSAR(it.price * it.quantity, lang)}</Text>
                </View>
              ))}
              <View style={styles.divider} />
              <Row label={t('subtotal')} value={formatSAR(order.subtotal, lang)} />
              {order.deliveryFee > 0 ? <Row label={t('deliveryFee')} value={formatSAR(order.deliveryFee, lang)} /> : null}
              {order.discountAmount > 0 ? <Row label={t('discount')} value={`−${formatSAR(order.discountAmount, lang)}`} /> : null}
              {order.loyaltyDiscountAmount > 0 ? <Row label={t('loyaltyDiscount')} value={`−${formatSAR(order.loyaltyDiscountAmount, lang)}`} /> : null}
              <Row label={t('vat')} value={formatSAR(order.vatAmount, lang)} muted />
              <View style={styles.divider} />
              <Row label={t('total')} value={formatSAR(order.total, lang)} strong big />
              {order.loyaltyPointsEarned > 0 ? (
                <Text style={[styles.earned, rtlText]}>
                  ⭐ +{order.loyaltyPointsEarned} {t('loyaltyPoints')}
                </Text>
              ) : null}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button label={t('viewMyOrders')} onPress={() => router.replace('/(tabs)/orders')} />
            <Button label={t('backToMenu')} onPress={() => router.replace('/(tabs)')} variant="secondary" style={{ marginTop: spacing.sm }} />
          </View>
        </View>
      )}
    </Screen>
  );
}

function Row({ label, value, secondary, strong, big, muted }: { label: string; value: string; secondary?: string; strong?: boolean; big?: boolean; muted?: boolean }) {
  const { isRTL, rtlRow } = useI18n();
  return (
    // Mirrored in Arabic: label on the right, value column on the left.
    <View style={[styles.row, rtlRow]}>
      <Text style={[styles.rowLabel, muted && styles.muted]}>{label}</Text>
      <View style={[styles.rowValueCol, isRTL && styles.rowValueColRTL]}>
        <Text style={[styles.rowValue, strong && styles.strong, big && styles.big]}>{value}</Text>
        {secondary ? <Text style={styles.rowSecondary}>{secondary}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs },
  check: { fontSize: 56 },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.purple },
  sub: { fontSize: font.md, color: colors.muted, textAlign: 'center' },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md },
  summaryTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginTop: spacing.xl, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.xs },
  rowLabel: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  rowValueCol: { alignItems: 'flex-end', flexShrink: 1 },
  rowValueColRTL: { alignItems: 'flex-start' },
  rowValue: { fontSize: font.md, color: colors.text, fontWeight: '700' },
  rowSecondary: { fontSize: font.sm, color: colors.muted, fontWeight: '600', marginTop: 1 },
  muted: { color: colors.muted, fontSize: font.sm },
  strong: { fontWeight: '800' },
  big: { fontSize: font.lg, color: colors.purple },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.xs },
  itemQty: { fontSize: font.md, fontWeight: '800', color: colors.purple, minWidth: 28 },
  itemName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  itemMods: { fontSize: font.sm, color: colors.muted },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  earned: { marginTop: spacing.sm, color: colors.warning, fontWeight: '800', fontSize: font.sm },
  notPaid: { marginTop: spacing.md, color: colors.warning, fontWeight: '800', fontSize: font.sm, textAlign: 'center' },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white },
});
