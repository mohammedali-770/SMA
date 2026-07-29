/**
 * DEV-ONLY UI preview harness. Renders key presentational components with mock
 * data so screens can be visually verified (English LTR / Arabic RTL, mobile
 * sizes) without auth or a backend. NEVER ships: the __DEV__ gate redirects
 * home in any release build, and nothing links to it. Mirrors /dev-sentry.
 *
 * Routes: /dev-preview (menu cards) · ?c=cart (cart lines) · ?c=riyal (Riyal symbol)
 */
import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, Text, View, type TextStyle } from 'react-native';

import { Price } from '../components/Price';
import { Screen } from '../components/Screen';
import { CartLine } from '../features/cart/CartScreen';
import { ProductCard } from '../features/menu/HomeMenuScreen';
import { useI18n } from '../i18n/I18nProvider';
import { colors, spacing } from '../theme';
import { useThemeColors } from '../theme/ThemeProvider';
import type { CartItem, Product } from '../types/models';

const P = (o: Partial<Product>): Product => o as unknown as Product;
const C = (o: Partial<CartItem>): CartItem => o as unknown as CartItem;

const MOCK_CARDS: { product: Product; hasModifiers: boolean }[] = [
  { hasModifiers: true, product: P({
    id: '1', nameEn: 'Spicy Crispy Chicken Meal', nameAr: 'وجبة دجاج مقرمش حار',
    descriptionEn: 'Two crispy fillets, fries, coleslaw and a drink.',
    descriptionAr: 'قطعتان مقرمشتان، بطاطس، سلطة كول سلو ومشروب.',
    price: 34.5, calories: 890, modifierGroupIds: ['g1'],
  }) },
  { hasModifiers: false, product: P({
    id: '2', nameEn: 'Golden Fries', nameAr: 'بطاطس ذهبية',
    descriptionEn: 'Hand-cut and lightly salted.', descriptionAr: 'مقطعة يدويًا ومملحة قليلًا.',
    price: 9, calories: 320, modifierGroupIds: [],
  }) },
  { hasModifiers: false, product: P({
    id: '3', nameEn: 'Fresh Lemon Mint', nameAr: 'ليمون بالنعناع الطازج',
    descriptionEn: '', descriptionAr: '', price: 12, modifierGroupIds: [],
  }) },
];

const MOCK_CART: { item: CartItem; modsEn: string; modsAr: string }[] = [
  { modsEn: 'Extra Spicy · Large Fries', modsAr: 'حار إضافي · بطاطس كبيرة', item: C({
    cartItemId: 'c1', quantity: 2, unitPrice: 34.5, selectedModifiers: {},
    product: P({ id: '1', nameEn: 'Spicy Crispy Chicken Meal', nameAr: 'وجبة دجاج مقرمش حار' }),
  }) },
  { modsEn: '', modsAr: '', item: C({
    cartItemId: 'c2', quantity: 1, unitPrice: 9, selectedModifiers: {},
    product: P({ id: '2', nameEn: 'Golden Fries', nameAr: 'بطاطس ذهبية' }),
  }) },
];

const RIYAL_SAMPLES: { label: string; a: number; s: number; w: TextStyle['fontWeight']; prefix?: string }[] = [
  { label: 'small · 13', a: 0.5, s: 13, w: '600' },
  { label: 'body · 15', a: 34.5, s: 15, w: '800' },
  { label: 'modifier +', a: 2, s: 13, w: '800', prefix: '+' },
  { label: 'discount −', a: 15, s: 15, w: '800', prefix: '−' },
  { label: 'heading · 17', a: 129, s: 17, w: '800' },
  { label: 'total · 20', a: 1299.75, s: 20, w: '800' },
  { label: 'large · 22', a: 12500, s: 22, w: '800' },
];

export default function DevPreview() {
  const colors = useThemeColors();
  const { c } = useLocalSearchParams<{ c?: string }>();
  const { pick, t } = useI18n();
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {c === 'riyal'
          ? RIYAL_SAMPLES.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Text style={{ width: 92, fontSize: 12, color: colors.muted }}>{r.label}</Text>
                <Price amount={r.a} prefix={r.prefix} size={r.s} color={colors.text} weight={r.w} />
                <Price amount={r.a} prefix={r.prefix} size={r.s} color={colors.accent} weight="800" />
              </View>
            ))
          : c === 'cart'
            ? MOCK_CART.map((m) => (
                <CartLine
                  key={m.item.cartItemId}
                  item={m.item}
                  name={pick(m.item.product.nameEn, m.item.product.nameAr)}
                  modifierSummary={m.modsEn ? pick(m.modsEn, m.modsAr) : ''}
                  lineAmount={m.item.unitPrice * m.item.quantity}
                  removeLabel={t('remove')}
                  onInc={() => {}}
                  onDec={() => {}}
                  onRemove={() => {}}
                />
              ))
            : MOCK_CARDS.map((m) => (
                <ProductCard key={m.product.id} product={m.product} hasModifiers={m.hasModifiers} onAdd={() => {}} />
              ))}
      </ScrollView>
    </Screen>
  );
}