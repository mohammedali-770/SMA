/**
 * Product detail + modifier selection. Single-select groups (max 1) render as
 * radios; multi-select as checkboxes bounded by maxSelection. Required groups
 * (isRequired or minSelection > 0) must be satisfied before Add is enabled.
 * The sticky Add-to-Cart bar sits above the safe area and shows the live price.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Header } from '../../components/Header';
import { QtyStepper } from '../../components/QtyStepper';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { useCart, useCatalog } from '../../store';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { computeUnitPrice, formatSAR } from '../../utils/format';
import type { Modifier, ModifierGroup } from '../../types/models';

export function ProductDetailScreen({ productId }: { productId: string }) {
  const insets = useSafeAreaInsets();
  const { t, pick, lang } = useI18n();
  const { loading, getProduct, groupsForProduct } = useCatalog();
  const cart = useCart();

  const product = getProduct(productId);
  const groups = useMemo(() => (product ? groupsForProduct(product) : []), [product, groupsForProduct]);

  const [selected, setSelected] = useState<{ [groupId: string]: Modifier[] }>({});
  const [qty, setQty] = useState(1);
  const [showErrors, setShowErrors] = useState(false);

  if (loading && !product) {
    return (
      <View style={styles.root}>
        <Header showBack />
        <LoadingView label={t('loading')} />
      </View>
    );
  }
  if (!product) {
    return (
      <View style={styles.root}>
        <Header showBack />
        <ErrorView message={t('somethingWentWrong')} onRetry={() => router.back()} retryLabel={t('back')} />
      </View>
    );
  }

  const toggle = (group: ModifierGroup, mod: Modifier) => {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      const singleSelect = group.maxSelection === 1;
      const already = current.some((m) => m.id === mod.id);
      let next: Modifier[];
      if (singleSelect) {
        next = already && !group.isRequired ? [] : [mod];
      } else if (already) {
        next = current.filter((m) => m.id !== mod.id);
      } else {
        if (current.length >= group.maxSelection) return prev; // respect max
        next = [...current, mod];
      }
      return { ...prev, [group.id]: next };
    });
  };

  const missingGroups = groups.filter((g) => {
    const count = (selected[g.id] ?? []).length;
    const min = g.isRequired ? Math.max(1, g.minSelection) : g.minSelection;
    return count < min;
  });
  const canAdd = missingGroups.length === 0;
  const unit = computeUnitPrice(product, selected);
  const total = Number((unit * qty).toFixed(2));

  const add = () => {
    if (!canAdd) { setShowErrors(true); return; }
    cart.addItem(product, selected, qty);
    router.back();
  };

  return (
    <View style={styles.root}>
      <Header showBack title={pick(product.nameEn, product.nameAr)} />
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: product.imageUrl }} style={styles.hero} contentFit="cover" transition={150} />
        <View style={styles.body}>
          <Text style={styles.name}>{pick(product.nameEn, product.nameAr)}</Text>
          {pick(product.descriptionEn, product.descriptionAr) ? (
            <Text style={styles.desc}>{pick(product.descriptionEn, product.descriptionAr)}</Text>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.price}>{formatSAR(product.price, lang)}</Text>
            {product.calories ? <Text style={styles.kcal}>{product.calories} {t('kcal')}</Text> : null}
          </View>

          {groups.map((g) => {
            const count = (selected[g.id] ?? []).length;
            const min = g.isRequired ? Math.max(1, g.minSelection) : g.minSelection;
            const unmet = showErrors && count < min;
            return (
              <View key={g.id} style={styles.group}>
                <View style={styles.groupHead}>
                  <Text style={styles.groupTitle}>{pick(g.nameEn, g.nameAr)}</Text>
                  <View style={[styles.reqPill, g.isRequired ? styles.reqYes : styles.reqNo]}>
                    <Text style={[styles.reqText, { color: g.isRequired ? colors.red : colors.muted }]}>
                      {g.isRequired ? t('required') : t('optional')}
                    </Text>
                  </View>
                </View>
                {unmet ? (
                  <Text style={styles.groupError}>
                    {t('required')} · {min}
                  </Text>
                ) : null}
                <View style={{ gap: spacing.sm }}>
                  {g.modifiers.map((m) => {
                    const checked = (selected[g.id] ?? []).some((x) => x.id === m.id);
                    return (
                      <Pressable key={m.id} style={styles.modRow} onPress={() => toggle(g, m)} accessibilityRole="button">
                        <View style={[styles.check, g.maxSelection === 1 ? styles.radio : null, checked && styles.checkOn]}>
                          {checked ? <Text style={styles.checkMark}>✓</Text> : null}
                        </View>
                        <Text style={styles.modName}>{pick(m.nameEn, m.nameAr)}</Text>
                        {m.price > 0 ? <Text style={styles.modPrice}>+ {formatSAR(m.price, lang)}</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}

          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>{t('quantity')}</Text>
            <QtyStepper value={qty} onIncrement={() => setQty((q) => q + 1)} onDecrement={() => setQty((q) => Math.max(1, q - 1))} />
          </View>
        </View>
      </ScrollView>

      {/* Sticky add-to-cart */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Pressable
          onPress={add}
          style={({ pressed }) => [styles.addBtn, !canAdd && styles.addBtnDim, pressed && canAdd && { opacity: 0.9 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canAdd }}
        >
          <Text style={styles.addBtnText}>{t('addForPrice')}</Text>
          <Text style={styles.addBtnPrice}>{formatSAR(total, lang)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { width: '100%', height: 240, backgroundColor: colors.bgAlt },
  body: { padding: spacing.lg },
  name: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  desc: { fontSize: font.md, color: colors.muted, marginTop: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.md },
  price: { fontSize: font.xl, fontWeight: '800', color: colors.purple },
  kcal: { fontSize: font.sm, color: colors.muted },

  group: { marginTop: spacing.xl },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  groupTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  reqPill: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radius.pill },
  reqYes: { backgroundColor: '#fdeaec' },
  reqNo: { backgroundColor: colors.bgAlt },
  reqText: { fontSize: font.xs, fontWeight: '800' },
  groupError: { color: colors.red, fontSize: font.xs, fontWeight: '700', marginBottom: spacing.xs },

  modRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.white,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  check: {
    width: 24, height: 24, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radio: { borderRadius: 12 },
  checkOn: { backgroundColor: colors.purple, borderColor: colors.purple },
  checkMark: { color: colors.white, fontWeight: '900', fontSize: font.sm },
  modName: { flex: 1, fontSize: font.md, color: colors.text, fontWeight: '600' },
  modPrice: { fontSize: font.sm, color: colors.purple, fontWeight: '800' },

  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl },
  qtyLabel: { fontSize: font.lg, fontWeight: '800', color: colors.text },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.white,
    borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.red, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
  },
  addBtnDim: { backgroundColor: colors.disabled },
  addBtnText: { color: colors.white, fontWeight: '800', fontSize: font.lg },
  addBtnPrice: { color: colors.white, fontWeight: '800', fontSize: font.lg },
});
