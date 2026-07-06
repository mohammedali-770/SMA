/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin, ShoppingBag, User,
  Plus, Minus, Check, Globe,
  Sparkles, Phone, Map, Wallet
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Product, ModifierGroup, Modifier, SavedAddress, CartItem } from '../types';
import { calculateDistance, getVATBreakdown, formatRiyadhDateTime } from '../utils/calculations';
import { LOCALES } from './mobile/mobileLocales';
import { WalletScreen } from './mobile/WalletScreen';
import { HomeScreen } from './mobile/HomeScreen';
import { CartScreen } from './mobile/CartScreen';
import { ProfileScreen } from './mobile/ProfileScreen';


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

  // New Address form states
  const [addrLabel, setAddrLabel] = useState('');
  const [addrDesc, setAddrDesc] = useState('');
  const [addrShort, setAddrShort] = useState('');
  const [addrLat, setAddrLat] = useState('24.7136');
  const [addrLng, setAddrLng] = useState('46.6753');

  // Coupon state

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

  // Place Order Action


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
          {activeTab === 'cart' && <CartScreen isLoggedIn={isLoggedIn} onNavigate={setActiveTab} onShowReceipt={setActiveOrderReceipt} onOpenAddressForm={() => setIsAddressFormOpen(true)} />}

          {/* TAB 3: WALLET & LOYALTY SYSTEM */}
          {activeTab === 'wallet' && <WalletScreen isLoggedIn={isLoggedIn} onNavigate={setActiveTab} onToast={setWalletToast} />}

          {/* TAB 4: CUSTOMER PROFILE / LOGIN VIEW */}
          {activeTab === 'profile' && <ProfileScreen isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn} onShowReceipt={setActiveOrderReceipt} onOpenAddressForm={() => setIsAddressFormOpen(true)} />}

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
