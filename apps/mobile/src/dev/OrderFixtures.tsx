/**
 * DEV-ONLY renderers for the Orders / Receipt states.
 *
 * These mount the PRESENTATIONAL components (`OrderCard`, `ConfirmationHero`,
 * `ReceiptBody`) against fixed mock orders — never `OrdersScreen` or
 * `ReceiptScreen` themselves. Those screens call `orders.listWithItems`,
 * `orders.byId` and `orders.requestResend` on mount, and a resend is a REAL POS
 * action, so mounting them under a fixture would put a live endpoint one render
 * away from a review session.
 *
 * Every handler here is a no-op. Nothing can fetch, resend, refund or navigate.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { color, space } from '../design-system/generated/tokens';
import { Text } from '../design-system/ui/Text';
import { ConfirmationHero } from '../features/orders/view/ConfirmationHero';
import { OrderCard } from '../features/orders/view/OrderCard';
import { ReceiptBody } from '../features/orders/view/ReceiptBody';
import { useI18n } from '../i18n/I18nProvider';
import { FIXTURE_ORDER_LIST, FIXTURE_RECEIPTS, type ReceiptSceneKey } from './fixtureOrders';
import type { OrderStatus } from '../types/models';
import { makeStyles } from '../theme/makeStyles';

const noop = () => {};

const STATUS_KEY: Record<OrderStatus, 'status_received' | 'status_preparing' | 'status_ready' | 'status_out_for_delivery' | 'status_delivered' | 'status_cancelled'> = {
  received: 'status_received',
  preparing: 'status_preparing',
  ready: 'status_ready',
  out_for_delivery: 'status_out_for_delivery',
  delivered: 'status_delivered',
  cancelled: 'status_cancelled',
};

/** My Orders — one card per interesting confirmation state. */
export function OrdersListFixture({ empty }: { empty?: boolean }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text variant="display">{t('orderHistory')}</Text>
        {empty ? (
          <View style={styles.empty}>
            <Text variant="heading" align="center">{t('noOrders')}</Text>
            <Text variant="body" tone="secondary" align="center">{t('noOrdersSub')}</Text>
          </View>
        ) : (
          FIXTURE_ORDER_LIST.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              statusLabel={t(STATUS_KEY[o.status])}
              onPress={noop}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

/** One receipt state: the hero plus the full receipt body. */
export function ReceiptFixture({ scene }: { scene: ReceiptSceneKey }) {
  const styles = useStyles();
  const order = FIXTURE_RECEIPTS[scene];
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* onResend is inert — the fixture must never reach the POS. */}
        <ConfirmationHero order={order} onResend={noop} resending={false} resendError={null} />
        <ReceiptBody order={order} />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.appBg },
  scroll: { padding: space.s4, gap: space.s3, paddingBottom: space.s6 },
  empty: { paddingVertical: space.s6, gap: space.s2 },
}));
