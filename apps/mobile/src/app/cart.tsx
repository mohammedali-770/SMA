import React from 'react';

import { AuthGate } from '../components/AuthGate';
import { CartScreen } from '../features/cart/CartScreen';

export default function CartRoute() {
  return (
    <AuthGate>
      <CartScreen />
    </AuthGate>
  );
}
