/**
 * Order status / receipt screen.
 *
 * THE RULE (Issue #94): this screen renders from ONE server-derived state —
 * `deriveCustomerOrderState` — and nothing else. There is no unconditional
 * success hero: the check mark and "Order confirmed" appear only in states whose
 * presentation says `success`, which for a POS-integrated order means the branch
 * actually accepted it and returned a usable reference. The previous version
 * rendered a green "Order placed!" hero above a banner that could simultaneously
 * read "Not confirmed"; that contradiction is now structurally impossible because
 * both the hero and the message come from the same state.
 *
 * The internal SM-… order number is never displayed — only the branch's own order
 * number, and only once the branch has issued one.
 */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { AlertIcon, AwardIcon, CheckCircleIcon, ClockIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { ErrorView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { orders } from '../../services/api';
import { isTerminalOrderStatus, RECEIPT_POLL_MS } from './ordersRefresh';
import {
  confirmationPresentation, orderConfirmationState,
  type ConfirmationTone, type CustomerOrderState,
} from './orderConfirmation';
import { mapOrder, orderDisplayNumber } from '../../lib/mappers';
import { paymentDisplayState, paymentMethodLabel } from '../../lib/payment';
import { colors, font, radius, shadow, spacing } from '../../theme';
import type { Palette } from '../../theme';
import { useThemeColors } from '../../theme/ThemeProvider';
import { makeStyles } from '../../theme/makeStyles';
import { formatRiyadhDateTime } from '../../utils/format';
import { Price } from '../../components/Price';
import type { Order } from '../../types/models';

export function ReceiptScreen({ orderId }: { orderId: string }) {
  const colors = useThemeColors();
  const styles = useStyles();
  const { t, pick, rtlText, rtlRow } = useI18n();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Resend is a server action; these only drive the button's local affordance.
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
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

  /**
   * Customer "Resend order". The server owns ownership, the proven-not-sent
   * safety check and the attempt budget; this handler only debounces the button
   * and re-reads the authoritative row afterwards.
   *
   * `resending` gates re-entry so a double tap cannot fire two requests — and
   * even if one slipped through, the RPC locks the order row and the second call
   * observes an already-requeued order, so it can never double the counter or
   * open a second send.
   */
  const resend = useCallback(async () => {
    if (resending) return;
    setResending(true);
    setResendError(null);
    try {
      await orders.requestResend(orderId);
    } catch {
      // A transport failure says nothing about the order's real state; surface a
      // neutral retry hint and let the refresh below show the truth.
      setResendError(t('oc_resend_failed'));
    } finally {
      // Always re-read: the RPC's own outcome is advisory, the row is the truth.
      await refreshSilently();
      setResending(false);
    }
  }, [orderId, refreshSilently, resending, t]);

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
            {/*
              ONE state drives the icon, the title and the message together, so a
              success hero can never sit above a "not confirmed" message again.
            */}
            <ConfirmationHero
              order={order}
              onResend={resend}
              resending={resending}
              resendError={resendError}
            />

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
                    {/*
                      ONLY the branch's own order number is ever shown, and only
                      once the branch has issued one. The internal SM-… number is
                      never rendered — it identifies a database row, not an order
                      the restaurant has accepted.
                    */}
                    <Row
                      label={t('oc_branch_order_number')}
                      value={orderDisplayNumber(order) ?? t('oc_number_pending')}
                      strong={orderDisplayNumber(order) != null}
                    />
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

const toneFor = (colors: Palette): Record<ConfirmationTone, { bg: string; fg: string }> => ({
  info: { bg: colors.purpleBg, fg: colors.accent },
  success: { bg: colors.successBg, fg: colors.success },
  warning: { bg: colors.bgAlt, fg: colors.warning },
  danger: { bg: colors.dangerBg, fg: colors.danger },
});

/** Only `success` states get a check mark; everything else is honest about waiting. */
function StateIcon({ state, color }: { state: CustomerOrderState; color: string }) {
  const p = confirmationPresentation(state);
  if (p.success) return <CheckCircleIcon size={56} color={color} />;
  if (p.tone === 'danger') return <AlertIcon size={56} color={color} />;
  return <ClockIcon size={56} color={color} />;
}

/**
 * THE receipt hero. Icon, title and message all come from one derived state, so
 * the screen cannot contradict itself. The Retry action is rendered only when the
 * state's presentation says `canResend` — which the state machine grants only for
 * orders proven never to have reached the branch, never for ambiguous ones (a
 * resend there could duplicate the restaurant's ticket).
 *
 * A polite live-region announces transitions picked up by the silent refresh.
 */
function ConfirmationHero({
  order, onResend, resending, resendError,
}: {
  order: Order;
  onResend: () => void;
  resending: boolean;
  resendError: string | null;
}) {
  const hero = useHero();
  const { t, rtlText } = useI18n();
  const state = orderConfirmationState(order);
  const p = confirmationPresentation(state);
  const tone = toneFor(colors)[p.tone];

  return (
    <View
      style={hero.wrap}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${t(p.titleKey)}. ${t(p.bodyKey)}`}
    >
      <StateIcon state={state} color={tone.fg} />
      <Text style={[hero.title, { color: tone.fg }]}>{t(p.titleKey)}</Text>
      <Text style={[hero.body, rtlText]}>{t(p.bodyKey)}</Text>

      {p.canResend ? (
        <View style={hero.action}>
          <Button
            label={resending ? t('oc_resending') : t('oc_resend')}
            onPress={onResend}
            // Button's own loading state disables the press and shows the spinner:
            // the server is idempotent regardless, but a dimmed control is the
            // honest signal that work is already in flight.
            loading={resending}
          />
          {resendError ? (
            <Text style={[hero.error, rtlText]} accessibilityLiveRegion="polite">{resendError}</Text>
          ) : null}
        </View>
      ) : null}

      {/*
        Refund progress is stated separately and never optimistically: 'Refunded'
        appears only once the provider has confirmed it (refund_state='refunded').
      */}
      {order.refundState && order.refundState !== 'none' ? (
        <View style={[hero.refund, { borderColor: tone.fg }]}>
          <Text style={[hero.refundLabel, rtlText]}>{t('oc_refund_status')}</Text>
          <Text style={[hero.refundValue, rtlText, { color: tone.fg }]}>
            {order.refundState === 'refunded' ? t('oc_refunded')
              : order.refundState === 'failed' ? t('oc_refund_failed')
              : t('oc_refund_pending')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useHero = makeStyles((colors) => ({
  wrap: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  title: { fontSize: font.xxl, fontWeight: '800', textAlign: 'center' },
  body: { fontSize: font.md, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  action: { alignSelf: 'stretch', marginTop: spacing.md },
  error: { fontSize: font.sm, color: colors.danger, fontWeight: '700', textAlign: 'center', marginTop: spacing.sm },
  refund: {
    alignSelf: 'stretch', marginTop: spacing.md, padding: spacing.md,
    borderWidth: 1, borderRadius: radius.md, borderCurve: 'continuous',
    backgroundColor: colors.bgAlt, gap: 2,
  },
  refundLabel: { fontSize: font.sm, color: colors.muted, fontWeight: '600' },
  refundValue: { fontSize: font.md, fontWeight: '800' },
}));

function Row({ label, value, amount, negative, secondary, strong, big, muted }: { label: string; value?: string; amount?: number; negative?: boolean; secondary?: string; strong?: boolean; big?: boolean; muted?: boolean }) {
  const colors = useThemeColors();
  const styles = useStyles();
  const { isRTL, rtlRow } = useI18n();
  return (
    // Mirrored in Arabic: label on the right, value column on the left.
    <View style={[styles.row, rtlRow]}>
      <Text style={[styles.rowLabel, muted && styles.muted]}>{label}</Text>
      <View style={[styles.rowValueCol, isRTL && styles.rowValueColRTL]}>
        {amount != null ? (
          <Price amount={amount} prefix={negative ? '−' : undefined} size={big ? font.lg : font.md} color={big ? colors.accent : colors.text} weight={strong || big ? '800' : '700'} />
        ) : (
          <Text style={[styles.rowValue, strong && styles.strong, big && styles.big]}>{value}</Text>
        )}
        {secondary ? <Text style={styles.rowSecondary}>{secondary}</Text> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: 'continuous',
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
  big: { fontSize: font.lg, color: colors.accent },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm - 2 },
  itemQty: { fontSize: font.md, fontWeight: '800', color: colors.accent, minWidth: 28 },
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
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
}));

/**
 * Static ghost receipt matching the loaded layout — no animation loops.
 * The WRAPPER is the single accessible element (VoiceOver/TalkBack announce
 * one "loading" progress state via the existing translation); the decorative
 * ghost shapes stay excluded from the accessibility tree, so there are no
 * per-block announcements.
 */
function ReceiptSkeleton() {
  const skeleton = useSkeleton();
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

const useSkeleton = makeStyles((colors) => ({
  circle: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.bgAlt, borderWidth: 1, borderColor: colors.border },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  line: { height: 12, borderRadius: 6, backgroundColor: colors.bgAlt },
}));
