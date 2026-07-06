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
  SmsSettings, NotificationSettings, LoyaltySettings
} from '../types';
import { 
  INITIAL_BRANCHES, INITIAL_CATEGORIES, INITIAL_MODIFIER_GROUPS, 
  INITIAL_PRODUCTS, INITIAL_PROFILES, INITIAL_ADDRESSES, INITIAL_ORDERS,
  INITIAL_BRAND_SETTINGS, INITIAL_LAZYWAIT_SETTINGS, INITIAL_PAYMENT_SETTINGS,
  INITIAL_SMS_SETTINGS, INITIAL_NOTIFICATION_SETTINGS, INITIAL_LOYALTY_SETTINGS
} from '../data/initialData';
import { getVATBreakdown } from '../utils/calculations';

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
  placeOrder: () => { success: boolean; orderId?: string; error?: string };
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
  loyaltySettings: LoyaltySettings;
  updateLoyaltySettings: (settings: Partial<LoyaltySettings>) => void;

  // Phase 11: Real-time Customer Loyalty Integration
  loyaltyPointsRedeemed: number;
  setLoyaltyPointsRedeemed: (points: number) => void;
  loyaltyDiscountAmount: number;
  updateCustomerPoints: (userId: string, points: number) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Database state
  const [branches, setBranches] = useState<Branch[]>(() => {
    const saved = localStorage.getItem('sm_branches');
    return saved ? JSON.parse(saved) : INITIAL_BRANCHES;
  });
  
  const [categories, setCategories] = useState<Category[]>(() => {
    const saved = localStorage.getItem('sm_categories');
    return saved ? JSON.parse(saved) : INITIAL_CATEGORIES;
  });

  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('sm_products');
    return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
  });

  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>(() => {
    const saved = localStorage.getItem('sm_modifier_groups');
    return saved ? JSON.parse(saved) : INITIAL_MODIFIER_GROUPS;
  });

  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem('sm_orders');
    return saved ? JSON.parse(saved) : INITIAL_ORDERS;
  });

  const [addresses, setAddresses] = useState<SavedAddress[]>(() => {
    const saved = localStorage.getItem('sm_addresses');
    return saved ? JSON.parse(saved) : INITIAL_ADDRESSES;
  });

  const [profiles, setProfiles] = useState<UserProfile[]>(() => {
    const saved = localStorage.getItem('sm_profiles');
    if (saved) return JSON.parse(saved);
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
    const saved = localStorage.getItem('sm_availability_matrix');
    if (saved) return JSON.parse(saved);
    
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
    const saved = localStorage.getItem('sm_profiles');
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed[0] || INITIAL_PROFILES[0];
    }
    return INITIAL_PROFILES[0];
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
  
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings>(() => {
    const saved = localStorage.getItem('sm_loyalty_settings');
    return saved ? JSON.parse(saved) : INITIAL_LOYALTY_SETTINGS;
  });

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

  // Languages
  const [mobileLang, setMobileLang] = useState<'en' | 'ar'>('en');
  const [adminLang, setAdminLang] = useState<'en' | 'ar'>('en');

  // Phase 10: Settings & Integration States
  const [brandSettings, setBrandSettings] = useState<BrandSettings>(() => {
    const saved = localStorage.getItem('sm_brand_settings');
    return saved ? JSON.parse(saved) : INITIAL_BRAND_SETTINGS;
  });

  const [lazywaitSettings, setLazywaitSettings] = useState<LazywaitSettings>(() => {
    const saved = localStorage.getItem('sm_lazywait_settings');
    return saved ? JSON.parse(saved) : INITIAL_LAZYWAIT_SETTINGS;
  });

  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(() => {
    const saved = localStorage.getItem('sm_payment_settings');
    return saved ? JSON.parse(saved) : INITIAL_PAYMENT_SETTINGS;
  });

  const [smsSettings, setSmsSettings] = useState<SmsSettings>(() => {
    const saved = localStorage.getItem('sm_sms_settings');
    return saved ? JSON.parse(saved) : INITIAL_SMS_SETTINGS;
  });

  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(() => {
    const saved = localStorage.getItem('sm_notification_settings');
    return saved ? JSON.parse(saved) : INITIAL_NOTIFICATION_SETTINGS;
  });

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
    const id = 'adr-' + Math.random().toString(36).substr(2, 9);
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

    const currentDeliveryFee = checkoutType === 'delivery' ? selectedBranch.deliveryFee : 0;
    const finalTotal = Math.max(0, cartTotal + currentDeliveryFee - discountAmount - loyaltyDiscountAmount);

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

    // Generate Order ID & Number
    const seq = String(orders.length + 1).padStart(6, '0');
    const orderNumber = `SM-2026-${seq}`;
    const orderId = `ord-${Math.random().toString(36).substr(2, 9)}`;

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
      total: finalTotal,
      paymentStatus: 'pending',
      orderSyncStatus: 'not_synced', // Starts as unsynced (representing Lazywait connector status)
      createdAt: new Date().toISOString(),
      address: deliveryAddress,
      items: orderItems
    };

    // Phase 11: Real-time loyalty update
    if (loyaltySettings.isEnabled && currentUser.role === 'customer') {
      const currentPoints = currentUser.loyaltyPoints || 0;
      const earnedPoints = Math.floor(finalTotal * loyaltySettings.pointsPerRiyal);
      const nextPoints = Math.max(0, currentPoints - loyaltyPointsRedeemed + earnedPoints);
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

    return { success: true, orderId };
  };

  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    setOrders(prev => prev.map(o => {
      if (o.id === orderId) {
        // Mocking external POS sync update status
        const syncStatusVal = status === 'received' ? 'not_synced' : 'synced';
        return { 
          ...o, 
          status, 
          orderSyncStatus: syncStatusVal as any,
          paymentStatus: status === 'delivered' ? 'paid' : o.paymentStatus
        };
      }
      return o;
    }));
  };

  // Phase 8 Admin Features: Category CRUD
  const addCategory = (nameEn: string, nameAr: string) => {
    const newCat: Category = {
      id: 'cat-' + Math.random().toString(36).substr(2, 9),
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
    const id = 'prod-' + Math.random().toString(36).substr(2, 9);
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
    
    // If a branch is closed, update availability for products
    if (updates.isActive === false) {
      setAvailabilityMatrix(prev => {
        const copy = { ...prev };
        Object.keys(copy).forEach(pId => {
          copy[pId][id] = false;
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
