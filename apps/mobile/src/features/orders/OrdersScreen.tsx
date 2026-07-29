/**
 * Order history for the signed-in customer. RLS returns only their own orders.
 * Pull-to-refresh; tapping an order opens its receipt.
 */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AlertIcon, ReceiptIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { EmptyView, ErrorView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { orders } from '../../services/api';
import { ORDERS_PAGE_LIMIT } from './ordersRefresh';
import { confirmationPresentation, orderConfirmationState, type ConfirmationTone } from './orderConfirmation';
import { mapOrder, orderDisplayNumber } from '../../lib/mappers';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { formatRiyadhDateTime, formatSAR } from '../../utils/format';
import { Price } from '../../components/Price';
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
  const { t, pick, lang, isRTL, rtlText, rtlRow } = useI18n();
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

  function renderOrder({ item }: { item: Order }) {
    // Only the branch's number is customer-visible; until the branch issues one
    // the card leads with the confirmation state instead of an internal id.
    const branchNo = orderDisplayNumber(item);
    const confirmation = confirmationPresentation(orderConfirmationState(item));
    const heading = branchNo ?? t(confirmation.titleKey);
    const statusLabel = t(STATUS_KEY[item.status]);
    const itemCount = item.items.reduce((n, it) => n + it.quantity, 0);
    const meta = `${itemCount} ${t('items')} · ${item.orderType === 'delivery' ? t('delivery') : t('pickup')}`;
    const totalLabel = formatSAR(item.total, lang);
    return (
      <Pressable
        style={({ pressed }) => [styles.card, shadow.card, pressed && styles.cardPressed]}
        onPress={() => router.push(`/receipt/${item.id}`)}
        accessibilityRole="button"
        // Composed only from values already displayed on the card.
        accessibilityLabel={`${heading} · ${statusLabel} · ${totalLabel}`}
      >
        <View style={[styles.cardTop, rtlRow]}>
          <View style={{ flexShrink: 1 }}>
            <Text style={[styles.orderNo, rtlText]} numberOfLines={1}>{heading}</Text>
          </View>
          <StatusBadge label={statusLabel} status={item.status} />
        </View>
        <Text style={[styles.date, rtlText]}>{formatRiyadhDateTime(item.createdAt)}</Text>
        <ConfirmationChip order={item} />
        <View style={[styles.cardBottom, rtlRow]}>
          <Text style={[styles.itemsCount, rtlText]}>{meta}</Text>
          <Price amount={item.total} size={font.lg} color={colors.purple} weight="800" />
        </View>
        <View style={styles.receiptRow}>
          <Text style={[styles.viewReceipt, rtlText]}>{t('viewReceipt')} {isRTL ? '‹' : '›'}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Screen background={colors.bg}>
      <View style={styles.header}>
        <Text style={[styles.title, rtlText]}>{t('orderHistory')}</Text>
      </View>
      {loading ? (
        // Static skeleton shaped like the final order cards so the first load
        // lands without a jump. Shown only before any data has ever arrived
        // (stale-while-revalidate keeps the real list on screen afterwards).
        <OrdersSkeleton />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load('focus')} retryLabel={t('retry')} icon={<AlertIcon />}
          fallbackTitle={pick("Your orders didn't load", 'تعذّر تحميل طلباتك')} />
      ) : list.length === 0 ? (
        <EmptyView icon={<ReceiptIcon size={44} color={colors.disabled} />} title={t('noOrders')} subtitle={t('noOrdersSub')} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.purple} />}
          renderItem={renderOrder}
        />
      )}
    </Screen>
  );
}

/** Static ghost cards matching the loaded layout — no animation loops. */
function OrdersSkeleton() {
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }} pointerEvents="none" accessibilityElementsHidden>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={skeleton.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={[skeleton.line, { width: '40%' }]} />
            <View style={skeleton.badge} />
          </View>
          <View style={[skeleton.line, { width: '55%' }]} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
            <View style={[skeleton.line, { width: '35%' }]} />
            <View style={[skeleton.line, { width: 72 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const skeleton = StyleSheet.create({
  card: {
    backgroundColor: colors.white, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm,
  },
  line: { height: 12, borderRadius: 6, backgroundColor: colors.bgAlt },
  badge: { width: 76, height: 22, borderRadius: radius.pill, backgroundColor: colors.bgAlt },
});

const CHIP_TONE: Record<ConfirmationTone, { bg: string; fg: string }> = {
  info: { bg: colors.purpleBg, fg: colors.purple },
  success: { bg: colors.successBg, fg: colors.success },
  warning: { bg: colors.bgAlt, fg: colors.warning },
  danger: { bg: colors.dangerBg, fg: colors.danger },
};

/**
 * The same derived state as the receipt, shown compactly. My Orders must not
 * collapse the confirmation states into a generic "placed" chip — a card whose
 * order never reached the branch reads "Order not sent yet" or "Order not
 * placed", never a success.
 *
 * The chip is suppressed only for `accepted_no_pos_channel`, where the heading
 * and the order status already tell the whole story and a second line would just
 * repeat it.
 */
function ConfirmationChip({ order }: { order: Order }) {
  const { t } = useI18n();
  const state = orderConfirmationState(order);
  // The card heading already renders this state's title when there is no branch
  // number, so a chip would only repeat it.
  if (state === 'accepted_no_pos_channel' || state === 'accepted_no_pos_channel_unpaid') return null;
  const p = confirmationPresentation(state);
  const tone = CHIP_TONE[p.tone];
  return (
    <View style={[styles.posChip, { backgroundColor: tone.bg }]}>
      <View style={[styles.posDot, { backgroundColor: tone.fg }]} />
      <Text style={[styles.posChipText, { color: tone.fg }]} numberOfLines={1}>{t(p.titleKey)}</Text>
    </View>
  );
}

function StatusBadge({ label, status }: { label: string; status: OrderStatus }) {
  const tone =
    status === 'delivered' ? { bg: colors.successBg, fg: colors.success }
    : status === 'cancelled' ? { bg: colors.dangerBg, fg: colors.danger }
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
  card: {
    backgroundColor: colors.white, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs,
  },
  cardPressed: { opacity: 0.9 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  orderNo: { fontSize: font.md, fontWeight: '800', color: colors.text },
  orderRef: { fontSize: font.sm, color: colors.muted, fontWeight: '600', marginTop: 1 },
  date: { fontSize: font.sm, color: colors.muted },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  itemsCount: { fontSize: font.sm, color: colors.text, fontWeight: '600', flexShrink: 1 },
  total: { fontSize: font.lg, fontWeight: '800', color: colors.purple },
  receiptRow: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm, paddingTop: spacing.sm },
  viewReceipt: { color: colors.purple, fontWeight: '800', fontSize: font.sm },
  // Badge sizes to its label and may wrap on narrow widths — long Arabic
  // status names shrink the reference column instead of clipping.
  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, maxWidth: '55%' },
  badgeText: { fontSize: font.xs, fontWeight: '800', textAlign: 'center' },
  posChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, marginTop: spacing.xs,
  },
  posDot: { width: 7, height: 7, borderRadius: 4 },
  posChipText: { fontSize: font.xs, fontWeight: '800', flexShrink: 1 },
});
