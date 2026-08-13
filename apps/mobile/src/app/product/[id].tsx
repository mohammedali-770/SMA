import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { AuthGate } from '../../components/AuthGate';
import { ProductDetailScreen } from '../../features/product/ProductDetailScreen';
export default function ProductRoute() {
  const { id, cartItemId } = useLocalSearchParams<{ id: string; cartItemId?: string }>();
  return <AuthGate><ProductDetailScreen productId={String(id)} cartItemId={cartItemId ? String(cartItemId) : undefined} /></AuthGate>;
}
