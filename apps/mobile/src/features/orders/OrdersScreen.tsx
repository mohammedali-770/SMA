/**
 * Order history for the signed-in customer. RLS returns only their own orders.
 * Pull-to-refresh; tapping an order opens its receipt.
 *
 * This file owns FETCHING only — the card is a pure component under `./view`,
 * so the dev fixture can render every order state from deterministic local data
 * without an endpoint being reachable.
 */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { AlertIcon, ReceiptIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { EmptyView, ErrorView } from '../../components/StateViews';
import { color, space } from '../../design-system/generated/tokens';
import { Text } from '../../design-system/ui/Text';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { useI18n } from '../../i18n/I18nProvider';
import { orders } from '../../services/api';
import { ORDERS_PAGE_LIMIT } from './ordersRefresh';
import { mapOrder } from '../../lib/mappers';
import { OrderCard } from './view/OrderCard';
import { OrdersSkeleton } from './view/Skeletons';
import type { Order, OrderStatus } from '../../types/models';

const STATUS_KEY: Record<OrderStatus, 'status_received' | 'status_preparing' | 'status_ready' | 'status_out_for_delivery' | 'status_delivered' | 'status_cancelled'> = {
  received: 'status_received',
  preparing: 'status_preparing',
  ready: 'status_ready',
  out_for_delivery: 'status_out_for_delivery',
  delivered: 'status_delivered',
  cancelled: 'status_cancelled',
};

export function OrdersScreen() {
  const { t, pick } = useI18n();
  const [list, setList] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True once any load has delivered data — the gate for stale-while-revalidate.
  const hasData = useRef(false);

  const load = useCallback(async (mode: 'focus' | 'refresh' = 'focus') => {
    // Stale-while-revalidate: once orders are on screen, focus refreshes run
    // silently in the background (the list stays visible); the full-screen
    // spinner is reserved for the very first load, and pull-to-refresh owns
    // its own indicator.
    if (mode === 'refresh') setRefreshing(true);
    else if (!hasData.current) setLoading(true);
    try {
      const rows = await orders.listWithItems(ORDERS_PAGE_LIMIT);
      setList(rows.map(mapOrder));
      setError(null);
      hasData.current = true;
    } catch (e) {
      // A failed background refresh never wipes the list already on screen;
      // the error state only shows when there is nothing to show instead.
      if (!hasData.current) setError(e instanceof Error ? e.message : t('somethingWentWrong'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  // Refetch whenever the tab regains focus (e.g. after placing an order) —
  // silently once data exists, so status changes appear without a blank flash.
  useFocusEffect(useCallback(() => { void load('focus'); }, [load]));

  return (
    <Screen background={color.appBg}>
      <View style={styles.headerBar}>
        <View style={columnStyles.column}>
          <Text variant="display">{t('orderHistory')}</Text>
        </View>
      </View>

      {loading ? (
        // Shaped like the final order cards so the first load lands without a
        // jump. Shown only before any data has ever arrived — stale-while-
        // revalidate keeps the real list on screen afterwards.
        <OrdersSkeleton />
      ) : error ? (
        <ErrorView
          message={error}
          onRetry={() => load('focus')}
          retryLabel={t('retry')}
          icon={<AlertIcon />}
          fallbackTitle={pick("Your orders didn't load", 'تعذّر تحميل طلباتك')}
        />
      ) : list.length === 0 ? (
        <EmptyView
          icon={<ReceiptIcon size={44} color={color.heatOff} />}
          title={t('noOrders')}
          subtitle={t('noOrdersSub')}
        />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={color.ember}
            />
          }
          // The cap goes on each ROW, not on the scroller, so the
          // RefreshControl still spans the full width on a tablet.
          renderItem={({ item }) => (
            <View style={columnStyles.column}>
              <OrderCard
                order={item}
                statusLabel={t(STATUS_KEY[item.status])}
                onPress={() => router.push(`/receipt/${item.id}`)}
              />
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerBar: { paddingHorizontal: space.s4, paddingTop: space.s2, paddingBottom: space.s3, alignItems: 'center' },
  list: { padding: space.s4, gap: space.s3, alignItems: 'center' },
});
