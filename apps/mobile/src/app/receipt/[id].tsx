import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { AuthGate } from '../../components/AuthGate';
import { ReceiptScreen } from '../../features/orders/ReceiptScreen';

export default function ReceiptRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <ReceiptScreen orderId={String(id)} />
    </AuthGate>
  );
}
