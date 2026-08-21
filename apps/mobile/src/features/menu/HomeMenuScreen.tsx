/** Home + Menu on ONE page with virtualized sections and a sticky cart bar. */
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, SectionList, TextInput, View, type LayoutChangeEvent, type SectionListData, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BannerCarousel } from './BannerCarousel';
import { buildMenuSections, buildSearchIndex, menuItemKey, type MenuSection, type MenuSectionItem } from './menuSections';
import { AlertIcon, DishIcon, SearchIcon } from '../../components/Icons';
import { OpenClosedBadge } from '../../components/OpenClosedBadge';
import { Price } from '../../components/Price';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { radius, space, type as typeScale } from '../../design-system/generated/tokens';
import { SelectableChip, StatusPill } from '../../design-system/ui/Chip';
import { ProductCard } from '../../design-system/ui/ProductCard';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { shouldForceSelection } from '../order/orderContext';
import { useCart, useCatalog, useOrderContext } from '../../store';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';
import { formatSAR } from '../../utils/format';
import type { Product } from '../../types/models';

export { ProductCard };
const SECTION_HEADER_OFFSET = 40; const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 10 };

export function HomeMenuScreen({ suppressInvalidRedirect = false }: { suppressInvalidRedirect?: boolean } = {}) {
  const colors = useThemeColors(); const insets = useSafeAreaInsets(); const { t, pick, lang, toggle, isRTL, rtlText, rtlRow } = useI18n(); const styles = useStyles();
  const { loading, error, reload, refreshAvailability, categories, products, selectedBranch, selectedBranchId, isOrderable, branchIsOpen, groupsForProduct } = useCatalog();
  const cart = useCart(); const { addItem } = cart; const orderCtx = useOrderContext();
  useEffect(() => { if (!suppressInvalidRedirect && shouldForceSelection({ ready: orderCtx.ready, loading, error, valid: orderCtx.valid })) router.replace('/select'); }, [orderCtx.ready, orderCtx.valid, loading, error, suppressInvalidRedirect]);

  // Returning to the menu is the other moment stale availability shows up: the
  // customer may have been sitting on the cart or a product page while the
  // branch closed something. Cheap enough to run on every focus.
  useFocusEffect(useCallback(() => { void refreshAvailability(); }, [refreshAvailability]));

  const [search, setSearch] = useState(''); const listRef = useRef<SectionList<MenuSectionItem, MenuSection>>(null); const chipScrollRef = useRef<ScrollView>(null); const chipOffsets = useRef<Record<string, { x: number; width: number }>>({}); const [activeCatId, setActiveCatId] = useState<string | null>(null);
  const branchOpen = branchIsOpen(selectedBranch); const searchIndex = useMemo(() => buildSearchIndex(products), [products]); const hasModifiers = useCallback((p: Product) => groupsForProduct(p).length > 0, [groupsForProduct]);
  const sections = useMemo(() => buildMenuSections({ products, categories, branchId: selectedBranchId, query: search, searchIndex, isOrderable, hasModifiers }), [products, categories, selectedBranchId, search, searchIndex, isOrderable, hasModifiers]);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => { const section = viewableItems.find((v) => v.section)?.section as MenuSection | undefined; if (section) setActiveCatId((prev) => prev === section.category.id ? prev : section.category.id); }, []);
  const pendingScroll = useRef<{ sectionIndex: number; retried: boolean } | null>(null);
  const scrollToCategory = (catId: string) => { setActiveCatId(catId); const sectionIndex = sections.findIndex((s) => s.category.id === catId); if (sectionIndex < 0) return; pendingScroll.current = { sectionIndex, retried: false }; listRef.current?.scrollToLocation({ sectionIndex, itemIndex: 0, viewOffset: SECTION_HEADER_OFFSET, animated: true }); };
  const onScrollToIndexFailed = (info: { index: number; averageItemLength: number }) => { listRef.current?.getScrollResponder()?.scrollTo({ y: info.averageItemLength * info.index, animated: false }); const pending = pendingScroll.current; if (pending && !pending.retried) { pending.retried = true; setTimeout(() => listRef.current?.scrollToLocation({ sectionIndex: pending.sectionIndex, itemIndex: 0, viewOffset: SECTION_HEADER_OFFSET, animated: true }), 120); } };
  const activeCatIdResolved = activeCatId ?? sections[0]?.category.id ?? null;
  useEffect(() => { const off = activeCatIdResolved ? chipOffsets.current[activeCatIdResolved] : null; if (off) chipScrollRef.current?.scrollTo({ x: Math.max(0, off.x - space.s4), animated: true }); }, [activeCatIdResolved]);
  const handleAdd = useCallback((product: Product, withModifiers: boolean) => { if (withModifiers) router.push(`/product/${product.id}`); else addItem(product, {}, 1); }, [addItem]);
  const renderItem = useCallback(({ item }: { item: MenuSectionItem }) => <ProductCard product={item.product} hasModifiers={item.hasModifiers} available={item.available} onAdd={handleAdd} />, [handleAdd]);

  return <View style={styles.root}>
    <View style={[styles.topBar, { paddingTop: insets.top + space.s2 }]}>
      <View style={styles.brandRow}><Image source={require('../../../assets/logo-mark.png')} style={styles.mark} contentFit="contain" /><View><Text variant="title">{pick('Spicy Meal', 'سبايسي ميل')}</Text><Text variant="caption" tone="secondary" numberOfLines={1}>{pick('Since 1997', 'منذ 1997')}</Text></View></View>
      <Pressable onPress={toggle} hitSlop={8} style={styles.langBtn} accessibilityRole="button"><Text variant="label" tone="ember" align="center">{lang === 'en' ? 'العربية' : 'EN'}</Text></Pressable>
    </View>
    {orderCtx.context ? <Pressable style={[styles.branchRow, rtlRow]} onPress={() => router.push('/select')} accessibilityRole="button">
      <View style={styles.ctxAccent} /><View style={{ flex: 1 }}><View style={[styles.ctxTopRow, rtlRow]}><StatusPill label={orderCtx.context.orderType === 'pickup' ? t('otPickup') : t('otDelivery')} tone="info" />{selectedBranch ? <OpenClosedBadge open={branchOpen} /> : null}</View>
      <Text variant="heading" numberOfLines={1}>{pick(orderCtx.context.branchNameEn, orderCtx.context.branchNameAr)}</Text>{orderCtx.context.orderType === 'delivery' ? <Text variant="caption" tone="secondary" numberOfLines={1}>{[orderCtx.context.deliveryDescription, orderCtx.context.deliveryFee != null ? `${t('deliveryFee')} ${formatSAR(orderCtx.context.deliveryFee, lang)}` : null].filter(Boolean).join(' · ')}</Text> : null}</View>
      <View style={styles.changeBtn}><Text variant="label" tone="ember" align="center">{t('otChange')}</Text></View>
    </Pressable> : null}
    <BannerCarousel />
    {loading ? <MenuSkeleton /> : error ? <ErrorView message={error} onRetry={reload} retryLabel={t('retry')} icon={<AlertIcon />} fallbackTitle={pick("The menu didn't load", 'تعذّر تحميل القائمة')} /> : !orderCtx.valid ? <LoadingView label={t('loading')} /> : <>
      {!branchOpen ? <View style={styles.closedNotice}><Text variant="label" style={{ color: colors.danger }}>{t('branchClosedNotice')}</Text></View> : null}
      <View style={[styles.searchWrap, rtlRow]}><SearchIcon color={colors.appText3} /><TextInput value={search} onChangeText={setSearch} placeholder={t('searchPlaceholder')} placeholderTextColor={colors.appText3} style={[styles.searchInput, rtlText]} autoCapitalize="none" returnKeyType="search" /></View>
      {sections.length > 0 ? <View style={styles.chipsWrap}><ScrollView ref={chipScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, isRTL && styles.chipsRTL]} onContentSizeChange={() => { if (isRTL) chipScrollRef.current?.scrollToEnd({ animated: false }); }}>
        {sections.map((s) => <SelectableChip key={s.category.id} label={pick(s.category.nameEn, s.category.nameAr)} selected={s.category.id === activeCatIdResolved} onPress={() => scrollToCategory(s.category.id)} onLayout={(e: LayoutChangeEvent) => { chipOffsets.current[s.category.id] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width }; }} />)}
      </ScrollView></View> : null}
      {sections.length === 0 ? <EmptyView icon={<DishIcon />} title={t('noProducts')} /> : <SectionList ref={listRef} sections={sections} keyExtractor={menuItemKey} renderItem={renderItem} renderSectionHeader={({ section }: { section: SectionListData<MenuSectionItem, MenuSection> }) => <Text variant="title" style={styles.sectionTitle}>{pick(section.category.nameEn, section.category.nameAr)}</Text>} renderSectionFooter={SectionFooter} ItemSeparatorComponent={ItemSeparator} stickySectionHeadersEnabled={false} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={VIEWABILITY_CONFIG} onScrollToIndexFailed={onScrollToIndexFailed} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={9} contentContainerStyle={{ padding: space.s4, paddingBottom: cart.count > 0 ? 120 : space.s6 }} showsVerticalScrollIndicator={false} />}
    </>}
    {cart.count > 0 ? <View style={[styles.cartBar, { paddingBottom: insets.bottom + space.s2 }]}><Pressable style={[styles.cartBtn, rtlRow]} onPress={() => router.push('/cart')} accessibilityRole="button"><View style={styles.cartCount}><Text variant="label" tone="onEmber" align="center">{cart.count}</Text></View><Text variant="heading" tone="onEmber" style={{ flex: 1 }}>{t('myCart')}</Text><Price amount={cart.subtotal} size={typeScale.body.size} color={colors.onEmber} weight="700" /></Pressable></View> : null}
  </View>;
}
function ItemSeparator() { return <View style={{ height: space.s3 }} />; }
function MenuSkeleton() { const s = useSkeletonStyles(); return <View style={{ padding: space.s4, gap: space.s3 }} pointerEvents="none" accessibilityElementsHidden><View style={[s.block, { height: 64 }]} /><View style={{ flexDirection: 'row', gap: space.s2 }}><View style={[s.chip, { width: 88 }]} /><View style={[s.chip, { width: 72 }]} /><View style={[s.chip, { width: 96 }]} /></View>{[0,1,2,3].map((i) => <View key={i} style={s.card}><View style={s.img} /><View style={{ flex: 1, padding: space.s3, gap: space.s2 }}><View style={[s.line, { width: '70%' }]} /><View style={[s.line, { width: '95%' }]} /><View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s2 }}><View style={[s.line, { width: 64 }]} /><View style={[s.chip, { width: 76 }]} /></View></View></View>)}</View>; }
const useSkeletonStyles = makeStyles((color) => ({ block: { backgroundColor: color.appSurface2, borderRadius: radius.md, borderWidth: 1, borderColor: color.appLine }, chip: { height: 34, borderRadius: radius.pill, backgroundColor: color.appSurface2, borderWidth: 1, borderColor: color.appLine }, card: { flexDirection: 'row' as const, backgroundColor: color.appSurface, borderRadius: radius.lg, overflow: 'hidden' as const, borderWidth: 1, borderColor: color.appLine }, img: { width: 104, minHeight: 112, backgroundColor: color.appSurface2 }, line: { height: 12, borderRadius: 6, backgroundColor: color.appSurface2 } }));
function SectionFooter() { return <View style={{ height: space.s5 }} />; }
const useStyles = makeStyles((color) => ({
  root: { flex: 1, backgroundColor: color.appBg }, topBar: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: space.s4, paddingBottom: space.s3, backgroundColor: color.appSurface, borderBottomWidth: 1, borderBottomColor: color.appLine }, brandRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s2 }, mark: { width: 38, height: 38 }, langBtn: { paddingHorizontal: space.s3, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ember },
  branchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s3, marginHorizontal: space.s4, marginTop: space.s3, padding: space.s3, backgroundColor: color.appSurface, borderRadius: radius.md, borderWidth: 1, borderColor: color.appLine, overflow: 'hidden' as const }, ctxAccent: { alignSelf: 'stretch' as const, width: 4, borderRadius: 2, backgroundColor: color.ember }, ctxTopRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s2, marginBottom: 4 }, changeBtn: { paddingHorizontal: space.s3, paddingVertical: space.s2, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ember },
  closedNotice: { backgroundColor: color.dangerTint, marginHorizontal: space.s4, marginTop: space.s3, padding: space.s3, borderRadius: radius.md, borderWidth: 1, borderColor: color.dangerLine }, searchWrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s2, marginHorizontal: space.s4, marginTop: space.s3, paddingHorizontal: space.s3, backgroundColor: color.appSurface, borderRadius: radius.md, borderWidth: 1, borderColor: color.appLine }, searchInput: { flex: 1, paddingVertical: space.s3, fontSize: typeScale.body.size, color: color.appText }, chipsWrap: { marginTop: space.s3 }, chips: { paddingHorizontal: space.s4, gap: space.s2 }, chipsRTL: { flexDirection: 'row-reverse' as const }, sectionTitle: { marginBottom: space.s3 },
  cartBar: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, paddingHorizontal: space.s4, paddingTop: space.s2, backgroundColor: 'transparent' }, cartBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s3, backgroundColor: color.ember, borderRadius: radius.lg, paddingHorizontal: space.s4, paddingVertical: space.s4 }, cartCount: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: color.emberDeep, alignItems: 'center' as const, justifyContent: 'center' as const },
}));
