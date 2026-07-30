/**
 * One order in My Orders — PRESENTATION ONLY.
 *
 * The confirmation chip shows the SAME derived state as the receipt. My Orders
 * must not collapse those states into a generic "placed" chip: a card whose
 * order never reached the branch reads "Order not sent yet", never a success.
 *
 * Only the branch's own number is customer-visible; until the branch issues one
 * the card leads with the confirmation state instead of an internal id — and in
 * that case the chip is suppressed, because it would repeat the heading word
 * for word.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Price } from '../../../components/Price';
import { priceAccessibilityLabel } from '../../../design-system/generated/money';
import { color, radius, space, type as typeScale } from '../../../design-system/generated/tokens';
import { StatusPill, type ChipTone } from '../../../design-system/ui/Chip';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { orderDisplayNumber } from '../../../lib/mappers';
import { formatRiyadhDateTime } from '../../../utils/format';
import { confirmationPresentation, orderConfirmationState } from '../orderConfirmation';
import { TONE_CHIP } from './confirmationTone';
import type { Order, OrderStatus } from '../../../types/models';

/** Order status → pill tone. Delivered reads settled, cancelled reads ended. */
function statusTone(status: OrderStatus): ChipTone {
  if (status === 'delivered') return 'success';
  if (status === 'cancelled') return 'danger';
  return 'info';
}

export function OrderCard({
  order, statusLabel, onPress,
}: {
  order: Order;
  statusLabel: string;
  onPress: () => void;
}) {
  const { t, lang, isRTL, rtlRow } = useI18n();

  const branchNo = orderDisplayNumber(order);
  const confirmation = confirmationPresentation(orderConfirmationState(order));
  const heading = branchNo ?? t(confirmation.titleKey);
  const itemCount = order.items.reduce((n, it) => n + it.quantity, 0);
  const meta = `${itemCount} ${t('items')} · ${order.orderType === 'delivery' ? t('delivery') : t('pickup')}`;
  // Screen-reader only. The visible total is the Price component, whose riyal
  // SVG has no text equivalent, so this is the only thing assistive tech can
  // read — and it must say the currency, not the code "SAR".
  const totalLabel = priceAccessibilityLabel(order.total, lang);
  // Show the chip only when the heading is NOT already this state's title.
  // Without a branch number the heading falls back to that very title, so the
  // chip repeated it word for word — "Order not sent yet" printed twice on one
  // card. The original rule named two states explicitly; the real rule is
  // "never repeat the heading", and `branchNo` is exactly what decides it.
  const showChip = branchNo != null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      // Composed only from values already displayed on the card.
      accessibilityLabel={`${heading} · ${statusLabel} · ${totalLabel}`}
    >
      <View style={[styles.top, rtlRow]}>
        <Text variant="heading" numberOfLines={1} style={styles.heading}>{heading}</Text>
        <StatusPill label={statusLabel} tone={statusTone(order.status)} style={styles.pill} />
      </View>

      <Text variant="caption" tone="tertiary">{formatRiyadhDateTime(order.createdAt)}</Text>

      {showChip ? (
        <View style={styles.chipRow}>
          <StatusPill label={t(confirmation.titleKey)} tone={TONE_CHIP[confirmation.tone]} />
        </View>
      ) : null}

      <View style={[styles.bottom, rtlRow]}>
        <Text variant="label" tone="secondary" style={styles.meta}>{meta}</Text>
        <Price amount={order.total} size={typeScale.title.size} color={color.appText} weight="700" />
      </View>

      <View style={styles.footer}>
        <Text variant="label" tone="ember">{t('viewReceipt')} {isRTL ? '‹' : '›'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.appSurface, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: color.appLine, padding: space.s4, gap: space.s1,
  },
  pressed: { opacity: 0.9 },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.s3 },
  heading: { flexShrink: 1 },
  // Sizes to its label and may wrap on narrow widths — long Arabic status names
  // shrink the reference column instead of clipping.
  pill: { maxWidth: '55%' },
  chipRow: { alignSelf: 'flex-start', marginTop: space.s1 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s1 },
  meta: { flexShrink: 1 },
  footer: { borderTopWidth: 1, borderTopColor: color.appLine, marginTop: space.s2, paddingTop: space.s2 },
});
