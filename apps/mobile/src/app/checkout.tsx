import React from 'react';

import { AuthGate } from '../components/AuthGate';
import { CheckoutScreen } from '../features/checkout/CheckoutScreen';

export default function CheckoutRoute() {
  return (
    <AuthGate>
      <CheckoutScreen />
    </AuthGate>
  );
}
