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
  Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View,
  type LayoutChangeEvent, type SectionListData, type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BannerCarousel } from './BannerCarousel';
import { buildMenuSections, buildSearchIndex, menuItemKey, type MenuSection, type MenuSectionItem } from './menuSections';
import { AlertIcon, DishIcon, SearchIcon } from '../../components/Icons';
import { LangToggle } from '../../components/LangToggle';
import { OpenClosedBadge } from '../../components/OpenClosedBadge';
import { Price } from '../../components/Price';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { shouldForceSelection } from '../order/orderContext';
import { useCart, useCatalog, useOrderContext } from '../../store';
import { colors, font, motion, radius, shadow, spacing } from '../../theme';
import { formatSAR } from '../../utils/format';
import type { Product } from '../../types/models';

// Approximate rendered height of a section header (title + margin) so a chip
// tap positions the SECTION TITLE at the top, not the first card.
const SECTION_HEADER_OFFSET = 40;

// SectionList requires a stable viewabilityConfig identity across renders.
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 10 };

export function HomeMenuScreen() {
  const insets = useSafeAreaInsets();
  const { t, pick, lang, isRTL, rtlText, rtlRow } = useI18n();
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
    if (off) chipScrollRef.current?.scrollTo({ x: Math.max(0, off.x - spacing.lg), animated: true });
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
      {/* Top bar: mark + wordmark, and the language toggle on the far edge.
          The marketing tagline that used to sit under the wordmark is gone —
          it competed with the branch context immediately below it, which is
          the line a customer actually needs to read before ordering. */}
      <View style={[styles.topBar, rtlRow, { paddingTop: insets.top + spacing.sm }]}>
        <View style={[styles.brandRow, rtlRow]}>
          <Image source={require('../../../assets/icon.png')} style={styles.mark} contentFit="cover" />
          <Text style={styles.brand}>{pick('Spicy Meal', 'سبايسي ميل')}</Text>
        </View>
        <LangToggle />
      </View>

      {/* Selected order context. Tapping it re-opens the same blocking
          Pickup/Delivery selection flow.

          It reads as a strip on the page ground rather than a bordered card
          with an accent bar: the order type is a quiet LABEL above the branch
          name, because "Delivery from" is context and the branch is the fact.
          The old layout gave both the same weight and boxed them, which made a
          persistent, always-true piece of state look like an alert. */}
      {orderCtx.context ? (
        <Pressable style={[styles.branchRow, rtlRow]} onPress={() => router.push('/select')} accessibilityRole="button">
          <View style={{ flex: 1 }}>
            <Text style={[styles.ctxLabel, rtlText]}>
              {orderCtx.context.orderType === 'pickup' ? t('otPickup') : t('otDelivery')}
            </Text>
            <View style={[styles.ctxTopRow, rtlRow]}>
              <Text style={[styles.branchValue, rtlText]} numberOfLines={1}>
                {pick(orderCtx.context.branchNameEn, orderCtx.context.branchNameAr)}
              </Text>
              {selectedBranch ? <OpenClosedBadge open={branchOpen} /> : null}
            </View>
            {orderCtx.context.orderType === 'delivery' ? (
              <Text style={[styles.branchSub, rtlText]} numberOfLines={1}>
                {[orderCtx.context.deliveryDescription,
                  orderCtx.context.deliveryFee != null ? `${t('deliveryFee')} ${formatSAR(orderCtx.context.deliveryFee, lang)}` : null]
                  .filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          <View style={styles.changeBtn}>
            <Text style={styles.change}>{t('otChange')}</Text>
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
              <Text style={[styles.closedNoticeText, rtlText]}>{t('branchClosedNotice')}</Text>
            </View>
          ) : null}

          {/* Search — mirrored so the icon sits on the reading edge in Arabic. */}
          <View style={[styles.searchWrap, rtlRow]}>
            <SearchIcon color={colors.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('searchPlaceholder')}
              placeholderTextColor={colors.muted}
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
                    <Pressable
                      key={s.category.id}
                      onLayout={(e: LayoutChangeEvent) => {
                        chipOffsets.current[s.category.id] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
                      }}
                      onPress={() => scrollToCategory(s.category.id)}
                      hitSlop={6}
                      style={[styles.chip, active && styles.chipActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{pick(s.category.nameEn, s.category.nameAr)}</Text>
                    </Pressable>
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
                <Text style={[styles.sectionTitle, rtlText]}>{pick(section.category.nameEn, section.category.nameAr)}</Text>
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
              contentContainerStyle={{ padding: spacing.lg, paddingBottom: cart.count > 0 ? 120 : spacing.xxl }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      )}

      {/* Sticky cart bar (above the safe area) */}
      {cart.count > 0 ? (
        <View style={[styles.cartBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable style={[styles.cartBtn, rtlRow]} onPress={() => router.push('/cart')} accessibilityRole="button">
            <View style={styles.cartCount}>
              <Text style={styles.cartCountText}>{cart.count}</Text>
            </View>
            <Text style={[styles.cartBtnText, rtlText]}>{t('myCart')}</Text>
            <Price amount={cart.subtotal} size={font.md} color={colors.white} weight="800" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ItemSeparator() {
  return <View style={{ height: spacing.md }} />;
}

/**
 * Static loading skeleton mirroring the loaded layout (context strip, chip
 * row, product cards) so content lands without a jump. Deliberately not
 * animated: no shimmer loop to burn frames, and nothing to disturb users
 * with reduced-motion preferences.
 */
function MenuSkeleton() {
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }} pointerEvents="none" accessibilityElementsHidden>
      <View style={[skeleton.block, { height: 64 }]} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={[skeleton.chip, { width: 88 }]} />
        <View style={[skeleton.chip, { width: 72 }]} />
        <View style={[skeleton.chip, { width: 96 }]} />
      </View>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={skeleton.card}>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <View style={[skeleton.line, { width: '70%' }]} />
            <View style={[skeleton.line, { width: '95%' }]} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
              <View style={[skeleton.line, { width: 64 }]} />
              <View style={[skeleton.chip, { width: 76, height: 36 }]} />
            </View>
          </View>
          <View style={skeleton.img} />
        </View>
      ))}
    </View>
  );
}

const skeleton = StyleSheet.create({
  block: { backgroundColor: colors.bgAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chip: { height: 34, borderRadius: radius.pill, backgroundColor: colors.bgAlt, borderWidth: 1, borderColor: colors.border },
  card: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.md, gap: spacing.md,
  },
  img: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.bgAlt },
  line: { height: 12, borderRadius: 6, backgroundColor: colors.bgAlt },
});

function SectionFooter() {
  return <View style={{ height: spacing.xl }} />;
}

/**
 * One menu card. Memoized with stable props (product ref, boolean, stable
 * handler) so cart taps and searches don't re-render every card; language
 * changes still propagate because useI18n reads context (which bypasses memo).
 */
export const ProductCard = React.memo(function ProductCard({
  product, hasModifiers, onAdd,
}: {
  product: Product; hasModifiers: boolean; onAdd: (product: Product, withModifiers: boolean) => void;
}) {
  const { t, pick, rtlText, rtlRow } = useI18n();
  const [imgFailed, setImgFailed] = useState(false);
  const name = pick(product.nameEn, product.nameAr);
  const description = pick(product.descriptionEn, product.descriptionAr);
  const kcalLabel = product.calories ? `${product.calories} ${t('kcal')}` : '';
  const actionLabel = hasModifiers ? t('customizeAdd') : t('addToCart');
  const showImage = !!product.imageUrl && !imgFailed;
  return (
    // Mirrored in Arabic: image on the trailing edge, text reading right-to-left.
    <View style={[styles.card, rtlRow, shadow.card]}>
      <View style={styles.cardBody}>
        <Text style={[styles.cardName, rtlText]} numberOfLines={2}>{name}</Text>
        {description ? <Text style={[styles.cardDesc, rtlText]} numberOfLines={2}>{description}</Text> : null}
        <View style={[styles.cardBottom, rtlRow]}>
          <View>
            <Price amount={product.price} size={font.lg} color={colors.ink} weight="800" />
            {kcalLabel ? <Text style={[styles.cardKcal, rtlText]}>{kcalLabel}</Text> : null}
          </View>
          <Pressable style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]} onPress={() => onAdd(product, hasModifiers)} hitSlop={6} accessibilityRole="button" accessibilityLabel={actionLabel}>
            <Text style={styles.addBtnText}>{actionLabel}</Text>
          </Pressable>
        </View>
      </View>
      {showImage ? (
        <Image
          source={{ uri: product.imageUrl }}
          style={styles.cardImg}
          contentFit="cover"
          transition={150}
          // Keep decoded thumbnails in memory so cards scrolled back into view
          // don't re-decode from disk; recyclingKey pairs with virtualization.
          cachePolicy="memory-disk"
          recyclingKey={product.id}
          onError={() => setImgFailed(true)}
        />
      ) : (
        // Missing/broken image → quiet plate glyph instead of a blank block.
        <View style={[styles.cardImg, styles.cardImgEmpty]}>
          <DishIcon size={34} />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 34, height: 34, borderRadius: radius.sm, borderCurve: 'continuous' },
  brand: { fontSize: font.xl, fontWeight: '800', color: colors.purple },
  // A strip on the ground, not a boxed card: this state is always present and
  // always true, so it should sit quietly under the header rather than announce
  // itself. The rule beneath separates it from the banners.
  branchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  ctxLabel: { fontSize: font.xs, color: colors.muted, fontWeight: '600' },
  ctxTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 3 },
  branchValue: { fontSize: font.md, color: colors.ink, fontWeight: '800', flexShrink: 1 },
  branchSub: { fontSize: font.xs, color: colors.muted, marginTop: 3 },
  changeBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill, backgroundColor: colors.purpleBg,
  },
  change: { color: colors.purple, fontWeight: '800', fontSize: font.sm },

  closedNotice: { backgroundColor: colors.dangerBg, marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md },
  closedNoticeText: { color: colors.danger, fontWeight: '700', fontSize: font.sm },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.lg, paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, paddingVertical: spacing.md, fontSize: font.md, color: colors.text },

  chipsWrap: { marginTop: spacing.md },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chipsRTL: { flexDirection: 'row-reverse' },
  // Neutral resting chips keep purple meaningful: only the SELECTED category
  // is purple. Identical padding + border width in both states → no layout
  // jump when the selection moves.
  chip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.white,
    borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.purple, borderColor: colors.purple },
  chipText: { color: colors.text, fontWeight: '700', fontSize: font.sm },
  chipTextActive: { color: colors.white, fontWeight: '800' },

  sectionTitle: { fontSize: font.lg, fontWeight: '800', color: colors.ink, marginBottom: spacing.md },

  // Card defined by shadow rather than a hairline border, with the image inset
  // instead of bleeding to the edge — the flush block made every row look like
  // a table cell, and a food photograph reads better as an object on the card
  // than as one of its walls.
  card: {
    flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.surface,
    borderRadius: radius.xl, borderCurve: 'continuous', padding: spacing.md, gap: spacing.md,
  },
  cardImg: {
    width: 96, alignSelf: 'stretch', minHeight: 96,
    borderRadius: radius.md, borderCurve: 'continuous', backgroundColor: colors.bgAlt,
  },
  cardImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, justifyContent: 'space-between', minHeight: 96 },
  cardName: { fontSize: font.md, lineHeight: 21, fontWeight: '800', color: colors.ink },
  cardDesc: { fontSize: font.sm, lineHeight: 19, color: colors.muted, marginTop: 3 },
  cardBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: spacing.md },
  cardKcal: { fontSize: font.xs, color: colors.muted, marginTop: 3 },
  // Quiet, not loud. A solid brand-red pill repeated down twenty rows spends the
  // accent on the least remarkable thing on screen; the price is what a customer
  // reads, and Add is the small affordance next to it.
  addBtn: {
    backgroundColor: colors.bgAlt, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.md, borderCurve: 'continuous', minHeight: 36, justifyContent: 'center',
  },
  addBtnPressed: { opacity: motion.pressedOpacity, transform: [{ scale: motion.pressedScale }] },
  addBtnText: { color: colors.ink, fontWeight: '800', fontSize: font.sm },

  cartBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: 'transparent',
  },
  cartBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.purple, borderRadius: radius.lg, borderCurve: 'continuous',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, ...shadow.lg,
  },
  cartCount: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  cartCountText: { color: colors.white, fontWeight: '800', fontSize: font.sm },
  cartBtnText: { color: colors.white, fontWeight: '800', fontSize: font.md, flex: 1 },
  cartBtnPrice: { color: colors.white, fontWeight: '800', fontSize: font.md },
});
