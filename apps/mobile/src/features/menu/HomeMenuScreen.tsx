/**
 * Home + Menu on ONE page (no separate Menu tab):
 *  - Spicy Meal logo at the top (no phone icon), with an EN/AR toggle.
 *  - Manual branch selector (never auto-selected). No branch => a clear CTA.
 *  - A closed branch shows a notice; the menu is browsable but checkout blocks.
 *  - Horizontal, dynamic category chips; tapping one scrolls to its section.
 *  - Product cards: "Add" for simple items, "Customize & Add" when a product
 *    has modifier groups (opens the product detail screen).
 *  - A sticky cart bar sits above the safe area whenever the cart has items.
 *
 * Performance: the menu is a VIRTUALIZED SectionList (only ~a screenful of
 * cards is mounted at a time), ProductCard is memoized with stable props (a
 * cart tap re-renders the screen but not the cards), search runs against a
 * lowercased index built once per catalog load, and per-card hasModifiers is
 * precomputed in the sections instead of calling groupsForProduct per render.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable, ScrollView, SectionList, StyleSheet, TextInput, View,
  type LayoutChangeEvent, type SectionListData, type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BannerCarousel } from './BannerCarousel';
import { buildMenuSections, buildSearchIndex, menuItemKey, type MenuSection, type MenuSectionItem } from './menuSections';
import { AlertIcon, DishIcon, SearchIcon } from '../../components/Icons';
import { OpenClosedBadge } from '../../components/OpenClosedBadge';
import { Price } from '../../components/Price';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { color, radius, space, type as typeScale } from '../../design-system/generated/tokens';
import { SelectableChip, StatusPill } from '../../design-system/ui/Chip';
import { ProductCard } from '../../design-system/ui/ProductCard';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { shouldForceSelection } from '../order/orderContext';
import { useCart, useCatalog, useOrderContext } from '../../store';
import { formatSAR } from '../../utils/format';
import type { Product } from '../../types/models';

// ProductCard now lives in the design system; re-exported so existing importers
// (dev-preview) keep working against one implementation.
export { ProductCard };

// Approximate rendered height of a section header (title + margin) so a chip
// tap positions the SECTION TITLE at the top, not the first card.
const SECTION_HEADER_OFFSET = 40;

// SectionList requires a stable viewabilityConfig identity across renders.
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 10 };

export function HomeMenuScreen() {
  const insets = useSafeAreaInsets();
  const { t, pick, lang, toggle, isRTL, rtlText, rtlRow } = useI18n();
  const {
    loading, error, reload, categories, products, selectedBranch, selectedBranchId,
    isAvailable, branchIsOpen, groupsForProduct,
  } = useCatalog();
  const cart = useCart();
  const { addItem } = cart;
  const orderCtx = useOrderContext();

  // BLOCKING GATE: no valid order context → the menu is not usable; send the
  // customer to the full-screen order-type selection first. Fires only once the
  // persisted context is hydrated and the catalog has loaded without error
  // (decision rule is pure + unit-tested: shouldForceSelection).
  useEffect(() => {
    if (shouldForceSelection({ ready: orderCtx.ready, loading, error, valid: orderCtx.valid })) {
      router.replace('/select');
    }
  }, [orderCtx.ready, orderCtx.valid, loading, error]);

  const [search, setSearch] = useState('');
  const listRef = useRef<SectionList<MenuSectionItem, MenuSection>>(null);
  // Active category (for the highlighted chip) + horizontal chip-row scrolling.
  const chipScrollRef = useRef<ScrollView>(null);
  const chipOffsets = useRef<Record<string, { x: number; width: number }>>({});
  const [activeCatId, setActiveCatId] = useState<string | null>(null);

  const branchOpen = branchIsOpen(selectedBranch);

  // Lowercased searchable text, built once per catalog load (not per keystroke).
  const searchIndex = useMemo(() => buildSearchIndex(products), [products]);
  const hasModifiers = useCallback(
    (p: Product) => groupsForProduct(p).length > 0,
    [groupsForProduct],
  );

  // Products visible for the chosen branch + search, grouped by category. Item
  // objects carry precomputed hasModifiers so cards never resolve groups in render.
  const sections = useMemo(
    () => buildMenuSections({
      products, categories, branchId: selectedBranchId, query: search, searchIndex, isAvailable, hasModifiers,
    }),
    [products, categories, selectedBranchId, search, searchIndex, isAvailable, hasModifiers],
  );

  // Scroll-spy: the topmost visible item's section drives the highlighted chip.
  // Empty-deps callback = stable identity, which SectionList requires.
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const section = viewableItems.find((v) => v.section)?.section as MenuSection | undefined;
    if (section) setActiveCatId((prev) => (prev === section.category.id ? prev : section.category.id));
  }, []);

  // Chip tap → jump to that section. A far-off section may not be measured yet
  // (virtualization); onScrollToIndexFailed jumps approximately, then retries
  // once so the landing is exact.
  const pendingScroll = useRef<{ sectionIndex: number; retried: boolean } | null>(null);
  const scrollToCategory = (catId: string) => {
    setActiveCatId(catId);
    const sectionIndex = sections.findIndex((s) => s.category.id === catId);
    if (sectionIndex < 0) return;
    pendingScroll.current = { sectionIndex, retried: false };
    listRef.current?.scrollToLocation({ sectionIndex, itemIndex: 0, viewOffset: SECTION_HEADER_OFFSET, animated: true });
  };
  const onScrollToIndexFailed = (info: { index: number; averageItemLength: number }) => {
    listRef.current?.getScrollResponder()?.scrollTo({ y: info.averageItemLength * info.index, animated: false });
    const pending = pendingScroll.current;
    if (pending && !pending.retried) {
      pending.retried = true;
      setTimeout(() => {
        listRef.current?.scrollToLocation({
          sectionIndex: pending.sectionIndex, itemIndex: 0, viewOffset: SECTION_HEADER_OFFSET, animated: true,
        });
      }, 120);
    }
  };

  // Which chip is highlighted: the category tapped, else the section currently
  // scrolled into view, else the first section.
  const activeCatIdResolved = activeCatId ?? sections[0]?.category.id ?? null;

  // Keep the highlighted chip visible in the horizontal chip row.
  useEffect(() => {
    const off = activeCatIdResolved ? chipOffsets.current[activeCatIdResolved] : null;
    if (off) chipScrollRef.current?.scrollTo({ x: Math.max(0, off.x - space.s4), animated: true });
  }, [activeCatIdResolved]);

  // Stable add handler so memoized cards never re-render from a new closure.
  const handleAdd = useCallback((product: Product, withModifiers: boolean) => {
    if (withModifiers) router.push(`/product/${product.id}`);
    else addItem(product, {}, 1);
  }, [addItem]);

  const renderItem = useCallback(
    ({ item }: { item: MenuSectionItem }) => (
      <ProductCard product={item.product} hasModifiers={item.hasModifiers} onAdd={handleAdd} />
    ),
    [handleAdd],
  );

  return (
    <View style={styles.root}>
      {/* Top bar: logo + language toggle (no phone icon) */}
      <View style={[styles.topBar, { paddingTop: insets.top + space.s2 }]}>
        <View style={styles.brandRow}>
          <Image source={require('../../../assets/icon.png')} style={styles.mark} contentFit="cover" />
          <View>
            <Text variant="title">{pick('Spicy Meal', 'سبايسي ميل')}</Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {pick('Hot, Crispy, Fresh and Golden Bites', 'حار، مقرمش، طازج ولقيمات ذهبية')}
            </Text>
          </View>
        </View>
        <Pressable onPress={toggle} hitSlop={8} style={styles.langBtn} accessibilityRole="button">
          <Text variant="label" tone="ember" align="center">{lang === 'en' ? 'العربية' : 'EN'}</Text>
        </Pressable>
      </View>

      {/* Selected order-context card (above the banners + search). Tapping it
          re-opens the same blocking Pickup/Delivery selection flow. Mirrored in
          Arabic (accent → info → action), with a purple accent bar on the
          reading edge so the current context scans instantly. */}
      {orderCtx.context ? (
        <Pressable style={[styles.branchRow, rtlRow]} onPress={() => router.push('/select')} accessibilityRole="button">
          <View style={styles.ctxAccent} />
          <View style={{ flex: 1 }}>
            <View style={[styles.ctxTopRow, rtlRow]}>
              <StatusPill
                label={orderCtx.context.orderType === 'pickup' ? t('otPickup') : t('otDelivery')}
                tone="info"
              />
              {selectedBranch ? <OpenClosedBadge open={branchOpen} /> : null}
            </View>
            <Text variant="heading" numberOfLines={1}>
              {pick(orderCtx.context.branchNameEn, orderCtx.context.branchNameAr)}
            </Text>
            {orderCtx.context.orderType === 'delivery' ? (
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {[orderCtx.context.deliveryDescription,
                  orderCtx.context.deliveryFee != null ? `${t('deliveryFee')} ${formatSAR(orderCtx.context.deliveryFee, lang)}` : null]
                  .filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          <View style={styles.changeBtn}>
            <Text variant="label" tone="ember" align="center">{t('otChange')}</Text>
          </View>
        </Pressable>
      ) : null}

      {/* Promotional banners — below the branch selector, above the search bar.
          Self-fetching; renders nothing when there are no active banners. */}
      <BannerCarousel />

      {loading ? (
        // Static skeleton shaped like the final layout (chips + cards) so the
        // menu doesn't shift when data lands. No animation loops.
        <MenuSkeleton />
      ) : error ? (
        <ErrorView message={error} onRetry={reload} retryLabel={t('retry')} icon={<AlertIcon />}
          fallbackTitle={pick("The menu didn't load", 'تعذّر تحميل القائمة')} />
      ) : !orderCtx.valid ? (
        // No valid context yet — the gate effect is redirecting to /select.
        <LoadingView label={t('loading')} />
      ) : (
        <>
          {!branchOpen ? (
            <View style={styles.closedNotice}>
              <Text variant="label" style={{ color: color.danger }}>{t('branchClosedNotice')}</Text>
            </View>
          ) : null}

          {/* Search — mirrored so the icon sits on the reading edge in Arabic. */}
          <View style={[styles.searchWrap, rtlRow]}>
            <SearchIcon color={color.appText3} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('searchPlaceholder')}
              placeholderTextColor={color.appText3}
              style={[styles.searchInput, rtlText]}
              autoCapitalize="none"
              returnKeyType="search"
            />
          </View>

          {/* Horizontal categories. In Arabic the row is laid out right-to-left
              and starts scrolled to the reading edge, so the first category is
              where the eye lands; tap/scroll-spy behavior is unchanged. */}
          {sections.length > 0 ? (
            <View style={styles.chipsWrap}>
              <ScrollView
                ref={chipScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.chips, isRTL && styles.chipsRTL]}
                onContentSizeChange={() => { if (isRTL) chipScrollRef.current?.scrollToEnd({ animated: false }); }}
              >
                {sections.map((s) => {
                  const active = s.category.id === activeCatIdResolved;
                  return (
                    <SelectableChip
                      key={s.category.id}
                      label={pick(s.category.nameEn, s.category.nameAr)}
                      selected={active}
                      onPress={() => scrollToCategory(s.category.id)}
                      onLayout={(e: LayoutChangeEvent) => {
                        chipOffsets.current[s.category.id] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
                      }}
                    />
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {/* Menu — virtualized; only the visible window of cards is mounted. */}
          {sections.length === 0 ? (
            <EmptyView icon={<DishIcon />} title={t('noProducts')} />
          ) : (
            <SectionList
              ref={listRef}
              sections={sections}
              keyExtractor={menuItemKey}
              renderItem={renderItem}
              renderSectionHeader={({ section }: { section: SectionListData<MenuSectionItem, MenuSection> }) => (
                <Text variant="title" style={styles.sectionTitle}>
                  {pick(section.category.nameEn, section.category.nameAr)}
                </Text>
              )}
              renderSectionFooter={SectionFooter}
              ItemSeparatorComponent={ItemSeparator}
              stickySectionHeadersEnabled={false}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={VIEWABILITY_CONFIG}
              onScrollToIndexFailed={onScrollToIndexFailed}
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              windowSize={9}
              contentContainerStyle={{ padding: space.s4, paddingBottom: cart.count > 0 ? 120 : space.s6 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      )}

      {/* Sticky cart bar (above the safe area) */}
      {cart.count > 0 ? (
        <View style={[styles.cartBar, { paddingBottom: insets.bottom + space.s2 }]}>
          <Pressable style={[styles.cartBtn, rtlRow]} onPress={() => router.push('/cart')} accessibilityRole="button">
            <View style={styles.cartCount}>
              <Text variant="label" tone="onEmber" align="center">{cart.count}</Text>
            </View>
            <Text variant="heading" tone="onEmber" style={{ flex: 1 }}>{t('myCart')}</Text>
            <Price amount={cart.subtotal} size={typeScale.body.size} color={color.onEmber} weight="700" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ItemSeparator() {
  return <View style={{ height: space.s3 }} />;
}

/**
 * Static loading skeleton mirroring the loaded layout (context strip, chip
 * row, product cards) so content lands without a jump. Deliberately not
 * animated: no shimmer loop to burn frames, and nothing to disturb users
 * with reduced-motion preferences.
 */
function MenuSkeleton() {
  return (
    <View style={{ padding: space.s4, gap: space.s3 }} pointerEvents="none" accessibilityElementsHidden>
      <View style={[skeleton.block, { height: 64 }]} />
      <View style={{ flexDirection: 'row', gap: space.s2 }}>
        <View style={[skeleton.chip, { width: 88 }]} />
        <View style={[skeleton.chip, { width: 72 }]} />
        <View style={[skeleton.chip, { width: 96 }]} />
      </View>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={skeleton.card}>
          <View style={skeleton.img} />
          <View style={{ flex: 1, padding: space.s3, gap: space.s2 }}>
            <View style={[skeleton.line, { width: '70%' }]} />
            <View style={[skeleton.line, { width: '95%' }]} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s2 }}>
              <View style={[skeleton.line, { width: 64 }]} />
              <View style={[skeleton.chip, { width: 76 }]} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const skeleton = StyleSheet.create({
  block: { backgroundColor: color.appSurface2, borderRadius: radius.md, borderWidth: 1, borderColor: color.appLine },
  chip: { height: 34, borderRadius: radius.pill, backgroundColor: color.appSurface2, borderWidth: 1, borderColor: color.appLine },
  card: { flexDirection: 'row', backgroundColor: color.appSurface, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: color.appLine },
  img: { width: 104, minHeight: 112, backgroundColor: color.appSurface2 },
  line: { height: 12, borderRadius: 6, backgroundColor: color.appSurface2 },
});

function SectionFooter() {
  return <View style={{ height: space.s5 }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.appBg },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.s4, paddingBottom: space.s3, backgroundColor: color.appSurface,
    borderBottomWidth: 1, borderBottomColor: color.appLine,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  mark: { width: 38, height: 38, borderRadius: radius.sm },
  langBtn: {
    paddingHorizontal: space.s3, paddingVertical: 6, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: color.ember,
  },

  // Order-context card. The reading-edge accent bar is ember so the current
  // context scans instantly; everything else on the card stays quiet.
  branchRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    marginHorizontal: space.s4, marginTop: space.s3, padding: space.s3,
    backgroundColor: color.appSurface, borderRadius: radius.md,
    borderWidth: 1, borderColor: color.appLine, overflow: 'hidden',
  },
  ctxAccent: { alignSelf: 'stretch', width: 4, borderRadius: 2, backgroundColor: color.ember },
  ctxTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2, marginBottom: 4 },
  changeBtn: {
    paddingHorizontal: space.s3, paddingVertical: space.s2,
    borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ember,
  },

  closedNotice: {
    backgroundColor: color.dangerTint, marginHorizontal: space.s4, marginTop: space.s3,
    padding: space.s3, borderRadius: radius.md, borderWidth: 1, borderColor: color.dangerLine,
  },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: space.s2,
    marginHorizontal: space.s4, marginTop: space.s3, paddingHorizontal: space.s3,
    backgroundColor: color.appSurface, borderRadius: radius.md,
    borderWidth: 1, borderColor: color.appLine,
  },
  searchInput: {
    flex: 1, paddingVertical: space.s3,
    fontSize: typeScale.body.size, color: color.appText,
  },

  chipsWrap: { marginTop: space.s3 },
  chips: { paddingHorizontal: space.s4, gap: space.s2 },
  chipsRTL: { flexDirection: 'row-reverse' },

  sectionTitle: { marginBottom: space.s3 },

  // Sticky cart bar. Ember, flat, hairline-free — it is the one primary action
  // on the screen and does not need a shadow to say so.
  cartBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.s4, paddingTop: space.s2, backgroundColor: 'transparent',
  },
  cartBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    backgroundColor: color.ember, borderRadius: radius.lg,
    paddingHorizontal: space.s4, paddingVertical: space.s4,
  },
  cartCount: {
    minWidth: 26, height: 26, borderRadius: 13,
    backgroundColor: color.emberDeep, alignItems: 'center', justifyContent: 'center',
  },
});
