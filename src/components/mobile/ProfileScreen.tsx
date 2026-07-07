import React, { useState } from 'react';
import { ClipboardList, Trash2, User } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Order } from '../../types';
import { formatRiyadhDateTime, formatSAR } from '../../utils/calculations';
import { LOCALES } from './mobileLocales';

interface ProfileScreenProps {
  isLoggedIn: boolean;
  setIsLoggedIn: (value: boolean) => void;
  onShowReceipt: (order: Order) => void;
  onOpenAddressForm: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ isLoggedIn, setIsLoggedIn, onShowReceipt, onOpenAddressForm }) => {
  const { orders, currentUser, setCurrentUser, addresses, deleteAddress, mobileLang } = useApp();
  const t = LOCALES[mobileLang];
  const isRTL = mobileLang === 'ar';
  const [authStep, setAuthStep] = useState<'login' | 'otp'>('login');
  const [authType, setAuthType] = useState<'phone' | 'email'>('phone');
  const [inputPhone, setInputPhone] = useState('+966 55 123 4567');
  const [inputEmail, setInputEmail] = useState('mohammed.ali@1sttaste.com');
  const [inputOtp, setInputOtp] = useState('');
  const [authError, setAuthError] = useState('');

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

  return (
    <>
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
                              onClick={() => onShowReceipt(order)}
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
                                  {formatSAR(order.total, mobileLang)}
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
                        onClick={() => onOpenAddressForm()}
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
    </>
  );
};
