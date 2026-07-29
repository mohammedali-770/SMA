/**
 * Cart review: per-line quantity stepper, modifier summary, remove, and a
 * subtotal preview (server recomputes on checkout). Empty cart shows a clear
 * empty state with a shortcut back to the menu. Sticky checkout bar above the
 * safe area.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Header } from '../../components/Header';
import { BagIcon, DishIcon } from '../../components/Icons';
import { Price } from '../../components/Price';
import { QtyStepper } from '../../components/QtyStepper';
import { EmptyView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { useCart, useOrderContext } from '../../store';
import { colors, font, radius, shadow, spacing } from '../../theme';
import type { CartItem } from '../../types/models';

export function CartScreen() {
  const insets = useSafeAreaInsets();
  const { t, pick, rtlRow } = useI18n();
  const cart = useCart();
  const orderCtx = useOrderContext();

  if (cart.items.length === 0) {
    return (
      <View style={styles.root}>
        <Header title={t('myCart')} showBack safeTop />
        <EmptyView
          icon={<BagIcon size={48} />}
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
      <Header title={t('myCart')} showBack safeTop />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 150 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: spacing.md }}>
          {cart.items.map((it) => (
            <CartLine
              key={it.cartItemId}
              item={it}
              name={pick(it.product.nameEn, it.product.nameAr)}
              modifierSummary={modifierSummary(it, pick)}
              lineAmount={it.unitPrice * it.quantity}
              removeLabel={t('remove')}
              onInc={() => cart.incrementLine(it.cartItemId)}
              onDec={() => cart.decrementLine(it.cartItemId)}
              onRemove={() => cart.removeLine(it.cartItemId)}
            />
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={[styles.subtotalRow, rtlRow]}>
          <Text style={styles.subtotalLabel}>{t('subtotal')}</Text>
          <Price amount={cart.subtotal} size={font.lg} color={colors.purple} weight="800" />
        </View>
        {orderCtx.valid ? (
          <Pressable style={[styles.checkoutBtn, rtlRow]} onPress={() => router.push('/checkout')} accessibilityRole="button">
            <Text style={styles.checkoutText}>{t('goToCheckout')}</Text>
            <Text style={styles.checkoutCount}>{cart.count} {cart.count === 1 ? t('item') : t('items')}</Text>
          </Pressable>
        ) : (
          // No valid order context — checkout is blocked; send back to selection.
          <Pressable style={[styles.checkoutBtn, styles.checkoutBtnDisabled]} onPress={() => router.replace('/select')} accessibilityRole="button">
            <Text style={styles.checkoutText}>{t('otSelectToOrder')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function modifierSummary(it: CartItem, pick: (en: string, ar: string) => string): string {
  const mods = Object.values(it.selectedModifiers).flat();
  return mods.map((m) => pick(m.nameEn, m.nameAr)).join(' · ');
}

export function CartLine({
  item, name, modifierSummary: summary, lineAmount, removeLabel, onInc, onDec, onRemove,
}: {
  item: CartItem; name: string; modifierSummary: string; lineAmount: number;
  removeLabel: string; onInc: () => void; onDec: () => void; onRemove: () => void;
}) {
  const { rtlText, rtlRow } = useI18n();
  const [imgFailed, setImgFailed] = useState(false);
  // The full Product travels with every cart line, so the thumbnail reuses the
  // image already in the menu's memory-disk cache — no fetch is introduced.
  const showImage = !!item.product.imageUrl && !imgFailed;
  return (
    // Mirrored in Arabic: thumbnail on the reading edge, like the menu cards.
    <View style={[styles.line, rtlRow, shadow.card]}>
      {showImage ? (
        <Image
          source={{ uri: item.product.imageUrl }}
          style={styles.lineImg}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
          recyclingKey={item.product.id}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <View style={[styles.lineImg, styles.lineImgEmpty]}>
          <DishIcon size={26} />
        </View>
      )}
      <View style={styles.lineBody}>
        <View style={[styles.lineTop, rtlRow]}>
          <Text style={[styles.lineName, rtlText]} numberOfLines={2}>{name}</Text>
          <Price amount={lineAmount} size={font.md} color={colors.purple} weight="800" />
        </View>
        {summary ? <Text style={[styles.lineMods, rtlText]} numberOfLines={2}>{summary}</Text> : null}
        <View style={[styles.lineBottom, rtlRow]}>
          <QtyStepper value={item.quantity} onIncrement={onInc} onDecrement={onDec} small />
          <Pressable
            onPress={onRemove}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={removeLabel}
            style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.remove}>{removeLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  line: {
    flexDirection: 'row', backgroundColor: colors.white, borderRadius: radius.lg,
    borderCurve: 'continuous', borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, gap: spacing.md,
  },
  lineImg: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.bgAlt },
  lineImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  lineBody: { flex: 1, gap: spacing.xs },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  lineName: { flex: 1, fontSize: font.md, fontWeight: '800', color: colors.text },
  lineTotal: { fontSize: font.md, fontWeight: '800', color: colors.purple },
  lineMods: { fontSize: font.sm, color: colors.muted },
  lineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  removeBtn: {
    minHeight: 34, justifyContent: 'center', paddingHorizontal: spacing.md,
    borderRadius: radius.pill, backgroundColor: colors.dangerBg,
  },
  remove: { color: colors.danger, fontWeight: '800', fontSize: font.sm },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.white,
    borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md,
  },
  subtotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subtotalLabel: { fontSize: font.md, color: colors.muted, fontWeight: '700' },
  subtotalValue: { fontSize: font.lg, color: colors.purple, fontWeight: '800' },
  checkoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    // Purple, not red: the design system gives primary actions the brand purple
    // and keeps red for destructive ones (Remove, above, is correctly red).
    backgroundColor: colors.purple, borderRadius: radius.lg, borderCurve: 'continuous',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, minHeight: 54,
  },
  checkoutBtnDisabled: { backgroundColor: colors.muted, justifyContent: 'center' },
  checkoutText: { color: colors.white, fontWeight: '800', fontSize: font.lg },
  checkoutCount: { color: colors.white, fontWeight: '700', fontSize: font.sm, opacity: 0.9 },
});
