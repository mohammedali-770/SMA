/**
 * Screenshot-only stand-in for src/context/AppContext.
 *
 * The console is gated behind a real Supabase session, so it cannot be captured
 * without credentials — and pointing a screenshot harness at Production is not
 * something to do casually. This supplies the same contract from the
 * repository's own bundled demo data instead, so the REAL components render
 * with the REAL stylesheet and only the data is synthetic.
 *
 * Wired in by vite.screenshots.config.ts, which aliases the context module to
 * this file. Nothing here ships: the alias exists only in that config.
 */
import React from 'react';

import {
  INITIAL_ADDRESSES,
  INITIAL_BRAND_SETTINGS,
  INITIAL_BRANCHES,
  INITIAL_CATEGORIES,
  INITIAL_LOYALTY_SETTINGS,
  INITIAL_MODIFIER_GROUPS,
  INITIAL_ORDERS,
  INITIAL_PRODUCTS,
  INITIAL_PROFILES,
} from '../src/data/initialData';
import type { OrderStatus } from '../src/types';

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  received: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

const admin = INITIAL_PROFILES.find((p) => p.role === 'admin') ?? {
  id: 'stub-admin',
  fullName: 'Mohammed Al-Ali',
  phoneNumber: '+966501234567',
  role: 'admin' as const,
  email: 'admin@spicymeal.sa',
  createdAt: '2026-01-01T00:00:00Z',
};

/** Everything the panels read. Callbacks are filled in by the proxy below. */
const data: Record<string, unknown> = {
  authReady: true,
  isAuthenticated: true,
  dataLoading: false,
  dataError: null,
  writeError: null,

  branches: INITIAL_BRANCHES,
  categories: INITIAL_CATEGORIES,
  products: INITIAL_PRODUCTS,
  modifierGroups: INITIAL_MODIFIER_GROUPS,
  orders: INITIAL_ORDERS,
  addresses: INITIAL_ADDRESSES,
  profiles: INITIAL_PROFILES,

  currentUser: admin,
  selectedBranch: INITIAL_BRANCHES[0] ?? null,

  cart: [],
  cartTotal: 0,
  cartCount: 0,

  checkoutType: 'delivery',
  selectedAddressId: '',
  couponCode: '',
  discountAmount: 0,

  mobileLang: 'en',
  adminLang: 'en',

  // Admin dashboard chrome
  newOrderAlert: false,
  soundMuted: false,
  ordersLiveMode: 'realtime',
  ordersLastUpdated: '2026-07-29T21:14:07Z',

  brandSettings: INITIAL_BRAND_SETTINGS,
  loyaltySettings: INITIAL_LOYALTY_SETTINGS,
  banners: [],

  // Collections the panels iterate. These must be declared explicitly: the
  // proxy below answers unknown keys with a function, which is right for a
  // callback and fatal for something the component calls .find/.map on —
  // "deliveryZones.find is not a function" takes the whole React tree down.
  deliveryZones: [],
  integrationSettings: [],
  integrationsLoading: false,
  integrationsError: null,
  paymentSettings: { providerName: 'sandbox', isLiveMode: false, publicKey: '', secretKey: '', isEnabled: false },
  loyaltyMutationsEnabled: true,
};

/**
 * The context exposes ~40 callbacks (setters, CRUD, cart operations). Listing
 * them all would be noise for a screenshot harness, so anything not in `data`
 * resolves to a no-op — returning a resolved promise so `await`ed calls behave.
 */
const value = new Proxy(data, {
  get(target, key: string) {
    if (key in target) return target[key];
    return (..._args: unknown[]) => Promise.resolve({ success: true });
  },
  has: () => true,
});

export const useApp = () => value as never;

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <>{children}</>
);
