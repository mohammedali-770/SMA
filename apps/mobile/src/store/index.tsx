/**
 * Composes the app-wide providers in one place so the router layout stays tidy.
 * Order matters only in that all three are independent here; none depends on
 * another's context at construction time.
 */
import React from 'react';

import { AuthProvider } from './AuthProvider';
import { CatalogProvider } from './CatalogProvider';
import { OrderContextProvider } from './OrderContextProvider';
import { CartProvider } from './CartProvider';

export { useAuth } from './AuthProvider';
export { useCatalog } from './CatalogProvider';
export { useOrderContext } from './OrderContextProvider';
export { useCart } from './CartProvider';

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  // OrderContext sits inside Catalog (it validates against branches/zones and
  // mirrors the selected branch) and above Cart (cart validation reads the
  // selected context/branch).
  return (
    <AuthProvider>
      <CatalogProvider>
        <OrderContextProvider>
          <CartProvider>{children}</CartProvider>
        </OrderContextProvider>
      </CatalogProvider>
    </AuthProvider>
  );
}
