/**
 * Home + Menu on ONE page (no separate Menu tab):
 *  - Spicy Meal logo at the top (no phone icon), with an EN/AR toggle.
 *  - Manual branch selector (never auto-selected). No branch => a clear CTA.
 *  - A closed branch shows a notice; the menu is browsable but checkout blocks.
 *  - Horizontal, dynamic category chips; tapping one scrolls to its section.
 *  - Product cards: "Add" for simple items, "Customize & Add" when a product
 *    has modifier groups (opens the product detail screen).
 *  - A sticky cart bar sits above the safe area whenever the cart has items.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BannerCarousel } from './BannerCarousel';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { useCart, useCatalog, useOrderContext } from '../../store';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { formatSAR } from '../../utils/format';
import type { Category, Product } from '../../types/models';

export function HomeMenuScreen() {
  const insets = useSafeAreaInsets();
  const { t, pick, lang, toggle } = useI18n();
  const {
    loading, error, reload, categories, products, selectedBranch, selectedBranchId,
    isAvailable, branchIsOpen, groupsForProduct,
  } = useCatalog();
  const cart = useCart();
  const orderCtx = useOrderContext();

  // BLOCKING GATE: no valid order context → the menu is not usable; send the
  // customer to the full-screen order-type selection first. Runs once the
  // persisted context is read and the catalog has loaded (so we never redirect
  // during load or before hydration).
  useEffect(() => {
    if (orderCtx.ready && !loading && !error && !orderCtx.valid) router.replace('/select');
  }, [orderCtx.ready, orderCtx.valid, loading, error]);

  const [search, setSearch] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  // Active category (for the highlighted chip) + horizontal chip-row scrolling.
  const chipScrollRef = useRef<ScrollView>(null);
  const chipOffsets = useRef<Record<string, { x: number; width: number }>>({});
  const [activeCatId, setActiveCatId] = useState<string | null>(null);

  const branchOpen = branchIsOpen(selectedBranch);

  // Products visible for the chosen branch + search, grouped by category.
  const sections = useMemo(() => {
    if (!selectedBranchId) return [] as { category: Category; items: Product[] }[];
    const q = search.trim().toLowerCase();
    const visible = products.filter((p) => {
      if (!p.isActive || !isAvailable(p.id, selectedBranchId)) return false;
      if (!q) return true;
      return (
        p.nameEn.toLowerCase().includes(q) ||
        p.nameAr.toLowerCase().includes(q) ||
        p.descriptionEn.toLowerCase().includes(q)
      );
    });
    return [...categories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => ({ category, items: visible.filter((p) => p.categoryId === category.id) }))
      .filter((s) => s.items.length > 0);
  }, [products, categories, selectedBranchId, isAvailable, search]);

  const scrollToCategory = (catId: string) => {
    setActiveCatId(catId);
    const y = offsets.current[catId];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.sm), animated: true });
  };

  // Which chip is highlighted: the category tapped, else the section currently
  // scrolled into view, else the first section.
  const activeCatIdResolved = activeCatId ?? sections[0]?.category.id ?? null;

  // Scroll-spy: as the menu scrolls, highlight the category whose section top has
  // passed the top of the viewport.
  const onMenuScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y + spacing.sm + 1;
    let current = sections[0]?.category.id ?? null;
    for (const s of sections) {
      const oy = offsets.current[s.category.id];
      if (oy != null && oy <= y) current = s.category.id;
    }
    if (current && current !== activeCatId) setActiveCatId(current);
  };

  // Keep the highlighted chip visible in the horizontal chip row.
  useEffect(() => {
    const off = activeCatIdResolved ? chipOffsets.current[activeCatIdResolved] : null;
    if (off) chipScrollRef.current?.scrollTo({ x: Math.max(0, off.x - spacing.lg), animated: true });
  }, [activeCatIdResolved]);

  const onAdd = (product: Product) => {
    if (groupsForProduct(product).length > 0) {
      router.push(`/product/${product.id}`);
    } else {
      cart.addItem(product, {}, 1);
    }
  };

  return (
    <View style={styles.root}>
      {/* Top bar: logo + language toggle (no phone icon) */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.brandRow}>
          <Image source={require('../../../assets/icon.png')} style={styles.mark} contentFit="cover" />
          <View>
            <Text style={styles.brand}>{pick('Spicy Meal', 'سبايسي ميل')}</Text>
            <Text style={styles.brandTag} numberOfLines={1}>
              {pick('Hot, ', 'حار، ')}
              <Text style={styles.brandTagAccent}>{pick('Crispy', 'مقرمش')}</Text>
              {pick(', Fresh and Golden Bites', '، طازج ولقيمات ذهبية')}
            </Text>
          </View>
        </View>
        <Pressable onPress={toggle} hitSlop={8} style={styles.langBtn} accessibilityRole="button">
          <Text style={styles.langText}>{lang === 'en' ? 'العربية' : 'EN'}</Text>
        </Pressable>
      </View>

      {/* Selected order-context card (above the banners + search). Tapping it
          re-opens the same blocking Pickup/Delivery selection flow. */}
      {orderCtx.context ? (
        <Pressable style={styles.branchRow} onPress={() => router.push('/select')} accessibilityRole="button">
          <View style={{ flex: 1 }}>
            <Text style={styles.branchLabel}>
              {orderCtx.context.orderType === 'pickup' ? t('otPickup') : t('otDelivery')}
            </Text>
            <Text style={styles.branchValue} numberOfLines={1}>
              {pick(orderCtx.context.branchNameEn, orderCtx.context.branchNameAr)}
            </Text>
            {orderCtx.context.orderType === 'delivery' ? (
              <Text style={styles.branchSub} numberOfLines={1}>
                {[orderCtx.context.deliveryDescription,
                  orderCtx.context.deliveryFee != null ? `${t('deliveryFee')} ${formatSAR(orderCtx.context.deliveryFee, lang)}` : null]
                  .filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          {selectedBranch ? (
            <View style={[styles.badge, branchOpen ? styles.badgeOpen : styles.badgeClosed]}>
              <Text style={[styles.badgeText, { color: branchOpen ? colors.success : colors.red }]}>
                {branchOpen ? t('open') : t('closed')}
              </Text>
            </View>
          ) : null}
          <Text style={styles.change}>{t('otChange')}</Text>
        </Pressable>
      ) : null}

      {/* Promotional banners — below the branch selector, above the search bar.
          Self-fetching; renders nothing when there are no active banners. */}
      <BannerCarousel />

      {loading ? (
        <LoadingView label={t('loading')} />
      ) : error ? (
        <ErrorView message={error} onRetry={reload} retryLabel={t('retry')} />
      ) : !orderCtx.valid ? (
        // No valid context yet — the gate effect is redirecting to /select.
        <LoadingView label={t('loading')} />
      ) : (
        <>
          {!branchOpen ? (
            <View style={styles.closedNotice}>
              <Text style={styles.closedNoticeText}>{t('branchClosedNotice')}</Text>
            </View>
          ) : null}

          {/* Search */}
          <View style={styles.searchWrap}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('searchPlaceholder')}
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
              autoCapitalize="none"
              returnKeyType="search"
            />
          </View>

          {/* Horizontal categories */}
          {sections.length > 0 ? (
            <View style={styles.chipsWrap}>
              <ScrollView ref={chipScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {sections.map((s) => {
                  const active = s.category.id === activeCatIdResolved;
                  return (
                    <Pressable
                      key={s.category.id}
                      onLayout={(e: LayoutChangeEvent) => {
                        chipOffsets.current[s.category.id] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
                      }}
                      onPress={() => scrollToCategory(s.category.id)}
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

          {/* Menu sections */}
          {sections.length === 0 ? (
            <EmptyView emoji="🍽️" title={t('noProducts')} />
          ) : (
            <ScrollView
              ref={scrollRef}
              onScroll={onMenuScroll}
              scrollEventThrottle={16}
              contentContainerStyle={{ padding: spacing.lg, paddingBottom: cart.count > 0 ? 120 : spacing.xxl }}
              showsVerticalScrollIndicator={false}
            >
              {sections.map((s) => (
                <View
                  key={s.category.id}
                  onLayout={(e: LayoutChangeEvent) => { offsets.current[s.category.id] = e.nativeEvent.layout.y; }}
                  style={styles.section}
                >
                  <Text style={styles.sectionTitle}>{pick(s.category.nameEn, s.category.nameAr)}</Text>
                  <View style={{ gap: spacing.md }}>
                    {s.items.map((p) => (
                      <ProductCard
                        key={p.id}
                        product={p}
                        priceLabel={formatSAR(p.price, lang)}
                        kcalLabel={p.calories ? `${p.calories} ${t('kcal')}` : ''}
                        name={pick(p.nameEn, p.nameAr)}
                        description={pick(p.descriptionEn, p.descriptionAr)}
                        actionLabel={groupsForProduct(p).length > 0 ? t('customizeAdd') : t('addToCart')}
                        onAdd={() => onAdd(p)}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}

      {/* Sticky cart bar (above the safe area) */}
      {cart.count > 0 ? (
        <View style={[styles.cartBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable style={styles.cartBtn} onPress={() => router.push('/cart')} accessibilityRole="button">
            <View style={styles.cartCount}>
              <Text style={styles.cartCountText}>{cart.count}</Text>
            </View>
            <Text style={styles.cartBtnText}>{t('myCart')}</Text>
            <Text style={styles.cartBtnPrice}>{formatSAR(cart.subtotal, lang)}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ProductCard({
  product, name, description, priceLabel, kcalLabel, actionLabel, onAdd,
}: {
  product: Product; name: string; description: string; priceLabel: string;
  kcalLabel: string; actionLabel: string; onAdd: () => void;
}) {
  return (
    <View style={[styles.card, shadow.card]}>
      <Image source={{ uri: product.imageUrl }} style={styles.cardImg} contentFit="cover" transition={150} />
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>{name}</Text>
        {description ? <Text style={styles.cardDesc} numberOfLines={2}>{description}</Text> : null}
        <View style={styles.cardBottom}>
          <View>
            <Text style={styles.cardPrice}>{priceLabel}</Text>
            {kcalLabel ? <Text style={styles.cardKcal}>{kcalLabel}</Text> : null}
          </View>
          <Pressable style={styles.addBtn} onPress={onAdd} accessibilityRole="button">
            <Text style={styles.addBtnText}>{actionLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 38, height: 38, borderRadius: radius.sm },
  brand: { fontSize: font.xl, fontWeight: '800', color: colors.purple },
  brandTag: { fontSize: font.xs, fontWeight: '700', color: colors.text, marginTop: -2 },
  brandTagAccent: { color: colors.red, fontWeight: '800' },
  langBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: colors.purple,
  },
  langText: { color: colors.purple, fontWeight: '800', fontSize: font.sm },

  branchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md,
    backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  branchLabel: { fontSize: font.xs, color: colors.muted, fontWeight: '700', textTransform: 'uppercase' },
  branchValue: { fontSize: font.md, color: colors.text, fontWeight: '800', marginTop: 2 },
  branchSub: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  change: { color: colors.purple, fontWeight: '800', fontSize: font.sm },

  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  badgeOpen: { backgroundColor: '#e7f6ee' },
  badgeClosed: { backgroundColor: '#fdeaec' },
  badgeText: { fontSize: font.xs, fontWeight: '800' },

  closedNotice: { backgroundColor: '#fdeaec', marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md },
  closedNoticeText: { color: colors.red, fontWeight: '700', fontSize: font.sm },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md, paddingHorizontal: spacing.md,
    backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  searchIcon: { fontSize: font.md },
  searchInput: { flex: 1, paddingVertical: spacing.md, fontSize: font.md, color: colors.text },

  chipsWrap: { marginTop: spacing.md },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.white,
    borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.purple,
  },
  chipActive: { backgroundColor: colors.purple, borderColor: colors.purple },
  chipText: { color: colors.purple, fontWeight: '800', fontSize: font.sm },
  chipTextActive: { color: colors.white },

  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text, marginBottom: spacing.md },

  card: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: radius.lg, overflow: 'hidden' },
  cardImg: { width: 104, alignSelf: 'stretch', minHeight: 116, backgroundColor: colors.bgAlt },
  cardBody: { flex: 1, padding: spacing.md, justifyContent: 'space-between' },
  cardName: { fontSize: font.md, fontWeight: '800', color: colors.text },
  cardDesc: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: spacing.sm },
  cardPrice: { fontSize: font.md, fontWeight: '800', color: colors.purple },
  cardKcal: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  addBtn: { backgroundColor: colors.red, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  addBtnText: { color: colors.white, fontWeight: '800', fontSize: font.sm },

  cartBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: 'transparent',
  },
  cartBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.purple, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, ...shadow.card,
  },
  cartCount: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  cartCountText: { color: colors.white, fontWeight: '800', fontSize: font.sm },
  cartBtnText: { color: colors.white, fontWeight: '800', fontSize: font.md, flex: 1 },
  cartBtnPrice: { color: colors.white, fontWeight: '800', fontSize: font.md },
});
