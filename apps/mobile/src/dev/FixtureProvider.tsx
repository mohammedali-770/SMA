/**
 * DEV-ONLY state injection for visual review.
 *
 * Supplies deterministic mock values to the REAL catalog / order-context / cart
 * contexts, so the REAL screens render without auth, without a network and
 * without a backend. It does not reimplement any provider — it only supplies
 * the values the production hooks already read, which is why no business logic
 * is duplicated and production provider behaviour is untouched.
 *
 * Hard guarantees, by construction:
 *   • no import from `services/api`, Supabase, Lazywait or any payment SDK;
 *   • every mutator is a no-op — nothing can create an order, start a payment
 *     session, or write anywhere;
 *   • all data comes from `fixtureData.ts`, which is fixed constants.
 *
 * The caller is responsible for the gate (`resolveFixtureGate`); this component
 * additionally refuses to mount outside `__DEV__` as a second line of defence.
 */
import React, { useMemo } from 'react';

import {
  AuthContext,
  CartContext,
  CatalogContext,
  OrderCtx,
  type AuthValue,
  type CartValue,
  type CatalogValue,
  type OrderContextValue,
} from '../store';
import {
  FIXTURE_BRAND_SETTINGS,
  FIXTURE_BRANCH,
  FIXTURE_CART_COUNT,
  FIXTURE_CART_ITEMS,
  FIXTURE_ORDER_CONTEXT,
  FIXTURE_PRODUCTS,
  FIXTURE_LOYALTY,
  FIXTURE_PAYMENT,
  FIXTURE_PROFILE,
  FIXTURE_SUBTOTAL,
} from './fixtureData';

const noop = () => {};

export interface FixtureOptions {
  /** Render the catalog in its loading state. */
  loading?: boolean;
  /** Render the catalog error state with this message. */
  error?: string | null;
  /** Empty the cart (for empty-state review). */
  emptyCart?: boolean;
  /** Make the order context invalid (blocked-checkout review). */
  invalidContext?: boolean;
}

export function FixtureProvider({
  children,
  options = {},
}: {
  children: React.ReactNode;
  options?: FixtureOptions;
}) {
  // Second line of defence. The route gate already checks __DEV__; this makes
  // the provider itself inert if it is ever mounted from somewhere else.
  if (!__DEV__) return <>{children}</>;

  return (
    <FixtureProviderInner options={options}>{children}</FixtureProviderInner>
  );
}

function FixtureProviderInner({
  children,
  options,
}: {
  children: React.ReactNode;
  options: FixtureOptions;
}) {
  const catalog = useMemo(
    () =>
      ({
        loading: Boolean(options.loading),
        error: options.error ?? null,
        reload: noop,
        categories: [],
        products: FIXTURE_PRODUCTS,
        branches: [FIXTURE_BRANCH],
        modifierGroups: [],
        selectedBranch: FIXTURE_BRANCH,
        selectedBranchId: FIXTURE_BRANCH.id,
        selectBranch: noop,
        isAvailable: () => true,
        branchIsOpen: () => true,
        getProduct: (id: string) => FIXTURE_PRODUCTS.find((p) => p.id === id),
        groupsForProduct: () => [],
        // Settings the checkout screen reads. Fixed values so the money column
        // in a screenshot can be checked by hand.
        brand: FIXTURE_BRAND_SETTINGS,
        loyalty: FIXTURE_LOYALTY,
        payment: FIXTURE_PAYMENT,
        deliveryZones: [],
      }) as unknown as CatalogValue,
    [options.loading, options.error],
  );

  const orderContext = useMemo(
    () =>
      ({
        ready: true,
        valid: !options.invalidContext,
        context: options.invalidContext ? null : FIXTURE_ORDER_CONTEXT,
        setContext: noop,
        clear: noop,
        refresh: noop,
      }) as unknown as OrderContextValue,
    [options.invalidContext],
  );

  const cart = useMemo(() => {
    const items = options.emptyCart ? [] : FIXTURE_CART_ITEMS;
    return {
      items,
      count: options.emptyCart ? 0 : FIXTURE_CART_COUNT,
      subtotal: options.emptyCart ? 0 : FIXTURE_SUBTOTAL,
      addItem: noop,
      removeLine: noop,
      incrementLine: noop,
      decrementLine: noop,
      clear: noop,
      notes: '',
      setNotes: noop,
    } as unknown as CartValue;
  }, [options.emptyCart]);

  const auth = useMemo(
    () =>
      ({
        status: 'authenticated',
        session: null,
        profile: FIXTURE_PROFILE,
        signOut: noop,
        refreshProfile: noop,
      }) as unknown as AuthValue,
    [],
  );

  return (
    <AuthContext.Provider value={auth}>
    <CatalogContext.Provider value={catalog}>
      <OrderCtx.Provider value={orderContext}>
        <CartContext.Provider value={cart}>{children}</CartContext.Provider>
      </OrderCtx.Provider>
    </CatalogContext.Provider>
    </AuthContext.Provider>
  );
}
