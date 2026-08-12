/** Cart review with quantity controls and a sticky checkout bar. */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Header } from '../../components/Header';
import { BagIcon, DishIcon } from '../../components/Icons';
import { Price } from '../../components/Price';
import { QtyStepper } from '../../components/QtyStepper';
import { EmptyView } from '../../components/StateViews';
import { radius, space, type as typeScale } from '../../design-system/generated/tokens';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { useCart, useOrderContext } from '../../store';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';
import type { CartItem } from '../../types/models';

export function CartScreen() {
  const insets = useSafeAreaInsets();
  const { t, pick, rtlRow } = useI18n();
  const styles = useStyles();
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
      <ScrollView contentContainerStyle={{ padding: space.s4, paddingBottom: 150 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: space.s3 }}>
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

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.s2 }]}>
        <View style={[styles.subtotalRow, rtlRow]}>
          <Text variant="body" tone="secondary">{t('subtotal')}</Text>
          <Price amount={cart.subtotal} size={typeScale.heading.size} weight="700" />
        </View>
        {orderCtx.valid ? (
          <Pressable style={[styles.checkoutBtn, rtlRow]} onPress={() => router.push('/checkout')} accessibilityRole="button">
            <Text variant="heading" tone="onEmber">{t('goToCheckout')}</Text>
            <Text variant="caption" tone="onEmber">{cart.count} {cart.count === 1 ? t('item') : t('items')}</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.checkoutBtn, styles.checkoutBtnDisabled]} onPress={() => router.replace('/select')} accessibilityRole="button">
            <Text variant="heading" tone="secondary" align="center">{t('otSelectToOrder')}</Text>
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
  const { rtlRow } = useI18n();
  const color = useThemeColors();
  const styles = useStyles();
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!item.product.imageUrl && !imgFailed;

  return (
    <View style={[styles.line, rtlRow]}>
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
          <DishIcon size={26} color={color.heatOff} />
        </View>
      )}
      <View style={styles.lineBody}>
        <View style={[styles.lineTop, rtlRow]}>
          <Text variant="heading" style={{ flex: 1 }} numberOfLines={2}>{name}</Text>
          <Price amount={lineAmount} size={typeScale.body.size} weight="700" />
        </View>
        {summary ? <Text variant="caption" tone="secondary" numberOfLines={2}>{summary}</Text> : null}
        <View style={[styles.lineBottom, rtlRow]}>
          <QtyStepper value={item.quantity} onIncrement={onInc} onDecrement={onDec} small />
          <Pressable
            onPress={onRemove}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={removeLabel}
            style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.7 }]}
          >
            <Text variant="caption" align="center" style={{ color: color.danger }}>{removeLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  root: { flex: 1, backgroundColor: color.appBg },
  line: {
    flexDirection: 'row' as const, backgroundColor: color.appSurface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: color.appLine, padding: space.s3, gap: space.s3,
  },
  lineImg: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: color.appSurface2 },
  lineImgEmpty: { alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: color.appSurface3 },
  lineBody: { flex: 1, gap: space.s1 },
  lineTop: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, justifyContent: 'space-between' as const, gap: space.s3 },
  lineBottom: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginTop: space.s1 },
  removeBtn: { minHeight: 34, justifyContent: 'center' as const, paddingHorizontal: space.s3, borderRadius: radius.pill, backgroundColor: color.dangerTint },
  footer: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: color.appSurface,
    borderTopWidth: 1, borderTopColor: color.appLine,
    paddingHorizontal: space.s4, paddingTop: space.s3, gap: space.s3,
  },
  subtotalRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  checkoutBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    backgroundColor: color.ember, borderRadius: radius.lg,
    paddingHorizontal: space.s5, paddingVertical: space.s4, minHeight: 54,
  },
  checkoutBtnDisabled: { backgroundColor: color.disabledBg, justifyContent: 'center' as const },
}));
