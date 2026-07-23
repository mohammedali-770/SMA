/**
 * Order confirmation / receipt. Loads the just-placed order (RLS scopes it to
 * the owner) and shows the server-authoritative amounts. Payment stays pending
 * — no payment is faked (payment integration is a later, server-side track).
 */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { AlertIcon, AwardIcon, CheckCircleIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { ErrorView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { orders } from '../../services/api';
import { isTerminalOrderStatus, RECEIPT_POLL_MS } from './ordersRefresh';
import { deriveCustomerPosLifecycle, posLifecyclePresentation, type PosLifecycleTone } from './posLifecycle';
import { mapOrder, orderDisplayNumber } from '../../lib/mappers';
import { paymentDisplayState, paymentMethodLabel } from '../../lib/payment';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { formatRiyadhDateTime } from '../../utils/format';
import { Price } from '../../components/Price';
import type { Order } from '../../types/models';

export function ReceiptScreen({ orderId }: { orderId: string }) {
  const { t, pick, rtlText, rtlRow } = useI18n();
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
        // Static skeleton shaped like the loaded receipt (hero, metadata card,
        // summary card) so the first paint lands without a jump. Rendered in
        // the same `loading` branch; silent refreshes never re-enter it.
        <ReceiptSkeleton />
      ) : error || !order ? (
        <ErrorView message={error ?? t('somethingWentWrong')} onRetry={load} retryLabel={t('retry')} icon={<AlertIcon />} />
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              <CheckCircleIcon size={56} color={colors.success} />
              <Text style={styles.title}>{t('orderPlaced')}</Text>
              <Text style={styles.sub}>{t('orderPlacedSub')}</Text>
            </View>

            <PosLifecycleBanner order={order} />

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
                  {note ? (
                    // Warning callout — informational tone, never styled as an
                    // error; the note text and visibility rules are unchanged.
                    <View style={[styles.noteBox, rtlRow]}>
                      <AlertIcon size={20} color={colors.warning} />
                      <Text style={[styles.notPaid, rtlText, { flex: 1 }]}>{note}</Text>
                    </View>
                  ) : null}
                </>
              );
            })()}

            <Text style={[styles.summaryTitle, rtlText]}>{t('orderSummary')}</Text>
            <View style={[styles.card, shadow.card]}>
              {order.items.map((it) => (
                <View key={it.id} style={[styles.itemRow, rtlRow]}>
                  <Text style={styles.itemQty}>{it.quantity}×</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemName, rtlText]} numberOfLines={2}>{pick(it.nameEn, it.nameAr)}</Text>
                    {it.selectedModifiers.length > 0 ? (
                      // The receipt is the detailed order record: every selected
                      // modifier stays visible in full — no line cap, no ellipsis.
                      <Text style={[styles.itemMods, rtlText]}>
                        {it.selectedModifiers.map((m) => pick(m.nameEn, m.nameAr)).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <Price amount={it.price * it.quantity} size={font.md} color={colors.text} weight="700" />
                </View>
              ))}
              <View style={styles.divider} />
              <Row label={t('subtotal')} amount={order.subtotal} />
              {order.deliveryFee > 0 ? <Row label={t('deliveryFee')} amount={order.deliveryFee} /> : null}
              {order.discountAmount > 0 ? <Row label={t('discount')} amount={order.discountAmount} negative /> : null}
              {order.loyaltyDiscountAmount > 0 ? <Row label={t('loyaltyDiscount')} amount={order.loyaltyDiscountAmount} negative /> : null}
              <Row label={t('vat')} amount={order.vatAmount} muted />
              <View style={styles.divider} />
              <Row label={t('total')} amount={order.total} strong big />
              {order.loyaltyPointsEarned > 0 ? (
                <View style={[styles.earnedRow, rtlRow]}>
                  <AwardIcon size={18} color={colors.warning} />
                  <Text style={[styles.earned, rtlText]}>
                    +{order.loyaltyPointsEarned} {t('loyaltyPoints')}
                  </Text>
                </View>
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

/**
 * Customer-facing POS confirmation banner. Renders ONLY when the order has a
 * derivable POS lifecycle (pickup, post-payment). Copy is the approved AR/EN
 * message; the derivation guarantees "confirmed" is shown only after Lazywait
 * returned a real order reference. Polite live-region so status changes picked
 * up by the silent refresh are announced.
 */
const POS_TONE: Record<PosLifecycleTone, { bg: string; fg: string }> = {
  info: { bg: colors.purpleBg, fg: colors.purple },
  success: { bg: colors.successBg, fg: colors.success },
  warning: { bg: colors.bgAlt, fg: colors.warning },
  danger: { bg: colors.dangerBg, fg: colors.danger },
};

function PosLifecycleBanner({ order }: { order: Order }) {
  const { t, rtlText, rtlRow } = useI18n();
  const lc = deriveCustomerPosLifecycle({
    orderType: order.orderType,
    syncState: order.lazywaitSyncState,
    ref: order.lazywaitRef,
    firstFailureAt: order.firstPosSyncFailureAt,
    nextAttemptAt: order.syncNextAttemptAt,
  });
  if (!lc) return null;
  const p = posLifecyclePresentation(lc);
  const tone = POS_TONE[p.tone];
  return (
    <View
      style={[banner.box, rtlRow, { backgroundColor: tone.bg, borderColor: tone.fg }]}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={`${t(p.labelKey)}. ${t(p.bodyKey)}`}
    >
      <View style={[banner.dot, { backgroundColor: tone.fg }]} />
      <View style={{ flex: 1 }}>
        <Text style={[banner.title, rtlText, { color: tone.fg }]}>{t(p.labelKey)}</Text>
        <Text style={[banner.body, rtlText]}>{t(p.bodyKey)}</Text>
      </View>
    </View>
  );
}

const banner = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    borderWidth: 1, borderRadius: radius.md, borderCurve: 'continuous',
    padding: spacing.md, marginTop: spacing.md,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  title: { fontSize: font.md, fontWeight: '800' },
  body: { fontSize: font.sm, color: colors.text, fontWeight: '600', marginTop: 2, lineHeight: 20 },
});

function Row({ label, value, amount, negative, secondary, strong, big, muted }: { label: string; value?: string; amount?: number; negative?: boolean; secondary?: string; strong?: boolean; big?: boolean; muted?: boolean }) {
  const { isRTL, rtlRow } = useI18n();
  return (
    // Mirrored in Arabic: label on the right, value column on the left.
    <View style={[styles.row, rtlRow]}>
      <Text style={[styles.rowLabel, muted && styles.muted]}>{label}</Text>
      <View style={[styles.rowValueCol, isRTL && styles.rowValueColRTL]}>
        {amount != null ? (
          <Price amount={amount} prefix={negative ? '−' : undefined} size={big ? font.lg : font.md} color={big ? colors.purple : colors.text} weight={strong || big ? '800' : '700'} />
        ) : (
          <Text style={[styles.rowValue, strong && styles.strong, big && styles.big]}>{value}</Text>
        )}
        {secondary ? <Text style={styles.rowSecondary}>{secondary}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.purple, textAlign: 'center' },
  sub: { fontSize: font.md, color: colors.muted, textAlign: 'center' },
  card: {
    backgroundColor: colors.white, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.md,
  },
  summaryTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginTop: spacing.xl, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm - 2 },
  rowLabel: { fontSize: font.md, color: colors.text, fontWeight: '600', flexShrink: 1 },
  rowValueCol: { alignItems: 'flex-end', flexShrink: 1 },
  rowValueColRTL: { alignItems: 'flex-start' },
  rowValue: { fontSize: font.md, color: colors.text, fontWeight: '700' },
  rowSecondary: { fontSize: font.sm, color: colors.muted, fontWeight: '600', marginTop: 1 },
  muted: { color: colors.muted, fontSize: font.sm },
  strong: { fontWeight: '800' },
  big: { fontSize: font.lg, color: colors.purple },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm - 2 },
  itemQty: { fontSize: font.md, fontWeight: '800', color: colors.purple, minWidth: 28 },
  itemName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  itemMods: { fontSize: font.sm, color: colors.muted, marginTop: 1 },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  earnedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  earned: { color: colors.warning, fontWeight: '800', fontSize: font.sm },
  noteBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md,
    backgroundColor: colors.bgAlt, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, borderCurve: 'continuous', padding: spacing.md,
  },
  notPaid: { color: colors.warning, fontWeight: '700', fontSize: font.sm },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white },
});

/**
 * Static ghost receipt matching the loaded layout — no animation loops.
 * The WRAPPER is the single accessible element (VoiceOver/TalkBack announce
 * one "loading" progress state via the existing translation); the decorative
 * ghost shapes stay excluded from the accessibility tree, so there are no
 * per-block announcements.
 */
function ReceiptSkeleton() {
  const { t } = useI18n();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('loading')}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      style={{ flex: 1 }}
    >
      <View
        style={{ padding: spacing.lg, gap: spacing.md }}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={{ alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm }}>
          <View style={skeleton.circle} />
          <View style={[skeleton.line, { width: '50%', height: 18 }]} />
          <View style={[skeleton.line, { width: '70%' }]} />
        </View>
        <View style={skeleton.card}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm }}>
              <View style={[skeleton.line, { width: '30%' }]} />
              <View style={[skeleton.line, { width: '38%' }]} />
            </View>
          ))}
        </View>
        <View style={skeleton.card}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm }}>
              <View style={[skeleton.line, { width: '55%' }]} />
              <View style={[skeleton.line, { width: 64 }]} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const skeleton = StyleSheet.create({
  circle: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.bgAlt, borderWidth: 1, borderColor: colors.border },
  card: {
    backgroundColor: colors.white, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  line: { height: 12, borderRadius: 6, backgroundColor: colors.bgAlt },
});
