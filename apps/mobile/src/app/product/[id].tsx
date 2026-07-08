import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { ProductDetailScreen } from '../../features/product/ProductDetailScreen';

export default function ProductRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProductDetailScreen productId={String(id)} />;
}
