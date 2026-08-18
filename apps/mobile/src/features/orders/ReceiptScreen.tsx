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
 *
 * This file owns FETCHING, POLLING AND THE RESEND ACTION only; the hero, the
 * receipt body and the skeleton are pure components under `./view`. That split
 * is what lets the dev fixture render every order state — confirmed, sending,
 * refund pending, refunded — from deterministic local data, without an endpoint
 * being reachable at all.
 */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AlertIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { ErrorView } from '../../components/StateViews';
import { color, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { useI18n } from '../../i18n/I18nProvider';
import { failureMessage } from '../../lib/errors/reportFailure';
import { orders } from '../../services/api';
import { isTerminalOrderStatus, RECEIPT_POLL_MS } from './ordersRefresh';
import { mapOrder } from '../../lib/mappers';
import { ConfirmationHero } from './view/ConfirmationHero';
import { ReceiptBody } from './view/ReceiptBody';
import { ReceiptSkeleton } from './view/Skeletons';
import type { Order } from '../../types/models';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';

export function ReceiptScreen({ orderId }: { orderId: string }) {
  const styles = useStyles();
  const colors = useThemeColors();
  const { t } = useI18n();
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
      .catch((e) => setError(failureMessage(e, t, { subsystem: 'orders', op: 'load_receipt' })))
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
    <Screen edges={['top', 'left', 'right', 'bottom']} background={colors.appBg}>
      {loading ? (
        // Shaped like the loaded receipt so the first paint lands without a
        // jump. Rendered in the same `loading` branch; silent refreshes never
        // re-enter it.
        <ReceiptSkeleton />
      ) : error || !order ? (
        <ErrorView message={error ?? t('somethingWentWrong')} onRetry={load} retryLabel={t('retry')} icon={<AlertIcon />} />
      ) : (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={columnStyles.column}>
            {/* ONE state drives the icon, the title and the message together, so
                a success hero can never sit above a "not confirmed" message. */}
            <ConfirmationHero
              order={order}
              onResend={resend}
              resending={resending}
              resendError={resendError}
            />
            <ReceiptBody order={order} />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={[columnStyles.column, styles.footerColumn]}>
            <Button label={t('viewMyOrders')} onPress={() => router.replace('/(tabs)/orders')} variant="primary" />
            <Button label={t('backToMenu')} onPress={() => router.replace('/(tabs)')} variant="secondary" />
            </View>
          </View>
        </View>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  scroll: { padding: space.s4, paddingBottom: space.s5, alignItems: 'center' },
  // The bar spans the full width so it reads as a floor, but its CONTENTS are
  // capped to the same column as the receipt above it.
  footer: {
    padding: space.s4,
    borderTopWidth: 1, borderTopColor: colors.appLine, backgroundColor: colors.appSurface,
    alignItems: 'center',
  },
  footerColumn: { gap: space.s2 },
}));
