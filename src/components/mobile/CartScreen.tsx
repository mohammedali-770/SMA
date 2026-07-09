import React, { useState } from 'react';
import { AlertCircle, Banknote, CreditCard, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Order, Modifier } from '../../types';
import { getVATBreakdown, formatSAR } from '../../utils/calculations';
import { LOCALES } from './mobileLocales';
import { availableMethods, checkoutBlocked, onlineUnavailableCashOn } from '../../lib/payment';
import { pointInPolygon } from '../../lib/geo';

interface CartScreenProps {
  isLoggedIn: boolean;
  onNavigate: (tab: 'home' | 'cart' | 'wallet' | 'profile') => void;
  onShowReceipt: (order: Order) => void;
  onOpenAddressForm: () => void;
}

export const CartScreen: React.FC<CartScreenProps> = ({ isLoggedIn, onNavigate, onShowReceipt, onOpenAddressForm }) => {
  const {
    cart, cartTotal, updateCartQuantity, removeFromCart, checkoutType, setCheckoutType,
    selectedAddressId, setSelectedAddressId, addresses, deleteAddress,
    couponCode, discountAmount, applyCoupon,
    loyaltyPointsRedeemed, setLoyaltyPointsRedeemed, loyaltyDiscountAmount, loyaltySettings, loyaltyMutationsEnabled,
    currentUser, selectedBranch, placeOrder, brandSettings, mobileLang,
    paymentSettings, selectedPaymentMethod, setSelectedPaymentMethod,
    deliveryZones,
  } = useApp();
  const t = LOCALES[mobileLang];
  const isRTL = mobileLang === 'ar';

  // ---- Delivery serviceability pre-check (UX only; place_order is authoritative) ----
  const selectedAddress = addresses.find(a => a.id === selectedAddressId);
  const branchZone = deliveryZones.find(z => z.branchId === selectedBranch?.id && z.isActive);
  const branchDeliveryOff = selectedBranch
    ? !(selectedBranch.deliveryEnabled ?? true) || (selectedBranch.deliveryTemporarilyClosed ?? false)
    : false;
  const insideZone = Boolean(
    selectedAddress && branchZone
    && pointInPolygon({ lat: selectedAddress.lat, lng: selectedAddress.lng }, branchZone.geojson),
  );
  // A delivery order is pre-check-serviceable only when the branch offers delivery,
  // has an active zone, an address is chosen, and the point falls inside the zone.
  const deliveryServiceable = checkoutType !== 'delivery'
    || (!branchDeliveryOff && Boolean(selectedAddress) && Boolean(branchZone) && insideZone);
  const deliveryBlockReason: string | null =
    checkoutType !== 'delivery' ? null
    : branchDeliveryOff ? (isRTL ? 'التوصيل مغلق حالياً لهذا الفرع.' : 'Delivery is currently closed for this branch.')
    : !selectedAddress ? (isRTL ? 'يرجى تحديد موقع التوصيل على الخريطة.' : 'Please select your delivery location on the map.')
    : !branchZone ? (isRTL ? 'منطقة التوصيل غير مُعدّة لهذا الفرع.' : 'Delivery area is not configured for this branch.')
    : !insideZone ? (isRTL ? 'موقعك خارج منطقة توصيل هذا الفرع.' : 'Your location is outside this branch delivery area.')
    : null;

  // Admin-configured availability mirrored for the UI (server re-checks at place_order).
  const payMethods = availableMethods(paymentSettings);
  const paymentBlocked = checkoutBlocked(paymentSettings);
  const showOnlineOutageNotice = onlineUnavailableCashOn(paymentSettings);
  // Cash label follows the order type: "on Pickup" vs "on Delivery".
  const cashLabel = checkoutType === 'delivery'
    ? (isRTL ? 'الدفع نقداً عند التوصيل' : 'Cash on Delivery')
    : (isRTL ? 'الدفع نقداً عند الاستلام' : 'Cash on Pickup');
  const onlineLabel = isRTL ? 'الدفع الإلكتروني' : 'Online Payment';
  const [couponInput, setCouponInput] = useState('');
  const [couponMsg, setCouponMsg] = useState({ text: '', isError: false });
  const [placing, setPlacing] = useState(false);

  const handlePlaceOrderClick = async () => {
    if (!isLoggedIn) {
      onNavigate('profile');
      alert(mobileLang === 'en' ? 'Please login to place an order!' : 'الرجاء تسجيل الدخول لتتمكن من الطلب!');
      return;
    }
    if (placing) return;
    setPlacing(true);
    // place_order runs server-side (recomputes totals, coupon + VAT); the receipt
    // shown is the authoritative order the database returned.
    const result = await placeOrder();
    setPlacing(false);
    if (result.success && result.order) {
      onShowReceipt(result.order);
      onNavigate('profile');
    } else if (result.error) {
      alert(result.error);
    }
  };

  const handleApplyCouponCode = async () => {
    if (!couponInput) return;
    // Validated server-side via the validate_coupon RPC — codes are never
    // shipped to the client, and place_order re-checks at checkout.
    const res = await applyCoupon(couponInput);
    setCouponMsg({
      text: res.valid ? t.coupon_success : (res.message || t.invalid_coupon),
      isError: !res.valid,
    });
  };

  return (
    <>
            <div className="p-4 animate-fade-in pb-12">
              <h2 className="text-base font-black text-gray-900 mb-4">{t.cart}</h2>

              {cart.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-center px-4">
                  <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-3 border border-gray-100">
                    <ShoppingBag className="w-8 h-8 text-gray-300" />
                  </div>
                  <p className="text-xs font-bold text-gray-400 leading-relaxed mb-6">{t.empty_cart}</p>
                  <button 
                    onClick={() => onNavigate('home')}
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
                                aria-label={isRTL ? 'إزالة العنصر' : 'Remove item'}
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
                                aria-label={isRTL ? 'إنقاص الكمية' : 'Decrease quantity'}
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="text-xs font-black text-gray-900">{item.quantity}</span>
                              <button 
                                onClick={() => updateCartQuantity(item.cartItemId, 1)}
                                className="w-5 h-5 rounded-full bg-white border border-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-100"
                                aria-label={isRTL ? 'زيادة الكمية' : 'Increase quantity'}
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
                        <span>{t.min_order_warning} {formatSAR(selectedBranch.minDeliveryOrder, mobileLang)} ({isRTL ? 'ينقصك' : 'need'} {formatSAR(selectedBranch.minDeliveryOrder - cartTotal, mobileLang)})</span>
                      </div>
                    )}
                  </div>

                  {/* Payment method selector (availability is admin-controlled) */}
                  <div className="glass-card rounded-2xl p-3">
                    <h3 className="text-xs font-black text-gray-800 uppercase mb-2.5">{isRTL ? 'طريقة الدفع' : 'Payment Method'}</h3>

                    {paymentBlocked ? (
                      <div className="p-2.5 bg-red-50 text-red-800 text-[10px] rounded-lg border border-red-100 font-bold flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                        <span>{isRTL ? 'لا توجد طريقة دفع متاحة حالياً.' : 'No payment method is currently available.'}</span>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          {payMethods.map(method => {
                            const active = selectedPaymentMethod === method;
                            const label = method === 'online' ? onlineLabel : cashLabel;
                            const Icon = method === 'online' ? CreditCard : Banknote;
                            return (
                              <button
                                key={method}
                                onClick={() => setSelectedPaymentMethod(method)}
                                aria-pressed={active}
                                className={`w-full flex items-center gap-2.5 p-2.5 border rounded-xl transition-all text-left ${active ? 'border-primary bg-primary/5' : 'border-gray-100 bg-white hover:bg-gray-50'}`}
                              >
                                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-primary' : 'bg-gray-300'}`}></div>
                                <Icon className={`w-4 h-4 flex-shrink-0 ${method === 'online' ? 'text-primary' : 'text-green-600'}`} />
                                <div className="flex-1">
                                  <p className="text-xs font-black text-gray-900 leading-tight">{label}</p>
                                  {method === 'cash' && (
                                    <p className="text-[9px] text-gray-400 leading-tight mt-0.5">{isRTL ? 'يُدفع المبلغ نقداً عند الاستلام' : 'Pay in cash when you receive your order'}</p>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {showOnlineOutageNotice && (
                          <div className="mt-2 p-2 bg-blue-50 text-blue-800 text-[10px] rounded-lg border border-blue-100 font-bold flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                            <span>{isRTL ? 'الدفع الإلكتروني غير متاح حالياً. الدفع النقدي مفعّل.' : 'Online payment is currently unavailable. Cash payment is enabled.'}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Delivery Location selector block */}
                  {checkoutType === 'delivery' && (
                    <div className="glass-card rounded-2xl p-3">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xs font-black text-gray-800">{t.address}</h3>
                        <button 
                          onClick={() => onOpenAddressForm()}
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
                              role="button"
                              tabIndex={0}
                              aria-pressed={selectedAddressId === addr.id}
                              aria-label={`${isRTL ? 'اختيار العنوان' : 'Select address'} ${addr.label}`}
                              onClick={() => setSelectedAddressId(addr.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedAddressId(addr.id); } }}
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

                  {/* Delivery serviceability notice (UX pre-check; server re-validates) */}
                  {checkoutType === 'delivery' && deliveryBlockReason && (
                    <div className="p-2.5 bg-red-50 text-red-800 text-[10px] rounded-xl border border-red-100 font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                      <span>{deliveryBlockReason}</span>
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
                            (= {formatSAR((currentUser.loyaltyPoints || 0) * (loyaltySettings.discountPerPoint || 0.1), mobileLang)})
                          </span>
                        </div>

                        {(() => {
                          // Redemption isn't wired server-side in this build, so
                          // the balance is shown read-only (no unbacked discount).
                          if (!loyaltyMutationsEnabled) {
                            return (
                              <span className="text-[8px] bg-slate-50 text-slate-500 border border-slate-200/60 p-1.5 rounded-lg font-bold max-w-[150px] leading-tight text-center">
                                {isRTL ? 'الاستبدال غير متاح حالياً' : 'Redemption coming soon'}
                              </span>
                            );
                          }
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
                      <div className="p-2 bg-primary/5 rounded-xl border border-purple-500/10 flex justify-between text-[9px]">
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
                      <span className="font-bold">{formatSAR(cartTotal, mobileLang)}</span>
                    </div>

                    {checkoutType === 'delivery' && selectedBranch && (
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{t.delivery_fee}</span>
                        <span className="font-bold">+{formatSAR(selectedBranch.deliveryFee, mobileLang)}</span>
                      </div>
                    )}

                    {discountAmount > 0 && (
                      <div className="flex justify-between text-xs text-green-600 font-bold">
                        <span>{t.discount} {couponCode.toUpperCase() ? `(${couponCode.toUpperCase()})` : ''}</span>
                        <span>-{formatSAR(discountAmount, mobileLang)}</span>
                      </div>
                    )}

                    {loyaltyDiscountAmount > 0 && (
                      <div className="flex justify-between text-xs text-purple-600 font-bold">
                        <span>{isRTL ? 'خصم نقاط الولاء' : 'Loyalty Discount'}</span>
                        <span>-{formatSAR(loyaltyDiscountAmount, mobileLang)}</span>
                      </div>
                    )}

                    <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                      <div>
                        <span className="text-sm font-black text-gray-900">{t.total}</span>
                        <p className="text-[9px] text-gray-400 leading-none mt-0.5">{t.vat_label}</p>
                      </div>
                      <span className="text-base font-black text-secondary">
                        {formatSAR(Math.max(0, cartTotal + (checkoutType === 'delivery' && selectedBranch ? selectedBranch.deliveryFee : 0) - discountAmount - loyaltyDiscountAmount), mobileLang)}
                      </span>
                    </div>

                    {/* Tax Breakdown Preview */}
                    <div className="bg-gray-50/50 p-2 rounded-lg text-[9px] text-gray-400 space-y-0.5">
                      <div className="flex justify-between">
                        <span>{isRTL ? 'المجموع غير شامل الضريبة:' : 'Subtotal Excl. VAT:'}</span>
                        <span>{formatSAR(getVATBreakdown(cartTotal + (checkoutType === 'delivery' && selectedBranch ? selectedBranch.deliveryFee : 0) - discountAmount - loyaltyDiscountAmount, brandSettings?.vatPercentage || 15).subtotalExcludingVat, mobileLang)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{isRTL ? `قيمة الضريبة (${brandSettings?.vatPercentage || 15}٪):` : `Saudi VAT portion (${brandSettings?.vatPercentage || 15}%):`}</span>
                        <span>{formatSAR(getVATBreakdown(cartTotal + (checkoutType === 'delivery' && selectedBranch ? selectedBranch.deliveryFee : 0) - discountAmount - loyaltyDiscountAmount, brandSettings?.vatPercentage || 15).vatAmount, mobileLang)}</span>
                      </div>
                    </div>

                    <button
                      onClick={handlePlaceOrderClick}
                      disabled={placing || paymentBlocked || !deliveryServiceable || (checkoutType === 'delivery' && !!selectedBranch && cartTotal < selectedBranch.minDeliveryOrder)}
                      className={`w-full text-center text-xs font-black py-3 rounded-full shadow-sm mt-2 transition-all ${
                        placing || paymentBlocked || !deliveryServiceable || (checkoutType === 'delivery' && !!selectedBranch && cartTotal < selectedBranch.minDeliveryOrder)
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-secondary text-white hover:bg-secondary/95 hover:scale-102'
                      }`}
                    >
                      {placing ? (isRTL ? 'جاري إرسال الطلب…' : 'Placing order…') : t.place_order}
                    </button>
                  </div>

                </div>
              )}
            </div>
    </>
  );
};
