/**
 * Order confirmation / receipt. Loads the just-placed order (RLS scopes it to
 * the owner) and shows the server-authoritative amounts. Payment stays pending
 * — no payment is faked (payment integration is a later, server-side track).
 */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { orders } from '../../services/api';
import { mapOrder } from '../../lib/mappers';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { formatRiyadhDateTime, formatSAR } from '../../utils/format';
import type { Order } from '../../types/models';

export function ReceiptScreen({ orderId }: { orderId: string }) {
  const { t, pick, lang } = useI18n();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    orders.byId(orderId)
      .then((row) => setOrder(mapOrder(row)))
      .catch((e) => setError(e instanceof Error ? e.message : t('somethingWentWrong')))
      .finally(() => setLoading(false));
  };
  useEffect(load, [orderId]);

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

            <View style={[styles.card, shadow.card]}>
              <Row label={t('orderNumber')} value={order.orderNumber} strong />
              <Row label={t('paymentStatus')} value={order.paymentStatus === 'paid' ? t('paymentPaid') : t('paymentPending')} />
              <Row label={pick('Type', 'النوع')} value={order.orderType === 'delivery' ? t('delivery') : t('pickup')} />
              <Row label={pick('Branch', 'الفرع')} value={pick(order.branchNameEn, order.branchNameAr)} />
              <Row label={pick('Placed', 'وقت الطلب')} value={formatRiyadhDateTime(order.createdAt)} />
            </View>

            <Text style={styles.summaryTitle}>{t('orderSummary')}</Text>
            <View style={[styles.card, shadow.card]}>
              {order.items.map((it) => (
                <View key={it.id} style={styles.itemRow}>
                  <Text style={styles.itemQty}>{it.quantity}×</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{pick(it.nameEn, it.nameAr)}</Text>
                    {it.selectedModifiers.length > 0 ? (
                      <Text style={styles.itemMods}>
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
                <Text style={styles.earned}>
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

function Row({ label, value, strong, big, muted }: { label: string; value: string; strong?: boolean; big?: boolean; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.muted]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.strong, big && styles.big]}>{value}</Text>
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
  rowValue: { fontSize: font.md, color: colors.text, fontWeight: '700' },
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
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white },
});
