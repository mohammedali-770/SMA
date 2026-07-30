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

// Contexts + value types are exported for the DEV FIXTURE PROVIDER only
// (src/dev/FixtureProvider.tsx), so the real screens can be rendered against
// deterministic mock state without duplicating any provider logic. Production
// code must keep using the hooks above.
export { AuthContext, type AuthValue } from './AuthProvider';
export { CatalogContext, type CatalogValue } from './CatalogProvider';
export { CartContext, type CartValue } from './CartProvider';
export { OrderCtx, type OrderContextValue } from './OrderContextProvider';

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
