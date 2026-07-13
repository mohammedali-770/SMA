/**
 * Cart review: per-line quantity stepper, modifier summary, remove, and a
 * subtotal preview (server recomputes on checkout). Empty cart shows a clear
 * empty state with a shortcut back to the menu. Sticky checkout bar above the
 * safe area.
 */
import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Header } from '../../components/Header';
import { QtyStepper } from '../../components/QtyStepper';
import { EmptyView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { useCart } from '../../store';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { formatSAR } from '../../utils/format';
import type { CartItem } from '../../types/models';

export function CartScreen() {
  const insets = useSafeAreaInsets();
  const { t, pick, lang } = useI18n();
  const cart = useCart();

  if (cart.items.length === 0) {
    return (
      <View style={styles.root}>
        <Header title={t('myCart')} showBack />
        <EmptyView
          emoji="🛒"
          title={t('emptyCartTitle')}
          subtitle={t('emptyCartSub')}
          actionLabel={t('browseMenu')}
          onAction={() => router.replace('/(tabs)')}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header title={t('myCart')} showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 150 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: spacing.md }}>
          {cart.items.map((it) => (
            <CartLine
              key={it.cartItemId}
              item={it}
              name={pick(it.product.nameEn, it.product.nameAr)}
              modifierSummary={modifierSummary(it, pick)}
              lineTotal={formatSAR(it.unitPrice * it.quantity, lang)}
              removeLabel={t('remove')}
              onInc={() => cart.incrementLine(it.cartItemId)}
              onDec={() => cart.decrementLine(it.cartItemId)}
              onRemove={() => cart.removeLine(it.cartItemId)}
            />
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>{t('subtotal')}</Text>
          <Text style={styles.subtotalValue}>{formatSAR(cart.subtotal, lang)}</Text>
        </View>
        <Pressable style={styles.checkoutBtn} onPress={() => router.push('/checkout')} accessibilityRole="button">
          <Text style={styles.checkoutText}>{t('goToCheckout')}</Text>
          <Text style={styles.checkoutCount}>{cart.count} {cart.count === 1 ? t('item') : t('items')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function modifierSummary(it: CartItem, pick: (en: string, ar: string) => string): string {
  const mods = Object.values(it.selectedModifiers).flat();
  return mods.map((m) => pick(m.nameEn, m.nameAr)).join(' · ');
}

function CartLine({
  item, name, modifierSummary: summary, lineTotal, removeLabel, onInc, onDec, onRemove,
}: {
  item: CartItem; name: string; modifierSummary: string; lineTotal: string;
  removeLabel: string; onInc: () => void; onDec: () => void; onRemove: () => void;
}) {
  return (
    <View style={[styles.line, shadow.card]}>
      <View style={styles.lineTop}>
        <Text style={styles.lineName} numberOfLines={2}>{name}</Text>
        <Text style={styles.lineTotal}>{lineTotal}</Text>
      </View>
      {summary ? <Text style={styles.lineMods}>{summary}</Text> : null}
      <View style={styles.lineBottom}>
        <QtyStepper value={item.quantity} onIncrement={onInc} onDecrement={onDec} small />
        <Pressable onPress={onRemove} hitSlop={14} accessibilityRole="button" accessibilityLabel={removeLabel}>
          <Text style={styles.remove}>{removeLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  line: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  lineName: { flex: 1, fontSize: font.md, fontWeight: '800', color: colors.text },
  lineTotal: { fontSize: font.md, fontWeight: '800', color: colors.purple },
  lineMods: { fontSize: font.sm, color: colors.muted },
  lineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  remove: { color: colors.red, fontWeight: '800', fontSize: font.sm },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.white,
    borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md,
  },
  subtotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subtotalLabel: { fontSize: font.md, color: colors.muted, fontWeight: '700' },
  subtotalValue: { fontSize: font.lg, color: colors.text, fontWeight: '800' },
  checkoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.purple, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
  },
  checkoutText: { color: colors.white, fontWeight: '800', fontSize: font.lg },
  checkoutCount: { color: colors.white, fontWeight: '700', fontSize: font.sm, opacity: 0.9 },
});
