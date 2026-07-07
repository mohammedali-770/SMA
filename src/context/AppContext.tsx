/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  Branch, Category, Product, ModifierGroup, Order, 
  UserProfile, SavedAddress, CartItem, OrderStatus, 
  Modifier, OrderItem, OrderItemModifier,
  BrandSettings, LazywaitSettings, PaymentSettings,
  SmsSettings, NotificationSettings, LoyaltySettings, IntegrationEvent
} from '../types';
import { 
  INITIAL_BRANCHES, INITIAL_CATEGORIES, INITIAL_MODIFIER_GROUPS, 
  INITIAL_PRODUCTS, INITIAL_PROFILES, INITIAL_ADDRESSES, INITIAL_ORDERS,
  INITIAL_BRAND_SETTINGS, INITIAL_LAZYWAIT_SETTINGS, INITIAL_PAYMENT_SETTINGS,
  INITIAL_SMS_SETTINGS, INITIAL_NOTIFICATION_SETTINGS, INITIAL_LOYALTY_SETTINGS
} from '../data/initialData';
import { getVATBreakdown, generateId } from '../utils/calculations';

interface AppContextType {
  // DB Tables
  branches: Branch[];
  categories: Category[];
  products: Product[];
  modifierGroups: ModifierGroup[];
  orders: Order[];
  addresses: SavedAddress[];
  profiles: UserProfile[];
  
  // Current Sessions
  currentUser: UserProfile;
  setCurrentUser: (user: UserProfile) => void;
  selectedBranch: Branch | null;
  setSelectedBranch: (branch: Branch | null) => void;
  
  // Cart
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
  
  // Active Languages
  mobileLang: 'en' | 'ar';
  setMobileLang: (lang: 'en' | 'ar') => void;
  adminLang: 'en' | 'ar';
  setAdminLang: (lang: 'en' | 'ar') => void;
  
  // DB operations
  addAddress: (address: Omit<SavedAddress, 'id'>) => void;
  deleteAddress: (id: string) => void;
  placeOrder: () => { success: boolean; orderId?: string; order?: Order; error?: string };
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  
  // Phase 8: Admin Panel Operations
  addCategory: (nameEn: string, nameAr: string) => void;
  updateCategory: (id: string, nameEn: string, nameAr: string) => void;
  deleteCategory: (id: string) => void;
  addProduct: (product: Omit<Product, 'id'>) => void;
  updateProduct: (product: Product) => void;
  deleteProduct: (id: string) => void;
  toggleProductAvailability: (productId: string, branchId: string) => void;
  isProductAvailableInBranch: (productId: string, branchId: string) => boolean;
  updateBranchSettings: (id: string, updates: Partial<Branch>) => void;
  bulkUploadMenu: (categories: Category[], products: Product[]) => { success: boolean; count: number };
  
  // Audio indicator for realtime
  playNotificationSound: () => void;
  newOrderAlert: boolean;
  setNewOrderAlert: (alert: boolean) => void;
  soundMuted: boolean;
  setSoundMuted: (muted: boolean) => void;

  // Phase 10: Settings & Integration States
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

  // Phase 11: Real-time Customer Loyalty Integration
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

/** Display labels for the payment gateway providers. */
const PAYMENT_PROVIDER_LABELS: Record<PaymentSettings['providerName'], string> = {
  moyasar: 'Moyasar',
  paytabs: 'PayTabs',
  hyperpay: 'HyperPay',
  sandbox: 'Sandbox',
};

/** One-liner describing each status, used in the simulated customer messages. */
const ORDER_STATUS_MESSAGES: Record<OrderStatus, string> = {
  received: 'has been received',
  preparing: 'is now being prepared',
  ready: 'is ready for pickup/dispatch',
  out_for_delivery: 'is out for delivery',
  delivered: 'has been delivered',
  cancelled: 'has been cancelled',
};

/**
 * Safely load a persisted value from localStorage, falling back to `fallback`
 * when the key is missing or holds corrupted/non-JSON data. Without this guard
 * a single malformed key crashes the whole app during the provider's initial
 * render (white screen with no recovery path).
 */
function loadPersisted<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved !== null ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Database state
  const [branches, setBranches] = useState<Branch[]>(() => loadPersisted('sm_branches', INITIAL_BRANCHES));

  const [categories, setCategories] = useState<Category[]>(() => loadPersisted('sm_categories', INITIAL_CATEGORIES));

  const [products, setProducts] = useState<Product[]>(() => loadPersisted('sm_products', INITIAL_PRODUCTS));

  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>(() => loadPersisted('sm_modifier_groups', INITIAL_MODIFIER_GROUPS));

  const [orders, setOrders] = useState<Order[]>(() => loadPersisted('sm_orders', INITIAL_ORDERS));

  const [addresses, setAddresses] = useState<SavedAddress[]>(() => loadPersisted('sm_addresses', INITIAL_ADDRESSES));

  const [profiles, setProfiles] = useState<UserProfile[]>(() => {
    const saved = loadPersisted<UserProfile[] | null>('sm_profiles', null);
    if (saved) return saved;
    // Seed default loyalty points to make the experience interactive
    const defaultProfiles = INITIAL_PROFILES.map(p => {
      if (p.id === 'usr-customer-1') {
        return { ...p, loyaltyPoints: 350 };
      }
      return { ...p, loyaltyPoints: p.role === 'customer' ? 50 : 0 };
    });
    localStorage.setItem('sm_profiles', JSON.stringify(defaultProfiles));
    return defaultProfiles;
  });

  // Availability matrix: productId -> Map of branchId -> isAvailable (true by default)
  const [availabilityMatrix, setAvailabilityMatrix] = useState<{ [key: string]: { [branchId: string]: boolean } }>(() => {
    const saved = loadPersisted<{ [key: string]: { [branchId: string]: boolean } } | null>('sm_availability_matrix', null);
    if (saved) return saved;

    // Seed default availability: all products available everywhere except non-active branches
    const matrix: { [key: string]: { [branchId: string]: boolean } } = {};
    INITIAL_PRODUCTS.forEach(p => {
      matrix[p.id] = {};
      INITIAL_BRANCHES.forEach(b => {
        matrix[p.id][b.id] = b.isActive;
      });
    });
    return matrix;
  });

  // Current session configurations
  const [currentUser, setCurrentUserInternal] = useState<UserProfile>(() => {
    const parsed = loadPersisted<UserProfile[] | null>('sm_profiles', null);
    return (parsed && parsed[0]) || INITIAL_PROFILES[0];
  });

  const setCurrentUser = (user: UserProfile) => {
    const latest = profiles.find(p => p.id === user.id) || user;
    setCurrentUserInternal(latest);
  };
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(() => {
    const active = INITIAL_BRANCHES.find(b => b.isActive);
    return active || null;
  });
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutType, setCheckoutType] = useState<'delivery' | 'pickup'>('delivery');
  const [selectedAddressId, setSelectedAddressId] = useState<string>(INITIAL_ADDRESSES[0]?.id || '');
  const [couponCode, setCouponCode] = useState<string>('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);

  // Phase 11: Real-time Customer Loyalty Integration
  const [loyaltyPointsRedeemed, setLoyaltyPointsRedeemed] = useState<number>(0);
  
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings>(() => loadPersisted('sm_loyalty_settings', INITIAL_LOYALTY_SETTINGS));

  const loyaltyDiscountAmount = Number((loyaltyPointsRedeemed * (loyaltySettings?.discountPerPoint || 0.1)).toFixed(2));

  const updateCustomerPoints = (userId: string, points: number) => {
    const nextPoints = Math.max(0, points);
    setProfiles(prev => {
      const updated = prev.map(p => {
        if (p.id === userId) {
          return { ...p, loyaltyPoints: nextPoints };
        }
        return p;
      });
      localStorage.setItem('sm_profiles', JSON.stringify(updated));
      return updated;
    });

    setCurrentUserInternal(prev => {
      if (prev.id === userId) {
        return { ...prev, loyaltyPoints: nextPoints };
      }
      return prev;
    });
  };

  useEffect(() => {
    setLoyaltyPointsRedeemed(0);
  }, [currentUser.id]);
  
  // Real-time states
  const [newOrderAlert, setNewOrderAlert] = useState<boolean>(false);
  const [soundMuted, setSoundMuted] = useState<boolean>(false);

  // Languages
  const [mobileLang, setMobileLang] = useState<'en' | 'ar'>('en');
  const [adminLang, setAdminLang] = useState<'en' | 'ar'>('en');

  // Phase 10: Settings & Integration States
  const [brandSettings, setBrandSettings] = useState<BrandSettings>(() => loadPersisted('sm_brand_settings', INITIAL_BRAND_SETTINGS));

  const [lazywaitSettings, setLazywaitSettings] = useState<LazywaitSettings>(() => loadPersisted('sm_lazywait_settings', INITIAL_LAZYWAIT_SETTINGS));

  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(() => loadPersisted('sm_payment_settings', INITIAL_PAYMENT_SETTINGS));

  const [smsSettings, setSmsSettings] = useState<SmsSettings>(() => loadPersisted('sm_sms_settings', INITIAL_SMS_SETTINGS));

  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(() => loadPersisted('sm_notification_settings', INITIAL_NOTIFICATION_SETTINGS));
  // Simulated SMS/push gateway activity, newest first (capped, see emitIntegrationEvent).
  const [integrationEvents, setIntegrationEvents] = useState<IntegrationEvent[]>(() => loadPersisted<IntegrationEvent[]>('sm_integration_events', []));

  const updateBrandSettings = (updates: Partial<BrandSettings>) => {
    setBrandSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('sm_brand_settings', JSON.stringify(next));
      return next;
    });
  };

  const updateLazywaitSettings = (updates: Partial<LazywaitSettings>) => {
    setLazywaitSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('sm_lazywait_settings', JSON.stringify(next));
      return next;
    });
  };

  const updatePaymentSettings = (updates: Partial<PaymentSettings>) => {
    setPaymentSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('sm_payment_settings', JSON.stringify(next));
      return next;
    });
  };

  const updateSmsSettings = (updates: Partial<SmsSettings>) => {
    setSmsSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('sm_sms_settings', JSON.stringify(next));
      return next;
    });
  };

  const updateNotificationSettings = (updates: Partial<NotificationSettings>) => {
    setNotificationSettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('sm_notification_settings', JSON.stringify(next));
      return next;
    });
  };

  const updateLoyaltySettings = (updates: Partial<LoyaltySettings>) => {
    setLoyaltySettings(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('sm_loyalty_settings', JSON.stringify(next));
      return next;
    });
  };

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem('sm_branches', JSON.stringify(branches));
  }, [branches]);

  useEffect(() => {
    localStorage.setItem('sm_categories', JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
    localStorage.setItem('sm_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('sm_modifier_groups', JSON.stringify(modifierGroups));
  }, [modifierGroups]);

  useEffect(() => {
    localStorage.setItem('sm_orders', JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    localStorage.setItem('sm_addresses', JSON.stringify(addresses));
  }, [addresses]);

  useEffect(() => {
    localStorage.setItem('sm_availability_matrix', JSON.stringify(availabilityMatrix));
  }, [availabilityMatrix]);

  useEffect(() => {
    localStorage.setItem('sm_integration_events', JSON.stringify(integrationEvents));
  }, [integrationEvents]);

  // Drive the Tailwind brand tokens from the editable brand settings, so the
  // admin's primary/secondary colour pickers actually re-theme every
  // bg-primary/text-primary/bg-secondary element across the app.
  useEffect(() => {
    const root = document.documentElement;
    // Only apply a valid CSS colour. The settings field updates on every
    // keystroke, so a partial/invalid value (e.g. "#" or "bluee") would
    // otherwise blank out every primary/secondary element; in that case fall
    // back to the @theme default by clearing the inline override.
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

  // Coupon application logic
  useEffect(() => {
    if (!couponCode) {
      setDiscountAmount(0);
      return;
    }
    const cleanCode = couponCode.trim().toUpperCase();
    if (cleanCode === 'SPICY15') {
      // 15% discount
      const sub = cart.reduce((acc, item) => acc + (item.totalPrice * item.quantity), 0);
      setDiscountAmount(Number((sub * 0.15).toFixed(2)));
    } else if (cleanCode === 'RIYADH10') {
      setDiscountAmount(10.00);
    } else {
      setDiscountAmount(0);
    }
  }, [couponCode, cart]);

  // Audio trigger
  const playNotificationSound = () => {
    if (soundMuted) return;
    try {
      // Simple synth ping using Web Audio API to prevent asset-loading issues
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // High A
      osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.1); // Quick up-slide

      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
      // Release the context once the ping ends; browsers cap live AudioContexts,
      // so leaking one per notification eventually silences all of them.
      osc.onended = () => { audioCtx.close().catch(() => {}); };
    } catch (e) {
      console.warn('Audio play block or unsupported:', e);
    }
  };

  // Cart operations
  const addToCart = (product: Product, selectedModifiers: { [groupId: string]: Modifier[] }, quantity: number) => {
    // Generate a unique cartItemId by flattening selected modifier IDs
    const modifierIds: string[] = [];
    Object.values(selectedModifiers).forEach(list => {
      list.forEach(m => modifierIds.push(m.id));
    });
    modifierIds.sort();
    const cartItemId = `${product.id}-${modifierIds.join('_')}`;

    // Calculate single item price
    let itemPrice = product.price;
    Object.values(selectedModifiers).forEach(list => {
      list.forEach(m => {
        itemPrice += m.price;
      });
    });

    setCart(prev => {
      const existing = prev.find(item => item.cartItemId === cartItemId);
      if (existing) {
        return prev.map(item => 
          item.cartItemId === cartItemId 
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      } else {
        return [...prev, {
          cartItemId,
          product,
          selectedModifiers,
          quantity,
          totalPrice: itemPrice
        }];
      }
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
  };

  const cartTotal = cart.reduce((acc, item) => acc + (item.totalPrice * item.quantity), 0);
  const cartCount = cart.reduce((acc, item) => acc + item.quantity, 0);

  // Saved Addresses
  const addAddress = (address: Omit<SavedAddress, 'id'>) => {
    const id = generateId('adr');
    const newAddress: SavedAddress = {
      ...address,
      id,
      isDefault: address.isDefault || addresses.length === 0
    };
    
    setAddresses(prev => {
      let updated = prev;
      if (newAddress.isDefault) {
        updated = prev.map(a => ({ ...a, isDefault: false }));
      }
      return [...updated, newAddress];
    });
    
    setSelectedAddressId(id);
  };

  const deleteAddress = (id: string) => {
    setAddresses(prev => prev.filter(a => a.id !== id));
    if (selectedAddressId === id) {
      setSelectedAddressId('');
    }
  };

  // Place Order (Real-time trigger)
  // Append a simulated gateway message to the activity log (newest first),
  // capped so the persisted log can't grow without bound.
  const emitIntegrationEvent = (channel: 'sms' | 'push', provider: string, recipient: string, message: string) => {
    setIntegrationEvents(prev => [
      { id: generateId('evt'), createdAt: new Date().toISOString(), channel, provider, recipient, message },
      ...prev,
    ].slice(0, 50));
  };

  const clearIntegrationEvents = () => setIntegrationEvents([]);

  // Fan an order event out to the SMS and push channels, each gated by its own
  // provider toggle. There is no real gateway — this records what *would* be sent.
  const notifyCustomer = (order: Order, message: string) => {
    // Prefer the in-app push channel; fall back to SMS only when push is
    // unavailable. Leaning on (free) app notifications keeps paid SMS to a
    // minimum — SMS fires only when push is disabled.
    if (notificationSettings.isEnabled) {
      emitIntegrationEvent('push', notificationSettings.providerName, order.customerName, message);
    } else if (smsSettings.isEnabled) {
      emitIntegrationEvent('sms', smsSettings.providerName, order.customerPhone, message);
    }
  };

  const placeOrder = () => {
    if (cart.length === 0) return { success: false, error: 'Cart is empty' };
    if (!selectedBranch) return { success: false, error: 'No branch selected' };
    
    // Delivery validation
    let deliveryAddress: SavedAddress | undefined;
    if (checkoutType === 'delivery') {
      deliveryAddress = addresses.find(a => a.id === selectedAddressId);
      if (!deliveryAddress) {
        return { success: false, error: 'Please select or add a delivery address' };
      }
      if (cartTotal < selectedBranch.minDeliveryOrder) {
        return {
          success: false,
          error: `Minimum delivery order for this branch is ${selectedBranch.minDeliveryOrder} SAR`
        };
      }
    }

    // Revalidate the cart against the live menu: a product may have been
    // deactivated, deleted, or switched off for this branch while it sat in the
    // cart, and must not be silently ordered.
    for (const cItem of cart) {
      const product = products.find(p => p.id === cItem.product.id);
      if (!product || !product.isActive) {
        return { success: false, error: `${cItem.product.nameEn} is no longer on the menu. Please remove it from your cart.` };
      }
      if (!isProductAvailableInBranch(product.id, selectedBranch.id)) {
        return { success: false, error: `${cItem.product.nameEn} is not available at ${selectedBranch.nameEn}.` };
      }
    }

    const currentDeliveryFee = checkoutType === 'delivery' ? selectedBranch.deliveryFee : 0;

    // Cap the staged loyalty redemption to the points the customer actually
    // holds, then derive the discount from that capped figure. This keeps the
    // discount applied to the total and the points deducted below in lockstep,
    // so a stale redemption (e.g. after the admin adjusts the same customer's
    // balance mid-session) can never fund an unbacked discount.
    const loyaltyActive = loyaltySettings.isEnabled && currentUser.role === 'customer';
    const availablePoints = currentUser.loyaltyPoints || 0;
    const pointsRedeemed = loyaltyActive ? Math.min(Math.max(0, loyaltyPointsRedeemed), availablePoints) : 0;
    const appliedLoyaltyDiscount = Number((pointsRedeemed * (loyaltySettings.discountPerPoint || 0.1)).toFixed(2));
    const finalTotal = Math.max(0, cartTotal + currentDeliveryFee - discountAmount - appliedLoyaltyDiscount);

    // Payment gateway wiring: when enabled the order is treated as paid online
    // through the configured provider; when disabled it falls back to cash on
    // delivery (still placeable, settled on delivery).
    const paymentEnabled = paymentSettings.isEnabled;
    const paymentMethod = paymentEnabled
      ? `${PAYMENT_PROVIDER_LABELS[paymentSettings.providerName]}${paymentSettings.isLiveMode ? '' : ' (Test)'}`
      : 'Cash on Delivery';

    // Build order items
    const orderItems: OrderItem[] = cart.map((cItem, index) => {
      const selectedMods: OrderItemModifier[] = [];
      Object.entries(cItem.selectedModifiers).forEach(([gId, mList]) => {
        (mList as Modifier[]).forEach(m => {
          selectedMods.push({
            id: `oim-${index}-${m.id}`,
            modifierId: m.id,
            nameEn: m.nameEn,
            nameAr: m.nameAr,
            price: m.price
          });
        });
      });

      return {
        id: `oi-${index}-${Math.random().toString(36).substr(2, 5)}`,
        productId: cItem.product.id,
        nameEn: cItem.product.nameEn,
        nameAr: cItem.product.nameAr,
        price: cItem.product.price,
        quantity: cItem.quantity,
        selectedModifiers: selectedMods
      };
    });

    // Generate Order ID & Number. Continue from the highest existing sequence so
    // numbers never collide with seeded orders or repeat after a deletion (using
    // orders.length would restart and clash).
    const maxSeq = orders.reduce((max, o) => {
      const m = o.orderNumber.match(/SM-2026-(\d+)/);
      const n = m ? parseInt(m[1], 10) : 0;
      return n > max ? n : max;
    }, 0);
    const seq = String(maxSeq + 1).padStart(6, '0');
    const orderNumber = `SM-2026-${seq}`;
    const orderId = generateId('ord');

    const newOrder: Order = {
      id: orderId,
      orderNumber,
      customerId: currentUser.id,
      customerName: currentUser.fullName,
      customerPhone: currentUser.phoneNumber,
      branchId: selectedBranch.id,
      branchNameEn: selectedBranch.nameEn,
      branchNameAr: selectedBranch.nameAr,
      status: 'received',
      orderType: checkoutType,
      subtotal: cartTotal,
      deliveryFee: currentDeliveryFee,
      discountAmount: discountAmount,
      loyaltyDiscountAmount: appliedLoyaltyDiscount,
      total: finalTotal,
      paymentStatus: paymentEnabled ? 'paid' : 'pending',
      paymentMethod,
      orderSyncStatus: 'not_synced', // Starts as unsynced (representing Lazywait connector status)
      createdAt: new Date().toISOString(),
      address: deliveryAddress,
      items: orderItems
    };

    // Phase 11: Real-time loyalty update. Deduct exactly the capped points that
    // funded appliedLoyaltyDiscount above, then add points earned on this order.
    if (loyaltyActive) {
      const earnedPoints = Math.floor(finalTotal * loyaltySettings.pointsPerRiyal);
      const nextPoints = Math.max(0, availablePoints - pointsRedeemed + earnedPoints);
      updateCustomerPoints(currentUser.id, nextPoints);
    }

    // Append to orders
    setOrders(prev => [newOrder, ...prev]);
    
    // Realtime alert
    setNewOrderAlert(true);
    playNotificationSound();

    // Reset checkout states
    clearCart();
    setLoyaltyPointsRedeemed(0);

    // Simulated order-confirmation message to the customer (SMS/push per toggles).
    notifyCustomer(newOrder, `Order ${orderNumber} confirmed — ${finalTotal.toFixed(2)} SAR, ${paymentEnabled ? 'paid via ' + paymentMethod : paymentMethod}.`);

    return { success: true, orderId, order: newOrder };
  };

  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    // Reject invalid jumps (e.g. delivered -> received, cancelled -> delivered)
    // up front, so we only mutate state and notify on a real transition.
    const target = orders.find(o => o.id === orderId);
    if (!target || !canTransitionOrder(target.status, status)) return;

    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      // Mocking external POS sync update status
      const syncStatusVal = status === 'received' ? 'not_synced' : 'synced';
      return {
        ...o,
        status,
        orderSyncStatus: syncStatusVal as any,
        paymentStatus: status === 'delivered' ? 'paid' : o.paymentStatus
      };
    }));

    // Simulated customer notification for the status change (SMS/push per toggles).
    notifyCustomer(target, `Order ${target.orderNumber} ${ORDER_STATUS_MESSAGES[status]}.`);
  };

  // Phase 8 Admin Features: Category CRUD
  const addCategory = (nameEn: string, nameAr: string) => {
    const newCat: Category = {
      id: generateId('cat'),
      nameEn,
      nameAr,
      sortOrder: categories.length + 1
    };
    setCategories(prev => [...prev, newCat]);
  };

  const updateCategory = (id: string, nameEn: string, nameAr: string) => {
    setCategories(prev => prev.map(c => 
      c.id === id ? { ...c, nameEn, nameAr } : c
    ));
  };

  const deleteCategory = (id: string) => {
    setCategories(prev => prev.filter(c => c.id !== id));
    // Also disable or reassign products belonging to this category
    setProducts(prev => prev.map(p => 
      p.categoryId === id ? { ...p, isActive: false } : p
    ));
  };

  // Phase 8 Admin Features: Product CRUD
  const addProduct = (pData: Omit<Product, 'id'>) => {
    const id = generateId('prod');
    const newProd: Product = {
      ...pData,
      id
    };
    setProducts(prev => [...prev, newProd]);
    
    // Update availability matrix for all active branches
    setAvailabilityMatrix(prev => {
      const copy = { ...prev };
      copy[id] = {};
      branches.forEach(b => {
        copy[id][b.id] = b.isActive;
      });
      return copy;
    });
  };

  const updateProduct = (p: Product) => {
    setProducts(prev => prev.map(old => old.id === p.id ? p : old));
  };

  const deleteProduct = (id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    // Remove from availability matrix
    setAvailabilityMatrix(prev => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  // Phase 8 Admin Features: Branch Specific Availability
  const toggleProductAvailability = (productId: string, branchId: string) => {
    setAvailabilityMatrix(prev => {
      const current = prev[productId] ? { ...prev[productId] } : {};
      const nextVal = current[branchId] === undefined ? false : !current[branchId];
      
      return {
        ...prev,
        [productId]: {
          ...current,
          [branchId]: nextVal
        }
      };
    });
  };

  const isProductAvailableInBranch = (productId: string, branchId: string): boolean => {
    if (!availabilityMatrix[productId]) return true;
    const branchVal = availabilityMatrix[productId][branchId];
    return branchVal === undefined ? true : branchVal;
  };

  const updateBranchSettings = (id: string, updates: Partial<Branch>) => {
    setBranches(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));

    // Mirror the branch's open/closed state into the availability matrix so the
    // mobile menu tracks it: closing marks every product unavailable at that
    // branch, and reopening restores them (without this the branch stays empty
    // after a close/reopen cycle). Rows are copied, not mutated in place.
    if (updates.isActive === false || updates.isActive === true) {
      const available = updates.isActive === true;
      setAvailabilityMatrix(prev => {
        const copy = { ...prev };
        Object.keys(copy).forEach(pId => {
          copy[pId] = { ...copy[pId], [id]: available };
        });
        return copy;
      });
    }
  };

  // Phase 8 Admin Features: Bulk Upload Menu (Excel/CSV Parser support)
  const bulkUploadMenu = (newCats: Category[], newProds: Product[]) => {
    // Filter duplicates
    const finalCats = [...categories];
    newCats.forEach(nc => {
      if (!finalCats.some(fc => fc.nameEn.toLowerCase() === nc.nameEn.toLowerCase())) {
        finalCats.push(nc);
      }
    });

    setCategories(finalCats);
    setProducts(prev => [...prev, ...newProds]);

    // Update availability matrix for new products
    setAvailabilityMatrix(prev => {
      const copy = { ...prev };
      newProds.forEach(p => {
        copy[p.id] = {};
        branches.forEach(b => {
          copy[p.id][b.id] = b.isActive;
        });
      });
      return copy;
    });

    return { success: true, count: newProds.length };
  };

  return (
    <AppContext.Provider value={{
      branches,
      categories,
      products,
      modifierGroups,
      orders,
      addresses,
      profiles,
      
      currentUser,
      setCurrentUser,
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
      
      mobileLang,
      setMobileLang,
      adminLang,
      setAdminLang,
      
      addAddress,
      deleteAddress,
      placeOrder,
      updateOrderStatus,
      
      // Phase 8 CRUDs
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

      // Phase 10 Settings & Integrations
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

      // Phase 11 Customer Loyalty
      loyaltyPointsRedeemed,
      setLoyaltyPointsRedeemed,
      loyaltyDiscountAmount,
      updateCustomerPoints
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
