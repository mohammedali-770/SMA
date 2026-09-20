/** Home + Menu on ONE page with virtualized sections and a sticky cart bar. */
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  SectionList,
  TextInput,
  View,
  type LayoutChangeEvent,
  type SectionListData,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BannerCarousel, useHomeBanners } from './BannerCarousel';
import { categoryFocusReducer, INITIAL_CATEGORY_FOCUS } from './categoryFocus';
import {
  buildMenuSections,
  buildSearchIndex,
  menuItemKey,
  type MenuSection,
  type MenuSectionItem,
} from './menuSections';
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
const SECTION_HEADER_OFFSET = 40;
/**
 * How long a tapped chip outranks the scroll spy when no momentum event
 * arrives. `scrollToLocation` has no completion callback, and fires no momentum
 * event at all when the target is already on screen — without this the spy
 * would stay muted for good. Comfortably longer than the animation plus the
 * 120 ms `onScrollToIndexFailed` retry, and short enough that a dropped
 * momentum event costs at most this much spy latency.
 */
const CATEGORY_SETTLE_MS = 700;
/**
 * How long after the finger lifts the chip strip waits to see whether a glide
 * follows. Long enough for `onMomentumScrollBegin` to arrive on a flick, short
 * enough that a plain drag-and-stop hands the strip back without a visible
 * pause.
 */
const CHIP_RELEASE_GRACE_MS = 80;
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 10 };

export function HomeMenuScreen({
  suppressInvalidRedirect = false,
}: { suppressInvalidRedirect?: boolean } = {}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t, pick, lang, toggle, isRTL, rtlText, rtlRow } = useI18n();
  const styles = useStyles();
  const {
    loading,
    error,
    reload,
    refreshAvailability,
    categories,
    products,
    selectedBranch,
    selectedBranchId,
    isOrderable,
    branchIsOpen,
    groupsForProduct,
  } = useCatalog();
  const cart = useCart();
  const { addItem } = cart;
  const orderCtx = useOrderContext();
  useEffect(() => {
    if (
      !suppressInvalidRedirect &&
      shouldForceSelection({ ready: orderCtx.ready, loading, error, valid: orderCtx.valid })
    )
      router.replace('/select');
  }, [orderCtx.ready, orderCtx.valid, loading, error, suppressInvalidRedirect]);

  // Returning to the menu is the other moment stale availability shows up: the
  // customer may have been sitting on the cart or a product page while the
  // branch closed something. Cheap enough to run on every focus.
  useFocusEffect(
    useCallback(() => {
      void refreshAvailability();
    }, [refreshAvailability]),
  );

  const [search, setSearch] = useState('');
  const listRef = useRef<SectionList<MenuSectionItem, MenuSection>>(null);
  const chipScrollRef = useRef<ScrollView>(null);
  const chipOffsets = useRef<Record<string, { x: number; width: number }>>({});
  const [catFocus, dispatchCatFocus] = useReducer(categoryFocusReducer, INITIAL_CATEGORY_FOCUS);
  const activeCatId = catFocus.activeCatId;
  const branchOpen = branchIsOpen(selectedBranch);
  const searchIndex = useMemo(() => buildSearchIndex(products), [products]);
  const hasModifiers = useCallback((p: Product) => groupsForProduct(p).length > 0, [groupsForProduct]);
  const sections = useMemo(
    () =>
      buildMenuSections({
        products,
        categories,
        branchId: selectedBranchId,
        query: search,
        searchIndex,
        isOrderable,
        hasModifiers,
      }),
    [products, categories, selectedBranchId, search, searchIndex, isOrderable, hasModifiers],
  );
  // `dispatch` has a stable identity, so this stays referentially stable — which
  // SectionList requires; changing it at runtime throws. The reducer, not this
  // callback, decides whether a report is allowed to move the chip.
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const section = viewableItems.find((v) => v.section)?.section as MenuSection | undefined;
    if (section) dispatchCatFocus({ kind: 'spy', catId: section.category.id });
  }, []);
  // Fetched HERE rather than inside BannerCarousel so the request starts when
  // the screen mounts, concurrently with the menu load. The carousel is the
  // list header now, so it does not exist until the menu has rendered — a
  // fetch owned by it would start only then, and the header would expand late
  // and shove the visible rows down. Review caught that on PR #280.
  const banners = useHomeBanners();
  const pendingScroll = useRef<{ sectionIndex: number; retried: boolean } | null>(null);
  // The banner is the list header, so every row sits that much further down.
  // scrollToLocation already accounts for it (VirtualizedList tracks the header
  // in its frame offsets); the onScrollToIndexFailed FALLBACK below does not,
  // because it does raw arithmetic on averageItemLength. Measured rather than
  // computed from the 16:6 ratio, since the header collapses to zero when there
  // are no active banners.
  const headerHeight = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True between `onScrollToIndexFailed` and the scroll it re-issues 120 ms
  // later. A momentum event from the raw jump in between must NOT be read as
  // "the list has arrived" — a second animated scroll is still coming.
  const reissuePending = useRef(false);
  // The retry's own handle, so a newer intention can cancel it. Without this,
  // a drag or a second chip tap inside the 120 ms window still had the old
  // retry fire underneath it and scroll to the PREVIOUS category.
  const reissueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelReissue = useCallback(() => {
    if (reissueTimer.current) {
      clearTimeout(reissueTimer.current);
      reissueTimer.current = null;
    }
    reissuePending.current = false;
  }, []);
  const settleNow = useCallback(() => {
    if (reissuePending.current) return;
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    dispatchCatFocus({ kind: 'settled' });
  }, []);
  // The user putting a finger down outranks their last tap. `onScrollBeginDrag`
  // fires ONLY for real drags — a programmatic `scrollToLocation` never emits
  // it — so releasing the hold here cannot reintroduce the lag this fixes.
  const dragBegan = useCallback(() => {
    // The finger outranks a pending retry too, or the guard above would keep
    // the hold alive through the user's own scroll — and the retry itself must
    // not land mid-gesture.
    cancelReissue();
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    dispatchCatFocus({ kind: 'drag' });
  }, []);
  const scrollToCategory = (catId: string) => {
    // A newer tap retires any retry still queued for the previous one.
    cancelReissue();
    dispatchCatFocus({ kind: 'tap', catId });
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settleNow, CATEGORY_SETTLE_MS);
    const sectionIndex = sections.findIndex((s) => s.category.id === catId);
    if (sectionIndex < 0) return;
    pendingScroll.current = { sectionIndex, retried: false };
    listRef.current?.scrollToLocation({
      sectionIndex,
      itemIndex: 0,
      viewOffset: SECTION_HEADER_OFFSET,
      animated: true,
    });
  };
  const onScrollToIndexFailed = (info: { index: number; averageItemLength: number }) => {
    listRef.current
      ?.getScrollResponder()
      ?.scrollTo({ y: headerHeight.current + info.averageItemLength * info.index, animated: false });
    const pending = pendingScroll.current;
    if (pending && !pending.retried) {
      pending.retried = true;
      // THE SECOND SCROLL NEEDS THE SAME PROTECTION AS THE FIRST. Without this
      // the retry travelled with no hold — its in-flight reports moved the chip,
      // which is why the very FIRST tap after opening the menu did not
      // highlight while every later one did: `scrollToLocation` only fails
      // while the target section is still unmeasured.
      reissuePending.current = true;
      dispatchCatFocus({ kind: 'rescroll' });
      reissueTimer.current = setTimeout(() => {
        reissueTimer.current = null;
        // Belt to the cancel's braces: if a newer tap has replaced the request
        // since this was scheduled, scrolling to the old one would fight the
        // customer rather than help them.
        if (pendingScroll.current !== pending) {
          reissuePending.current = false;
          return;
        }
        listRef.current?.scrollToLocation({
          sectionIndex: pending.sectionIndex,
          itemIndex: 0,
          viewOffset: SECTION_HEADER_OFFSET,
          animated: true,
        });
        reissuePending.current = false;
        // The retry has its own animation, so the fallback timer starts again
        // from here rather than from the tap that is now 120 ms old.
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(settleNow, CATEGORY_SETTLE_MS);
      }, 120);
    }
  };
  const activeCatIdResolved = activeCatId ?? sections[0]?.category.id ?? null;
  /**
   * True while the customer is swiping the CHIP STRIP itself.
   *
   * The strip auto-centres on the active chip, and the active chip changes
   * constantly while the menu scrolls — so a customer swiping the strip was
   * fighting an animation that kept yanking it back to wherever the menu had
   * got to. Reported on build 26 with a screenshot of the strip mid-fight,
   * showing two scroll positions at once.
   *
   * A ref rather than state: this must not re-render the strip on every touch,
   * and the effect below reads it at the moment it fires.
   */
  const chipStripHeld = useRef(false);
  /**
   * Releases the strip only if no momentum follows the finger lifting.
   *
   * `onScrollEndDrag` fires at finger-up, WHILE a flick is still gliding, so
   * releasing there hands the strip back mid-glide — the exact yank this is
   * meant to stop. Review caught that on #411, in code whose own comment
   * claimed it released on momentum end. RN offers no "will momentum follow?"
   * flag, so the drag end schedules a release that `onMomentumScrollBegin`
   * cancels when a glide does start.
   */
  const chipReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdChipStrip = useCallback(() => {
    if (chipReleaseTimer.current) {
      clearTimeout(chipReleaseTimer.current);
      chipReleaseTimer.current = null;
    }
    chipStripHeld.current = true;
  }, []);
  const releaseChipStrip = useCallback(() => {
    if (chipReleaseTimer.current) {
      clearTimeout(chipReleaseTimer.current);
      chipReleaseTimer.current = null;
    }
    chipStripHeld.current = false;
  }, []);
  /**
   * Every timer this screen owns, cleared together.
   *
   * Placed AFTER all three refs rather than beside the first one: a cleanup
   * that names a ref declared eighty lines below it works — the closure runs at
   * unmount — but it reads like a mistake and invites one.
   *
   * A pending timer outliving the screen would dispatch into an unmounted
   * reducer on every navigation away mid-scroll.
   */
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (reissueTimer.current) clearTimeout(reissueTimer.current);
      if (chipReleaseTimer.current) clearTimeout(chipReleaseTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (chipStripHeld.current) return;
    const off = activeCatIdResolved ? chipOffsets.current[activeCatIdResolved] : null;
    if (off) chipScrollRef.current?.scrollTo({ x: Math.max(0, off.x - space.s4), animated: true });
  }, [activeCatIdResolved]);
  // `needsChoice` covers modifier groups AND multi-tier products. A tiered
  // product must never be added straight from the card: addItem falls back to
  // cheapestVariant, so the customer would be given the cheapest tier without
  // being asked. The detail screen already renders the tier picker.
  const handleAdd = useCallback(
    (product: Product, needsChoice: boolean) => {
      if (needsChoice) router.push(`/product/${product.id}`);
      else addItem(product, {}, 1);
    },
    [addItem],
  );
  const renderItem = useCallback(
    ({ item }: { item: MenuSectionItem }) => (
      <ProductCard
        product={item.product}
        needsChoice={item.needsChoice}
        showFromPrice={item.showFromPrice}
        available={item.available}
        onAdd={handleAdd}
      />
    ),
    [handleAdd],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + space.s2 }]}>
        <View style={styles.brandRow}>
          <Image source={require('../../../assets/logo-mark.png')} style={styles.mark} contentFit="contain" />
          <View>
            <Text variant="title">{pick('Spicy Meal', 'سبايسي ميل')}</Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {pick('Since 1997', 'منذ 1997')}
            </Text>
          </View>
        </View>
        <Pressable onPress={toggle} hitSlop={8} style={styles.langBtn} accessibilityRole="button">
          <Text variant="label" tone="ember" align="center">
            {lang === 'en' ? 'العربية' : 'EN'}
          </Text>
        </Pressable>
      </View>
      {orderCtx.context ? (
        <Pressable
          style={[styles.branchRow, rtlRow]}
          onPress={() => router.push('/select')}
          accessibilityRole="button"
        >
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
                {[
                  orderCtx.context.deliveryDescription,
                  orderCtx.context.deliveryFee != null
                    ? `${t('deliveryFee')} ${formatSAR(orderCtx.context.deliveryFee, lang)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}
          </View>
          <View style={styles.changeBtn}>
            <Text variant="label" tone="ember" align="center">
              {t('otChange')}
            </Text>
          </View>
        </Pressable>
      ) : null}
      {/* The banner is NOT fixed chrome. It is the menu list's header, so it
        scrolls away and gives the vertical space back to the food — see
        BannerCarousel's header comment. It is still rendered statically in the
        states below that have no list to attach a header to. */}
      {loading ? (
        <MenuSkeleton />
      ) : error ? (
        <>
          <BannerCarousel banners={banners} />
          <ErrorView
            message={error}
            onRetry={reload}
            retryLabel={t('retry')}
            icon={<AlertIcon />}
            fallbackTitle={pick("The menu didn't load", 'تعذّر تحميل القائمة')}
          />
        </>
      ) : !orderCtx.valid ? (
        <LoadingView label={t('loading')} />
      ) : (
        <>
          {!branchOpen ? (
            <View style={styles.closedNotice}>
              <Text variant="label" style={{ color: colors.danger }}>
                {t('branchClosedNotice')}
              </Text>
            </View>
          ) : null}
          <View style={[styles.searchWrap, rtlRow]}>
            <SearchIcon color={colors.appText3} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('searchPlaceholder')}
              placeholderTextColor={colors.appText3}
              style={[styles.searchInput, rtlText]}
              autoCapitalize="none"
              returnKeyType="search"
            />
          </View>
          {sections.length > 0 ? (
            <View style={styles.chipsWrap}>
              <ScrollView
                ref={chipScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.chips, isRTL && styles.chipsRTL]}
                // While the customer is swiping the strip, it is theirs. The
                // hold is released on momentum end rather than on finger-up, so
                // a flick is not yanked back mid-glide.
                onScrollBeginDrag={holdChipStrip}
                // Finger up. A flick is still gliding at this point, so the
                // release is only PROVISIONAL — momentum starting cancels it.
                onScrollEndDrag={() => {
                  if (chipReleaseTimer.current) clearTimeout(chipReleaseTimer.current);
                  chipReleaseTimer.current = setTimeout(releaseChipStrip, CHIP_RELEASE_GRACE_MS);
                }}
                onMomentumScrollBegin={holdChipStrip}
                onMomentumScrollEnd={releaseChipStrip}
                onContentSizeChange={() => {
                  // Only the RTL initial placement. Doing this mid-swipe would
                  // be the same fight in a different costume.
                  if (isRTL && !chipStripHeld.current) {
                    chipScrollRef.current?.scrollToEnd({ animated: false });
                  }
                }}
              >
                {sections.map((s) => (
                  <SelectableChip
                    key={s.category.id}
                    label={pick(s.category.nameEn, s.category.nameAr)}
                    selected={s.category.id === activeCatIdResolved}
                    onPress={() => scrollToCategory(s.category.id)}
                    onLayout={(e: LayoutChangeEvent) => {
                      chipOffsets.current[s.category.id] = {
                        x: e.nativeEvent.layout.x,
                        width: e.nativeEvent.layout.width,
                      };
                    }}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}
          {sections.length === 0 ? (
            <>
              <BannerCarousel banners={banners} />
              <EmptyView icon={<DishIcon />} title={t('noProducts')} />
            </>
          ) : (
            <SectionList
              ref={listRef}
              sections={sections}
              keyExtractor={menuItemKey}
              renderItem={renderItem}
              renderSectionHeader={({
                section,
              }: {
                section: SectionListData<MenuSectionItem, MenuSection>;
              }) => (
                <Text variant="title" style={styles.sectionTitle}>
                  {pick(section.category.nameEn, section.category.nameAr)}
                </Text>
              )}
              renderSectionFooter={SectionFooter}
              ItemSeparatorComponent={ItemSeparator}
              ListHeaderComponent={
                <View
                  onLayout={(e: LayoutChangeEvent) => {
                    headerHeight.current = e.nativeEvent.layout.height;
                  }}
                >
                  <BannerCarousel banners={banners} inset={false} />
                </View>
              }
              stickySectionHeadersEnabled={false}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={VIEWABILITY_CONFIG}
              onMomentumScrollEnd={settleNow}
              onScrollBeginDrag={dragBegan}
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
      {cart.count > 0 ? (
        <View style={[styles.cartBar, { paddingBottom: insets.bottom + space.s2 }]}>
          <Pressable
            style={[styles.cartBtn, rtlRow]}
            onPress={() => router.push('/cart')}
            accessibilityRole="button"
          >
            <View style={styles.cartCount}>
              <Text variant="label" tone="onEmber" align="center">
                {cart.count}
              </Text>
            </View>
            <Text variant="heading" tone="onEmber" style={{ flex: 1 }}>
              {t('myCart')}
            </Text>
            <Price amount={cart.subtotal} size={typeScale.body.size} color={colors.onEmber} weight="700" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
function ItemSeparator() {
  return <View style={{ height: space.s3 }} />;
}
function MenuSkeleton() {
  const s = useSkeletonStyles();
  return (
    <View style={{ padding: space.s4, gap: space.s3 }} pointerEvents="none" accessibilityElementsHidden>
      <View style={[s.block, { height: 64 }]} />
      <View style={{ flexDirection: 'row', gap: space.s2 }}>
        <View style={[s.chip, { width: 88 }]} />
        <View style={[s.chip, { width: 72 }]} />
        <View style={[s.chip, { width: 96 }]} />
      </View>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={s.card}>
          <View style={s.img} />
          <View style={{ flex: 1, padding: space.s3, gap: space.s2 }}>
            <View style={[s.line, { width: '70%' }]} />
            <View style={[s.line, { width: '95%' }]} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s2 }}>
              <View style={[s.line, { width: 64 }]} />
              <View style={[s.chip, { width: 76 }]} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}
const useSkeletonStyles = makeStyles((color) => ({
  block: {
    backgroundColor: color.appSurface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.appLine,
  },
  chip: {
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: color.appSurface2,
    borderWidth: 1,
    borderColor: color.appLine,
  },
  card: {
    flexDirection: 'row' as const,
    backgroundColor: color.appSurface,
    borderRadius: radius.lg,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: color.appLine,
  },
  img: { width: 104, minHeight: 112, backgroundColor: color.appSurface2 },
  line: { height: 12, borderRadius: 6, backgroundColor: color.appSurface2 },
}));
function SectionFooter() {
  return <View style={{ height: space.s5 }} />;
}
const useStyles = makeStyles((color) => ({
  root: { flex: 1, backgroundColor: color.appBg },
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: space.s4,
    paddingBottom: space.s3,
    backgroundColor: color.appSurface,
    borderBottomWidth: 1,
    borderBottomColor: color.appLine,
  },
  brandRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s2 },
  mark: { width: 38, height: 38 },
  langBtn: {
    paddingHorizontal: space.s3,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: color.ember,
  },
  branchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.s3,
    marginHorizontal: space.s4,
    marginTop: space.s3,
    padding: space.s3,
    backgroundColor: color.appSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.appLine,
    overflow: 'hidden' as const,
  },
  ctxAccent: { alignSelf: 'stretch' as const, width: 4, borderRadius: 2, backgroundColor: color.ember },
  ctxTopRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s2, marginBottom: 4 },
  changeBtn: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: color.ember,
  },
  closedNotice: {
    backgroundColor: color.dangerTint,
    marginHorizontal: space.s4,
    marginTop: space.s3,
    padding: space.s3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.dangerLine,
  },
  searchWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.s2,
    marginHorizontal: space.s4,
    marginTop: space.s3,
    paddingHorizontal: space.s3,
    backgroundColor: color.appSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.appLine,
  },
  searchInput: { flex: 1, paddingVertical: space.s3, fontSize: typeScale.body.size, color: color.appText },
  chipsWrap: { marginTop: space.s3 },
  chips: { paddingHorizontal: space.s4, gap: space.s2 },
  chipsRTL: { flexDirection: 'row-reverse' as const },
  sectionTitle: { marginBottom: space.s3 },
  cartBar: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
    backgroundColor: 'transparent',
  },
  cartBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.s3,
    backgroundColor: color.ember,
    borderRadius: radius.lg,
    paddingHorizontal: space.s4,
    paddingVertical: space.s4,
  },
  cartCount: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.emberDeep,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
}));
