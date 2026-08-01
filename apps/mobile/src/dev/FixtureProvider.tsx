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
  AddressBookContext,
  AuthContext,
  CartContext,
  CatalogContext,
  OrderCtx,
  type AddressBookValue,
  type AuthValue,
  type CartValue,
  type CatalogValue,
  type OrderContextValue,
} from '../store';
import {
  FIXTURE_ADDRESS,
  FIXTURE_BRAND_SETTINGS,
  FIXTURE_BRANCH,
  FIXTURE_BRANCH_DELIVERY_OFF,
  FIXTURE_CART_BELOW_MIN,
  FIXTURE_CART_COUNT,
  FIXTURE_CART_COUNT_BELOW_MIN,
  FIXTURE_CART_ITEMS,
  FIXTURE_DELIVERY_ZONE,
  FIXTURE_LOYALTY,
  FIXTURE_ORDER_CONTEXT,
  FIXTURE_ORDER_CONTEXT_NO_ADDRESS,
  FIXTURE_ORDER_CONTEXT_PICKUP,
  FIXTURE_PAYMENT,
  FIXTURE_PAYMENT_NONE,
  FIXTURE_PAYMENT_ONLINE_OFF,
  FIXTURE_PRODUCTS,
  FIXTURE_PROFILE,
  FIXTURE_SUBTOTAL,
  FIXTURE_SUBTOTAL_BELOW_MIN,
} from './fixtureData';

const noop = () => {};

/**
 * Every fixture write path. Rejects rather than resolving so a reviewer can
 * never mistake "the fixture swallowed it" for "it saved" — and so the screens'
 * failure states are what the preview actually exercises.
 */
const fixtureWriteBlocked = async (): Promise<never> => {
  throw new Error('Fixture provider is read-only.');
};

export interface FixtureOptions {
  /** Render the catalog in its loading state. */
  loading?: boolean;
  /** Render the catalog error state with this message. */
  error?: string | null;
  /** Empty the cart (for empty-state review). */
  emptyCart?: boolean;
  /** Cart below the branch delivery minimum (below-minimum block). */
  belowMinimum?: boolean;
  /** Make the order context invalid (blocked-checkout review). */
  invalidContext?: boolean;
  /** Pickup instead of delivery: no map, no landmark, no delivery fee. */
  pickup?: boolean;
  /** Delivery chosen but no pin and no landmark yet. */
  missingAddress?: boolean;
  /** Online off / everything off — drives the payment-unavailable states. */
  payment?: 'both' | 'online-off' | 'none';
  /** Branch has delivery temporarily closed. */
  deliveryClosed?: boolean;
  /** Signed in but the profile carries no name — Profile's fallback state. */
  noProfileName?: boolean;
  /** No saved addresses — the address book's empty state. */
  emptyAddresses?: boolean;
  /**
   * Inject NO delivery zones. On the order-type gate this makes
   * `resolveDeliveryBranch` return null for every pin, so `confirmNewAddress`
   * returns at the "delivery unavailable" branch and can never reach
   * `addresses.create`. That is a structural block on the write, not a
   * side effect of the review environment.
   */
  noDeliveryZones?: boolean;
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
  const branch = options.deliveryClosed ? FIXTURE_BRANCH_DELIVERY_OFF : FIXTURE_BRANCH;
  const paymentSettings =
    options.payment === 'none' ? FIXTURE_PAYMENT_NONE
    : options.payment === 'online-off' ? FIXTURE_PAYMENT_ONLINE_OFF
    : FIXTURE_PAYMENT;

  const catalog = useMemo(
    () =>
      ({
        loading: Boolean(options.loading),
        error: options.error ?? null,
        reload: noop,
        categories: [],
        products: FIXTURE_PRODUCTS,
        branches: [branch],
        modifierGroups: [],
        selectedBranch: branch,
        selectedBranchId: branch.id,
        selectBranch: noop,
        isAvailable: () => true,
        branchIsOpen: () => true,
        getProduct: (id: string) => FIXTURE_PRODUCTS.find((p) => p.id === id),
        groupsForProduct: () => [],
        // Settings the checkout screen reads. Fixed values so the money column
        // in a screenshot can be checked by hand.
        brand: FIXTURE_BRAND_SETTINGS,
        loyalty: FIXTURE_LOYALTY,
        payment: paymentSettings,
        // A real polygon covering the fixture pin. With an empty list the
        // serviceability pre-check always failed, so a VALID delivery checkout
        // could never be screenshotted.
        deliveryZones: options.noDeliveryZones ? [] : [FIXTURE_DELIVERY_ZONE],
      }) as unknown as CatalogValue,
    [options.loading, options.error, branch, paymentSettings, options.noDeliveryZones],
  );

  const orderContext = useMemo(() => {
    const context =
      options.pickup ? FIXTURE_ORDER_CONTEXT_PICKUP
      : options.missingAddress ? FIXTURE_ORDER_CONTEXT_NO_ADDRESS
      : FIXTURE_ORDER_CONTEXT;
    return {
      ready: true,
      valid: !options.invalidContext,
      context: options.invalidContext ? null : context,
      setContext: noop,
      clear: noop,
      refresh: noop,
    } as unknown as OrderContextValue;
  }, [options.invalidContext, options.pickup, options.missingAddress]);

  const cart = useMemo(() => {
    const items =
      options.emptyCart ? []
      : options.belowMinimum ? FIXTURE_CART_BELOW_MIN
      : FIXTURE_CART_ITEMS;
    const count =
      options.emptyCart ? 0
      : options.belowMinimum ? FIXTURE_CART_COUNT_BELOW_MIN
      : FIXTURE_CART_COUNT;
    const subtotal =
      options.emptyCart ? 0
      : options.belowMinimum ? FIXTURE_SUBTOTAL_BELOW_MIN
      : FIXTURE_SUBTOTAL;
    return {
      items,
      count,
      subtotal,
      // Fixed key: the real one is a uuid, which would make every screenshot
      // differ. Nothing can submit it — every mutator here is inert.
      idempotencyKey: 'fixture-idempotency-key',
      toOrderItems: () => [],
      addItem: noop,
      removeLine: noop,
      incrementLine: noop,
      decrementLine: noop,
      clear: noop,
      notes: '',
      setNotes: noop,
    } as unknown as CartValue;
  }, [options.emptyCart, options.belowMinimum]);

  const auth = useMemo(
    () =>
      ({
        // 'signed_in' — the real AuthStatus union. This said 'authenticated'
        // before, which is not a value the app ever produces.
        status: 'signed_in',
        userId: FIXTURE_PROFILE.id,
        profile: options.noProfileName
          ? { ...FIXTURE_PROFILE, fullName: '', email: undefined }
          : FIXTURE_PROFILE,
        signOut: noop,
        refreshProfile: noop,
      }) as unknown as AuthValue,
    [options.noProfileName],
  );

  // Saved addresses. Every mutator REJECTS rather than resolving: the fixture
  // must never write, and a silent no-op would let a reviewer believe an address
  // had been saved. `emptyAddresses` drives the empty-state review.
  const addressBook = useMemo(
    () =>
      ({
        addresses: options.emptyAddresses ? [] : [FIXTURE_ADDRESS],
        status: 'ready',
        error: null,
        pending: null,
        reload: noop,
        clearError: noop,
        create: fixtureWriteBlocked,
        update: fixtureWriteBlocked,
        remove: fixtureWriteBlocked,
        setDefault: fixtureWriteBlocked,
      }) as unknown as AddressBookValue,
    [options.emptyAddresses],
  );

  return (
    <AuthContext.Provider value={auth}>
      <AddressBookContext.Provider value={addressBook}>
        <CatalogContext.Provider value={catalog}>
          <OrderCtx.Provider value={orderContext}>
            <CartContext.Provider value={cart}>{children}</CartContext.Provider>
          </OrderCtx.Provider>
        </CatalogContext.Provider>
      </AddressBookContext.Provider>
    </AuthContext.Provider>
  );
}
