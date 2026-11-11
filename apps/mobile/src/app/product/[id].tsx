import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ProductDetailScreen } from '../../features/product/ProductDetailScreen';
/** Not behind AuthGate: product detail reads only the public catalog and the on-device cart. */
export default function ProductRoute() {
  const { id, cartItemId } = useLocalSearchParams<{ id: string; cartItemId?: string }>();
  return <ProductDetailScreen productId={String(id)} cartItemId={cartItemId ? String(cartItemId) : undefined} />;
}
