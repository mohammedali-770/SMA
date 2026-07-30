/**
 * Catalog + settings state. Loads the whole menu graph from Supabase once on
 * mount (catalog.all()), maps it to domain models, and exposes selectors the
 * screens use. The selected branch is a MIRROR of the order context (see
 * OrderContextProvider — the persisted pickup/delivery decision): the app never
 * auto-selects a branch; an invalid/missing context forces the blocking
 * selection screen before the menu is usable.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { catalog } from '../services/api';
import {
  buildAvailabilityMatrix, mapBranch, mapBrandSettings, mapCategory, mapDeliveryZone, mapLoyaltySettings,
  mapModifierGroup, mapPaymentMethodSettings, mapProduct, mapSupportSettings,
} from '../lib/mappers';
import type { Branch, BrandSettings, Category, DeliveryZone, LoyaltySettings, ModifierGroup, Product } from '../types/models';
import type { PaymentMethodSettings } from '../lib/payment';
import type { SupportSettings } from '../lib/supportContact';

// Safe fallback matching the DB defaults (cash on, online off) so the customer
// is never blocked before settings finish loading.
const DEFAULT_PAYMENT_SETTINGS: PaymentMethodSettings = {
  onlineEnabled: false, cashEnabled: true, defaultMethod: 'cash', outageMode: false,
};

export interface CatalogValue {
  loading: boolean;
  error: string | null;
  reload: () => void;

  branches: Branch[];
  categories: Category[];
  products: Product[];
  modifierGroupsById: Record<string, ModifierGroup>;
  brand: BrandSettings | null;
  loyalty: LoyaltySettings | null;
  payment: PaymentMethodSettings;
  support: SupportSettings | null;
  deliveryZones: DeliveryZone[];

  selectedBranchId: string | null;
  selectedBranch: Branch | null;
  // Driven by OrderContextProvider (the single source of truth): pass a branch id
  // to mirror the chosen branch, or null to clear it when the context is reset.
  setSelectedBranch: (id: string | null) => void;

  getProduct: (id: string) => Product | undefined;
  groupsForProduct: (product: Product) => ModifierGroup[];
  isAvailable: (productId: string, branchId: string) => boolean;
  branchIsOpen: (branch: Branch | null | undefined) => boolean;
}

/**
 * Exported ONLY so the dev fixture provider can supply deterministic mock state
 * to the real screens (see src/dev/FixtureProvider.tsx). Production code must
 * keep using `useCatalog()` — nothing outside src/dev may consume this directly.
 */
export const CatalogContext = createContext<CatalogValue | null>(null);

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modifierGroupsById, setModifierGroupsById] = useState<Record<string, ModifierGroup>>({});
  const [brand, setBrand] = useState<BrandSettings | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltySettings | null>(null);
  const [payment, setPayment] = useState<PaymentMethodSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [support, setSupport] = useState<SupportSettings | null>(null);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [availability, setAvailability] = useState<{ [p: string]: { [b: string]: boolean } }>({});
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const mounted = useRef(true);

  // NOTE: the branch itself is not persisted here — OrderContextProvider owns
  // the persisted pickup/delivery decision and mirrors its (re-validated)
  // branch into this provider on launch. A context that is no longer valid
  // sends the customer back to the blocking selection screen instead of ever
  // auto-selecting a branch.

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const raw = await catalog.all();
        if (!mounted.current) return;
        const mappedBranches = raw.branches.map(mapBranch);
        const mappedProducts = raw.products.map((p) => mapProduct(p, raw.links));
        const groups: Record<string, ModifierGroup> = {};
        for (const g of raw.modifierGroups) {
          groups[g.id] = mapModifierGroup(g, raw.modifiers);
        }
        setBranches(mappedBranches);
        setCategories(raw.categories.map(mapCategory));
        setProducts(mappedProducts);
        setModifierGroupsById(groups);
        setAvailability(buildAvailabilityMatrix(raw.products, raw.branches, raw.availability));
        setBrand(mapBrandSettings(raw.settings));
        setLoyalty(mapLoyaltySettings(raw.settings));
        setPayment(mapPaymentMethodSettings(raw.settings));
        setSupport(mapSupportSettings(raw.settings));
        setDeliveryZones((raw.deliveryZones ?? []).map(mapDeliveryZone));
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : 'Failed to load the menu.');
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; };
  }, [reloadTick]);

  // Mirror of the order context's branch. The persisted source of truth lives in
  // OrderContextProvider; this stays the accessor the menu/product/checkout
  // screens already read (selectedBranch), so those screens are untouched.
  const setSelectedBranch = useCallback((id: string | null) => {
    setSelectedBranchId(id);
  }, []);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === selectedBranchId) ?? null,
    [branches, selectedBranchId],
  );

  const getProduct = useCallback((id: string) => products.find((p) => p.id === id), [products]);

  const groupsForProduct = useCallback(
    (product: Product) => product.modifierGroupIds.map((gid) => modifierGroupsById[gid]).filter(Boolean),
    [modifierGroupsById],
  );

  const isAvailable = useCallback(
    (productId: string, branchId: string) => availability[productId]?.[branchId] ?? true,
    [availability],
  );

  // "Open" == the branch is active. There is no opening-hours schema yet, and
  // place_order re-checks is_active server-side, so this matches the backend.
  const branchIsOpen = useCallback((branch: Branch | null | undefined) => Boolean(branch?.isActive), []);

  const value = useMemo<CatalogValue>(() => ({
    loading, error, reload,
    branches, categories, products, modifierGroupsById, brand, loyalty, payment, support, deliveryZones,
    selectedBranchId, selectedBranch, setSelectedBranch,
    getProduct, groupsForProduct, isAvailable, branchIsOpen,
  }), [
    loading, error, reload, branches, categories, products, modifierGroupsById, brand, loyalty, payment, support, deliveryZones,
    selectedBranchId, selectedBranch, setSelectedBranch, getProduct, groupsForProduct, isAvailable, branchIsOpen,
  ]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used within CatalogProvider');
  return ctx;
}
