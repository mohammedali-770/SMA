/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  Branch, Category, Product, ModifierGroup, Order,
  UserProfile, SavedAddress, CartItem, OrderStatus,
  Modifier, BrandSettings, LazywaitSettings, PaymentSettings,
  SmsSettings, NotificationSettings, LoyaltySettings, IntegrationEvent,
} from '../types';
import {
  INITIAL_BRAND_SETTINGS, INITIAL_LAZYWAIT_SETTINGS, INITIAL_PAYMENT_SETTINGS,
  INITIAL_SMS_SETTINGS, INITIAL_NOTIFICATION_SETTINGS, INITIAL_LOYALTY_SETTINGS,
} from '../data/initialData';
import { supabase } from '../lib/supabase';
import { auth, catalog, orders as ordersApi, addresses as addressesApi, coupons as couponsApi, admin as adminApi, profiles as profilesApi, loyalty as loyaltyApi } from '../lib/api';
import {
  mapBranch, mapCategory, mapProduct, mapModifierGroup, buildAvailabilityMatrix,
  mapProfile, mapAddress, mapOrder, mapBrandSettings, mapLoyaltySettings,
  brandPatchToDb, loyaltyPatchToDb, productToDbInsert, productToDbUpdate,
  categoryToDbInsert, branchPatchToDb,
} from '../lib/mappers';

interface AppContextType {
  // Auth / session (Option A: GoTrue = authentication, profiles.role = authorization)
  authReady: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, phone?: string) => Promise<void>;
  signOut: () => Promise<void>;

  // Data load lifecycle
  dataLoading: boolean;
  dataError: string | null;
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
  bulkUploadMenu: (categories: Category[], products: Product[]) => Promise<{ success: boolean; count: number }>;

  // Audio indicator for realtime
  playNotificationSound: () => void;
  newOrderAlert: boolean;
  setNewOrderAlert: (alert: boolean) => void;
  soundMuted: boolean;
  setSoundMuted: (muted: boolean) => void;

  // Settings & Integration States
  brandSettings: BrandSettings;
  updateBrandSettings: (settings: Partial<BrandSettings>) => void;
  lazywaitSettings: LazywaitSettings;
  updateLazywaitSettings: (settings: Partial<LazywaitSettings>) => void;
  paymentSettings: PaymentSettings;
  updatePaymentSettings: (settings: Partial<PaymentSettings>) => void;
  smsSettings: SmsSettings;
  updateSmsSettings: (settings: Partial<SmsSettings>) => void;
  notificationSettings: NotificationSettings;
  updateNotificationSettings: (settings: Partial<NotificationSettings>) => void;
  integrationEvents: IntegrationEvent[];
  clearIntegrationEvents: () => void;
  loyaltySettings: LoyaltySettings;
  updateLoyaltySettings: (settings: Partial<LoyaltySettings>) => void;

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

const AppContext = createContext<AppContextType | undefined>(undefined);

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
  const loadedUserRef = useRef<string | null>(null);

  // ---- Data load lifecycle -------------------------------------------------
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // ---- Database-backed state (mapped app types) ----------------------------
  const [branches, setBranches] = useState<Branch[]>([]);
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

  // Integration settings with no backend yet (payment / SMS / push / Lazywait)
  // are deliberately client-only session state and drive no real behaviour —
  // the order flow is server-authoritative. Surfaced read/write so the admin
  // Settings screen keeps working; documented as not-yet-wired.
  const [lazywaitSettings, setLazywaitSettings] = useState<LazywaitSettings>(INITIAL_LAZYWAIT_SETTINGS);
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(INITIAL_PAYMENT_SETTINGS);
  const [smsSettings, setSmsSettings] = useState<SmsSettings>(INITIAL_SMS_SETTINGS);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(INITIAL_NOTIFICATION_SETTINGS);
  const [integrationEvents, setIntegrationEvents] = useState<IntegrationEvent[]>([]);

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
  /** Load only the orders (used after placing / advancing an order). */
  const refreshOrders = useCallback(async () => {
    const rows = await ordersApi.listWithItems();
    setOrders(rows.map(mapOrder));
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
      }
    } catch (e) {
      setDataError(e instanceof Error ? e.message : String(e));
    } finally {
      setDataLoading(false);
    }
  }, [refreshCatalog, refreshOrders]);

  const resetToGuest = useCallback(() => {
    loadedUserRef.current = null;
    setIsAuthenticated(false);
    setCurrentUser(GUEST_USER);
    setBranches([]); setCategories([]); setProducts([]); setModifierGroups([]);
    setOrders([]); setAddresses([]); setProfiles([]); setAvailabilityMatrix({});
    setSelectedBranch(null); setCart([]); setCouponCode(''); setDiscountAmount(0);
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

  // ---- Auth actions --------------------------------------------------------
  const signIn = useCallback(async (email: string, password: string) => {
    await auth.signIn(email, password);
  }, []);
  const signUp = useCallback(async (email: string, password: string, fullName: string, phone?: string) => {
    await auth.signUp(email, password, fullName, phone);
  }, []);
  const signOut = useCallback(async () => {
    await auth.signOut();
    resetToGuest();
  }, [resetToGuest]);

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
    setCart(prev => prev.filter(item => item.cartItemId !== cartItemId));
  };

  const updateCartQuantity = (cartItemId: string, change: number) => {
    setCart(prev => prev.map(item => {
      if (item.cartItemId === cartItemId) {
        const newQty = item.quantity + change;
        return newQty > 0 ? { ...item, quantity: newQty } : item;
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const clearCart = () => {
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
        setDataError(e instanceof Error ? e.message : String(e));
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
        setDataError(e instanceof Error ? e.message : String(e));
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

    const items = cart.map(ci => ({
      product_id: ci.product.id,
      quantity: ci.quantity,
      modifier_ids: (Object.values(ci.selectedModifiers) as Modifier[][]).flat().map(m => m.id),
    }));

    try {
      const created = await ordersApi.place({
        branchId: selectedBranch.id,
        orderType: checkoutType,
        items,
        addressId: checkoutType === 'delivery' ? selectedAddressId : null,
        couponCode: couponCode || null,
        notes: null,
        loyaltyPoints: currentUser.role === 'customer' ? loyaltyPointsRedeemed : 0,
      });
      // The RPC returns the order row without its items; refetch (with items) so
      // the receipt renders the full breakdown recomputed by the server.
      const rows = await ordersApi.listWithItems();
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
  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    const target = orders.find(o => o.id === orderId);
    if (!target || !canTransitionOrder(target.status, status)) return;
    void (async () => {
      try {
        await ordersApi.setStatus(orderId, status);
        await refreshOrders();
      } catch (e) {
        setDataError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  // ---- Admin: category CRUD ------------------------------------------------
  const addCategory = (nameEn: string, nameAr: string) => {
    void (async () => {
      try {
        await adminApi.createCategory(categoryToDbInsert(nameEn, nameAr, categories.length + 1));
        await refreshCatalog();
      } catch (e) { setDataError(e instanceof Error ? e.message : String(e)); }
    })();
  };
  const updateCategory = (id: string, nameEn: string, nameAr: string) => {
    void (async () => {
      try {
        await adminApi.updateCategory(id, { name_en: nameEn, name_ar: nameAr });
        await refreshCatalog();
      } catch (e) { setDataError(e instanceof Error ? e.message : String(e)); }
    })();
  };
  const deleteCategory = (id: string) => {
    void (async () => {
      try {
        await adminApi.deleteCategory(id);
        await refreshCatalog();
      } catch (e) { setDataError(e instanceof Error ? e.message : String(e)); }
    })();
  };

  // ---- Admin: product CRUD -------------------------------------------------
  const addProduct = (pData: Omit<Product, 'id'>) => {
    void (async () => {
      try {
        await adminApi.createProduct(productToDbInsert(pData, products.length + 1));
        await refreshCatalog();
      } catch (e) { setDataError(e instanceof Error ? e.message : String(e)); }
    })();
  };
  const updateProduct = (p: Product) => {
    void (async () => {
      try {
        await adminApi.updateProduct(p.id, productToDbUpdate(p));
        await refreshCatalog();
      } catch (e) { setDataError(e instanceof Error ? e.message : String(e)); }
    })();
  };
  const deleteProduct = (id: string) => {
    void (async () => {
      try {
        await adminApi.deleteProduct(id);
        await refreshCatalog();
      } catch (e) { setDataError(e instanceof Error ? e.message : String(e)); }
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
        setDataError(e instanceof Error ? e.message : String(e));
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
        setDataError(e instanceof Error ? e.message : String(e));
        await refreshCatalog();
      }
    })();
  };

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
      setDataError(e instanceof Error ? e.message : String(e));
      return { success: false, count: 0 };
    }
  };

  // ---- Settings ------------------------------------------------------------
  const updateBrandSettings = (updates: Partial<BrandSettings>) => {
    setBrandSettings(prev => ({ ...prev, ...updates })); // colours re-theme instantly
    const dbPatch = brandPatchToDb(updates);
    if (Object.keys(dbPatch).length > 0) {
      void (async () => {
        try { await adminApi.updateSettings(dbPatch); }
        catch (e) { setDataError(e instanceof Error ? e.message : String(e)); }
      })();
    }
  };

  const updateLoyaltySettings = (updates: Partial<LoyaltySettings>) => {
    setLoyaltySettings(prev => ({ ...prev, ...updates }));
    const dbPatch = loyaltyPatchToDb(updates);
    if (Object.keys(dbPatch).length > 0) {
      void (async () => {
        try { await adminApi.updateSettings(dbPatch); }
        catch (e) { setDataError(e instanceof Error ? e.message : String(e)); }
      })();
    }
  };

  // Integrations with no backend yet: client-only session state (no persistence).
  const updateLazywaitSettings = (u: Partial<LazywaitSettings>) => setLazywaitSettings(prev => ({ ...prev, ...u }));
  const updatePaymentSettings = (u: Partial<PaymentSettings>) => setPaymentSettings(prev => ({ ...prev, ...u }));
  const updateSmsSettings = (u: Partial<SmsSettings>) => setSmsSettings(prev => ({ ...prev, ...u }));
  const updateNotificationSettings = (u: Partial<NotificationSettings>) => setNotificationSettings(prev => ({ ...prev, ...u }));
  const clearIntegrationEvents = () => setIntegrationEvents([]);

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
        setDataError(e instanceof Error ? e.message : String(e));
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
      bulkUploadMenu,

      playNotificationSound,
      newOrderAlert,
      setNewOrderAlert,
      soundMuted,
      setSoundMuted,

      brandSettings,
      updateBrandSettings,
      lazywaitSettings,
      updateLazywaitSettings,
      paymentSettings,
      updatePaymentSettings,
      smsSettings,
      updateSmsSettings,
      notificationSettings,
      updateNotificationSettings,
      integrationEvents,
      clearIntegrationEvents,
      loyaltySettings,
      updateLoyaltySettings,

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
