/**
 * Composes the app-wide providers in one place so the router layout stays tidy.
 * Order matters only in that all three are independent here; none depends on
 * another's context at construction time.
 */
import React from 'react';

import { AuthProvider } from './AuthProvider';
import { CatalogProvider } from './CatalogProvider';
import { CartProvider } from './CartProvider';

export { useAuth } from './AuthProvider';
export { useCatalog } from './CatalogProvider';
export { useCart } from './CartProvider';

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CatalogProvider>
        <CartProvider>{children}</CartProvider>
      </CatalogProvider>
    </AuthProvider>
  );
}
