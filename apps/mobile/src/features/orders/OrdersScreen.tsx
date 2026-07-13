/**
 * Order history for the signed-in customer. RLS returns only their own orders.
 * Pull-to-refresh; tapping an order opens its receipt.
 */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { orders } from '../../services/api';
import { mapOrder, orderDisplayNumber } from '../../lib/mappers';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { formatRiyadhDateTime, formatSAR } from '../../utils/format';
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
  const { t, pick, lang } = useI18n();
  const [list, setList] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const rows = await orders.listWithItems();
      setList(rows.map(mapOrder));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('somethingWentWrong'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  // Refetch whenever the tab regains focus (e.g. after placing an order).
  useFocusEffect(useCallback(() => { void load('initial'); }, [load]));

  return (
    <Screen background={colors.bg}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('orderHistory')}</Text>
      </View>
      {loading ? (
        <LoadingView label={t('loading')} />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load('initial')} retryLabel={t('retry')} />
      ) : list.length === 0 ? (
        <EmptyView emoji="🧾" title={t('noOrders')} subtitle={t('noOrdersSub')} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.purple} />}
          renderItem={({ item }) => (
            <Pressable style={[styles.card, shadow.card]} onPress={() => router.push(`/receipt/${item.id}`)} accessibilityRole="button">
              <View style={styles.cardTop}>
                {(() => { const d = orderDisplayNumber(item); return (
                  <View style={{ flexShrink: 1 }}>
                    <Text style={styles.orderNo}>{d.primary}</Text>
                    {d.secondary ? <Text style={styles.orderRef}>{d.secondary}</Text> : null}
                  </View>
                ); })()}
                <StatusBadge label={t(STATUS_KEY[item.status])} status={item.status} />
              </View>
              <Text style={styles.date}>{formatRiyadhDateTime(item.createdAt)}</Text>
              <View style={styles.cardBottom}>
                <Text style={styles.itemsCount}>
                  {item.items.reduce((n, it) => n + it.quantity, 0)} {t('items')} · {item.orderType === 'delivery' ? t('delivery') : t('pickup')}
                </Text>
                <Text style={styles.total}>{formatSAR(item.total, lang)}</Text>
              </View>
              <Text style={styles.viewReceipt}>{t('viewReceipt')} ›</Text>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

function StatusBadge({ label, status }: { label: string; status: OrderStatus }) {
  const tone =
    status === 'delivered' ? { bg: colors.successBg, fg: colors.success }
    : status === 'cancelled' ? { bg: colors.dangerBg, fg: colors.red }
    : { bg: colors.purpleBg, fg: colors.purple };
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderNo: { fontSize: font.md, fontWeight: '800', color: colors.text },
  orderRef: { fontSize: font.sm, color: colors.muted, fontWeight: '600', marginTop: 1 },
  date: { fontSize: font.sm, color: colors.muted },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  itemsCount: { fontSize: font.sm, color: colors.text, fontWeight: '600' },
  total: { fontSize: font.lg, fontWeight: '800', color: colors.purple },
  viewReceipt: { color: colors.purple, fontWeight: '800', fontSize: font.sm, marginTop: spacing.xs },
  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: font.xs, fontWeight: '800' },
});
