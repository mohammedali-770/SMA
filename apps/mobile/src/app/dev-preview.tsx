/**
 * DEV-ONLY UI preview harness. Renders key presentational components with mock
 * data so screens can be visually verified (English LTR / Arabic RTL, mobile
 * sizes) without auth or a backend. NEVER ships: the __DEV__ gate redirects
 * home in any release build, and nothing links to it. Mirrors /dev-sentry.
 */
import { Redirect } from 'expo-router';
import React from 'react';
import { ScrollView } from 'react-native';

import { Screen } from '../components/Screen';
import { ProductCard } from '../features/menu/HomeMenuScreen';
import { spacing } from '../theme';
import type { Product } from '../types/models';

const P = (o: Partial<Product>): Product => o as unknown as Product;

const MOCK: { product: Product; hasModifiers: boolean }[] = [
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

export default function DevPreview() {
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {MOCK.map((m) => (
          <ProductCard key={m.product.id} product={m.product} hasModifiers={m.hasModifiers} onAdd={() => {}} />
        ))}
      </ScrollView>
    </Screen>
  );
}