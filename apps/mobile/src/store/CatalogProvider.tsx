/**
 * Catalog + settings state. Loads the whole menu graph from Supabase once on
 * mount (catalog.all()), maps it to domain models, and exposes selectors the
 * screens use. The selected branch is a MIRROR of the order context (see
 * OrderContextProvider — the persisted pickup/delivery decision): the app never
 * auto-selects a branch; an invalid/missing context forces the blocking
 * selection screen before the menu is usable.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { catalog } from '../services/api';
import { failureMessage } from '../lib/errors/reportFailure';
import { useI18n } from '../i18n/I18nProvider';
import {
  buildAvailabilityMatrix, buildModifierAvailabilityMatrix, buildVariantAvailabilityMatrix,
  mapBranch, mapBrandSettings, mapCategory,
  mapDeliveryZone, mapLoyaltySettings,
  mapModifierGroup, mapPaymentMethodSettings, mapProduct, mapSupportSettings,
} from '../lib/mappers';
import { productOrderable } from '../lib/orderability';
import type { Branch, BrandSettings, Category, DeliveryZone, LoyaltySettings, ModifierGroup, Product } from '../types/models';
import type { PaymentMethodSettings } from '../lib/payment';
import type { SupportSettings } from '../lib/supportContact';

// Safe fallback matching the DB defaults (cash on, online off) so the customer
// is never blocked before settings finish loading.
const DEFAULT_PAYMENT_SETTINGS: PaymentMethodSettings = {
  onlineEnabled: false, cashEnabled: true, defaultMethod: 'cash', outageMode: false,
};

export type AvailabilityMatrix = { [productId: string]: { [branchId: string]: boolean } };

/**
 * All THREE availability axes as of one fetch. Products, sizes and options are
 * closed independently, and a caller that acts on freshness (the checkout
 * pre-check) has to see them together or it will clear a cart line for the wrong
 * reason.
 */
export interface AvailabilitySnapshot {
  products: AvailabilityMatrix;
  /** modifierId -> branchId -> available. Same exception-only semantics. */
  modifiers: AvailabilityMatrix;
  /**
   * variantId -> branchId -> available. Exceptions only and NOT seeded, so it
   * holds closed tiers alone; `availabilityLookup`'s `?? true` supplies the
   * rest. Lapsed restore timers are already resolved to "open" by the builder.
   */
  variants: AvailabilityMatrix;
}

export interface CatalogValue {
  loading: boolean;
  error: string | null;
  reload: () => void;
  /**
   * Re-read ONLY branch availability, without re-fetching the whole menu graph.
   *
   * The catalog otherwise loads once per mount, which meant a customer already
   * browsing never learned that a branch had closed an item — they discovered it
   * as a raw server error at checkout. This is cheap enough to run on every
   * foreground and every return to the menu; prices, categories and modifiers
   * still need the full `reload()`.
   *
   * Returns the freshly built matrix so a caller can act on it immediately —
   * React state set inside this call is not visible to the awaiting closure,
   * and the checkout pre-check has to decide with the values it just fetched.
   * Null means the refresh failed and the caller should not draw conclusions.
   */
  refreshAvailability: () => Promise<AvailabilitySnapshot | null>;

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
  /** One OPTION's availability at a branch. Absent row means on sale. */
  isModifierAvailable: (modifierId: string, branchId: string) => boolean;
  /**
   * One PRICE TIER's availability at a branch. Absent row means on sale, and a
   * closure whose restore time has passed already counts as absent.
   *
   * A product with no tiers has nothing to ask about; a cart line naming no tier
   * is resolved server-side to the cheapest ACTIVE one, which `place_order`
   * checks itself.
   */
  isVariantAvailable: (variantId: string, branchId: string) => boolean;
  /**
   * `isAvailable` AND every required option group still satisfiable. This is
   * what the menu and the product screen ask; `isAvailable` alone answers only
   * "is the item itself closed", which is no longer the whole question.
   */
  isOrderable: (productId: string, branchId: string) => boolean;
  branchIsOpen: (branch: Branch | null | undefined) => boolean;
}

/**
 * Exported ONLY so the dev fixture provider can supply deterministic mock state
 * to the real screens (see src/dev/FixtureProvider.tsx). Production code must
 * keep using `useCatalog()` — nothing outside src/dev may consume this directly.
 */
export const CatalogContext = createContext<CatalogValue | null>(null);

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  // Safe: _layout nests I18nProvider OUTSIDE AppStoreProvider.
  const { t } = useI18n();
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
  const [availability, setAvailability] = useState<AvailabilityMatrix>({});
  const [modifierAvailability, setModifierAvailability] = useState<AvailabilityMatrix>({});
  const [variantAvailability, setVariantAvailability] = useState<AvailabilityMatrix>({});
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const mounted = useRef(true);
  // The matrix seeds every product x branch to available before applying stored
  // exceptions, so a partial refresh needs the same id lists the full load used.
  const matrixSeed = useRef<{
    products: { id: string }[]; modifiers: { id: string }[]; branches: { id: string }[];
  }>({ products: [], modifiers: [], branches: [] });

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
        const mappedProducts = raw.products.map((p) => mapProduct(p, raw.links, raw.productVariants));
        const groups: Record<string, ModifierGroup> = {};
        for (const g of raw.modifierGroups) {
          groups[g.id] = mapModifierGroup(g, raw.modifiers);
        }
        setBranches(mappedBranches);
        setCategories(raw.categories.map(mapCategory));
        setProducts(mappedProducts);
        setModifierGroupsById(groups);
        matrixSeed.current = { products: raw.products, modifiers: raw.modifiers, branches: raw.branches };
        setAvailability(buildAvailabilityMatrix(raw.products, raw.branches, raw.availability));
        setModifierAvailability(
          buildModifierAvailabilityMatrix(raw.modifiers, raw.branches, raw.modifierAvailability));
        setVariantAvailability(buildVariantAvailabilityMatrix(raw.variantAvailability));
        setBrand(mapBrandSettings(raw.settings));
        setLoyalty(mapLoyaltySettings(raw.settings));
        setPayment(mapPaymentMethodSettings(raw.settings));
        setSupport(mapSupportSettings(raw.settings));
        setDeliveryZones((raw.deliveryZones ?? []).map(mapDeliveryZone));
      } catch (e) {
        // Was rendering the raw provider message straight onto the menu screen.
        if (mounted.current) setError(failureMessage(e, t, { subsystem: 'menu', op: 'load_catalog' }));
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; };
  }, [reloadTick, t]);

  // Mirror of the order context's branch. The persisted source of truth lives in
  // OrderContextProvider; this stays the accessor the menu/product/checkout
  // screens already read (selectedBranch), so those screens are untouched.
  const setSelectedBranch = useCallback((id: string | null) => {
    setSelectedBranchId(id);
  }, []);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  const refreshAvailability = useCallback(async (): Promise<AvailabilitySnapshot | null> => {
    const seed = matrixSeed.current;
    if (seed.products.length === 0) return null;   // nothing loaded yet
    try {
      // Branches come too. A call-centre operator can pause delivery while the
      // customer is mid-order, and `deliveryTemporarilyClosed` decides whether
      // the delivery flow is offered at all (CheckoutScreen) and which branches
      // are eligible (geo.deliveryEligibleBranches). Without this the customer
      // kept the delivery option until place_order refused the order at the end.
      const [rows, modRows, varRows, freshBranches] = await Promise.all([
        catalog.availability(), catalog.modifierAvailability(), catalog.variantAvailability(),
        catalog.branches(),
      ]);
      const next: AvailabilitySnapshot = {
        products: buildAvailabilityMatrix(seed.products, seed.branches, rows),
        modifiers: buildModifierAvailabilityMatrix(seed.modifiers, seed.branches, modRows),
        // No seed list needed — the builder emits closed tiers only. That is
        // also why a size closed on a product the catalog has not loaded still
        // lands here correctly rather than being dropped for want of an id.
        variants: buildVariantAvailabilityMatrix(varRows),
      };
      if (mounted.current) {
        setAvailability(next.products);
        setModifierAvailability(next.modifiers);
        setVariantAvailability(next.variants);
        // Replaced wholesale rather than merged: this is the same read and the
        // same mapper the initial load uses, so it cannot drift from it.
        setBranches(freshBranches.map(mapBranch));
      }
      return next;
    } catch {
      // Deliberately silent. This is a freshness nicety on top of state the
      // customer already has; a failed refresh must not replace a working menu
      // with an error, and place_order re-checks availability regardless.
      return null;
    }
  }, []);

  // Foreground is the moment stale availability matters most: the app may have
  // sat in the background for hours while the branch closed half the menu.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshAvailability();
    });
    return () => sub.remove();
  }, [refreshAvailability]);

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

  const isModifierAvailable = useCallback(
    (modifierId: string, branchId: string) => modifierAvailability[modifierId]?.[branchId] ?? true,
    [modifierAvailability],
  );

  const isVariantAvailable = useCallback(
    (variantId: string, branchId: string) => variantAvailability[variantId]?.[branchId] ?? true,
    [variantAvailability],
  );

  const isOrderable = useCallback(
    (productId: string, branchId: string) => {
      const product = products.find((p) => p.id === productId);
      if (!product) return isAvailable(productId, branchId);
      return productOrderable({
        productAvailable: isAvailable(productId, branchId),
        groups: groupsForProduct(product),
        isModifierAvailable: (mid) => isModifierAvailable(mid, branchId),
        // Without this the menu card would offer "Add" on an item whose every
        // size is closed, and the product screen one tap later would say it is
        // out of stock. They read the same rule now.
        variants: product.variants,
        isVariantAvailable: (vid) => isVariantAvailable(vid, branchId),
      });
    },
    [products, groupsForProduct, isAvailable, isModifierAvailable, isVariantAvailable],
  );

  // "Open" == the branch is active. There is no opening-hours schema yet, and
  // place_order re-checks is_active server-side, so this matches the backend.
  const branchIsOpen = useCallback((branch: Branch | null | undefined) => Boolean(branch?.isActive), []);

  const value = useMemo<CatalogValue>(() => ({
    loading, error, reload, refreshAvailability,
    branches, categories, products, modifierGroupsById, brand, loyalty, payment, support, deliveryZones,
    selectedBranchId, selectedBranch, setSelectedBranch,
    getProduct, groupsForProduct, isAvailable, isModifierAvailable, isVariantAvailable, isOrderable,
    branchIsOpen,
  }), [
    loading, error, reload, refreshAvailability, branches, categories, products, modifierGroupsById, brand, loyalty, payment, support, deliveryZones,
    selectedBranchId, selectedBranch, setSelectedBranch, getProduct, groupsForProduct, isAvailable,
    isModifierAvailable, isVariantAvailable, isOrderable, branchIsOpen,
  ]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used within CatalogProvider');
  return ctx;
}
