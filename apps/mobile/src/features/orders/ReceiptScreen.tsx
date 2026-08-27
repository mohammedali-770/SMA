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
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AlertIcon, PinIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { ErrorView } from '../../components/StateViews';
import { color, hitTarget, radius, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { failureMessage } from '../../lib/errors/reportFailure';
import { orders } from '../../services/api';
import { useCatalog } from '../../store';
import { directionsUrl } from '../../lib/mapsLink';
import { openDirections } from '../../lib/openDirections';
import { isCompletedForReview, shouldRequestReview } from '../onboarding/firstRun';
import { markReviewAsked, readFirstRun } from '../onboarding/firstRunStore';
import { requestStoreReview } from '../onboarding/storeReview';
import { isTerminalOrderStatus, nextReceiptPollMs } from './ordersRefresh';
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
  const { t, pick } = useI18n();
  const { branches } = useCatalog();
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
  //
  // The delay is chosen per tick rather than fixed, so a receipt still WAITING
  // for its branch number refreshes every 2 s instead of every 25 s. That gap
  // is real: order-intake now stops waiting for the POS at 5 s, and a slow
  // Create Order call (8.02 s measured on SM-2026-000068) lands the customer on
  // a receipt whose number arrives moments later — but the pos_confirmed push
  // is data-free and only navigates when TAPPED, so without this they would sit
  // looking at "not issued yet" for up to a full 25 s poll.
  //
  // A self-scheduling timeout, not setInterval, because setInterval cannot
  // change its delay. See nextReceiptPollMs for the escalation rule and why the
  // fast phase is bounded.
  useFocusEffect(useCallback(() => {
    if (orderRef.current) void refreshSilently();
    const focusedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      const current = orderRef.current;
      if (!current) return;
      const delay = nextReceiptPollMs(current, Date.now() - focusedAt);
      if (delay == null) return;  // terminal — stop entirely
      timer = setTimeout(() => {
        if (cancelled) return;
        const now = orderRef.current;
        if (now && !isTerminalOrderStatus(now.status)) void refreshSilently();
        schedule();
      }, delay);
    };
    schedule();

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
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
  /**
   * Directions are a PICKUP-only affordance: on a delivery order the food comes
   * to the customer, so a route to the branch is noise.
   *
   * The order row carries `branchId` and the branch NAME but no coordinates —
   * those live in the catalog — so the branch is looked up here. When the
   * catalog has not loaded, or the branch was deactivated since the order was
   * placed, there is no location and the button simply does not render rather
   * than opening a broken map.
   */
  const branch = branches.find((b) => b.id === order?.branchId);
  const mapsUrl = order && order.orderType === 'pickup' && branch
    ? directionsUrl(branch.latitude, branch.longitude, pick(branch.nameEn, branch.nameAr))
    : null;

  /**
   * Ask for a store review as the customer LEAVES this screen, never while it
   * is open: they show this screen to a cashier, and a system rating dialog
   * would sit on top of the order number. Fires once, ever, and only for an
   * order that actually reached the branch.
   */
  const leave = useCallback((href: '/(tabs)' | '/(tabs)/orders') => {
    router.replace(href);
    void (async () => {
      const state = await readFirstRun();
      const ok = shouldRequestReview({
        state,
        orderCompleted: isCompletedForReview(order?.status, order?.lazywaitSyncState),
        leavingConfirmation: true,
        available: await requestStoreReview.isAvailable(),
      });
      if (!ok) return;
      // Mark BEFORE asking: if the OS silently declines to show its dialog we
      // still must not try again on the next order.
      await markReviewAsked();
      await requestStoreReview.request();
    })();
  }, [order?.status, order?.lazywaitSyncState]);

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
            {/* Styled to match the design system's `secondary` Button (same
                radius, height and ember outline) but rendered inline because
                Button has no icon slot, and a pin is what makes this read as
                "directions" rather than another generic action. */}
            {mapsUrl ? (
              <Pressable
                onPress={() => { void openDirections(branch?.latitude, branch?.longitude, pick(branch?.nameEn ?? '', branch?.nameAr ?? ''), {
                  title: t('oc_directions_choose'),
                  appleMaps: t('oc_maps_apple'),
                  googleMaps: t('oc_maps_google'),
                  cancel: t('cancel'),
                }); }}
                accessibilityRole="link"
                accessibilityLabel={t('oc_directions')}
                style={({ pressed }) => [styles.directions, pressed && styles.directionsPressed]}
              >
                <PinIcon size={18} color={colors.ember} />
                <Text variant="button" tone="ember">{t('oc_directions')}</Text>
              </Pressable>
            ) : null}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={[columnStyles.column, styles.footerColumn]}>
            <Button label={t('viewMyOrders')} onPress={() => leave('/(tabs)/orders')} variant="primary" />
            <Button label={t('backToMenu')} onPress={() => leave('/(tabs)')} variant="secondary" />
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
  directions: {
    marginTop: space.s4,
    minHeight: hitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s2,
    borderWidth: 1.5,
    borderColor: colors.ember,
    backgroundColor: colors.appSurface,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    paddingHorizontal: space.s4,
  },
  directionsPressed: { opacity: 0.92 },
}));
