/**
 * DEV-ONLY UI fixture route. Renders the REAL production components against
 * deterministic mock data so screens can be reviewed in English LTR and Arabic
 * RTL, at phone and tablet widths, WITHOUT a WhatsApp OTP.
 *
 * Production safety, in order of strength:
 *   1. `if (!__DEV__) return <Redirect href="/" />` — in any release build this
 *      route renders nothing and bounces to home.
 *   2. Nothing in the app links to it; it is reachable only by typing the path.
 *   3. Every handler here is a no-op `() => {}`. It cannot call an API, write to
 *      Supabase, create an order, or start a payment — there is no code path
 *      from this file to any of them.
 *   4. All data is the local `MOCK_*` constants below. No fetch, no store.
 *
 * Modes: /dev-preview (menu cards) · ?c=cart (cart lines) · ?c=riyal (Riyal scale)
 *
 * LIMITATION: these are component-level fixtures. Whole-screen fixtures for
 * ProductDetail / Checkout / Payment need the catalog and cart React contexts
 * exported from `src/store` so a mock provider can supply them — tracked in the
 * migration tracker as the next step for this route.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, Text, View, type TextStyle } from 'react-native';

import { Price } from '../components/Price';
import { Screen } from '../components/Screen';
import { CartLine } from '../features/cart/CartScreen';
import { ProductCard } from '../features/menu/HomeMenuScreen';
import { useI18n } from '../i18n/I18nProvider';
import { color, space } from '../design-system/generated/tokens';
import type { CartItem, Product } from '../types/models';
import { useThemeColors } from '../theme/ThemeProvider';

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
      <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s3 }}>
        {c === 'riyal'
          ? RIYAL_SAMPLES.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3 }}>
                <Text style={{ width: 92, fontSize: 12, color: colors.appText3 }}>{r.label}</Text>
                <Price amount={r.a} prefix={r.prefix} size={r.s} color={colors.appText} weight={r.w} />
                <Price amount={r.a} prefix={r.prefix} size={r.s} color={colors.ember} weight="800" />
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
                  editLabel={pick('Edit item', 'تعديل المنتج')}
                  onEdit={() => {}}
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