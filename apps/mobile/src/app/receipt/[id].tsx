import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { ReceiptScreen } from '../../features/orders/ReceiptScreen';

export default function ReceiptRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReceiptScreen orderId={String(id)} />;
}
