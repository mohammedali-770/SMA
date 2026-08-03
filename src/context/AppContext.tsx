/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  Branch, Category, Product, ModifierGroup, Order,
  UserProfile, SavedAddress, CartItem, OrderStatus,
  Modifier, BrandSettings, LoyaltySettings, DeliveryZone,
} from '../types';
import { INITIAL_BRAND_SETTINGS, INITIAL_LOYALTY_SETTINGS } from '../data/initialData';
import { supabase } from '../lib/supabase';
import {
  auth, catalog, orders as ordersApi, addresses as addressesApi, coupons as couponsApi,
  admin as adminApi, profiles as profilesApi, loyalty as loyaltyApi, integrations as integrationsApi,
  DbIntegrationSetting, UpsertIntegrationInput, ORDERS_POLL_LIMIT,
} from '../lib/api';
import {
  mapBranch, mapCategory, mapProduct, mapModifierGroup, mapDeliveryZone, buildAvailabilityMatrix,
  mapProfile, mapAddress, mapOrder, mapBrandSettings, mapLoyaltySettings,
  mapPaymentMethodSettings,
  brandPatchToDb, loyaltyPatchToDb, productToDbInsert, productToDbUpdate,
  categoryToDbInsert, branchPatchToDb,
} from '../lib/mappers';
import {
  PaymentMethod, PaymentMethodSettings, resolveDefaultMethod, availableMethods,
} from '../lib/payment';
import { isBranchDependencyError, branchDeletionBlockedMessage } from '../lib/branchDeletion';

interface AppContextType {
  // Auth / session (Option A: GoTrue = authentication, profiles.role = authorization)
  authReady: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, phone?: string) => Promise<void>;
  signOut: () => Promise<void>;

  // Data load lifecycle
  dataLoading: boolean;
  dataError: string | null;      // fatal INITIAL-load failure (full-screen retry)
  writeError: string | null;     // non-fatal mutation failure (dismissible banner)
  dismissWriteError: () => void;
  reload: () => Promise<void>;

  // DB Tables (mapped to app types)
  branches: Branch[];
  categories: Category[];
  products: Product[];
  modifierGroups: ModifierGroup[];
  orders: Order[];
  addresses: SavedAddress[];
  profiles: UserProfile[];

  // Current session
  currentUser: UserProfile;
  selectedBranch: Branch | null;
  setSelectedBranch: (branch: Branch | null) => void;

  // Cart (client-only ephemeral state)
  cart: CartItem[];
  addToCart: (product: Product, selectedModifiers: { [groupId: string]: Modifier[] }, quantity: number) => void;
  removeFromCart: (cartItemId: string) => void;
  updateCartQuantity: (cartItemId: string, change: number) => void;
  clearCart: () => void;
  cartTotal: number;
  cartCount: number;

  // Mobile Checkout Preferences
  checkoutType: 'delivery' | 'pickup';
  setCheckoutType: (type: 'delivery' | 'pickup') => void;
  selectedAddressId: string;
  setSelectedAddressId: (id: string) => void;
  couponCode: string;
  setCouponCode: (code: string) => void;
  discountAmount: number;
  applyCoupon: (code: string) => Promise<{ valid: boolean; message: string }>;

  // Active Languages
  mobileLang: 'en' | 'ar';
  setMobileLang: (lang: 'en' | 'ar') => void;
  adminLang: 'en' | 'ar';
  setAdminLang: (lang: 'en' | 'ar') => void;

  // DB operations
  addAddress: (address: Omit<SavedAddress, 'id'>) => void;
  deleteAddress: (id: string) => void;
  placeOrder: () => Promise<{ success: boolean; orderId?: string; order?: Order; error?: string }>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;

  // Admin Panel Operations
  addCategory: (nameEn: string, nameAr: string) => void;
  updateCategory: (id: string, nameEn: string, nameAr: string) => void;
  deleteCategory: (id: string) => void;
  addProduct: (product: Omit<Product, 'id'>) => void;
  updateProduct: (product: Product) => void;
  deleteProduct: (id: string) => void;
  toggleProductAvailability: (productId: string, branchId: string) => void;
  isProductAvailableInBranch: (productId: string, branchId: string) => boolean;
  updateBranchSettings: (id: string, updates: Partial<Branch>) => void;
  deleteBranch: (id: string) => Promise<void>;
  bulkUploadMenu: (categories: Category[], products: Product[]) => Promise<{ success: boolean; count: number }>;

  // Delivery zones (per-branch coverage polygons). Reads are public (active
  // zones); writes are admin-only via the server RPCs.
  deliveryZones: DeliveryZone[];
  saveBranchDeliveryZone: (branchId: string, geojson: unknown, name?: string | null) => Promise<void>;
  clearBranchDeliveryZone: (branchId: string) => Promise<void>;

  // Audio indicator for realtime
  playNotificationSound: () => void;
  newOrderAlert: boolean;
  setNewOrderAlert: (alert: boolean) => void;
  soundMuted: boolean;
  setSoundMuted: (muted: boolean) => void;

  // Brand + loyalty settings (from the app_settings singleton)
  brandSettings: BrandSettings;
  updateBrandSettings: (settings: Partial<BrandSettings>) => void;
  loyaltySettings: LoyaltySettings;
  updateLoyaltySettings: (settings: Partial<LoyaltySettings>) => void;

  // Payment-method availability (admin-configured; server-authoritative in place_order).
  // The customer picks from what's enabled; the client can never enable a method
  // or mark an order paid — these are read-only mirrors for the UI.
  paymentSettings: PaymentMethodSettings;
  updatePaymentSettings: (settings: {
    onlineEnabled: boolean; cashEnabled: boolean;
    defaultMethod: PaymentMethod | null; outageMode: boolean;
  }) => Promise<void>;
  selectedPaymentMethod: PaymentMethod | null;
  setSelectedPaymentMethod: (method: PaymentMethod | null) => void;

  // Admin live orders (realtime with polling fallback)
  ordersLiveMode: 'realtime' | 'polling' | 'off';
  ordersLastUpdated: number | null;

  // Secure integration settings (admin-only; secrets never returned to client)
  integrationSettings: DbIntegrationSetting[];
  integrationsLoading: boolean;
  integrationsError: string | null;
  loadIntegrations: () => Promise<void>;
  saveIntegration: (input: UpsertIntegrationInput) => Promise<DbIntegrationSetting>;

  // Customer Loyalty. Earning + checkout redemption + admin adjustment are
  // server-authoritative (place_order / adjust_loyalty_points). The store-credit
  // wallet has no backend, so its conversions stay disabled.
  loyaltyMutationsEnabled: boolean;
  walletCreditEnabled: boolean;
  loyaltyPointsRedeemed: number;
  setLoyaltyPointsRedeemed: (points: number) => void;
  loyaltyDiscountAmount: number;
  updateCustomerPoints: (userId: string, points: number) => void;
}

/**
 * Exported ONLY so the design system can read the active language DEFENSIVELY
 * (see design-system/ui/useDsLang.ts). `useApp` throws without a provider,
 * which is correct for app code but wrong for a primitive that must also render
 * in a unit test or a storybook. Application code uses `useApp`.
 */
export const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * Allowed forward-only order-status transitions. A status can advance to any of
 * the listed targets (or be cancelled), but cannot jump backwards or skip the
 * flow (e.g. delivered -> received, or cancelled -> delivered).
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  received: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/** Whether an order may move from `from` to `to` (a no-op stay is always allowed). */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || (ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false);
}

/** A neutral placeholder used before a profile has loaded / while signed out. */
const GUEST_USER: UserProfile = {
  id: '', fullName: '', phoneNumber: '', role: 'customer', email: undefined,
  createdAt: '', loyaltyPoints: 0,
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // ---- Auth / session ------------------------------------------------------
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile>(GUEST_USER);
  // Mirror of currentUser for the stable ([]-dep) order fetchers below: they pick
  // the customer table read or the staff RPC by LIVE role without being recreated
  // on every profile change. Staff order reads go through the SECURITY DEFINER
  // admin RPCs (staff hold no direct privilege on public.orders); a customer
  // reads the column-scoped table. See supabase migration 20260724200000.
  const currentUserRef = useRef<UserProfile>(GUEST_USER);
  currentUserRef.current = currentUser;
  const loadedUserRef = useRef<string | null>(null);
  // Stable per-checkout key so a retried submit can't create a duplicate order.
  // Reset whenever the cart materially changes or an order succeeds.
  const idempotencyKeyRef = useRef<string | null>(null);

  // ---- Data load lifecycle -------------------------------------------------
  const [dataLoading, setDataLoading] = useState(false);
  // dataError is reserved for a FATAL initial-load failure (the whole dashboard
  // is replaced with a retry card). A failed *write* (settings/order/loyalty/…)
  // must never do that — it surfaces via writeError as a dismissible banner so
  // the admin keeps their place and unsaved edits.
  const [dataError, setDataError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const dismissWriteError = useCallback(() => setWriteError(null), []);

  // ---- Debounced settings persistence (declared early so signOut can flush it) --
  // Brand + loyalty edits update local state INSTANTLY (inputs stay responsive,
  // brand colours re-theme live), but the DB write is DEBOUNCED + coalesced so
  // typing fires one request when editing settles — not one per keystroke.
  // Accumulated column patches merge (latest wins) and flush together.
  const SETTINGS_FLUSH_MS = 600;
  const settingsPatchRef = useRef<Record<string, unknown>>({});
  const settingsFlushT = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Awaitable: signOut (and unmount) await this so a queued edit is persisted
  // before the session ends — after sign-out the write would run as a guest and
  // RLS would reject it, silently losing the edit.
  const flushSettings = useCallback(async () => {
    if (settingsFlushT.current) { clearTimeout(settingsFlushT.current); settingsFlushT.current = null; }
    const patch = settingsPatchRef.current;
    settingsPatchRef.current = {};
    if (Object.keys(patch).length === 0) return;
    try { await adminApi.updateSettings(patch); }
    catch (e) { setWriteError(e instanceof Error ? e.message : String(e)); }
  }, []);

  // ---- Database-backed state (mapped app types) ----------------------------
  const [branches, setBranches] = useState<Branch[]>([]);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [availabilityMatrix, setAvailabilityMatrix] =
    useState<{ [key: string]: { [branchId: string]: boolean } }>({});

  // Settings sourced from the app_settings singleton (brand colours + VAT + loyalty).
  const [brandSettings, setBrandSettings] = useState<BrandSettings>(INITIAL_BRAND_SETTINGS);
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings>(INITIAL_LOYALTY_SETTINGS);

  // Admin-configured payment availability. Safe fallback matches the DB defaults
  // (cash ON, online OFF) so a customer is never blocked before settings load.
  const [paymentSettings, setPaymentSettings] = useState<PaymentMethodSettings>({
    onlineEnabled: false, cashEnabled: true, defaultMethod: 'cash', outageMode: false,
  });
  // The customer's chosen method for the current checkout. Null until resolved
  // from availability; a disabled method can never be submitted (server re-checks).
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | null>(null);

  // Secure integration settings (payment / SMS / push / Lazywait). Loaded for
  // admins via an RPC that returns only non-secret fields + a has_secret flag;
  // secrets live server-side and never reach the browser.
  const [integrationSettings, setIntegrationSettings] = useState<DbIntegrationSetting[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [integrationsError, setIntegrationsError] = useState<string | null>(null);

  // Admin live-orders indicator (see the realtime/polling effect below).
  const [ordersLiveMode, setOrdersLiveMode] = useState<'realtime' | 'polling' | 'off'>('off');
  const [ordersLastUpdated, setOrdersLastUpdated] = useState<number | null>(null);

  // ---- Client-only UI/session state ----------------------------------------
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutType, setCheckoutType] = useState<'delivery' | 'pickup'>('delivery');
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [couponCode, setCouponCode] = useState<string>('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [mobileLang, setMobileLang] = useState<'en' | 'ar'>('en');
  const [adminLang, setAdminLang] = useState<'en' | 'ar'>('en');
  const [newOrderAlert, setNewOrderAlert] = useState<boolean>(false);
  const [soundMuted, setSoundMuted] = useState<boolean>(false);

  // Loyalty earning + checkout redemption are handled server-side by
  // place_order, and admin point adjustments by adjust_loyalty_points — so
  // point mutations are enabled. The store-credit wallet + voucher claims have
  // no backend table, so those specific conversions stay disabled.
  const loyaltyMutationsEnabled = true;
  const walletCreditEnabled = false;
  const [loyaltyPointsRedeemed, setLoyaltyPointsRedeemedState] = useState<number>(0);
  const setLoyaltyPointsRedeemed = (points: number) => {
    setLoyaltyPointsRedeemedState(Math.max(0, points));
  };
  const loyaltyDiscountAmount = Number((loyaltyPointsRedeemed * (loyaltySettings?.discountPerPoint || 0.1)).toFixed(2));

  const cartTotal = cart.reduce((acc, item) => acc + (item.totalPrice * item.quantity), 0);
  const cartCount = cart.reduce((acc, item) => acc + item.quantity, 0);

  // ---- Data loading --------------------------------------------------------
  /**
   * Full orders load (UNBOUNDED) — used after placing / advancing an order and on
   * the initial load. The reports read the whole in-memory `orders` list, so this
   * must fetch every order, not a capped window.
   */
  const refreshOrders = useCallback(async () => {
    const rows = currentUserRef.current.role === 'customer'
      ? await ordersApi.listWithItems()
      : await ordersApi.adminListWithItems();
    setOrders(rows.map(mapOrder));
    setOrdersLastUpdated(Date.now());
  }, []);

  /**
   * Live-poll refresh — fetches only the most-recent window (bounded, so the
   * frequent poll payload can't grow with the whole table) and MERGES it into the
   * existing list by id. Merging (not replacing) preserves the full history the
   * reports need while still surfacing new/updated recent orders.
   */
  const pollRecentOrders = useCallback(async () => {
    const rows = currentUserRef.current.role === 'customer'
      ? await ordersApi.listWithItems(ORDERS_POLL_LIMIT)
      : await ordersApi.adminListWithItems(ORDERS_POLL_LIMIT);
    const fresh = rows.map(mapOrder);
    setOrders(prev => {
      const byId = new Map<string, Order>(prev.map(o => [o.id, o] as [string, Order]));
      for (const o of fresh) byId.set(o.id, o);
      // Keep newest-first (createdAt is an ISO string, so lexical compare works).
      return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    });
    setOrdersLastUpdated(Date.now());
  }, []);

  /** Admin-only: load integration settings (non-secret projection). */
  const loadIntegrations = useCallback(async () => {
    setIntegrationsLoading(true);
    setIntegrationsError(null);
    try {
      setIntegrationSettings(await integrationsApi.list());
    } catch (e) {
      setIntegrationsError(e instanceof Error ? e.message : String(e));
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  const saveIntegration = useCallback(async (input: UpsertIntegrationInput): Promise<DbIntegrationSetting> => {
    const row = await integrationsApi.upsert(input);
    setIntegrationSettings(prev => {
      const exists = prev.some(r => r.provider_type === row.provider_type);
      return exists ? prev.map(r => (r.provider_type === row.provider_type ? row : r)) : [...prev, row];
    });
    return row;
  }, []);

  /** Reload the whole catalog + availability + settings (used after admin writes). */
  const refreshCatalog = useCallback(async () => {
    const c = await catalog.all();
    setBranches(c.branches.map(mapBranch));
    setCategories(c.categories.map(mapCategory));
    setProducts(c.products.map(p => mapProduct(p, c.links)));
    setModifierGroups(c.modifierGroups.map(g => mapModifierGroup(g, c.modifiers)));
    setAvailabilityMatrix(buildAvailabilityMatrix(c.products, c.branches, c.availability));
    setBrandSettings(mapBrandSettings(c.settings));
    setLoyaltySettings(mapLoyaltySettings(c.settings));
    setPaymentSettings(mapPaymentMethodSettings(c.settings));
    setDeliveryZones((c.deliveryZones ?? []).map(mapDeliveryZone));
    return c;
  }, []);

  /** Full load after authentication: profile → role → catalog + orders + profiles + addresses. */
  const loadEverything = useCallback(async (user: UserProfile) => {
    setDataLoading(true);
    setDataError(null);
    try {
      const c = await refreshCatalog();

      // Default the branch selection to the first open branch right away (don't
      // make the storefront wait on orders/profiles to finish loading).
      const mappedBranches = c.branches.map(mapBranch);
      const firstActive = mappedBranches.find(b => b.isActive) ?? mappedBranches[0] ?? null;
      setSelectedBranch(prev => prev ?? firstActive);

      await refreshOrders();

      if (user.role === 'customer') {
        setAddresses((await addressesApi.listMine()).map(mapAddress));
        setProfiles([user]);
      } else {
        // Staff read all profiles (loyalty stats / DB console). Addresses are
        // read via each order's snapshot, so no separate list is needed.
        setAddresses([]);
        setProfiles((await profilesApi.list()).map(mapProfile));
        // Integration settings are admin-only (the RPC rejects accountants).
        if (user.role === 'admin') void loadIntegrations();
      }
    } catch (e) {
      setDataError(e instanceof Error ? e.message : String(e));
    } finally {
      setDataLoading(false);
    }
  }, [refreshCatalog, refreshOrders, loadIntegrations]);

  const resetToGuest = useCallback(() => {
    loadedUserRef.current = null;
    setIsAuthenticated(false);
    setCurrentUser(GUEST_USER);
    setBranches([]); setCategories([]); setProducts([]); setModifierGroups([]);
    setDeliveryZones([]);
    setOrders([]); setAddresses([]); setProfiles([]); setAvailabilityMatrix({});
    setSelectedBranch(null); setCart([]); setCouponCode(''); setDiscountAmount(0);
    setIntegrationSettings([]); setIntegrationsError(null);
    setOrdersLiveMode('off'); setOrdersLastUpdated(null);
    setDataError(null); setDataLoading(false);
  }, []);

  /** Load the signed-in user's profile then all their data. */
  const bootstrap = useCallback(async (userId: string) => {
    if (loadedUserRef.current === userId) return;
    loadedUserRef.current = userId;
    setIsAuthenticated(true);
    setDataLoading(true);
    setDataError(null);
    try {
      const dbProfile = await auth.myProfile();
      const user = dbProfile ? mapProfile(dbProfile) : { ...GUEST_USER, id: userId };
      setCurrentUser(user);
      await loadEverything(user);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : String(e));
      setDataLoading(false);
    }
  }, [loadEverything]);

  // Wire the Supabase auth listener once. INITIAL_SESSION fires on mount with
  // any persisted session, and SIGNED_IN / SIGNED_OUT drive subsequent changes.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthReady(true);
      if (session?.user) {
        void bootstrap(session.user.id);
      } else {
        resetToGuest();
      }
    });
    // Fallback in case no INITIAL_SESSION event arrives promptly.
    supabase.auth.getSession().then(({ data }) => {
      setAuthReady(true);
      if (data.session?.user) void bootstrap(data.session.user.id);
    }).catch(() => setAuthReady(true));
    return () => sub.subscription.unsubscribe();
  }, [bootstrap, resetToGuest]);

  const reload = useCallback(async () => {
    if (currentUser.id) await loadEverything(currentUser);
  }, [currentUser, loadEverything]);

  // ---- Admin live orders: Supabase Realtime with a polling fallback --------
  // Staff only. Realtime pushes order INSERT/UPDATE events; if the channel never
  // connects (or drops), we fall back to a 12s poll. A slow 60s backstop poll
  // also runs even in realtime mode, so a silently-stalled subscription still
  // catches up. All timers/channels are torn down on sign-out / unmount.
  useEffect(() => {
    if (!isAuthenticated || currentUser.role === 'customer') {
      setOrdersLiveMode('off');
      return;
    }
    let disposed = false;
    let refreshing = false;
    let pending = false;                    // an event arrived while a refresh was in-flight
    let debounceT: ReturnType<typeof setTimeout> | null = null;
    let connectT: ReturnType<typeof setTimeout> | null = null;
    let fastPoll: ReturnType<typeof setInterval> | null = null;
    let slowPoll: ReturnType<typeof setInterval> | null = null;
    const modeRef = { current: 'off' as 'realtime' | 'polling' | 'off' };
    const setMode = (m: 'realtime' | 'polling' | 'off') => {
      if (disposed) return;
      modeRef.current = m;
      setOrdersLiveMode(m);
    };
    const doRefresh = async () => {
      if (disposed) return;
      if (refreshing) { pending = true; return; }  // coalesce, but never drop the last event
      refreshing = true;
      // Poll path uses the bounded + merged refresh so the frequent refetch stays
      // small without truncating the full history the reports read.
      try { await pollRecentOrders(); } catch { /* transient; keep the loop alive */ }
      finally {
        refreshing = false;
        if (pending && !disposed) { pending = false; void doRefresh(); }  // trailing run
      }
    };
    const bump = () => {                     // coalesce event bursts into one refetch
      if (debounceT) return;
      debounceT = setTimeout(() => { debounceT = null; void doRefresh(); }, 500);
    };
    const startFastPoll = () => {
      if (fastPoll) return;
      fastPoll = setInterval(() => { if (!document.hidden) void doRefresh(); }, 12000);
    };
    const stopFastPoll = () => { if (fastPoll) { clearInterval(fastPoll); fastPoll = null; } };

    // Always-on slow backstop covers a realtime channel that connects but never
    // delivers (e.g. table not in the realtime publication).
    slowPoll = setInterval(() => { if (!document.hidden) void doRefresh(); }, 60000);

    // Subscribe to the staff-only signal table, NOT public.orders. orders left
    // the realtime publication (migration 20260724200000) so a customer
    // subscriber can no longer receive full order rows; order_change_events
    // carries only an order id + event kind, and its RLS is staff-only. The
    // handler ignores the payload and just refetches, so the change is one line.
    const channel = supabase
      .channel(`admin-orders-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_change_events' }, () => bump())
      .subscribe((status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          if (connectT) { clearTimeout(connectT); connectT = null; }
          setMode('realtime');
          stopFastPoll();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setMode('polling');
          startFastPoll();
        }
      });

    // If realtime hasn't connected within 6s, start polling.
    connectT = setTimeout(() => {
      if (!disposed && modeRef.current !== 'realtime') { setMode('polling'); startFastPoll(); }
    }, 6000);

    // Catch up immediately when the tab becomes visible again.
    const onVis = () => { if (!document.hidden && !disposed) void doRefresh(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      disposed = true;
      if (debounceT) clearTimeout(debounceT);
      if (connectT) clearTimeout(connectT);
      stopFastPoll();
      if (slowPoll) clearInterval(slowPoll);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, currentUser.role, currentUser.id, pollRecentOrders]);

  // ---- Auth actions --------------------------------------------------------
  const signIn = useCallback(async (email: string, password: string) => {
    await auth.signIn(email, password);
  }, []);
  const signUp = useCallback(async (email: string, password: string, fullName: string, phone?: string) => {
    await auth.signUp(email, password, fullName, phone);
  }, []);
  const signOut = useCallback(async () => {
    // Persist any debounced settings edit BEFORE the session ends — after sign-out
    // the queued write would run as a guest and RLS would reject it (losing the edit).
    await flushSettings();
    await auth.signOut();
    resetToGuest();
  }, [resetToGuest, flushSettings]);

  // ---- Brand theming: drive Tailwind tokens from the settings colours -------
  useEffect(() => {
    const root = document.documentElement;
    const apply = (token: string, value: string) => {
      if (typeof CSS !== 'undefined' && CSS.supports('color', value)) {
        root.style.setProperty(token, value);
      } else {
        root.style.removeProperty(token);
      }
    };
    apply('--color-primary', brandSettings.primaryColor);
    apply('--color-secondary', brandSettings.secondaryColor);
  }, [brandSettings.primaryColor, brandSettings.secondaryColor]);

  // ---- Coupon preview: server-validated (no client-side hardcoded codes) ----
  useEffect(() => {
    if (!couponCode || !isAuthenticated) { setDiscountAmount(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await couponsApi.validate(couponCode, cartTotal);
        if (!cancelled) setDiscountAmount(r.valid ? Number(r.discount_amount) : 0);
      } catch {
        if (!cancelled) setDiscountAmount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [couponCode, cartTotal, isAuthenticated]);

  // ---- Keep the chosen payment method valid as availability changes ---------
  // If the customer hasn't picked (null) or their pick is no longer offered
  // (e.g. admin just turned online off mid-session), fall back to the resolved
  // default. When nothing is enabled, leave it null so checkout stays blocked.
  useEffect(() => {
    const allowed = availableMethods(paymentSettings);
    setSelectedPaymentMethod(prev =>
      prev && allowed.includes(prev) ? prev : resolveDefaultMethod(paymentSettings),
    );
  }, [paymentSettings]);

  const applyCoupon = useCallback(async (code: string): Promise<{ valid: boolean; message: string }> => {
    const trimmed = code.trim();
    if (!trimmed) { setCouponCode(''); setDiscountAmount(0); return { valid: false, message: 'No code supplied' }; }
    try {
      const r = await couponsApi.validate(trimmed, cartTotal);
      setCouponCode(trimmed);
      setDiscountAmount(r.valid ? Number(r.discount_amount) : 0);
      return { valid: r.valid, message: r.message };
    } catch (e) {
      setDiscountAmount(0);
      return { valid: false, message: e instanceof Error ? e.message : 'Coupon check failed' };
    }
  }, [cartTotal]);

  // ---- Audio ping (unchanged) ----------------------------------------------
  const playNotificationSound = () => {
    if (soundMuted) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.1);
      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
      osc.onended = () => { audioCtx.close().catch(() => {}); };
    } catch (e) {
      console.warn('Audio play block or unsupported:', e);
    }
  };

  // ---- Cart (client-only) --------------------------------------------------
  const addToCart = (product: Product, selectedModifiers: { [groupId: string]: Modifier[] }, quantity: number) => {
    idempotencyKeyRef.current = null; // cart changed → next checkout is a new order
    const modifierIds: string[] = [];
    Object.values(selectedModifiers).forEach(list => list.forEach(m => modifierIds.push(m.id)));
    modifierIds.sort();
    const cartItemId = `${product.id}-${modifierIds.join('_')}`;

    let itemPrice = product.price;
    Object.values(selectedModifiers).forEach(list => list.forEach(m => { itemPrice += m.price; }));

    setCart(prev => {
      const existing = prev.find(item => item.cartItemId === cartItemId);
      if (existing) {
        return prev.map(item =>
          item.cartItemId === cartItemId ? { ...item, quantity: item.quantity + quantity } : item);
      }
      return [...prev, { cartItemId, product, selectedModifiers, quantity, totalPrice: itemPrice }];
    });
  };

  const removeFromCart = (cartItemId: string) => {
    idempotencyKeyRef.current = null;
    setCart(prev => prev.filter(item => item.cartItemId !== cartItemId));
  };

  const updateCartQuantity = (cartItemId: string, change: number) => {
    idempotencyKeyRef.current = null;
    setCart(prev => prev.map(item => {
      if (item.cartItemId === cartItemId) {
        const newQty = item.quantity + change;
        return newQty > 0 ? { ...item, quantity: newQty } : item;
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const clearCart = () => {
    idempotencyKeyRef.current = null;
    setCart([]);
    setCouponCode('');
    setDiscountAmount(0);
    setLoyaltyPointsRedeemedState(0);
  };

  // ---- Addresses (Supabase, customer-owned) --------------------------------
  const addAddress = (address: Omit<SavedAddress, 'id'>) => {
    if (!currentUser.id) return;
    void (async () => {
      try {
        const created = await addressesApi.add({
          customer_id: currentUser.id,
          label: address.label,
          description: address.description,
          national_short_address: address.nationalShortAddress || null,
          latitude: address.lat,
          longitude: address.lng,
          is_default: address.isDefault || addresses.length === 0,
        });
        setAddresses((await addressesApi.listMine()).map(mapAddress));
        setSelectedAddressId(created.id);
      } catch (e) {
        setWriteError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const deleteAddress = (id: string) => {
    void (async () => {
      try {
        await addressesApi.remove(id);
        setAddresses((await addressesApi.listMine()).map(mapAddress));
        if (selectedAddressId === id) setSelectedAddressId('');
      } catch (e) {
        setWriteError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  // ---- Place order: server-authoritative via the place_order RPC -----------
  const placeOrder = async (): Promise<{ success: boolean; orderId?: string; order?: Order; error?: string }> => {
    if (cart.length === 0) return { success: false, error: 'Cart is empty' };
    if (!selectedBranch) return { success: false, error: 'No branch selected' };
    if (checkoutType === 'delivery' && !selectedAddressId) {
      return { success: false, error: 'Please select or add a delivery address' };
    }

    // Resolve the payment method against current availability. The client picks
    // from enabled methods only; place_order re-validates server-side, so this is
    // just an early, friendly guard (never the security boundary).
    const allowed = availableMethods(paymentSettings);
    if (allowed.length === 0) {
      return { success: false, error: 'No payment method is currently available.' };
    }
    const chosen =
      selectedPaymentMethod && allowed.includes(selectedPaymentMethod)
        ? selectedPaymentMethod
        : resolveDefaultMethod(paymentSettings);
    if (!chosen) {
      return { success: false, error: 'No payment method is currently available.' };
    }

    const items = cart.map(ci => ({
      product_id: ci.product.id,
      quantity: ci.quantity,
      modifier_ids: (Object.values(ci.selectedModifiers) as Modifier[][]).flat().map(m => m.id),
    }));

    // One key per checkout attempt; kept across a retry so a lost-response retry
    // returns the same order instead of creating a duplicate.
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    try {
      const created = await ordersApi.place({
        branchId: selectedBranch.id,
        orderType: checkoutType,
        items,
        addressId: checkoutType === 'delivery' ? selectedAddressId : null,
        couponCode: couponCode || null,
        notes: null,
        loyaltyPoints: currentUser.role === 'customer' ? loyaltyPointsRedeemed : 0,
        idempotencyKey: idempotencyKeyRef.current,
        paymentMethod: chosen,
      });
      idempotencyKeyRef.current = null; // success → the next checkout gets a fresh key
      // The RPC returns the order row without its items; refetch (with items) so
      // the receipt renders the full breakdown recomputed by the server.
      const rows = currentUser.role === 'customer'
        ? await ordersApi.listWithItems()
        : await ordersApi.adminListWithItems();
      const mapped = rows.map(mapOrder);
      setOrders(mapped);
      const full = mapped.find(o => o.id === created.id);

      // The order changed the loyalty balance (redeemed + earned); refetch the
      // profile so the wallet/checkout reflect the new balance.
      const dbProfile = await auth.myProfile();
      if (dbProfile) {
        const u = mapProfile(dbProfile);
        setCurrentUser(u);
        setProfiles(prev => (prev.some(p => p.id === u.id) ? prev.map(p => (p.id === u.id ? u : p)) : [u]));
      }

      clearCart();
      setNewOrderAlert(true);
      playNotificationSound();
      return { success: true, orderId: created.id, order: full };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Could not place the order' };
    }
  };

  // ---- Order status (admin only; RLS enforces) -----------------------------
  /**
   * Advance one order's status.
   *
   * This used to await an UNBOUNDED `refreshOrders()` afterwards — re-downloading
   * every order ever placed, with its items and modifiers, on every single status
   * click. During a lunch rush that is the same full-table read repeated once per
   * ticket per staff member, and it is the first thing in the console that breaks
   * as order volume grows. It also meant the status pill did not move until that
   * whole round-trip finished, which reads as an unresponsive button and invites
   * a second click.
   *
   * Now: update the row locally first so the UI responds immediately, then
   * reconcile with the BOUNDED recent-orders poll, which merges the authoritative
   * server row by id. If the order is older than that window, the optimistic
   * value stands — the server already accepted the change, and
   * `admin_set_order_status` stores exactly the status it was given.
   *
   * On failure the optimistic change is rolled back to the status the row
   * actually had, so a rejected transition cannot leave the console displaying a
   * state the database never reached.
   */
  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    const target = orders.find(o => o.id === orderId);
    if (!target || !canTransitionOrder(target.status, status)) return;
    const previousStatus = target.status;

    setOrders(prev => prev.map(o => (o.id === orderId ? { ...o, status } : o)));

    void (async () => {
      try {
        await ordersApi.setStatus(orderId, status);
        await pollRecentOrders();
      } catch (e) {
        setOrders(prev => prev.map(o => (o.id === orderId ? { ...o, status: previousStatus } : o)));
        setWriteError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  // ---- Admin: category CRUD ------------------------------------------------
  const addCategory = (nameEn: string, nameAr: string) => {
    void (async () => {
      try {
        await adminApi.createCategory(categoryToDbInsert(nameEn, nameAr, categories.length + 1));
        await refreshCatalog();
      } catch (e) { setWriteError(e instanceof Error ? e.message : String(e)); }
    })();
  };
  const updateCategory = (id: string, nameEn: string, nameAr: string) => {
    void (async () => {
      try {
        await adminApi.updateCategory(id, { name_en: nameEn, name_ar: nameAr });
        await refreshCatalog();
      } catch (e) { setWriteError(e instanceof Error ? e.message : String(e)); }
    })();
  };
  const deleteCategory = (id: string) => {
    void (async () => {
      try {
        await adminApi.deleteCategory(id);
        await refreshCatalog();
      } catch (e) { setWriteError(e instanceof Error ? e.message : String(e)); }
    })();
  };

  // ---- Admin: product CRUD -------------------------------------------------
  const addProduct = (pData: Omit<Product, 'id'>) => {
    void (async () => {
      try {
        await adminApi.createProduct(productToDbInsert(pData, products.length + 1));
        await refreshCatalog();
      } catch (e) { setWriteError(e instanceof Error ? e.message : String(e)); }
    })();
  };
  const updateProduct = (p: Product) => {
    void (async () => {
      try {
        await adminApi.updateProduct(p.id, productToDbUpdate(p));
        await refreshCatalog();
      } catch (e) { setWriteError(e instanceof Error ? e.message : String(e)); }
    })();
  };
  const deleteProduct = (id: string) => {
    void (async () => {
      try {
        await adminApi.deleteProduct(id);
        await refreshCatalog();
      } catch (e) { setWriteError(e instanceof Error ? e.message : String(e)); }
    })();
  };

  // ---- Admin: branch availability matrix -----------------------------------
  const toggleProductAvailability = (productId: string, branchId: string) => {
    const current = availabilityMatrix[productId]?.[branchId];
    const nextVal = current === undefined ? false : !current;
    // Optimistic local update so the toggle feels instant; then persist.
    setAvailabilityMatrix(prev => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), [branchId]: nextVal },
    }));
    void (async () => {
      try {
        await adminApi.setAvailability(branchId, productId, nextVal);
      } catch (e) {
        setWriteError(e instanceof Error ? e.message : String(e));
        await refreshCatalog(); // revert to server truth on failure
      }
    })();
  };

  const isProductAvailableInBranch = (productId: string, branchId: string): boolean => {
    if (!availabilityMatrix[productId]) return true;
    const branchVal = availabilityMatrix[productId][branchId];
    return branchVal === undefined ? true : branchVal;
  };

  const updateBranchSettings = (id: string, updates: Partial<Branch>) => {
    // Optimistic local update, then persist the mapped columns.
    setBranches(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
    void (async () => {
      try {
        await adminApi.updateBranch(id, branchPatchToDb(updates));
        await refreshCatalog();
      } catch (e) {
        setWriteError(e instanceof Error ? e.message : String(e));
        await refreshCatalog();
      }
    })();
  };

  const deleteBranch = async (id: string): Promise<void> => {
    try {
      await adminApi.deleteBranch(id);
      setSelectedBranch(prev => {
        if (prev?.id !== id) return prev;
        return branches.find(b => b.id !== id && b.isActive)
          ?? branches.find(b => b.id !== id)
          ?? null;
      });
      await refreshCatalog();
    } catch (e) {
      // A branch that still owns orders / checkout sessions is FK-blocked. Show
      // the friendly, localized "deactivate instead" guidance instead of the raw
      // Postgres constraint string; the branch is left in place (never removed
      // locally on this path). All other errors surface their message as-is.
      const message = isBranchDependencyError(e)
        ? branchDeletionBlockedMessage(adminLang === 'ar')
        : (e instanceof Error ? e.message : String(e));
      setWriteError(message);
      throw e;
    }
  };

  // ---- Admin: delivery-zone save / clear (server RPCs re-check is_admin()) ---
  const saveBranchDeliveryZone = useCallback(async (branchId: string, geojson: unknown, name?: string | null): Promise<void> => {
    await adminApi.setBranchDeliveryZone({ branchId, geojson, name: name ?? null });
    const zones = await catalog.deliveryZones();
    setDeliveryZones(zones.map(mapDeliveryZone));
  }, []);

  const clearBranchDeliveryZone = useCallback(async (branchId: string): Promise<void> => {
    await adminApi.clearBranchDeliveryZone(branchId);
    const zones = await catalog.deliveryZones();
    setDeliveryZones(zones.map(mapDeliveryZone));
  }, []);

  // ---- Admin: bulk CSV upload ----------------------------------------------
  const bulkUploadMenu = async (newCats: Category[], newProds: Product[]): Promise<{ success: boolean; count: number }> => {
    try {
      // Insert categories not already present (match by English name), then map
      // the parsed products' category ids to the real inserted category ids.
      const existingByName = new Map(categories.map(c => [c.nameEn.toLowerCase(), c]));
      const toInsert = newCats.filter(c => !existingByName.has(c.nameEn.toLowerCase()));
      for (const c of toInsert) {
        await adminApi.createCategory(categoryToDbInsert(c.nameEn, c.nameAr, c.sortOrder));
      }
      const refreshed = await refreshCatalog();
      const dbByName = new Map<string, string>(
        refreshed.categories.map(c => [c.name_en.toLowerCase(), c.id] as [string, string]),
      );

      const parsedCatById = new Map(newCats.map(c => [c.id, c] as [string, Category]));
      let count = 0;
      for (const p of newProds) {
        const parsedCat = parsedCatById.get(p.categoryId);
        const realCatId = parsedCat ? dbByName.get(parsedCat.nameEn.toLowerCase()) : dbByName.get('');
        if (!realCatId) continue;
        await adminApi.createProduct(productToDbInsert({ ...p, categoryId: realCatId }, count + 1));
        count++;
      }
      await refreshCatalog();
      return { success: true, count };
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : String(e));
      return { success: false, count: 0 };
    }
  };

  // ---- Settings ------------------------------------------------------------
  // The debounced flush machinery (settingsPatchRef / flushSettings) is declared
  // near the top so signOut can await it. Here we only queue patches and flush on
  // unmount so a quick navigate-away can't drop the last edit.
  const queueSettingsPatch = useCallback((dbPatch: Record<string, unknown>) => {
    if (Object.keys(dbPatch).length === 0) return;
    settingsPatchRef.current = { ...settingsPatchRef.current, ...dbPatch };
    if (settingsFlushT.current) clearTimeout(settingsFlushT.current);
    settingsFlushT.current = setTimeout(flushSettings, SETTINGS_FLUSH_MS);
  }, [flushSettings]);

  // Force any pending settings write on unmount so a quick navigate-away can't
  // drop the last edit.
  useEffect(() => () => { void flushSettings(); }, [flushSettings]);

  const updateBrandSettings = (updates: Partial<BrandSettings>) => {
    setBrandSettings(prev => ({ ...prev, ...updates })); // colours re-theme instantly
    queueSettingsPatch(brandPatchToDb(updates));
  };

  const updateLoyaltySettings = (updates: Partial<LoyaltySettings>) => {
    setLoyaltySettings(prev => ({ ...prev, ...updates }));
    queueSettingsPatch(loyaltyPatchToDb(updates));
  };

  // Admin-only: persist payment-method availability via the SECURITY DEFINER
  // set_payment_settings RPC (server enforces admin + stamps updated_by/at).
  // We re-read the settings afterwards so the value reflects exactly what the
  // server stored (e.g. a default that got coerced when its method was disabled).
  const updatePaymentSettings = useCallback(async (settings: {
    onlineEnabled: boolean; cashEnabled: boolean;
    defaultMethod: PaymentMethod | null; outageMode: boolean;
  }): Promise<void> => {
    await adminApi.setPaymentSettings({
      onlineEnabled: settings.onlineEnabled,
      cashEnabled: settings.cashEnabled,
      defaultMethod: settings.defaultMethod,
      outageMode: settings.outageMode,
    });
    const c = await catalog.all();
    setPaymentSettings(mapPaymentMethodSettings(c.settings));
  }, []);

  // Admin loyalty point adjustment. Callers pass the desired absolute balance
  // (e.g. currentPoints + 50); we derive the delta and apply it through the
  // admin-only adjust_loyalty_points RPC, then refresh the affected profile.
  const updateCustomerPoints = (userId: string, points: number) => {
    const current = profiles.find(p => p.id === userId)?.loyaltyPoints ?? 0;
    const delta = Math.round(points - current);
    if (delta === 0) return;
    void (async () => {
      try {
        const updated = mapProfile(await loyaltyApi.adjustPoints(userId, delta));
        setProfiles(prev => prev.map(p => (p.id === userId ? updated : p)));
        setCurrentUser(prev => (prev.id === userId ? updated : prev));
      } catch (e) {
        setWriteError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  return (
    <AppContext.Provider value={{
      authReady,
      isAuthenticated,
      signIn,
      signUp,
      signOut,
      dataLoading,
      dataError,
      writeError,
      dismissWriteError,
      reload,

      branches,
      categories,
      products,
      modifierGroups,
      orders,
      addresses,
      profiles,

      currentUser,
      selectedBranch,
      setSelectedBranch,

      cart,
      addToCart,
      removeFromCart,
      updateCartQuantity,
      clearCart,
      cartTotal,
      cartCount,

      checkoutType,
      setCheckoutType,
      selectedAddressId,
      setSelectedAddressId,
      couponCode,
      setCouponCode,
      discountAmount,
      applyCoupon,

      mobileLang,
      setMobileLang,
      adminLang,
      setAdminLang,

      addAddress,
      deleteAddress,
      placeOrder,
      updateOrderStatus,

      addCategory,
      updateCategory,
      deleteCategory,
      addProduct,
      updateProduct,
      deleteProduct,
      toggleProductAvailability,
      isProductAvailableInBranch,
      updateBranchSettings,
      deleteBranch,
      bulkUploadMenu,

      deliveryZones,
      saveBranchDeliveryZone,
      clearBranchDeliveryZone,

      playNotificationSound,
      newOrderAlert,
      setNewOrderAlert,
      soundMuted,
      setSoundMuted,

      brandSettings,
      updateBrandSettings,
      loyaltySettings,
      updateLoyaltySettings,

      paymentSettings,
      updatePaymentSettings,
      selectedPaymentMethod,
      setSelectedPaymentMethod,

      ordersLiveMode,
      ordersLastUpdated,

      integrationSettings,
      integrationsLoading,
      integrationsError,
      loadIntegrations,
      saveIntegration,

      loyaltyMutationsEnabled,
      walletCreditEnabled,
      loyaltyPointsRedeemed,
      setLoyaltyPointsRedeemed,
      loyaltyDiscountAmount,
      updateCustomerPoints,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
