/** Cart review with editable item cards, quantity controls and sticky checkout. */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../../components/Header';
import { BagIcon, DishIcon } from '../../components/Icons';
import { Price } from '../../components/Price';
import { QtyStepper } from '../../components/QtyStepper';
import { EmptyView } from '../../components/StateViews';
import { priceAccessibilityLabel } from '../../design-system/generated/money';
import { radius, space, type as typeScale } from '../../design-system/generated/tokens';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { useCart, useOrderContext } from '../../store';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';
import type { CartItem } from '../../types/models';
import { SuggestionStrip, type SuggestionCardModel } from './SuggestionStrip';
import { useCartSuggestions } from './useCartSuggestions';

export function CartScreen() {
  const insets = useSafeAreaInsets(); const { t, pick, rtlRow, isRTL, lang } = useI18n(); const styles = useStyles(); const cart = useCart(); const orderCtx = useOrderContext();
  // Called before the empty-cart early return so the hook order never changes.
  const { suggestions, noteRemoved, noteSlateVisible } = useCartSuggestions();
  const suggestionCards: SuggestionCardModel[] = suggestions.map((s) => {
    const name = pick(s.product.nameEn, s.product.nameAr);
    const configure = s.addability === 'configure';
    const actionLabel = configure ? t('customizeAdd') : t('addToCart');
    const kcalLabel = s.product.calories > 0 ? `${s.product.calories} ${t('kcal')}` : '';
    return {
      id: s.product.id, name, imageUrl: s.product.imageUrl, price: s.product.price, kcalLabel, actionLabel,
      // The card is one accessibility element, so this label REPLACES the
      // Price and kcal children. Omitting the money would let a one-tap card
      // commit a charge a screen-reader user was never told about.
      accessibilityLabel: [`${actionLabel}: ${name}`, priceAccessibilityLabel(s.product.price, lang), kcalLabel]
        .filter(Boolean).join(', '),
      accessibilityHint: configure
        ? pick('Opens item options', 'يفتح خيارات المنتج')
        : pick('Adds to your cart', 'يضيف إلى سلتك'),
    };
  });
  // Dwell alone is not visibility: past three cart lines the rail sits below the
  // fold, so an impression armed on mount would fatigue cards nobody saw.
  const viewportH = useRef(0); const scrollY = useRef(0); const stripTop = useRef<number | null>(null);
  const evaluateStripVisible = useCallback(() => {
    const top = stripTop.current;
    if (top === null || viewportH.current === 0) return;
    if (top < scrollY.current + viewportH.current - 24) noteSlateVisible();
  }, [noteSlateVisible]);
  const slateIds = suggestions.map((s) => s.product.id).join('|');
  // A new slate starts unseen, so re-test without waiting for a scroll event.
  useEffect(() => { evaluateStripVisible(); }, [slateIds, evaluateStripVisible]);
  // A product with any modifier group opens its page — matching the menu, and
  // so an optional PRICED group can never be added cheaper than the card shows.
  const onSuggestionPress = (id: string) => {
    const s = suggestions.find((x) => x.product.id === id); if (!s) return;
    if (s.addability === 'configure') router.push({ pathname: '/product/[id]', params: { id: s.product.id } });
    else cart.addItem(s.product, {}, 1);
  };
  if (cart.items.length === 0) return <View style={styles.root}><Header title={t('myCart')} showBack safeTop /><EmptyView icon={<BagIcon size={48} />} title={t('emptyCartTitle')} subtitle={t('emptyCartSub')} actionLabel={t('browseMenu')} onAction={() => router.replace('/(tabs)')} /></View>;
  return (
    <View style={styles.root}>
      <Header title={t('myCart')} showBack safeTop />
      <ScrollView contentContainerStyle={{ padding: space.s4, paddingBottom: 150 }} showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onLayout={(e) => { viewportH.current = e.nativeEvent.layout.height; evaluateStripVisible(); }}
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; evaluateStripVisible(); }}><View style={{ gap: space.s3 }}>
        {cart.items.map((it) => <CartLine key={it.cartItemId} item={it} name={pick(it.product.nameEn, it.product.nameAr)} modifierSummary={modifierSummary(it, pick)} lineAmount={it.unitPrice * it.quantity}
          removeLabel={t('remove')} editLabel={pick('Edit item', 'تعديل المنتج')}
          onEdit={() => router.push({ pathname: '/product/[id]', params: { id: it.product.id, cartItemId: it.cartItemId } })}
          onInc={() => cart.incrementLine(it.cartItemId)}
          // Suggesting back the item the customer just deleted reads as broken —
          // and removal frees it from the in-cart filter, so without this it
          // would immediately become a high-scoring candidate.
          onDec={() => { if (it.quantity === 1) noteRemoved(it.product.id); cart.decrementLine(it.cartItemId); }}
          onRemove={() => { noteRemoved(it.product.id); cart.removeLine(it.cartItemId); }} />)}
      </View>
      <View onLayout={(e) => { stripTop.current = e.nativeEvent.layout.y; evaluateStripVisible(); }}>
        <SuggestionStrip title={t('cartSuggestTitle')} items={suggestionCards} isRTL={isRTL} onPress={onSuggestionPress} />
      </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.s2 }]}>
        <View style={[styles.subtotalRow, rtlRow]}><Text variant="body" tone="secondary">{t('subtotal')}</Text><Price amount={cart.subtotal} size={typeScale.heading.size} weight="700" /></View>
        {orderCtx.valid ? <Pressable style={[styles.checkoutBtn, rtlRow]} onPress={() => router.push('/checkout')} accessibilityRole="button"><Text variant="heading" tone="onEmber">{t('goToCheckout')}</Text><Text variant="caption" tone="onEmber">{cart.count} {cart.count === 1 ? t('item') : t('items')}</Text></Pressable>
          : <Pressable style={[styles.checkoutBtn, styles.checkoutBtnDisabled]} onPress={() => router.replace('/select')} accessibilityRole="button"><Text variant="heading" tone="secondary" align="center">{t('otSelectToOrder')}</Text></Pressable>}
      </View>
    </View>
  );
}
function modifierSummary(it: CartItem, pick: (en: string, ar: string) => string): string { return Object.values(it.selectedModifiers).flat().map((m) => pick(m.nameEn, m.nameAr)).join(' · '); }

export function CartLine({ item, name, modifierSummary: summary, lineAmount, removeLabel, editLabel, onEdit, onInc, onDec, onRemove }: {
  item: CartItem; name: string; modifierSummary: string; lineAmount: number; removeLabel: string; editLabel: string; onEdit: () => void; onInc: () => void; onDec: () => void; onRemove: () => void;
}) {
  const colors = useThemeColors(); const { rtlRow } = useI18n(); const styles = useStyles(); const [imgFailed, setImgFailed] = useState(false); const showImage = !!item.product.imageUrl && !imgFailed;
  return <View style={styles.line}>
    <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`${editLabel}: ${name}`} accessibilityHint={editLabel} style={({ pressed }) => [styles.editArea, rtlRow, pressed && styles.pressed]}>
      {showImage ? <Image source={{ uri: item.product.imageUrl }} style={styles.lineImg} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={item.product.id} onError={() => setImgFailed(true)} /> : <View style={[styles.lineImg, styles.lineImgEmpty]}><DishIcon size={26} color={colors.heatOff} /></View>}
      <View style={styles.lineBody}><View style={[styles.lineTop, rtlRow]}><Text variant="heading" style={{ flex: 1 }} numberOfLines={2}>{name}</Text><Price amount={lineAmount} size={typeScale.body.size} weight="700" /></View>
        {summary ? <Text variant="caption" tone="secondary" numberOfLines={2}>{summary}</Text> : null}</View>
    </Pressable>
    <View style={[styles.lineBottom, rtlRow]}><QtyStepper value={item.quantity} onIncrement={onInc} onDecrement={onDec} small /><Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={removeLabel} style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}><Text variant="caption" align="center" style={{ color: colors.danger }}>{removeLabel}</Text></Pressable></View>
  </View>;
}
const useStyles = makeStyles((color) => ({
  root: { flex: 1, backgroundColor: color.appBg }, line: { backgroundColor: color.appSurface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.appLine, padding: space.s3, gap: space.s3 },
  editArea: { flexDirection: 'row' as const, gap: space.s3 }, lineImg: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: color.appSurface2 }, lineImgEmpty: { alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: color.appSurface3 }, lineBody: { flex: 1, gap: space.s1, justifyContent: 'center' as const },
  lineTop: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, justifyContent: 'space-between' as const, gap: space.s3 }, lineBottom: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, borderTopWidth: 1, borderTopColor: color.appLine, paddingTop: space.s2 },
  removeBtn: { minHeight: 34, justifyContent: 'center' as const, paddingHorizontal: space.s3, borderRadius: radius.pill, backgroundColor: color.dangerTint }, pressed: { opacity: 0.72 },
  footer: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: color.appSurface, borderTopWidth: 1, borderTopColor: color.appLine, paddingHorizontal: space.s4, paddingTop: space.s3, gap: space.s3 }, subtotalRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  checkoutBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, backgroundColor: color.ember, borderRadius: radius.lg, paddingHorizontal: space.s5, paddingVertical: space.s4, minHeight: 54 }, checkoutBtnDisabled: { backgroundColor: color.disabledBg, justifyContent: 'center' as const },
}));
