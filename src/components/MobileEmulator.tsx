/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin, ShoppingBag, ClipboardList, User,
  Plus, Minus, Trash2, Check, Globe,
  Sparkles, AlertCircle, Phone, Map, Wallet
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Product, ModifierGroup, Modifier, SavedAddress, CartItem } from '../types';
import { calculateDistance, getVATBreakdown, formatRiyadhDateTime } from '../utils/calculations';
import { LOCALES } from './mobile/mobileLocales';
import { WalletScreen } from './mobile/WalletScreen';
import { HomeScreen } from './mobile/HomeScreen';


export const MobileEmulator: React.FC = () => {
  const {
    branches, categories, products, modifierGroups, orders, addresses, currentUser, setCurrentUser,
    selectedBranch, setSelectedBranch, cart, addToCart, removeFromCart, updateCartQuantity, clearCart,
    cartTotal, cartCount, checkoutType, setCheckoutType, selectedAddressId, setSelectedAddressId,
    couponCode, setCouponCode, discountAmount, mobileLang, setMobileLang, addAddress, deleteAddress,
    placeOrder, isProductAvailableInBranch, brandSettings,
    loyaltySettings, loyaltyPointsRedeemed, setLoyaltyPointsRedeemed, loyaltyDiscountAmount, updateCustomerPoints
  } = useApp();

  const [activeTab, setActiveTab] = useState<'home' | 'cart' | 'wallet' | 'profile'>('home');
  
  // Modals state
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [activeOrderReceipt, setActiveOrderReceipt] = useState<any | null>(null);
  const [isAddressFormOpen, setIsAddressFormOpen] = useState(false);

  // Customization selection state
  const [selectedModifiers, setSelectedModifiers] = useState<{ [groupId: string]: Modifier[] }>({});
  const [customizationQty, setCustomizationQty] = useState(1);

  // Authentication simulation states
  const [isLoggedIn, setIsLoggedIn] = useState(true); // Pre-logged in for better initial demo experience
  const [authStep, setAuthStep] = useState<'login' | 'otp'>('login');
  const [authType, setAuthType] = useState<'phone' | 'email'>('phone');
  const [inputPhone, setInputPhone] = useState('+966 55 123 4567');
  const [inputEmail, setInputEmail] = useState('mohammed.ali@1sttaste.com');
  const [inputOtp, setInputOtp] = useState('');
  const [authError, setAuthError] = useState('');

  // New Address form states
  const [addrLabel, setAddrLabel] = useState('');
  const [addrDesc, setAddrDesc] = useState('');
  const [addrShort, setAddrShort] = useState('');
  const [addrLat, setAddrLat] = useState('24.7136');
  const [addrLng, setAddrLng] = useState('46.6753');

  // Coupon state
  const [couponInput, setCouponInput] = useState('');
  const [couponMsg, setCouponMsg] = useState({ text: '', isError: false });

  // Real-time loyalty toast state
  const [loyaltyToast, setLoyaltyToast] = useState<{ show: boolean; diff: number; current: number } | null>(null);
  const prevPointsRef = useRef<number>(currentUser.loyaltyPoints || 0);
  const prevUserIdRef = useRef<string>(currentUser.id);

  const [walletToast, setWalletToast] = useState<string | null>(null);

  useEffect(() => {
    if (walletToast) {
      const timer = setTimeout(() => setWalletToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [walletToast]);


  useEffect(() => {
    const currentPoints = currentUser.loyaltyPoints || 0;
    // On a profile switch, re-baseline silently — the balance delta between two
    // different users is not a points change to celebrate.
    if (prevUserIdRef.current !== currentUser.id) {
      prevUserIdRef.current = currentUser.id;
      prevPointsRef.current = currentPoints;
      return;
    }
    const diff = currentPoints - prevPointsRef.current;
    if (diff !== 0 && currentUser.role === 'customer') {
      setLoyaltyToast({ show: true, diff, current: currentPoints });
      const timer = setTimeout(() => {
        setLoyaltyToast(null);
      }, 4500);
      prevPointsRef.current = currentPoints;
      return () => clearTimeout(timer);
    }
    prevPointsRef.current = currentPoints;
  }, [currentUser.loyaltyPoints, currentUser.id, currentUser.role]);

  // Mock location coordinate of user
  const userLat = 24.7200;
  const userLng = 46.6800;

  const t = LOCALES[mobileLang];
  const isRTL = mobileLang === 'ar';


  // Set initial modifiers when opening customization
  useEffect(() => {
    if (customizingProduct) {
      const initial: { [groupId: string]: Modifier[] } = {};
      customizingProduct.modifierGroupIds.forEach(mgId => {
        const group = modifierGroups.find(g => g.id === mgId);
        if (group && group.isRequired && group.modifiers.length > 0) {
          // Default select the first modifier for required single-select groups
          initial[mgId] = [group.modifiers[0]];
        } else {
          initial[mgId] = [];
        }
      });
      setSelectedModifiers(initial);
      setCustomizationQty(1);
    }
  }, [customizingProduct, modifierGroups]);

  // Handle modifier selection
  const handleModifierToggle = (group: ModifierGroup, modifier: Modifier) => {
    const isSingleSelect = group.maxSelection === 1;
    const currentSelections = selectedModifiers[group.id] || [];

    if (isSingleSelect) {
      const alreadySelected = currentSelections.some(m => m.id === modifier.id);
      setSelectedModifiers(prev => ({
        ...prev,
        // In an optional single-select group, tapping the chosen option again
        // clears it; a required group always keeps exactly one selected.
        [group.id]: (alreadySelected && !group.isRequired) ? [] : [modifier]
      }));
    } else {
      const exists = currentSelections.some(m => m.id === modifier.id);
      let updated: Modifier[] = [];

      if (exists) {
        updated = currentSelections.filter(m => m.id !== modifier.id);
      } else {
        if (currentSelections.length < group.maxSelection) {
          updated = [...currentSelections, modifier];
        } else {
          // At max limit, replace the oldest selection
          updated = [...currentSelections.slice(1), modifier];
        }
      }

      setSelectedModifiers(prev => ({
        ...prev,
        [group.id]: updated
      }));
    }
  };

  // Check if customization can be added
  const canAddToCart = () => {
    if (!customizingProduct) return false;
    // Check if all required groups have met their minSelection
    return customizingProduct.modifierGroupIds.every(mgId => {
      const group = modifierGroups.find(g => g.id === mgId);
      if (!group) return true;
      if (!group.isRequired) return true;
      const selections = selectedModifiers[mgId] || [];
      return selections.length >= group.minSelection;
    });
  };

  const handleAddProductToCart = () => {
    if (!customizingProduct || !canAddToCart()) return;
    addToCart(customizingProduct, selectedModifiers, customizationQty);
    setCustomizingProduct(null);
  };

  // Address submission
  const handleSaveAddress = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addrLabel || !addrDesc || !addrShort) return;
    
    // Simple National Short Address format validation (4 letters + 4 numbers)
    const regex = /^[a-zA-Z]{4}\d{4}$/;
    if (!regex.test(addrShort.trim())) {
      alert(mobileLang === 'en' ? 'National Short Address must be 4 letters followed by 4 digits (e.g. RRBB1234)' : 'العنوان الوطني المختصر يجب أن يكون من ٤ أحرف تليها ٤ أرقام (مثل RRBB1234)');
      return;
    }

    addAddress({
      label: addrLabel,
      description: addrDesc,
      nationalShortAddress: addrShort.toUpperCase().trim(),
      lat: parseFloat(addrLat) || 24.7136,
      lng: parseFloat(addrLng) || 46.6753,
      isDefault: false
    });

    // Reset form
    setAddrLabel('');
    setAddrDesc('');
    setAddrShort('');
    setIsAddressFormOpen(false);
  };

  // Auth processing
  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (authStep === 'login') {
      if (authType === 'phone' && !inputPhone) {
        setAuthError(mobileLang === 'en' ? 'Please enter your phone number' : 'الرجاء إدخال رقم الجوال');
        return;
      }
      if (authType === 'email' && !inputEmail) {
        setAuthError(mobileLang === 'en' ? 'Please enter your email' : 'الرجاء إدخال البريد الإلكتروني');
        return;
      }
      setAuthStep('otp');
    } else {
      if (inputOtp === '1234') {
        setIsLoggedIn(true);
        // Sync profile to user info
        setCurrentUser({
          id: 'usr-customer-1',
          fullName: 'Mohammed Ali',
          phoneNumber: inputPhone,
          role: 'customer',
          email: inputEmail,
          createdAt: new Date().toISOString()
        });
        setAuthStep('login');
      } else {
        setAuthError(mobileLang === 'en' ? 'Invalid verification code. Try 1234.' : 'رمز التحقق غير صحيح. جرب 1234.');
      }
    }
  };

  // Place Order Action
  const handlePlaceOrderClick = () => {
    if (!isLoggedIn) {
      setActiveTab('profile');
      alert(mobileLang === 'en' ? 'Please login to place an order!' : 'الرجاء تسجيل الدخول لتتمكن من الطلب!');
      return;
    }
    const result = placeOrder();
    if (result.success && result.order) {
      // Use the order object returned by placeOrder — it is not yet present in
      // the `orders` array from this render's context snapshot.
      setActiveOrderReceipt(result.order);
      setActiveTab('profile');
    } else if (result.error) {
      alert(result.error);
    }
  };

  const handleApplyCouponCode = () => {
    if (!couponInput) return;
    setCouponCode(couponInput);
    const clean = couponInput.trim().toUpperCase();
    if (clean === 'SPICY15' || clean === 'RIYADH10') {
      setCouponMsg({
        text: t.coupon_success,
        isError: false
      });
    } else {
      setCouponMsg({
        text: t.invalid_coupon,
        isError: true
      });
    }
  };


  return (
    <div className="flex flex-col items-center justify-center py-4 bg-gray-50/50">
      {/* Device frame container */}
      <div 
        id="phone_frame"
        className="relative w-full max-w-[390px] h-[780px] glass-panel border-[10px] border-slate-900 rounded-[48px] shadow-2xl flex flex-col overflow-hidden select-none"
        style={{ direction: isRTL ? 'rtl' : 'ltr' }}
      >
        {/* Notch / Speaker bar */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-[28px] bg-gray-900 rounded-b-2xl z-50 flex items-center justify-center">
          <div className="w-12 h-1 bg-gray-800 rounded-full mb-1"></div>
          <div className="w-2.5 h-2.5 bg-gray-800 rounded-full mb-1 ml-2"></div>
        </div>

        {/* Real-time Loyalty Point notification overlay */}
        {loyaltyToast?.show && (
          <div className="absolute top-[36px] left-3 right-3 bg-gradient-to-r from-purple-900 via-slate-900 to-indigo-950 border border-purple-500/40 text-white rounded-2xl p-3 shadow-2xl z-[100] animate-bounce-short flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-base animate-pulse">🌟</span>
              <div>
                <span className="text-[9px] font-black text-purple-300 block uppercase tracking-wider">
                  {isRTL ? 'نقاط الولاء المحدثة' : 'Loyalty Wallet Sync'}
                </span>
                <p className="text-[11px] font-black leading-tight text-white">
                  {loyaltyToast.diff > 0 
                    ? (isRTL ? `رائع! تم شحن رصيدك بـ +${loyaltyToast.diff} نقطة` : `Awesome! Gained +${loyaltyToast.diff} points`)
                    : (isRTL ? `تم خصم ${Math.abs(loyaltyToast.diff)} نقطة` : `Deducted ${Math.abs(loyaltyToast.diff)} points`)}
                </p>
              </div>
            </div>
            <div className="bg-white/10 px-2 py-0.5 rounded-lg text-center border border-white/5 min-w-[50px]">
              <span className="text-[7px] text-purple-200 block font-bold uppercase">{isRTL ? 'الرصيد' : 'Balance'}</span>
              <span className="text-xs font-black text-yellow-300 font-mono">{loyaltyToast.current}</span>
            </div>
          </div>
        )}

        {/* Real-time Wallet / Conversion notification overlay */}
        {walletToast && (
          <div className="absolute top-[36px] left-3 right-3 bg-gradient-to-r from-emerald-900 via-slate-900 to-teal-950 border border-emerald-500/40 text-white rounded-2xl p-3 shadow-2xl z-[100] animate-bounce-short flex items-center gap-2.5">
            <span className="text-base animate-pulse">🎉</span>
            <div className="flex-1">
              <span className="text-[9px] font-black text-emerald-300 block uppercase tracking-wider leading-none">
                {isRTL ? 'إشعار المحفظة الرقمية' : 'Digital Wallet Sync'}
              </span>
              <p className="text-[10.5px] font-black leading-snug text-white mt-1">
                {walletToast}
              </p>
            </div>
          </div>
        )}
        <div className="bg-white/30 backdrop-blur-md px-6 pt-3 pb-1 flex items-center justify-between text-xs font-semibold text-slate-800 z-40">
          <span>03:13</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] bg-purple-100 text-purple-700 px-1 rounded font-bold uppercase">{mobileLang}</span>
            <div className="w-4 h-3.5 flex flex-col justify-end gap-0.5">
              <div className="flex items-end gap-0.5 h-2">
                <div className="w-0.5 h-1 bg-gray-600"></div>
                <div className="w-0.5 h-1.5 bg-gray-600"></div>
                <div className="w-0.5 h-2 bg-gray-600"></div>
              </div>
            </div>
            <span>5G</span>
            <div className="w-5 h-2.5 border border-gray-600 rounded-sm p-0.5 flex items-center">
              <div className="w-full h-full bg-green-500 rounded-2xs"></div>
            </div>
          </div>
        </div>

        {/* Main Phone Header */}
        <div className="bg-white/30 backdrop-blur-md px-4 py-2 border-b border-slate-200/60 flex items-center justify-between z-30">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Spicy Meal logo" className="w-9 h-9 rounded-full object-contain bg-white border border-gray-100" />
            <div>
              <div className="flex items-center gap-1 text-[10px] text-secondary font-bold uppercase tracking-wider">
                <Sparkles className="w-2.5 h-2.5" />
                {t.spicy_badge}
              </div>
              <h1 className="text-sm font-black text-primary leading-tight">SPICY MEAL</h1>
            </div>
          </div>

          {/* Branch & Lang switches */}
          <div className="flex items-center gap-1.5">
            <button 
              onClick={() => setIsBranchModalOpen(true)}
              className="flex items-center gap-1 text-xs bg-gray-50 border border-gray-100 py-1.5 px-2.5 rounded-full text-gray-800 hover:bg-gray-100 transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-secondary" />
              <span className="font-bold max-w-[80px] truncate">
                {selectedBranch ? (isRTL ? selectedBranch.nameAr : selectedBranch.nameEn) : t.select_branch}
              </span>
            </button>
            
            <button 
              onClick={() => setMobileLang(mobileLang === 'en' ? 'ar' : 'en')}
              className="p-1.5 rounded-full bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors text-gray-600"
              title={t.change_lang}
            >
              <Globe className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Scrollable Viewport */}
        <div className="flex-1 overflow-y-auto bg-white/10 backdrop-blur-md pb-20">
          
          {/* TAB 1: HOME SCREEN */}
          {activeTab === 'home' && <HomeScreen onCustomize={setCustomizingProduct} onOpenBranchModal={() => setIsBranchModalOpen(true)} />}

          {/* TAB 2: CART SCREEN */}
          {activeTab === 'cart' && (
            <div className="p-4 animate-fade-in pb-12">
              <h2 className="text-base font-black text-gray-900 mb-4">{t.cart}</h2>

              {cart.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-center px-4">
                  <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-3 border border-gray-100">
                    <ShoppingBag className="w-8 h-8 text-gray-300" />
                  </div>
                  <p className="text-xs font-bold text-gray-400 leading-relaxed mb-6">{t.empty_cart}</p>
                  <button 
                    onClick={() => setActiveTab('home')}
                    className="bg-primary text-white text-xs font-black px-6 py-2.5 rounded-full shadow-sm"
                  >
                    {t.back_to_menu}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  
                  {/* Cart Item Row list */}
                  <div className="glass-card rounded-2xl p-3 space-y-3.5">
                    {cart.map(item => (
                      <div key={item.cartItemId} className="flex gap-3 pb-3 border-b border-gray-50 last:border-b-0 last:pb-0">
                        <img 
                          src={item.product.imageUrl} 
                          alt={item.product.nameEn}
                          className="w-14 h-14 object-cover rounded-xl bg-gray-50 flex-shrink-0"
                        />
                        <div className="flex-1 flex flex-col justify-between">
                          <div>
                            <div className="flex justify-between items-start">
                              <h4 className="text-xs font-bold text-gray-950 leading-tight">
                                {isRTL ? item.product.nameAr : item.product.nameEn}
                              </h4>
                              <button 
                                onClick={() => removeFromCart(item.cartItemId)}
                                className="text-gray-300 hover:text-red-500 transition-colors p-0.5"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            
                            {/* Rendered selected modifiers list */}
                            {(Object.values(item.selectedModifiers) as Modifier[][]).flatMap(list => list).length > 0 && (
                              <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">
                                + {(Object.values(item.selectedModifiers) as Modifier[][]).flatMap(list => list).map(m => isRTL ? m.nameAr : m.nameEn).join(', ')}
                              </p>
                            )}
                          </div>

                          <div className="flex justify-between items-center mt-2">
                            <span className="text-xs font-black text-primary">
                              {item.totalPrice * item.quantity} {t.sar}
                            </span>
                            
                            {/* Quantity control */}
                            <div className="flex items-center bg-gray-50 border border-gray-100 rounded-full p-1 gap-2.5">
                              <button 
                                onClick={() => updateCartQuantity(item.cartItemId, -1)}
                                className="w-5 h-5 rounded-full bg-white border border-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-100"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="text-xs font-black text-gray-900">{item.quantity}</span>
                              <button 
                                onClick={() => updateCartQuantity(item.cartItemId, 1)}
                                className="w-5 h-5 rounded-full bg-white border border-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-100"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Checkout step: Order Type Selector */}
                  <div className="glass-card rounded-2xl p-3">
                    <h3 className="text-xs font-black text-gray-800 uppercase mb-2.5">{t.checkout}</h3>
                    <div className="grid grid-cols-2 gap-2 bg-gray-50 p-1 border border-gray-100 rounded-xl">
                      <button 
                        onClick={() => setCheckoutType('delivery')}
                        className={`text-xs py-2 rounded-lg font-black transition-all ${checkoutType === 'delivery' ? 'bg-primary text-white shadow-sm' : 'text-gray-500'}`}
                      >
                        {t.delivery}
                      </button>
                      <button 
                        onClick={() => setCheckoutType('pickup')}
                        className={`text-xs py-2 rounded-lg font-black transition-all ${checkoutType === 'pickup' ? 'bg-primary text-white shadow-sm' : 'text-gray-500'}`}
                      >
                        {t.pickup}
                      </button>
                    </div>

                    {/* Minimum order check warning */}
                    {checkoutType === 'delivery' && selectedBranch && cartTotal < selectedBranch.minDeliveryOrder && (
                      <div className="mt-2.5 p-2 bg-red-50 text-red-800 text-[10px] rounded-lg border border-red-100 font-medium flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                        <span>{t.min_order_warning} {selectedBranch.minDeliveryOrder} {t.sar} ({isRTL ? 'ينقصك' : 'need'} {Number((selectedBranch.minDeliveryOrder - cartTotal).toFixed(2))} {t.sar})</span>
                      </div>
                    )}
                  </div>

                  {/* Delivery Location selector block */}
                  {checkoutType === 'delivery' && (
                    <div className="glass-card rounded-2xl p-3">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xs font-black text-gray-800">{t.address}</h3>
                        <button 
                          onClick={() => setIsAddressFormOpen(true)}
                          className="text-[10px] font-black text-secondary flex items-center gap-0.5"
                        >
                          + {t.add_address}
                        </button>
                      </div>

                      {addresses.length === 0 ? (
                        <p className="text-[10px] text-red-500 font-bold py-1">{isRTL ? 'الرجاء إضافة عنوان لإتمام التوصيل.' : 'Please add a saved address to complete delivery.'}</p>
                      ) : (
                        <div className="space-y-1.5 max-h-[110px] overflow-y-auto">
                          {addresses.map(addr => (
                            <div 
                              key={addr.id}
                              onClick={() => setSelectedAddressId(addr.id)}
                              className={`p-2 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${selectedAddressId === addr.id ? 'border-primary bg-primary/5' : 'border-gray-100 bg-white hover:bg-gray-50'}`}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full ${selectedAddressId === addr.id ? 'bg-primary' : 'bg-gray-300'}`}></div>
                                <div>
                                  <p className="text-xs font-bold text-gray-900 leading-tight">{addr.label}</p>
                                  <p className="text-[9px] text-gray-400 mt-0.5 max-w-[210px] truncate leading-none">{addr.description} • {addr.nationalShortAddress}</p>
                                </div>
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteAddress(addr.id);
                                }}
                                className="text-gray-300 hover:text-red-500 text-[10px] px-1 font-bold"
                              >
                                {isRTL ? 'حذف' : 'Del'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Coupon Codes Input */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-3">
                    <h3 className="text-xs font-black text-gray-800 mb-1.5">{t.apply_coupon}</h3>
                    <div className="flex gap-2">
                      <input 
                        type="text"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value)}
                        placeholder="e.g., SPICY15 (15% off)"
                        className="flex-1 text-xs border border-gray-100 rounded-lg px-2.5 py-1.5 outline-none focus:border-primary/50 text-gray-800 uppercase"
                      />
                      <button 
                        onClick={handleApplyCouponCode}
                        className="bg-primary/10 text-primary border border-primary/20 text-xs font-black px-4 rounded-lg hover:bg-primary hover:text-white transition-all"
                      >
                        {isRTL ? 'تطبيق' : 'Apply'}
                      </button>
                    </div>
                    {couponMsg.text && (
                      <p className={`text-[10px] font-bold mt-1.5 ${couponMsg.isError ? 'text-red-500' : 'text-green-600'}`}>
                        {couponMsg.text}
                      </p>
                    )}
                  </div>

                  {/* Phase 11 Customer Loyalty Rewards Card */}
                  {loyaltySettings?.isEnabled && currentUser.role === 'customer' && (
                    <div className="bg-purple-50/50 rounded-2xl border border-purple-100/60 p-3 space-y-2.5 animate-fade-in">
                      <div className="flex items-center gap-1.5 text-xs font-black text-purple-800">
                        <span className="text-sm">🌟</span>
                        <span>{isRTL ? 'برنامج مكافآت زبائننا' : 'Loyalty Rewards Program'}</span>
                      </div>
                      
                      <div className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-purple-100/30">
                        <div>
                          <span className="text-[9px] font-bold text-gray-400 block uppercase">{isRTL ? 'رصيد نقاطك المتوفرة' : 'Available Point Balance'}</span>
                          <span className="text-sm font-black text-purple-950">{currentUser.loyaltyPoints || 0} {isRTL ? 'نقطة' : 'points'}</span>
                          <span className="text-[8.5px] text-gray-400 block mt-0.5">
                            (= {((currentUser.loyaltyPoints || 0) * (loyaltySettings.discountPerPoint || 0.1)).toFixed(2)} {t.sar})
                          </span>
                        </div>

                        {(() => {
                          const perPoint = loyaltySettings.discountPerPoint || 0.1;
                          const balance = currentUser.loyaltyPoints || 0;
                          const preLoyaltyTotal = Math.max(0, cartTotal + (checkoutType === 'delivery' && selectedBranch ? selectedBranch.deliveryFee : 0) - discountAmount);
                          // Cap the staged redemption at the balance and the order value,
                          // then require it to clear the configured minimum so a small
                          // order cannot bypass the "Min Points to Redeem" setting.
                          const redeemable = Math.min(balance, Math.floor(preLoyaltyTotal / perPoint));
                          const canRedeem = redeemable >= loyaltySettings.minPointsToRedeem;

                          // A staged redemption can always be cancelled, even if the cart
                          // later shrinks below the threshold.
                          if (loyaltyPointsRedeemed > 0) {
                            return (
                              <div className="flex flex-col items-end gap-1">
                                <button
                                  onClick={() => setLoyaltyPointsRedeemed(0)}
                                  className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 text-[9px] font-black py-1 px-2.5 rounded-lg transition-all"
                                >
                                  {isRTL ? 'إلغاء الخصم' : 'Cancel Discount'}
                                </button>
                              </div>
                            );
                          }

                          if (canRedeem) {
                            return (
                              <div className="flex flex-col items-end gap-1">
                                <button
                                  onClick={() => setLoyaltyPointsRedeemed(redeemable)}
                                  className="bg-purple-600 text-white hover:bg-purple-700 text-[9px] font-black py-1 px-2.5 rounded-lg transition-all"
                                >
                                  {isRTL ? 'استبدال النقاط' : 'Redeem Points'}
                                </button>
                              </div>
                            );
                          }

                          const belowBalance = balance < loyaltySettings.minPointsToRedeem;
                          return (
                            <span className="text-[8px] bg-amber-50 text-amber-800 border border-amber-200/40 p-1.5 rounded-lg font-bold max-w-[150px] leading-tight text-center">
                              {belowBalance
                                ? (isRTL
                                    ? `يلزمك ${loyaltySettings.minPointsToRedeem} نقطة على الأقل للاستبدال`
                                    : `Min ${loyaltySettings.minPointsToRedeem} points needed to redeem`)
                                : (isRTL
                                    ? `قيمة الطلب صغيرة جداً لاستبدال ${loyaltySettings.minPointsToRedeem} نقطة`
                                    : `Order too small to redeem ${loyaltySettings.minPointsToRedeem} points`)}
                            </span>
                          );
                        })()}
                      </div>

                      {loyaltyPointsRedeemed > 0 && (
                        <p className="text-[9px] text-purple-600 font-extrabold flex items-center gap-1">
                          ✨ {isRTL ? `مستعد لخصم ${loyaltyPointsRedeemed} نقطة بخصم مالي ${loyaltyDiscountAmount} ر.س!` : `Ready to deduct ${loyaltyPointsRedeemed} points for ${loyaltyDiscountAmount} SAR off!`}
                        </p>
                      )}

                      {/* Display estimated earnings for this purchase */}
                      <div className="p-2 bg-[#422e87]/5 rounded-xl border border-purple-500/10 flex justify-between text-[9px]">
                        <span className="text-slate-500 font-medium">{isRTL ? 'نقاط مضمونة على هذا الطلب:' : 'Points you will earn on checkout:'}</span>
                        <span className="font-extrabold text-secondary">
                          +{Math.floor(Math.max(0, cartTotal + (checkoutType === 'delivery' && selectedBranch ? selectedBranch.deliveryFee : 0) - discountAmount - loyaltyDiscountAmount) * (loyaltySettings.pointsPerRiyal || 1))} {isRTL ? 'نقطة' : 'Points'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Pricing and VAT breakdown billing card */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-3 space-y-2">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{t.subtotal}</span>
                      <span className="font-bold">{cartTotal.toFixed(2)} {t.sar}</span>
                    </div>

                    {checkoutType === 'delivery' && selectedBranch && (
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{t.delivery_fee}</span>
                        <span className="font-bold">+{selectedBranch.deliveryFee.toFixed(2)} {t.sar}</span>
                      </div>
                    )}

                    {discountAmount > 0 && (
                      <div className="flex justify-between text-xs text-green-600 font-bold">
                        <span>{t.discount} {couponCode.toUpperCase() ? `(${couponCode.toUpperCase()})` : ''}</span>
                        <span>-{discountAmount.toFixed(2)} {t.sar}</span>
                      </div>
                    )}

                    {loyaltyDiscountAmount > 0 && (
                      <div className="flex justify-between text-xs text-purple-600 font-bold">
                        <span>{isRTL ? 'خصم نقاط الولاء' : 'Loyalty Discount'}</span>
                        <span>-{loyaltyDiscountAmount.toFixed(2)} {t.sar}</span>
                      </div>
                    )}

                    <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                      <div>
                        <span className="text-sm font-black text-gray-900">{t.total}</span>
                        <p className="text-[9px] text-gray-400 leading-none mt-0.5">{t.vat_label}</p>
                      </div>
                      <span className="text-base font-black text-secondary">
                        {Math.max(0, cartTotal + (checkoutType === 'delivery' && selectedBranch ? selectedBranch.deliveryFee : 0) - discountAmount - loyaltyDiscountAmount).toFixed(2)} {t.sar}
                      </span>
                    </div>

                    {/* Tax Breakdown Preview */}
                    <div className="bg-gray-50/50 p-2 rounded-lg text-[9px] text-gray-400 space-y-0.5">
                      <div className="flex justify-between">
                        <span>{isRTL ? 'المجموع غير شامل الضريبة:' : 'Subtotal Excl. VAT:'}</span>
                        <span>{getVATBreakdown(cartTotal + (checkoutType === 'delivery' && selectedBranch ? selectedBranch.deliveryFee : 0) - discountAmount - loyaltyDiscountAmount, brandSettings?.vatPercentage || 15).subtotalExcludingVat} {t.sar}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{isRTL ? `قيمة الضريبة (${brandSettings?.vatPercentage || 15}٪):` : `Saudi VAT portion (${brandSettings?.vatPercentage || 15}%):`}</span>
                        <span>{getVATBreakdown(cartTotal + (checkoutType === 'delivery' && selectedBranch ? selectedBranch.deliveryFee : 0) - discountAmount - loyaltyDiscountAmount, brandSettings?.vatPercentage || 15).vatAmount} {t.sar}</span>
                      </div>
                    </div>

                    <button 
                      onClick={handlePlaceOrderClick}
                      disabled={checkoutType === 'delivery' && selectedBranch && cartTotal < selectedBranch.minDeliveryOrder}
                      className={`w-full text-center text-xs font-black py-3 rounded-full shadow-sm mt-2 transition-all ${
                        checkoutType === 'delivery' && selectedBranch && cartTotal < selectedBranch.minDeliveryOrder
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-secondary text-white hover:bg-secondary/95 hover:scale-102'
                      }`}
                    >
                      {t.place_order}
                    </button>
                  </div>

                </div>
              )}
            </div>
          )}

          {/* TAB 3: WALLET & LOYALTY SYSTEM */}
          {activeTab === 'wallet' && <WalletScreen isLoggedIn={isLoggedIn} onNavigate={setActiveTab} onToast={setWalletToast} />}

          {/* TAB 4: CUSTOMER PROFILE / LOGIN VIEW */}
          {activeTab === 'profile' && (
            <div className="p-4 animate-fade-in pb-12">
              <h2 className="text-base font-black text-gray-900 mb-4">{t.profile}</h2>

              {!isLoggedIn ? (
                /* AUTHENTICATION LOGIN CARD FORM */
                <div className="glass-card rounded-2xl p-4 space-y-4">
                  <div className="text-center">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-2 text-primary">
                      <User className="w-6 h-6" />
                    </div>
                    <h3 className="text-sm font-black text-gray-950">{t.auth_title}</h3>
                    <p className="text-[10px] text-gray-400 mt-1">{t.auth_sub}</p>
                  </div>

                  <form onSubmit={handleAuthSubmit} className="space-y-3">
                    <div className="flex gap-2 p-1 bg-gray-50 border border-gray-100 rounded-xl">
                      <button 
                        type="button"
                        onClick={() => { setAuthType('phone'); setAuthStep('login'); }}
                        className={`flex-1 text-xs py-1.5 rounded-lg font-black transition-all ${authType === 'phone' ? 'bg-primary text-white' : 'text-gray-500'}`}
                      >
                        {t.phone_number}
                      </button>
                      <button 
                        type="button"
                        onClick={() => { setAuthType('email'); setAuthStep('login'); }}
                        className={`flex-1 text-xs py-1.5 rounded-lg font-black transition-all ${authType === 'email' ? 'bg-primary text-white' : 'text-gray-500'}`}
                      >
                        {t.email}
                      </button>
                    </div>

                    {authStep === 'login' ? (
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">{authType === 'phone' ? t.phone_number : t.email}</label>
                        {authType === 'phone' ? (
                          <input 
                            type="tel"
                            value={inputPhone}
                            onChange={(e) => setInputPhone(e.target.value)}
                            className="w-full text-xs border border-gray-100 bg-gray-50 rounded-lg p-2.5 outline-none focus:bg-white text-gray-800"
                            placeholder="+966 5X XXX XXXX"
                          />
                        ) : (
                          <input 
                            type="email"
                            value={inputEmail}
                            onChange={(e) => setInputEmail(e.target.value)}
                            className="w-full text-xs border border-gray-100 bg-gray-50 rounded-lg p-2.5 outline-none focus:bg-white text-gray-800"
                            placeholder="mohammed.ali@1sttaste.com"
                          />
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">{t.otp_title}</label>
                        <p className="text-[10px] text-gray-400 leading-tight mb-2">{t.otp_sub} <span className="font-bold text-primary">{authType === 'phone' ? inputPhone : inputEmail}</span></p>
                        <input 
                          type="text"
                          maxLength={4}
                          value={inputOtp}
                          onChange={(e) => setInputOtp(e.target.value)}
                          className="w-full text-center text-lg font-black tracking-widest border border-gray-100 bg-gray-50 rounded-lg p-2 outline-none focus:bg-white text-gray-800"
                          placeholder="••••"
                        />
                        <span className="block text-[9px] text-secondary font-semibold text-center pt-1">{t.test_otp_help}</span>
                      </div>
                    )}

                    {authError && <p className="text-[10px] text-red-500 font-bold">{authError}</p>}

                    <button 
                      type="submit"
                      className="w-full text-center bg-secondary text-white text-xs font-black py-2.5 rounded-full shadow-xs hover:bg-secondary/95 transition-colors"
                    >
                      {authStep === 'login' ? t.login_btn : t.verify_btn}
                    </button>
                  </form>
                </div>
              ) : (
                /* LOGGED IN ACCOUNT PAGE */
                <div className="space-y-4">
                  {/* Customer Badge card */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4 flex items-center gap-3">
                    <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center font-black text-white text-lg">
                      M
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-gray-950">{currentUser.fullName}</h3>
                      <p className="text-[10px] text-gray-400 leading-tight">{currentUser.phoneNumber} • {currentUser.email}</p>
                      <span className="inline-block text-[8px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-black mt-1 uppercase">
                        {isRTL ? 'حساب زبون نشط' : 'Active Customer Account'}
                      </span>
                    </div>
                  </div>

                  {/* Order History (My Orders) Inside Profile/Account */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4 space-y-3">
                    <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                      <ClipboardList className="w-4 h-4 text-primary" />
                      <span>{isRTL ? 'طلباتي السابقة' : 'My Order History'}</span>
                    </h3>

                    {orders.filter(o => o.customerId === currentUser.id).length === 0 ? (
                      <p className="text-[10px] text-gray-400 text-center py-4">
                        {isRTL ? 'لا توجد طلبات سابقة بعد!' : 'No orders placed yet!'}
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                        {orders
                          .filter(o => o.customerId === currentUser.id)
                          .map(order => (
                            <div 
                              key={order.id}
                              onClick={() => setActiveOrderReceipt(order)}
                              className="p-3 bg-slate-50/75 hover:bg-purple-50/30 border border-gray-100 hover:border-purple-200 rounded-xl cursor-pointer flex justify-between items-center transition-all"
                            >
                              <div className="space-y-0.5">
                                <span className="text-[10px] font-black text-gray-800 block">
                                  {order.orderNumber}
                                </span>
                                <span className="text-[8.5px] text-gray-400 block">
                                  {formatRiyadhDateTime(order.createdAt)}
                                </span>
                                <span className="text-[9.5px] font-extrabold text-secondary block mt-0.5">
                                  {order.total.toFixed(2)} {t.sar}
                                </span>
                              </div>
                              <span className={`text-[8.5px] font-black px-2 py-0.5 rounded-full uppercase ${
                                order.status === 'delivered' 
                                  ? 'bg-green-100 text-green-700'
                                  : order.status === 'received'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-yellow-100 text-yellow-700'
                              }`}>
                                {order.status}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Saved addresses CRUD in profile */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider">{t.address}</h3>
                      <button 
                        onClick={() => setIsAddressFormOpen(true)}
                        className="text-[10px] text-secondary font-black"
                      >
                        + {t.add_address}
                      </button>
                    </div>

                    <div className="space-y-2">
                      {addresses.map(addr => (
                        <div key={addr.id} className="p-2.5 bg-gray-50/50 border border-gray-100 rounded-xl flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-bold text-gray-950">{addr.label}</span>
                              {addr.isDefault && <span className="text-[8px] bg-primary/10 text-primary px-1.5 rounded font-black">{isRTL ? 'الأساسي' : 'Default'}</span>}
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{addr.description}</p>
                            <p className="text-[9px] font-bold text-primary mt-0.5">{t.short_code}: {addr.nationalShortAddress}</p>
                          </div>
                          <button 
                            onClick={() => deleteAddress(addr.id)}
                            className="text-gray-300 hover:text-red-500 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Logout trigger */}
                  <button 
                    onClick={() => setIsLoggedIn(false)}
                    className="w-full text-center bg-gray-50 border border-gray-100 hover:bg-red-50 hover:text-red-600 text-xs font-bold py-2.5 rounded-full transition-colors text-gray-500"
                  >
                    {isRTL ? 'تسجيل الخروج' : 'Log Out Account'}
                  </button>
                </div>
              )}
            </div>
          )}

        </div>

        {/* BOTTOM NAVIGATION SHELL */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-100 flex items-center justify-around px-2 z-40">
          <button 
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center gap-0.5 transition-colors ${activeTab === 'home' ? 'text-primary' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Map className="w-5 h-5" />
            <span className="text-[9px] font-bold">{isRTL ? 'المنيو' : 'Menu'}</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('cart')}
            className={`flex flex-col items-center gap-0.5 relative transition-colors ${activeTab === 'cart' ? 'text-primary' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <div className="relative">
              <ShoppingBag className="w-5 h-5" />
              {cartCount > 0 && (
                <span className={`absolute -top-1.5 -right-2 bg-secondary text-white text-[8px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center border border-white`}>
                  {cartCount}
                </span>
              )}
            </div>
            <span className="text-[9px] font-bold">{isRTL ? 'السلة' : 'Cart'}</span>
          </button>

          <button 
            onClick={() => setActiveTab('wallet')}
            className={`flex flex-col items-center gap-0.5 transition-colors ${activeTab === 'wallet' ? 'text-primary' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Wallet className="w-5 h-5" />
            <span className="text-[9px] font-bold">{isRTL ? 'المحفظة' : 'Wallet'}</span>
          </button>

          <button 
            onClick={() => setActiveTab('profile')}
            className={`flex flex-col items-center gap-0.5 transition-colors ${activeTab === 'profile' ? 'text-primary' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <User className="w-5 h-5" />
            <span className="text-[9px] font-bold">{isRTL ? 'حسابي' : 'Account'}</span>
          </button>
        </div>

        {/* Dynamic Safe Area / Home Indicator bar */}
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-32 h-1 bg-gray-900 rounded-full z-50"></div>

        {/* GLOBAL RECEIPT MODAL OVERLAY */}
        {activeOrderReceipt && (
          <div className="absolute inset-0 bg-black/60 z-[110] flex items-end justify-center animate-fade-in">
            <div className="bg-white w-full max-h-[85%] rounded-t-3xl overflow-y-auto shadow-2xl flex flex-col pb-6">
              
              {/* Header */}
              <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div>
                  <h3 className="text-sm font-black text-gray-900">{isRTL ? 'تفاصيل الفاتورة الإلكترونية' : 'E-Invoice Receipt Details'}</h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">{isRTL ? 'متوافق مع هيئة الزكاة والضريبة والجمارك' : 'ZATCA Simplified Tax Invoice Compliant'}</p>
                </div>
                <button 
                  onClick={() => setActiveOrderReceipt(null)}
                  className="w-7 h-7 rounded-full bg-white border border-gray-100 flex items-center justify-center font-bold text-gray-500 hover:bg-gray-100 transition-colors text-xs font-black"
                >
                  ✕
                </button>
              </div>

              {/* Detailed Invoice Receipt Component */}
              <div className="p-4 space-y-4">
                <div className="bg-slate-50 rounded-2xl p-4 relative space-y-3 border border-gray-100 text-left">
                  <div className="absolute top-0 right-1/2 translate-x-1/2 w-4 h-4 bg-white rounded-full -mt-2 border-b border-slate-100"></div>
                  
                  {/* Stamp Header */}
                  <div className="text-center pb-2 border-b border-dashed border-slate-200">
                    <div className="inline-block bg-green-100 text-green-800 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full mb-1">
                      {activeOrderReceipt.status.toUpperCase()}
                    </div>
                    <h3 className="text-[10px] font-extrabold text-gray-400 mt-1 uppercase tracking-wider">{t.invoice}</h3>
                    <p className="text-xs font-black text-primary tracking-wide mt-0.5">{activeOrderReceipt.orderNumber}</p>
                    <p className="text-[9.5px] text-gray-400 mt-0.5">
                      {formatRiyadhDateTime(activeOrderReceipt.createdAt)}
                    </p>
                  </div>

                  {/* Metadata fields */}
                  <div className="space-y-1.5 text-xs text-gray-600 pb-2 border-b border-slate-200">
                    <div className="flex justify-between">
                      <span className="text-gray-400">{isRTL ? 'العميل:' : 'Customer:'}</span>
                      <span className="font-bold text-gray-800">{activeOrderReceipt.customerName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">{isRTL ? 'رقم الجوال:' : 'Phone:'}</span>
                      <span className="font-bold text-gray-800">{activeOrderReceipt.customerPhone}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">{isRTL ? 'نوع الطلب:' : 'Order Type:'}</span>
                      <span className="font-bold text-primary">{activeOrderReceipt.orderType === 'delivery' ? t.delivery : t.pickup}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">{isRTL ? 'الفرع المخدم:' : 'Branch:'}</span>
                      <span className="font-bold text-gray-800">{isRTL ? activeOrderReceipt.branchNameAr : activeOrderReceipt.branchNameEn}</span>
                    </div>
                    {activeOrderReceipt.address && (
                      <div className="flex flex-col pt-1 border-t border-slate-100 mt-1">
                        <span className="text-[10px] text-gray-400 mb-0.5">{isRTL ? 'عنوان التوصيل:' : 'Delivery Address:'}</span>
                        <span className="text-[10.5px] font-semibold text-gray-700 leading-tight bg-white p-1.5 rounded-lg border border-slate-100">
                          {activeOrderReceipt.address.label} • {activeOrderReceipt.address.description}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Items List */}
                  <div className="space-y-2 py-1">
                    {activeOrderReceipt.items.map((item: any) => (
                      <div key={item.id} className="flex justify-between text-xs text-gray-800">
                        <div>
                          <div className="flex items-center gap-1">
                            <span className="font-black text-primary">{item.quantity}x</span>
                            <span className="font-semibold text-gray-900">{isRTL ? item.nameAr : item.nameEn}</span>
                          </div>
                          {item.selectedModifiers.length > 0 && (
                            <p className="text-[9px] text-gray-400 pl-4 mt-0.5 leading-none">
                              + {item.selectedModifiers.map((m: any) => isRTL ? m.nameAr : m.nameEn).join(', ')}
                            </p>
                          )}
                        </div>
                        <span className="font-black text-gray-900">{(item.price * item.quantity).toFixed(2)} {t.sar}</span>
                      </div>
                    ))}
                  </div>

                  {/* Invoice Totals */}
                  <div className="pt-2.5 border-t border-dashed border-slate-200 space-y-1.5 text-xs text-gray-600">
                    <div className="flex justify-between">
                      <span>{t.subtotal}</span>
                      <span>{activeOrderReceipt.subtotal.toFixed(2)} {t.sar}</span>
                    </div>
                    {activeOrderReceipt.deliveryFee > 0 && (
                      <div className="flex justify-between">
                        <span>{t.delivery_fee}</span>
                        <span>+{activeOrderReceipt.deliveryFee.toFixed(2)} {t.sar}</span>
                      </div>
                    )}
                    {(activeOrderReceipt.discountAmount ?? 0) > 0 && (
                      <div className="flex justify-between text-emerald-600">
                        <span>{isRTL ? 'خصم القسيمة' : 'Coupon Discount'}</span>
                        <span>-{(activeOrderReceipt.discountAmount ?? 0).toFixed(2)} {t.sar}</span>
                      </div>
                    )}
                    {(activeOrderReceipt.loyaltyDiscountAmount ?? 0) > 0 && (
                      <div className="flex justify-between text-purple-600">
                        <span>{isRTL ? 'خصم نقاط الولاء' : 'Loyalty Discount'}</span>
                        <span>-{(activeOrderReceipt.loyaltyDiscountAmount ?? 0).toFixed(2)} {t.sar}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm font-black text-gray-900">
                      <div>
                        <span>{t.total}</span>
                        <p className="text-[8px] text-gray-400 font-normal leading-none mt-0.5">{t.vat_label}</p>
                      </div>
                      <span className="text-base font-black text-secondary">{activeOrderReceipt.total.toFixed(2)} {t.sar}</span>
                    </div>

                    {/* VAT extraction info strictly required in Saudi e-invoicing */}
                    <div className="bg-white p-2 rounded-lg text-[9.5px] text-gray-400 space-y-0.5 mt-2 border border-slate-100">
                      <div className="flex justify-between">
                        <span>{isRTL ? 'المبلغ الخاضع للضريبة:' : 'Amount Excl. VAT:'}</span>
                        <span>{getVATBreakdown(activeOrderReceipt.total, brandSettings?.vatPercentage || 15).subtotalExcludingVat} {t.sar}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{isRTL ? `ضريبة القيمة المضافة (${brandSettings?.vatPercentage || 15}٪):` : `Saudi VAT portion (${brandSettings?.vatPercentage || 15}%):`}</span>
                        <span>{getVATBreakdown(activeOrderReceipt.total, brandSettings?.vatPercentage || 15).vatAmount} {t.sar}</span>
                      </div>
                      <div className="flex justify-between items-center pt-1 border-t border-slate-100 mt-1 text-[8.5px] font-bold text-gray-400">
                        <span>{t.sync_status}:</span>
                        <span className={`px-1.5 py-0.5 rounded-full ${activeOrderReceipt.orderSyncStatus === 'synced' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {t[activeOrderReceipt.orderSyncStatus]}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setActiveOrderReceipt(null)}
                  className="w-full text-center bg-primary text-white text-xs font-black py-2.5 rounded-xl mt-3 shadow-md"
                >
                  {isRTL ? 'إغلاق التفاصيل' : 'Close Receipt'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 1: BRANCH SELECTION DRAWER */}
        {isBranchModalOpen && (
          <div className="absolute inset-0 bg-black/60 z-50 flex items-end justify-center animate-fade-in">
            <div className="bg-white w-full max-h-[75%] rounded-t-3xl overflow-hidden shadow-2xl flex flex-col pb-6">
              
              {/* Header bar */}
              <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div>
                  <h3 className="text-sm font-black text-gray-900">{t.select_branch}</h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">{isRTL ? 'مرتبة بحسب الأقرب إلى موقعك الحالي' : 'Sorted by distance from your current location'}</p>
                </div>
                <button 
                  onClick={() => setIsBranchModalOpen(false)}
                  className="w-7 h-7 rounded-full bg-white border border-gray-100 flex items-center justify-center font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Branch listing list */}
              <div className="p-4 overflow-y-auto space-y-3 flex-1">
                {branches.map(branch => {
                  const distance = calculateDistance(userLat, userLng, branch.latitude, branch.longitude);
                  return (
                    <div 
                      key={branch.id}
                      onClick={() => {
                        if (branch.isActive) {
                          setSelectedBranch(branch);
                          setIsBranchModalOpen(false);
                        }
                      }}
                      className={`p-3 border rounded-2xl transition-all cursor-pointer ${
                        !branch.isActive
                          ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                          : selectedBranch?.id === branch.id
                          ? 'border-primary bg-primary/5 shadow-xs'
                          : 'border-gray-100 bg-white hover:bg-gray-50 hover:border-gray-200'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-black text-gray-950">{isRTL ? branch.nameAr : branch.nameEn}</h4>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded font-black uppercase ${branch.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {branch.isActive ? t.open : t.closed}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{isRTL ? branch.addressAr : branch.addressEn}</p>
                          <p className="text-[10px] text-gray-500 font-bold mt-1.5 flex items-center gap-1">
                            <Phone className="w-3 h-3 text-secondary" /> {branch.phone}
                          </p>
                        </div>
                        
                        <div className="text-right">
                          <span className="text-[10px] bg-secondary/10 text-secondary font-black px-2 py-0.5 rounded-full">
                            {distance} km
                          </span>
                          <p className="text-[9px] text-gray-400 mt-2">{isRTL ? 'الحد الأدنى:' : 'Min order:'} {branch.minDeliveryOrder} {t.sar}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        )}

        {/* MODAL 2: PRODUCT CUSTOMIZATION DRAWER SHEET */}
        {customizingProduct && (
          <div className="absolute inset-0 bg-black/60 z-50 flex items-end justify-center animate-fade-in">
            <div className="bg-white w-full max-h-[85%] rounded-t-3xl overflow-hidden shadow-2xl flex flex-col">
              
              {/* Header section */}
              <div className="relative h-[150px] bg-gray-50">
                <img 
                  src={customizingProduct.imageUrl} 
                  alt={customizingProduct.nameEn}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-3 right-3 left-3 flex justify-between items-center z-10">
                  <span className="bg-black/60 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                    {customizingProduct.calories} {t.calories}
                  </span>
                  <button 
                    onClick={() => setCustomizingProduct(null)}
                    className="w-8 h-8 rounded-full bg-white/95 flex items-center justify-center font-bold text-gray-700 hover:bg-white transition-colors"
                  >
                    ✕
                  </button>
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-4 flex flex-col justify-end">
                  <h3 className="text-white text-base font-black leading-tight">
                    {isRTL ? customizingProduct.nameAr : customizingProduct.nameEn}
                  </h3>
                  <p className="text-white/80 text-[10px] leading-tight line-clamp-2 mt-0.5">
                    {isRTL ? customizingProduct.descriptionAr : customizingProduct.descriptionEn}
                  </p>
                </div>
              </div>

              {/* Modifier options content scroll area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {customizingProduct.modifierGroupIds.map(mgId => {
                  const group = modifierGroups.find(g => g.id === mgId);
                  if (!group) return null;
                  const selections = selectedModifiers[group.id] || [];
                  const isRequired = group.isRequired;
                  const maxLimit = group.maxSelection;

                  return (
                    <div key={group.id} className="bg-gray-50/50 border border-gray-100 rounded-2xl p-3">
                      <div className="flex justify-between items-center mb-2.5">
                        <div>
                          <h4 className="text-xs font-black text-gray-900">{isRTL ? group.nameAr : group.nameEn}</h4>
                          <p className="text-[9px] text-gray-400 mt-0.5">
                            {maxLimit === 1 
                              ? (isRTL ? 'اختر خيار واحد فقط' : 'Select only 1 option') 
                              : (isRTL ? `اختر حتى ${maxLimit} إضافات` : `Select up to ${maxLimit} options`)}
                          </p>
                        </div>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${isRequired ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                          {isRequired ? t.required : t.optional}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {group.modifiers.map(mod => {
                          const isChecked = selections.some(m => m.id === mod.id);
                          return (
                            <div 
                              key={mod.id}
                              onClick={() => handleModifierToggle(group, mod)}
                              className={`p-2 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                                isChecked 
                                  ? 'border-primary bg-primary/5 font-semibold text-primary' 
                                  : 'border-gray-100 bg-white hover:bg-gray-50/80 text-gray-700'
                              }`}
                            >
                              <span className="text-xs">{isRTL ? mod.nameAr : mod.nameEn}</span>
                              <div className="flex items-center gap-1.5">
                                {mod.price > 0 && (
                                  <span className="text-[10px] text-secondary font-black bg-secondary/10 px-2 py-0.5 rounded-full">
                                    +{mod.price.toFixed(2)} {t.sar}
                                  </span>
                                )}
                                {mod.price < 0 && (
                                  <span className="text-[10px] text-green-600 font-black bg-green-50 px-2 py-0.5 rounded-full">
                                    {mod.price.toFixed(2)} {t.sar}
                                  </span>
                                )}
                                <div className={`w-4 h-4 rounded flex items-center justify-center border ${isChecked ? 'bg-primary border-primary text-white' : 'border-gray-200'}`}>
                                  {isChecked && <Check className="w-3 h-3" />}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add to Cart checkout control bar */}
              <div className="p-4 border-t border-gray-100 flex items-center justify-between gap-4 bg-white">
                
                {/* Quantity adjuster */}
                <div className="flex items-center bg-gray-50 border border-gray-100 rounded-full p-1 gap-2.5">
                  <button 
                    onClick={() => setCustomizationQty(prev => Math.max(1, prev - 1))}
                    className="w-7 h-7 rounded-full bg-white border border-gray-100 flex items-center justify-center text-gray-600"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-sm font-black text-gray-950 w-4 text-center">{customizationQty}</span>
                  <button 
                    onClick={() => setCustomizationQty(prev => prev + 1)}
                    className="w-7 h-7 rounded-full bg-white border border-gray-100 flex items-center justify-center text-gray-600"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Confirm Add action */}
                <button 
                  onClick={handleAddProductToCart}
                  disabled={!canAddToCart()}
                  className={`flex-1 text-center text-xs font-black py-3 rounded-full shadow-sm transition-all flex items-center justify-center gap-1.5 ${
                    canAddToCart() 
                      ? 'bg-secondary text-white hover:bg-secondary/95' 
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <span>{t.add_to_cart}</span>
                  <span className="border-l border-white/30 pl-1.5">
                    {(() => {
                      let price = customizingProduct.price;
                      (Object.values(selectedModifiers) as Modifier[][]).forEach(list => {
                        list.forEach(m => { price += m.price; });
                      });
                      return (price * customizationQty).toFixed(2);
                    })()} {t.sar}
                  </span>
                </button>
              </div>

            </div>
          </div>
        )}

        {/* MODAL 3: SAUDI ADDRESS FORM DRAWER */}
        {isAddressFormOpen && (
          <div className="absolute inset-0 bg-black/60 z-50 flex items-end justify-center animate-fade-in">
            <div className="bg-white w-full rounded-t-3xl overflow-hidden shadow-2xl p-4 space-y-4 pb-6">
              <div className="flex justify-between items-center border-b border-gray-100 pb-2.5">
                <h3 className="text-sm font-black text-gray-900">{t.add_address}</h3>
                <button 
                  onClick={() => setIsAddressFormOpen(false)}
                  className="text-gray-400 font-bold hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveAddress} className="space-y-3.5">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">{t.address_label}</label>
                  <input 
                    type="text"
                    required
                    value={addrLabel}
                    onChange={(e) => setAddrLabel(e.target.value)}
                    placeholder="e.g., Home, Work, My Office"
                    className="w-full text-xs border border-gray-100 bg-gray-50 rounded-lg p-2.5 outline-none focus:bg-white text-gray-800"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">{t.address_desc}</label>
                  <input 
                    type="text"
                    required
                    value={addrDesc}
                    onChange={(e) => setAddrDesc(e.target.value)}
                    placeholder="e.g., King Fahd Rd, Exit 5, Apt 12"
                    className="w-full text-xs border border-gray-100 bg-gray-50 rounded-lg p-2.5 outline-none focus:bg-white text-gray-800"
                  />
                </div>

                <div>
                  <div className="flex justify-between">
                    <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">{t.short_code}</label>
                    <span className="text-[8px] text-secondary font-semibold">{t.short_code_help}</span>
                  </div>
                  <input 
                    type="text"
                    required
                    maxLength={8}
                    value={addrShort}
                    onChange={(e) => setAddrShort(e.target.value)}
                    placeholder="e.g., RRBB4321"
                    className="w-full text-xs border border-gray-100 bg-gray-50 rounded-lg p-2.5 outline-none focus:bg-white text-gray-800 uppercase"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">Latitude</label>
                    <input 
                      type="text"
                      value={addrLat}
                      onChange={(e) => setAddrLat(e.target.value)}
                      className="w-full text-xs border border-gray-100 bg-gray-50 rounded-lg p-2 outline-none text-gray-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">Longitude</label>
                    <input 
                      type="text"
                      value={addrLng}
                      onChange={(e) => setAddrLng(e.target.value)}
                      className="w-full text-xs border border-gray-100 bg-gray-50 rounded-lg p-2 outline-none text-gray-800"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full text-center bg-secondary text-white text-xs font-black py-2.5 rounded-full shadow-xs hover:bg-secondary/95 transition-colors"
                >
                  {t.save}
                </button>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
