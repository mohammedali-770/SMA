/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, ShoppingBag, ClipboardList, User, ChevronRight, 
  Plus, Minus, Trash2, Check, ArrowRight, ArrowLeft, Globe, 
  Sparkles, AlertCircle, Phone, Info, Map, Wallet, Award, History, Gift, Coins
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Product, ModifierGroup, Modifier, SavedAddress, CartItem } from '../types';
import { calculateDistance, getVATBreakdown } from '../utils/calculations';

const LOCALES = {
  en: {
    welcome: 'Satisfy Your Cravings!',
    select_branch: 'Select Branch',
    nearest: 'Nearest',
    active_branch: 'Serving Branch',
    categories: 'Categories',
    add_to_cart: 'Add to Cart',
    cart: 'My Cart',
    checkout: 'Checkout',
    delivery: 'Delivery',
    pickup: 'Self-Pickup',
    place_order: 'Confirm & Order',
    order_success: 'Order Placed!',
    total: 'Total',
    subtotal: 'Subtotal',
    vat_label: 'Includes 15% Saudi VAT',
    calories: 'kcal',
    orders: 'Order History',
    profile: 'Profile',
    change_lang: 'العربية (Arabic)',
    address: 'Saved Addresses',
    add_address: 'Add New Address',
    short_code: 'National Short Code (e.g., RRBB1234)',
    short_code_help: 'Saudi National Address Short Code (4 letters + 4 numbers)',
    required: 'Required',
    optional: 'Optional',
    quantity: 'Quantity',
    min_order_warning: 'Min. delivery subtotal is',
    reorder: 'Reorder',
    status: 'Status',
    open: 'Open',
    closed: 'Closed',
    search_food: 'Search burgers, sides...',
    view_details: 'Customize & Add',
    delivery_fee: 'Delivery Fee',
    discount: 'Discount',
    apply_coupon: 'Apply Coupon',
    coupon_placeholder: 'Enter promo code',
    invalid_coupon: 'Invalid code',
    coupon_success: 'Discount Applied!',
    address_label: 'Address Label (Home, Work)',
    address_desc: 'Street, Building, Apartment',
    lat_lng: 'Mock Coordinates (lat, lng)',
    save: 'Save Address',
    empty_cart: 'Your cart is empty. Add some spicy items!',
    no_orders: 'No previous orders found.',
    spicy_badge: 'Spicy Fast-Food',
    sar: 'SAR',
    back_to_menu: 'Back to Menu',
    order_num: 'Order Number',
    sync_status: 'Lazywait Sync',
    not_synced: 'Queued',
    pending_sync: 'Syncing',
    synced: 'Synced to POS',
    payment: 'Payment',
    payment_pending: 'Pay on Delivery',
    payment_paid: 'Paid (Mada / Visa)',
    invoice: 'Tax Invoice',
    auth_title: 'Login to Spicy Meal',
    auth_sub: 'Enter your phone or email to checkout',
    phone_number: 'Phone Number',
    email: 'Email Address (Testing)',
    login_btn: 'Send OTP Code',
    otp_title: 'Enter Verification Code',
    otp_sub: 'We sent a 4-digit code to',
    verify_btn: 'Verify & Login',
    test_otp_help: 'Use test code: 1234',
    guest_btn: 'Continue as Guest',
    choose_spice: 'Choose your Spice Level',
    branch_min_order: 'Branch Minimum Order',
    pos_connected: 'Live POS Connection',
  },
  ar: {
    welcome: 'أشبع رغبتك في الطعم الحار!',
    select_branch: 'اختر الفرع لتحديد قائمة الطعام',
    nearest: 'الأقرب لك',
    active_branch: 'الفرع المخدم',
    categories: 'التصنيفات',
    add_to_cart: 'إضافة للسلة',
    cart: 'سلة المشتريات',
    checkout: 'الدفع والطلب',
    delivery: 'توصيل للمنزل',
    pickup: 'استلام من الفرع',
    place_order: 'تأكيد وإرسال الطلب',
    order_success: 'تم إرسال الطلب بنجاح!',
    total: 'المجموع الكلي',
    subtotal: 'المجموع الفرعي',
    vat_label: 'شامل ضريبة القيمة المضافة السعودية ١٥٪',
    calories: 'سعرة حرارية',
    orders: 'طلباتي السابقة',
    profile: 'الملف الشخصي',
    change_lang: 'English (الإنجليزية)',
    address: 'العناوين المحفوظة',
    add_address: 'إضافة عنوان جديد',
    short_code: 'رمز العنوان الوطني المختصر (مثال: RRBB1234)',
    short_code_help: 'العنوان الوطني السعودي (٤ أحرف + ٤ أرقام)',
    required: 'إجباري',
    optional: 'اختياري',
    quantity: 'الكمية',
    min_order_warning: 'الحد الأدنى لطلب التوصيل هو',
    reorder: 'إعادة الطلب',
    status: 'الحالة',
    open: 'مفتوح الآن',
    closed: 'مغلق مؤقتاً',
    search_food: 'ابحث عن برجر، مقبلات...',
    view_details: 'تخصيص وإضافة',
    delivery_fee: 'رسوم التوصيل',
    discount: 'الخصم',
    apply_coupon: 'تطبيق الكوبون',
    coupon_placeholder: 'أدخل رمز الخصم',
    invalid_coupon: 'الكوبون غير صحيح',
    coupon_success: 'تم تطبيق الخصم بنجاح!',
    address_label: 'اسم العنوان (المنزل، العمل)',
    address_desc: 'اسم الشارع، رقم المبنى، رقم الشقة',
    lat_lng: 'الإحداثيات (خط العرض، خط الطول)',
    save: 'حفظ العنوان',
    empty_cart: 'سلتك فارغة حالياً. أضف بعض الوجبات الشهية الحارة!',
    no_orders: 'لا توجد طلبات سابقة.',
    spicy_badge: 'الوجبات الحارة السريعة',
    sar: 'ر.س',
    back_to_menu: 'العودة للمنيو',
    order_num: 'رقم الطلب',
    sync_status: 'مزامنة نظام POS',
    not_synced: 'في الانتظار',
    pending_sync: 'جاري المزامنة',
    synced: 'تمت المزامنة بنجاح',
    payment: 'الدفع',
    payment_pending: 'الدفع عند الاستلام',
    payment_paid: 'مدفوع (مدى / فيزا)',
    invoice: 'فاتورة ضريبية مبسطة',
    auth_title: 'تسجيل الدخول إلى سبايسي ميل',
    auth_sub: 'أدخل رقم جوالك أو بريدك الإلكتروني لإتمام الطلب',
    phone_number: 'رقم الجوال',
    email: 'البريد الإلكتروني (للتجربة)',
    login_btn: 'إرسال رمز التحقق OTP',
    otp_title: 'أدخل رمز التحقق المرسل',
    otp_sub: 'أرسلنا رمز تحقق مكون من ٤ أرقام إلى',
    verify_btn: 'تحقق وتسجيل الدخول',
    test_otp_help: 'رمز التحقق التجريبي هو: 1234',
    guest_btn: 'المتابعة كزائر',
    choose_spice: 'اختر درجة الحرارة والبهارات',
    branch_min_order: 'الحد الأدنى للفرع',
    pos_connected: 'اتصال مباشر بالكاشير',
  }
};

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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);
  
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

  const [walletBalance, setWalletBalance] = useState<number>(() => {
    const saved = localStorage.getItem('sm_wallet_balance');
    return saved ? Number(saved) : 25.00;
  });
  const [walletToast, setWalletToast] = useState<string | null>(null);

  useEffect(() => {
    if (walletToast) {
      const timer = setTimeout(() => setWalletToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [walletToast]);

  const playNotificationSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (e) {
      // Ignore audio fail
    }
  };

  const handleConvertPoints = (ptsToDeduct: number, cashToAdd: number) => {
    if ((currentUser.loyaltyPoints || 0) < ptsToDeduct) return;
    const nextPoints = (currentUser.loyaltyPoints || 0) - ptsToDeduct;
    updateCustomerPoints(currentUser.id, nextPoints);
    const nextBalance = walletBalance + cashToAdd;
    setWalletBalance(nextBalance);
    localStorage.setItem('sm_wallet_balance', String(nextBalance));
    
    playNotificationSound();
    
    setWalletToast(mobileLang === 'en' 
      ? `🎉 Success! Converted ${ptsToDeduct} points to ${cashToAdd} SAR store credit!` 
      : `🎉 تم تحويل ${ptsToDeduct} نقطة إلى ${cashToAdd} ر.س رصيد في محفظتك!`
    );
  };

  const handleClaimVoucher = (reward: any) => {
    if ((currentUser.loyaltyPoints || 0) < reward.points) return;
    const nextPoints = (currentUser.loyaltyPoints || 0) - reward.points;
    updateCustomerPoints(currentUser.id, nextPoints);
    
    playNotificationSound();
    
    const voucherCode = `SM-VOU-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    setWalletToast(mobileLang === 'en'
      ? `🎁 Success! Generated code: [${voucherCode}] for ${reward.nameEn}!`
      : `🎁 تم توليد كود المكافأة: [${voucherCode}] لـ ${reward.nameAr}!`
    );
  };

  const getLoyaltyLedger = () => {
    const ledger = [
      {
        titleEn: 'Welcome Bonus Points',
        titleAr: 'نقاط ترحيبية من الإدارة',
        date: '2026-07-01 12:00',
        points: 350
      }
    ];

    orders.filter(o => o.customerId === currentUser.id).forEach(order => {
      const orderPts = Math.floor(order.total * (loyaltySettings.pointsPerRiyal || 1));
      if (orderPts > 0) {
        ledger.push({
          titleEn: `Earned on order ${order.orderNumber}`,
          titleAr: `نقاط مكتسبة من الطلب رقم ${order.orderNumber}`,
          date: new Date(order.createdAt).toISOString().replace('T', ' ').substring(0, 16),
          points: orderPts
        });
      }
    });

    return ledger;
  };

  useEffect(() => {
    const currentPoints = currentUser.loyaltyPoints || 0;
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

  // Auto scroll banners
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveBannerIndex(prev => (prev + 1) % 3);
    }, 4500);
    return () => clearInterval(timer);
  }, []);

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
      setSelectedModifiers(prev => ({
        ...prev,
        [group.id]: [modifier]
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
    if (result.success && result.orderId) {
      // Find the placed order
      const orderMatch = orders.find(o => o.id === result.orderId) || orders[0];
      setActiveOrderReceipt(orderMatch);
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

  // Filter products by search and category
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.nameAr.includes(searchQuery);
    const matchesCategory = selectedCategory === 'all' || p.categoryId === selectedCategory;
    const isAvailableInBranch = selectedBranch ? isProductAvailableInBranch(p.id, selectedBranch.id) : true;
    return matchesSearch && matchesCategory && p.isActive && isAvailableInBranch;
  });

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
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center font-black text-white text-lg tracking-wider">
              S
            </div>
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
          {activeTab === 'home' && (
            <div className="animate-fade-in">
              
              {/* Branch Selector Alert Header if none active */}
              {!selectedBranch && (
                <div className="m-3 p-3 bg-red-50 rounded-xl border border-red-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-800 font-bold">{t.select_branch}</p>
                  </div>
                  <button 
                    onClick={() => setIsBranchModalOpen(true)}
                    className="text-[10px] bg-red-600 text-white font-bold py-1 px-2.5 rounded-full"
                  >
                    {t.select_branch}
                  </button>
                </div>
              )}

              {/* Dynamic Banners Slider */}
              <div className="relative mx-4 mt-3 h-[130px] rounded-2xl overflow-hidden shadow-sm">
                <img 
                  src={activeBannerIndex === 0 
                    ? 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&h=400&q=80' 
                    : activeBannerIndex === 1
                    ? 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=600&h=400&q=80'
                    : 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=600&h=400&q=80'
                  } 
                  alt="spicy promotion banner" 
                  className="w-full h-full object-cover brightness-75"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 flex flex-col justify-end">
                  <div className="bg-secondary text-white text-[9px] font-black uppercase px-1.5 py-0.5 rounded self-start mb-1 tracking-widest">
                    PROMO HOT DEAL
                  </div>
                  <h3 className="text-white text-sm font-black tracking-tight line-clamp-1">
                    {isRTL 
                      ? (activeBannerIndex === 0 
                        ? 'ضعف الحرارة، ضعف النكهة الرائعة!' 
                        : activeBannerIndex === 1
                        ? 'برجر سموكي أنجوس البقري المدخن الفاخر!'
                        : 'جديد: ميلك شيك فراولة بنكهة دافئة مميزة')
                      : (activeBannerIndex === 0 
                        ? 'Double The Heat, Double The Flavor!' 
                        : activeBannerIndex === 1
                        ? 'Halal Bacon Smokey Angus Launch!'
                        : 'Spiced Strawberry Milkshakes')
                    }
                  </h3>
                </div>
                {/* Dots indicator */}
                <div className={`absolute bottom-2 ${isRTL ? 'left-3' : 'right-3'} flex gap-1 z-10`}>
                  {[0, 1, 2].map(i => (
                    <div 
                      key={i} 
                      className={`w-1.5 h-1.5 rounded-full transition-all ${i === activeBannerIndex ? 'bg-secondary w-3' : 'bg-white/50'}`}
                    ></div>
                  ))}
                </div>
              </div>

              {/* Welcome text & Search */}
              <div className="px-4 mt-4">
                <h2 className="text-base font-black text-gray-900">{t.welcome}</h2>
                {selectedBranch && (
                  <p className="text-[11px] text-gray-500 font-medium">
                    {t.active_branch}: <span className="font-bold text-primary">{isRTL ? selectedBranch.nameAr : selectedBranch.nameEn}</span>
                  </p>
                )}

                {/* Live Search bar */}
                <div className="mt-2.5 relative flex items-center">
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t.search_food}
                    className="glass-input w-full text-xs rounded-full py-2.5 px-4 outline-none text-slate-800"
                  />
                </div>
              </div>

              {/* Category Pills Slider */}
              <div className="mt-4 px-4">
                <h3 className="text-xs font-black text-gray-700 uppercase tracking-wider mb-2">{t.categories}</h3>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                  <button 
                    onClick={() => setSelectedCategory('all')}
                    className={`text-xs px-4 py-1.5 rounded-full font-bold whitespace-nowrap transition-colors ${selectedCategory === 'all' ? 'glass-btn-primary text-white shadow-sm' : 'glass-btn-outline'}`}
                  >
                    {isRTL ? 'الكل' : 'All Menu'}
                  </button>
                  {categories.map(cat => (
                    <button 
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`text-xs px-4 py-1.5 rounded-full font-bold whitespace-nowrap transition-colors ${selectedCategory === cat.id ? 'glass-btn-primary text-white shadow-sm' : 'glass-btn-outline'}`}
                    >
                      {isRTL ? cat.nameAr : cat.nameEn}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Menu Product Cards */}
              <div className="mt-3 px-4 grid grid-cols-2 gap-3 pb-8">
                {filteredProducts.map(product => (
                  <div 
                    key={product.id}
                    className="glass-card rounded-2xl overflow-hidden flex flex-col hover:shadow-md transition-all cursor-pointer"
                    onClick={() => setCustomizingProduct(product)}
                  >
                    <div className="relative h-[100px] w-full bg-gray-50">
                      <img 
                        src={product.imageUrl} 
                        alt={product.nameEn}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className={`absolute top-1.5 ${isRTL ? 'left-1.5' : 'right-1.5'} bg-black/65 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full`}>
                        {product.calories} {t.calories}
                      </div>
                    </div>
                    
                    <div className="p-2.5 flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-black text-gray-950 leading-tight line-clamp-1">
                          {isRTL ? product.nameAr : product.nameEn}
                        </h4>
                        <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-2 leading-snug">
                          {isRTL ? product.descriptionAr : product.descriptionEn}
                        </p>
                      </div>

                      <div className="mt-2.5 pt-1.5 border-t border-gray-50 flex items-center justify-between">
                        <span className="text-xs font-black text-secondary">
                          {product.price} {t.sar}
                        </span>
                        <div className="w-6 h-6 rounded-full bg-primary/10 hover:bg-primary text-primary hover:text-white flex items-center justify-center transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredProducts.length === 0 && (
                  <div className="col-span-2 py-8 flex flex-col items-center justify-center text-center">
                    <AlertCircle className="w-8 h-8 text-gray-300 mb-1" />
                    <p className="text-xs font-semibold text-gray-400">
                      {isRTL ? 'عذراً، لا توجد وجبات متاحة حالياً لتصنيفك أو فرعك المحدد.' : 'Sorry, no active products in this category for the selected branch.'}
                    </p>
                  </div>
                )}
              </div>

            </div>
          )}

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

                        {(currentUser.loyaltyPoints || 0) >= loyaltySettings.minPointsToRedeem ? (
                          <div className="flex flex-col items-end gap-1">
                            {loyaltyPointsRedeemed > 0 ? (
                              <button 
                                onClick={() => setLoyaltyPointsRedeemed(0)}
                                className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 text-[9px] font-black py-1 px-2.5 rounded-lg transition-all"
                              >
                                {isRTL ? 'إلغاء الخصم' : 'Cancel Discount'}
                              </button>
                            ) : (
                              <button 
                                onClick={() => setLoyaltyPointsRedeemed(currentUser.loyaltyPoints || 0)}
                                className="bg-purple-600 text-white hover:bg-purple-700 text-[9px] font-black py-1 px-2.5 rounded-lg transition-all"
                              >
                                {isRTL ? 'استبدال النقاط' : 'Redeem Points'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[8px] bg-amber-50 text-amber-800 border border-amber-200/40 p-1.5 rounded-lg font-bold max-w-[150px] leading-tight text-center">
                            {isRTL 
                              ? `يلزمك ${loyaltySettings.minPointsToRedeem} نقطة على الأقل للاستبدال` 
                              : `Min ${loyaltySettings.minPointsToRedeem} points needed to redeem`}
                          </span>
                        )}
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
          {activeTab === 'wallet' && (
            <div className="p-4 animate-fade-in pb-12 space-y-4">
              <div className="flex justify-between items-center mb-1">
                <h2 className="text-base font-black text-gray-900">{isRTL ? 'المحفظة والولاء' : 'Wallet & Loyalty'}</h2>
                <span className="text-[10px] bg-[#422e87]/10 text-[#422e87] px-2 py-0.5 rounded-full font-black uppercase">
                  {isRTL ? 'مكافآت حصرية' : 'Exclusive Rewards'}
                </span>
              </div>

              {!isLoggedIn ? (
                /* IF NOT LOGGED IN, SHOW PROMPT CARD TO LOG IN FOR LOYALTY */
                <div className="glass-card rounded-2xl p-6 text-center space-y-4">
                  <div className="w-14 h-14 bg-purple-50 rounded-full flex items-center justify-center mx-auto text-[#422e87]">
                    <Wallet className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-gray-900">{isRTL ? 'افتح محفظتك الرقمية' : 'Unlock Your Digital Wallet'}</h3>
                    <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                      {isRTL 
                        ? 'سجل دخولك الآن لتجميع نقاط الولاء، الحصول على كاش باك فوري، واسترداد وجبات مجانية مكافأة لك!' 
                        : 'Sign in to accumulate loyalty points, earn instant cashback, and redeem delicious free meals!'}
                    </p>
                  </div>
                  <button 
                    onClick={() => setActiveTab('profile')}
                    className="w-full bg-primary text-white text-xs font-black py-2.5 rounded-xl transition-all hover:scale-101"
                  >
                    {isRTL ? 'سجل دخولك الآن' : 'Go to Login'}
                  </button>
                </div>
              ) : (
                /* FULL LOYALTY SYSTEM AND WALLET DETAILS */
                <div className="space-y-4">
                  {/* Digital Loyalty Card Component */}
                  <div className="bg-gradient-to-br from-[#422e87] to-[#e02d3d] text-white rounded-3xl p-4 shadow-lg relative overflow-hidden">
                    {/* Abstract background design blobs */}
                    <div className="absolute -right-8 -top-8 w-24 h-24 bg-white/10 rounded-full blur-xl pointer-events-none" />
                    <div className="absolute -left-8 -bottom-8 w-24 h-24 bg-white/10 rounded-full blur-xl pointer-events-none" />
                    
                    <div className="relative space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-[9px] font-bold text-purple-200 uppercase tracking-widest block">
                            {isRTL ? 'بطاقة الولاء الرقمية الموحدة' : 'Unified Digital Loyalty Card'}
                          </span>
                          <h4 className="text-base font-black tracking-tight mt-0.5">
                            {currentUser.fullName}
                          </h4>
                          <span className="text-[8px] font-mono text-purple-200 block opacity-80 mt-0.5">
                            ID: SM-LOY-{currentUser.id.split('-')[1]?.toUpperCase() || 'CUST'}
                          </span>
                        </div>
                        <span className="text-[9px] font-black bg-white/20 px-2.5 py-1 rounded-full backdrop-blur-xs border border-white/10 uppercase">
                          {currentUser.loyaltyPoints >= 300 
                            ? (isRTL ? '👑 ذهبي' : '👑 Gold Tier') 
                            : currentUser.loyaltyPoints >= 100 
                            ? (isRTL ? '✨ فضي' : '✨ Silver Tier') 
                            : (isRTL ? '🥉 برونزي' : '🥉 Bronze Tier')}
                        </span>
                      </div>

                      <div className="flex justify-between items-end pt-1">
                        <div>
                          <span className="text-[8.5px] font-bold text-purple-100 uppercase block leading-none">
                            {isRTL ? 'رصيد نقاط الولاء' : 'Loyalty Points Balance'}
                          </span>
                          <div className="flex items-baseline gap-1.5 mt-1">
                            <span className="text-3xl font-black leading-none">{currentUser.loyaltyPoints || 0}</span>
                            <span className="text-xs font-bold text-purple-100">{isRTL ? 'نقطة' : 'pts'}</span>
                          </div>
                          <span className="text-[9.5px] text-purple-100 block mt-1">
                            (= {((currentUser.loyaltyPoints || 0) * (loyaltySettings?.discountPerPoint || 0.1)).toFixed(2)} {t.sar} {isRTL ? 'رصيد مسترجع' : 'cashback credit'})
                          </span>
                        </div>

                        {/* Interactive Scan barcode/QR code for gamified scanning */}
                        <div className="bg-white p-1.5 rounded-xl flex flex-col items-center gap-1 shadow-md">
                          <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center overflow-hidden border border-slate-200">
                            {/* Standard pixelated mini mock QR pattern */}
                            <div className="w-9 h-9 opacity-90" style={{
                              backgroundImage: `radial-gradient(circle, #000 25%, transparent 26%), radial-gradient(circle, #000 25%, transparent 26%)`,
                              backgroundSize: '6px 6px',
                              backgroundPosition: '0 0, 3px 3px'
                            }} />
                          </div>
                          <span className="text-[7px] text-[#422e87] font-mono font-black tracking-wide leading-none">POS_SCAN_EARN</span>
                        </div>
                      </div>

                      {/* Tier progress bar */}
                      <div className="space-y-1.5 pt-2 border-t border-white/10">
                        <div className="flex justify-between text-[9px] font-black text-purple-200">
                          <span>
                            {currentUser.loyaltyPoints >= 500 
                              ? (isRTL ? '🎁 مبروك! لقد فتحت الوجبة المجانية!' : '🎁 Unlocked Free Premium Meal!') 
                              : (isRTL ? `متبقي ${(500 - currentUser.loyaltyPoints)} نقطة لوجبة مجانية` : `${500 - currentUser.loyaltyPoints} pts to Free Premium Meal!`)}
                          </span>
                          <span>
                            {currentUser.loyaltyPoints} / 500
                          </span>
                        </div>
                        <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden p-0.5 border border-white/5">
                          <div 
                            className={`h-full rounded-full transition-all duration-700 ${
                              currentUser.loyaltyPoints >= 500 
                                ? 'bg-gradient-to-r from-amber-400 to-yellow-300' 
                                : 'bg-gradient-to-r from-primary to-yellow-400'
                            }`}
                            style={{ width: `${Math.min(100, (currentUser.loyaltyPoints / 500) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Cashback Conversion and Store Credit Module */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider">{isRTL ? 'رصيد المحفظة النقدي' : 'Store Credit Wallet'}</h3>
                        <p className="text-[9px] text-gray-400 mt-0.5 leading-snug">{isRTL ? 'استبدل نقاطك إلى رصيد بالمحفظة واستخدمه عند الطلب!' : 'Convert points to cash credit in your wallet!'}</p>
                      </div>
                      <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 px-3 py-1 rounded-xl text-center">
                        <span className="text-[9px] font-bold block uppercase leading-none">{isRTL ? 'رصيد المحفظة' : 'Wallet Balance'}</span>
                        <span className="text-sm font-black text-emerald-600 font-mono mt-1 block leading-none">{walletBalance.toFixed(2)} {t.sar}</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button 
                        disabled={currentUser.loyaltyPoints < 100}
                        onClick={() => handleConvertPoints(100, 10)}
                        className="flex-1 bg-slate-50 hover:bg-purple-50 text-[#422e87] border border-gray-100 hover:border-purple-200 rounded-xl p-2.5 text-center transition-all disabled:opacity-40"
                      >
                        <span className="block text-[11px] font-black">{isRTL ? 'تحويل ١٠٠ نقطة' : 'Convert 100 Pts'}</span>
                        <span className="block text-[9px] text-[#e02d3d] font-bold mt-0.5">{isRTL ? 'للحصول على ١٠ ر.س' : 'Get 10 SAR'}</span>
                      </button>
                      <button 
                        disabled={currentUser.loyaltyPoints < 250}
                        onClick={() => handleConvertPoints(250, 30)}
                        className="flex-1 bg-slate-50 hover:bg-purple-50 text-[#422e87] border border-gray-100 hover:border-purple-200 rounded-xl p-2.5 text-center transition-all disabled:opacity-40"
                      >
                        <span className="block text-[11px] font-black">{isRTL ? 'تحويل ٢٥٠ نقطة' : 'Convert 250 Pts'}</span>
                        <span className="block text-[9px] text-[#e02d3d] font-bold mt-0.5">{isRTL ? 'للحصول على ٣٠ ر.س' : 'Get 30 SAR'}</span>
                      </button>
                    </div>

                    {currentUser.loyaltyPoints < 100 && (
                      <p className="text-[9.5px] text-amber-600 font-semibold text-center mt-1">
                        ⚠️ {isRTL ? 'تحتاج إلى ١٠٠ نقطة على الأقل للبدء بتحويل النقاط لرصيد مالي' : 'You need at least 100 points to start converting points to credit'}
                      </p>
                    )}
                  </div>

                  {/* Vouchers and Rewards Milestones */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4 space-y-3">
                    <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1">
                      <Award className="w-4 h-4 text-secondary" />
                      <span>{isRTL ? 'مكافآت الولاء المتاحة للفتح' : 'Unlocked Rewards & Milestones'}</span>
                    </h3>

                    <div className="space-y-2">
                      {[
                        { id: 'rew-1', nameEn: 'Free Soft Drink', nameAr: 'مشروب غازي مجاني', points: 50, descEn: 'Any soda can from our spicy menu', descAr: 'أي علبة مشروب من قائمة الوجبات' },
                        { id: 'rew-2', nameEn: 'Free Spicy Fries', nameAr: 'بطاطس مقلية حارة مجانية', points: 100, descEn: 'Regular size crispy spiced fries', descAr: 'بطاطس مقلية متبلة بحجم عادي' },
                        { id: 'rew-3', nameEn: 'Free Chicken Burger', nameAr: 'برجر دجاج كلاسيك مجاني', points: 250, descEn: 'Signature classic crispy burger', descAr: 'برجر دجاج مقرمش كلاسيكي' },
                        { id: 'rew-4', nameEn: 'Free Spicy Feast', nameAr: 'وجبة الوليمة الحارة مجاناً', points: 500, descEn: 'Double meal combo with sides and drink', descAr: 'وجبة كومبو مزدوجة مع مقبلات ومشروب' }
                      ].map(reward => {
                        const isUnlocked = currentUser.loyaltyPoints >= reward.points;
                        return (
                          <div 
                            key={reward.id} 
                            className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                              isUnlocked 
                                ? 'bg-purple-50/40 border-purple-100 hover:border-purple-300' 
                                : 'bg-gray-50/50 border-gray-100 opacity-60'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-black ${isUnlocked ? 'text-gray-950' : 'text-gray-400'}`}>
                                  {isRTL ? reward.nameAr : reward.nameEn}
                                </span>
                                <span className={`text-[8px] px-1.5 py-0.5 rounded font-black uppercase ${
                                  isUnlocked ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                                }`}>
                                  {isUnlocked ? (isRTL ? 'جاهز' : 'Unlocked') : `${reward.points} pts`}
                                </span>
                              </div>
                              <p className="text-[9.5px] text-gray-400 leading-snug">
                                {isRTL ? reward.descAr : reward.descEn}
                              </p>
                            </div>

                            <button 
                              disabled={!isUnlocked}
                              onClick={() => handleClaimVoucher(reward)}
                              className={`text-[9px] font-black px-3 py-1.5 rounded-lg transition-all ${
                                isUnlocked 
                                  ? 'bg-secondary text-white hover:scale-103' 
                                  : 'bg-gray-100 text-gray-400 border border-gray-200/50'
                              }`}
                            >
                              {isRTL ? 'استلام المكافأة' : 'Claim Reward'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Points Ledger / Dynamic Transaction History */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4 space-y-3">
                    <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1">
                      <History className="w-4 h-4 text-primary" />
                      <span>{isRTL ? 'سجل نقاط الولاء' : 'Loyalty Points Ledger'}</span>
                    </h3>

                    <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                      {getLoyaltyLedger().map((item: any, i: number) => (
                        <div key={i} className="flex justify-between items-center p-2 bg-slate-50 rounded-xl text-[10px]">
                          <div>
                            <span className="font-extrabold text-gray-800 block leading-tight">
                              {isRTL ? item.titleAr : item.titleEn}
                            </span>
                            <span className="text-[8px] text-gray-400 mt-0.5 block leading-none">
                              {item.date}
                            </span>
                          </div>
                          <span className={`font-black font-mono text-[10.5px] ${
                            item.points > 0 ? 'text-green-600' : 'text-[#e02d3d]'
                          }`}>
                            {item.points > 0 ? `+${item.points}` : item.points} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

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
                                  {new Date(order.createdAt).toISOString().replace('T', ' ').substring(0, 16)}
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
                      {new Date(activeOrderReceipt.createdAt).toISOString().replace('T', ' ').substring(0, 16)}
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
                        <span>{(activeOrderReceipt.total / 1.15).toFixed(2)} {t.sar}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{isRTL ? `ضريبة القيمة المضافة (١٥٪):` : `Saudi VAT portion (15%):`}</span>
                        <span>{(activeOrderReceipt.total - (activeOrderReceipt.total / 1.15)).toFixed(2)} {t.sar}</span>
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
