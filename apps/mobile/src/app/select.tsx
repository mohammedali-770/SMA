import React from 'react';

import { AuthGate } from '../components/AuthGate';
import { OrderTypeSelectScreen } from '../features/order/OrderTypeSelectScreen';

export default function SelectRoute() {
  return (
    <AuthGate>
      <OrderTypeSelectScreen />
    </AuthGate>
  );
}
