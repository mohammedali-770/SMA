import React from 'react';
import { ClipboardList, Trash2 } from 'lucide-react';
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

/**
 * Account tab. Under Supabase Auth the customer is already authenticated to
 * reach this screen, so there is no in-screen login form anymore — the profile,
 * order history and addresses all come from Supabase (RLS scopes them to this
 * customer), and "Log out" ends the real GoTrue session.
 */
export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onShowReceipt, onOpenAddressForm }) => {
  const { orders, currentUser, addresses, deleteAddress, mobileLang, signOut } = useApp();
  const t = LOCALES[mobileLang];
  const isRTL = mobileLang === 'ar';

  const myOrders = orders.filter(o => o.customerId === currentUser.id);
  const initial = (currentUser.fullName || currentUser.email || '?').charAt(0).toUpperCase();

  return (
    <>
      <div className="p-4 animate-fade-in pb-12">
        <h2 className="text-base font-black text-gray-900 mb-4">{t.profile}</h2>

        <div className="space-y-4">
          {/* Customer Badge card */}
          <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4 flex items-center gap-3">
            <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center font-black text-white text-lg">
              {initial}
            </div>
            <div>
              <h3 className="text-sm font-black text-gray-950">{currentUser.fullName || (isRTL ? 'عميل' : 'Customer')}</h3>
              <p className="text-[10px] text-gray-400 leading-tight">{currentUser.phoneNumber} {currentUser.phoneNumber && currentUser.email ? '•' : ''} {currentUser.email}</p>
              <span className="inline-block text-[8px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-black mt-1 uppercase">
                {isRTL ? 'حساب زبون نشط' : 'Active Customer Account'}
              </span>
            </div>
          </div>

          {/* Order History (My Orders) */}
          <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4 space-y-3">
            <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4 text-primary" />
              <span>{isRTL ? 'طلباتي السابقة' : 'My Order History'}</span>
            </h3>

            {myOrders.length === 0 ? (
              <p className="text-[10px] text-gray-400 text-center py-4">
                {isRTL ? 'لا توجد طلبات سابقة بعد!' : 'No orders placed yet!'}
              </p>
            ) : (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {myOrders.map(order => (
                  <div
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${isRTL ? 'عرض فاتورة الطلب' : 'View receipt for order'} ${order.orderNumber}`}
                    onClick={() => onShowReceipt(order)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onShowReceipt(order); } }}
                    className="p-3 bg-slate-50/75 hover:bg-purple-50/30 border border-gray-100 hover:border-purple-200 rounded-xl cursor-pointer flex justify-between items-center transition-all"
                  >
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-black text-gray-800 block">{order.orderNumber}</span>
                      <span className="text-[8.5px] text-gray-400 block">{formatRiyadhDateTime(order.createdAt)}</span>
                      <span className="text-[9.5px] font-extrabold text-secondary block mt-0.5">{formatSAR(order.total, mobileLang)}</span>
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

          {/* Saved addresses */}
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

            {addresses.length === 0 ? (
              <p className="text-[10px] text-gray-400 py-2">{isRTL ? 'لا توجد عناوين محفوظة بعد.' : 'No saved addresses yet.'}</p>
            ) : (
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
                      aria-label={isRTL ? 'حذف العنوان' : 'Delete address'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Logout (ends the Supabase session) */}
          <button
            onClick={() => { void signOut(); }}
            className="w-full text-center bg-gray-50 border border-gray-100 hover:bg-red-50 hover:text-red-600 text-xs font-bold py-2.5 rounded-full transition-colors text-gray-500"
          >
            {isRTL ? 'تسجيل الخروج' : 'Log Out Account'}
          </button>
        </div>
      </div>
    </>
  );
};
