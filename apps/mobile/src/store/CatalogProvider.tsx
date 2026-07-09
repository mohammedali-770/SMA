/**
 * Catalog + settings state. Loads the whole menu graph from Supabase once on
 * mount (catalog.all()), maps it to domain models, and exposes selectors the
 * screens use. Also owns the manually-chosen branch (persisted) — per the
 * brief, the app NEVER auto-selects a branch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { catalog } from '../services/api';
import {
  buildAvailabilityMatrix, mapBranch, mapBrandSettings, mapCategory, mapLoyaltySettings,
  mapModifierGroup, mapPaymentMethodSettings, mapProduct,
} from '../lib/mappers';
import type { Branch, BrandSettings, Category, LoyaltySettings, ModifierGroup, Product } from '../types/models';
import type { PaymentMethodSettings } from '../lib/payment';

// Safe fallback matching the DB defaults (cash on, online off) so the customer
// is never blocked before settings finish loading.
const DEFAULT_PAYMENT_SETTINGS: PaymentMethodSettings = {
  onlineEnabled: false, cashEnabled: true, defaultMethod: 'cash', outageMode: false,
};

const BRANCH_KEY = 'spicymeal.branchId';

interface CatalogValue {
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

  selectedBranchId: string | null;
  selectedBranch: Branch | null;
  setSelectedBranch: (id: string) => void;

  getProduct: (id: string) => Product | undefined;
  groupsForProduct: (product: Product) => ModifierGroup[];
  isAvailable: (productId: string, branchId: string) => boolean;
  branchIsOpen: (branch: Branch | null | undefined) => boolean;
}

const CatalogContext = createContext<CatalogValue | null>(null);

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
  const [availability, setAvailability] = useState<{ [p: string]: { [b: string]: boolean } }>({});
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const mounted = useRef(true);

  // Restore the previously chosen branch (if any) — this is a user choice being
  // remembered, NOT an auto-selection of a default branch.
  useEffect(() => {
    AsyncStorage.getItem(BRANCH_KEY)
      .then((v) => { if (v) setSelectedBranchId(v); })
      .catch(() => {});
  }, []);

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
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : 'Failed to load the menu.');
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; };
  }, [reloadTick]);

  const setSelectedBranch = useCallback((id: string) => {
    setSelectedBranchId(id);
    AsyncStorage.setItem(BRANCH_KEY, id).catch(() => {});
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
    branches, categories, products, modifierGroupsById, brand, loyalty, payment,
    selectedBranchId, selectedBranch, setSelectedBranch,
    getProduct, groupsForProduct, isAvailable, branchIsOpen,
  }), [
    loading, error, reload, branches, categories, products, modifierGroupsById, brand, loyalty, payment,
    selectedBranchId, selectedBranch, setSelectedBranch, getProduct, groupsForProduct, isAvailable, branchIsOpen,
  ]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used within CatalogProvider');
  return ctx;
}
