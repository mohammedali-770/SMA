import React from 'react';

import { CartScreen } from '../features/cart/CartScreen';

/**
 * Not behind AuthGate: a guest may fill a cart (guest browsing, App Store
 * 5.1.1(v)). The cart is on-device; CartScreen asks for an account at the
 * checkout button, and `checkout` keeps its own gate as the backstop.
 */
export default function CartRoute() {
  return <CartScreen />;
}
