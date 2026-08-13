/** Product detail + modifier selection; supports editing one existing cart line. */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../../components/Header';
import { Price } from '../../components/Price';
import { QtyStepper } from '../../components/QtyStepper';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { radius, space, type as typeScale } from '../../design-system/generated/tokens';
import { StatusPill } from '../../design-system/ui/Chip';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { useCart, useCatalog } from '../../store';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';
import type { Modifier, ModifierGroup } from '../../types/models';
import { computeUnitPrice } from '../../utils/format';

export function ProductDetailScreen({ productId, cartItemId }: { productId: string; cartItemId?: string }) {
  const styles = useStyles(); const colors = useThemeColors(); const insets = useSafeAreaInsets();
  const { t, pick, rtlRow } = useI18n(); const { loading, getProduct, groupsForProduct } = useCatalog(); const cart = useCart();
  const product = getProduct(productId);
  const groups = useMemo(() => product ? groupsForProduct(product) : [], [product, groupsForProduct]);
  const editingLine = useMemo(() => cartItemId ? cart.items.find((it) => it.cartItemId === cartItemId) ?? null : null, [cart.items, cartItemId]);
  const [selected, setSelected] = useState<{ [groupId: string]: Modifier[] }>(() => editingLine?.selectedModifiers ?? {});
  const [qty, setQty] = useState(() => editingLine?.quantity ?? 1);
  const [showErrors, setShowErrors] = useState(false);

  if (loading && !product) return <View style={styles.root}><Header showBack safeTop /><LoadingView label={t('loading')} /></View>;
  if (!product) return <View style={styles.root}><Header showBack safeTop /><ErrorView message={t('somethingWentWrong')} onRetry={() => router.back()} retryLabel={t('back')} /></View>;

  const toggle = (group: ModifierGroup, mod: Modifier) => setSelected((prev) => {
    const current = prev[group.id] ?? []; const single = group.maxSelection === 1; const already = current.some((m) => m.id === mod.id);
    let next: Modifier[];
    if (single) next = already && !group.isRequired ? [] : [mod];
    else if (already) next = current.filter((m) => m.id !== mod.id);
    else { if (current.length >= group.maxSelection) return prev; next = [...current, mod]; }
    return { ...prev, [group.id]: next };
  });
  const missingGroups = groups.filter((g) => (selected[g.id] ?? []).length < (g.isRequired ? Math.max(1, g.minSelection) : g.minSelection));
  const canSave = missingGroups.length === 0; const total = Number((computeUnitPrice(product, selected) * qty).toFixed(2));
  const isEditing = Boolean(cartItemId && editingLine);
  const save = () => {
    if (!canSave) { setShowErrors(true); return; }
    if (isEditing && cartItemId) cart.updateItem(cartItemId, product, selected, qty); else cart.addItem(product, selected, qty);
    router.back();
  };

  return (
    <View style={styles.root}>
      <Header showBack safeTop title={pick(product.nameEn, product.nameAr)} />
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.hero} contentFit="cover" transition={150} /> : null}
        <View style={styles.body}>
          <Text variant="display">{pick(product.nameEn, product.nameAr)}</Text>
          {pick(product.descriptionEn, product.descriptionAr) ? <Text variant="body" tone="secondary" style={{ marginTop: space.s1 }}>{pick(product.descriptionEn, product.descriptionAr)}</Text> : null}
          <View style={[styles.metaRow, rtlRow]}><Price amount={product.price} size={typeScale.title.size} color={colors.appText} weight="700" />{product.calories ? <Text variant="caption" tone="tertiary">{product.calories} {t('kcal')}</Text> : null}</View>
          {groups.map((g) => {
            const count = (selected[g.id] ?? []).length; const min = g.isRequired ? Math.max(1, g.minSelection) : g.minSelection; const unmet = showErrors && count < min;
            return <View key={g.id} style={[styles.group, unmet && styles.groupUnmet]}>
              <View style={[styles.groupHead, rtlRow]}><Text variant="heading" style={{ flex: 1 }}>{pick(g.nameEn, g.nameAr)}</Text><StatusPill label={g.isRequired ? t('required') : t('optional')} tone={g.isRequired ? 'danger' : 'neutral'} /></View>
              {unmet ? <Text variant="caption" tone="danger" style={{ marginBottom: space.s1 }}>{t('required')} · {min}</Text> : null}
              <View style={{ gap: space.s2 }}>{g.modifiers.map((m) => {
                const checked = (selected[g.id] ?? []).some((x) => x.id === m.id);
                return <Pressable key={m.id} style={[styles.modRow, rtlRow, checked && styles.modRowOn]} onPress={() => toggle(g, m)} accessibilityRole={g.maxSelection === 1 ? 'radio' : 'checkbox'} accessibilityState={{ checked }}>
                  <View style={[styles.check, g.maxSelection === 1 ? styles.radio : null, checked && styles.checkOn]}>{checked ? <Text variant="label" tone="onEmber" align="center">✓</Text> : null}</View>
                  <Text variant="body" style={{ flex: 1 }}>{pick(m.nameEn, m.nameAr)}</Text>{m.price > 0 ? <Price amount={m.price} prefix="+" size={typeScale.label.size} color={colors.ember} weight="700" /> : null}
                </Pressable>;
              })}</View>
            </View>;
          })}
          <View style={[styles.qtyRow, rtlRow]}><Text variant="heading">{t('quantity')}</Text><QtyStepper value={qty} onIncrement={() => setQty((q) => q + 1)} onDecrement={() => setQty((q) => Math.max(1, q - 1))} /></View>
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.s2 }]}><Pressable onPress={save} style={({ pressed }) => [styles.addBtn, rtlRow, !canSave && styles.addBtnDim, pressed && canSave && { opacity: 0.9 }]} accessibilityRole="button">
        <Text variant="heading" tone={canSave ? 'onEmber' : 'secondary'}>{isEditing ? pick('Save changes', 'حفظ التعديلات') : t('addForPrice')}</Text>
        <Price amount={total} size={typeScale.heading.size} color={canSave ? colors.onEmber : colors.disabledFg} weight="700" />
      </Pressable></View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.appBg }, hero: { width: '100%', height: 260, backgroundColor: colors.appSurface2 }, body: { padding: space.s4 },
  metaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s4, marginTop: space.s3 },
  group: { marginTop: space.s4, backgroundColor: colors.appSurface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.appLine, padding: space.s3 }, groupUnmet: { borderColor: colors.danger },
  groupHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: space.s2, gap: space.s2 },
  modRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s3, backgroundColor: colors.appSurface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.appLine, padding: space.s3, minHeight: 48 }, modRowOn: { borderColor: colors.ember, backgroundColor: colors.appSurface2 },
  check: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.appLine, alignItems: 'center' as const, justifyContent: 'center' as const }, radio: { borderRadius: 12 }, checkOn: { backgroundColor: colors.ember, borderColor: colors.ember },
  qtyRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginTop: space.s5 },
  footer: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: colors.appSurface, borderTopWidth: 1, borderTopColor: colors.appLine, paddingHorizontal: space.s4, paddingTop: space.s3 },
  addBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, backgroundColor: colors.ember, borderRadius: radius.lg, paddingHorizontal: space.s5, paddingVertical: space.s4, minHeight: 54 }, addBtnDim: { backgroundColor: colors.disabledBg },
}));
