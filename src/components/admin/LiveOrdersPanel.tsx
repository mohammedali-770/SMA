import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import { useApp, canTransitionOrder } from '../../context/AppContext';
import { Order, OrderStatus } from '../../types';
import { getVATBreakdown, formatSAR } from '../../utils/calculations';
import { ADMIN_LOCALES } from './adminLocales';

export const LiveOrdersPanel: React.FC = () => {
  const { orders, updateOrderStatus, brandSettings, currentUser, adminLang } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';
  const [orderFilter, setOrderFilter] = useState<string>('all');
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [activeReceiptOrder, setActiveReceiptOrder] = useState<Order | null>(null);

  const handleUpdateStatus = (orderId: string, status: OrderStatus) => {
    if (isAccountant) return;
    updateOrderStatus(orderId, status);
    if (activeReceiptOrder?.id === orderId) {
      const match = orders.find(o => o.id === orderId);
      if (match) setActiveReceiptOrder({ ...match, status });
    }
  };

  const filteredOrders = orders.filter(o => {
    const matchesSearch = o.orderNumber.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          o.customerPhone.includes(orderSearch);
    const matchesFilter = orderFilter === 'all' || o.status === orderFilter;
    return matchesSearch && matchesFilter;
  });

  return (
    <>
            <div className="space-y-4 animate-fade-in">
              
              {/* Filter controls bar */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest">{t.live_alerts}</h3>
                
                <div className="flex flex-wrap gap-1.5 bg-slate-200/50 backdrop-blur-md p-1 rounded-xl border border-slate-300/30">
                  {['all', 'received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'].map(st => (
                    <button 
                      key={st}
                      onClick={() => setOrderFilter(st)}
                      className={`text-[9.5px] font-bold px-2.5 py-1 rounded-lg uppercase transition-all ${orderFilter === st ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
                    >
                      {st === 'all' ? (isRTL ? 'الكل' : 'All') : st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live search input */}
              <div className="relative">
                <input 
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder={isRTL ? 'ابحث برقم الطلب، اسم العميل، جوال العميل...' : 'Search by order#, client, phone...'}
                  className="glass-input w-full text-xs rounded-xl py-2.5 px-4 outline-none text-slate-800"
                />
              </div>

              {/* Data Table */}
              <div className="glass-card rounded-2xl overflow-hidden overflow-x-auto">
                <table className="w-full text-left text-xs text-gray-500" style={{ textAlign: isRTL ? 'right' : 'left' }}>
                  <thead className="bg-gray-50 text-[10px] text-gray-400 font-bold uppercase">
                    <tr>
                      <th className="px-4 py-3">{t.order_id}</th>
                      <th className="px-4 py-3">{t.customer}</th>
                      <th className="px-4 py-3">{t.branch}</th>
                      <th className="px-4 py-3">{t.total_sar}</th>
                      <th className="px-4 py-3">{t.status}</th>
                      <th className="px-4 py-3">{t.sync}</th>
                      <th className="px-4 py-3">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredOrders.map(order => (
                      <tr key={order.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3.5 font-black text-primary">{order.orderNumber}</td>
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-gray-900">{order.customerName}</div>
                          <div className="text-[10px] text-gray-400">{order.customerPhone}</div>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-gray-700">
                          {isRTL ? order.branchNameAr : order.branchNameEn}
                        </td>
                        <td className="px-4 py-3.5 font-bold text-secondary">
                          {formatSAR(order.total, adminLang)}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-[9.5px] font-black px-2.5 py-0.5 rounded-full uppercase ${
                            order.status === 'delivered' 
                              ? 'bg-green-100 text-green-700'
                              : order.status === 'cancelled'
                              ? 'bg-red-100 text-red-700'
                              : order.status === 'received'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {order.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${
                            order.orderSyncStatus === 'synced' ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600'
                          }`}>
                            {order.orderSyncStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <button 
                              onClick={() => setActiveReceiptOrder(order)}
                              className="bg-primary/5 hover:bg-primary hover:text-white border border-primary/10 text-primary py-1 px-2.5 rounded text-[10px] font-bold transition-colors flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                              <span>{t.view_details}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredOrders.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-gray-400 font-bold">
                          {t.no_orders}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>

      {activeReceiptOrder && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md overflow-hidden rounded-[2rem] shadow-2xl animate-scale-up" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
            <div className="p-5 bg-white/20 border-b border-white/10 flex justify-between items-center">
              <div>
                <h4 className="text-xs font-black text-gray-500 uppercase">{isRTL ? 'تعديل حالة الكاشير الموحدة' : 'Live POS Status Controller'}</h4>
                <p className="text-sm font-extrabold text-primary">{activeReceiptOrder.orderNumber}</p>
              </div>
              <button 
                onClick={() => setActiveReceiptOrder(null)}
                className="w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center font-bold text-gray-400 hover:bg-gray-100 transition-all"
                aria-label={isRTL ? 'إغلاق' : 'Close'}
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[480px] overflow-y-auto text-xs text-gray-700">
              
              {/* Order Status Controller dropdown selector */}
              <div className="bg-purple-50/30 border border-purple-100 p-3 rounded-xl space-y-2">
                <label className="block text-[10px] font-black text-primary uppercase">{isRTL ? 'تعديل حالة الطلب الحالية:' : 'SET REALTIME ORDER STATUS:'}</label>
                <div className="flex gap-2">
                  <select 
                    disabled={isAccountant}
                    value={activeReceiptOrder.status}
                    onChange={(e) => handleUpdateStatus(activeReceiptOrder.id, e.target.value as OrderStatus)}
                    className="flex-1 bg-white border border-gray-200 rounded-lg p-2 font-bold outline-none text-xs text-gray-800 disabled:opacity-50"
                  >
                    <option value="received" disabled={!canTransitionOrder(activeReceiptOrder.status, 'received')}>Received</option>
                    <option value="preparing" disabled={!canTransitionOrder(activeReceiptOrder.status, 'preparing')}>Preparing</option>
                    <option value="ready" disabled={!canTransitionOrder(activeReceiptOrder.status, 'ready')}>Ready (POS Buzzer)</option>
                    <option value="out_for_delivery" disabled={!canTransitionOrder(activeReceiptOrder.status, 'out_for_delivery')}>Out for Delivery</option>
                    <option value="delivered" disabled={!canTransitionOrder(activeReceiptOrder.status, 'delivered')}>Delivered</option>
                    <option value="cancelled" disabled={!canTransitionOrder(activeReceiptOrder.status, 'cancelled')}>Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Invoice Breakdown Details */}
              <div className="border border-gray-100 rounded-2xl p-3 space-y-2 bg-gray-50/50">
                <div className="flex justify-between">
                  <span className="text-gray-400">Customer:</span>
                  <span className="font-bold text-gray-800">{activeReceiptOrder.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Phone:</span>
                  <span className="font-bold text-gray-800">{activeReceiptOrder.customerPhone}</span>
                </div>
                {activeReceiptOrder.address && (
                  <div className="pt-1.5 border-t border-gray-100">
                    <span className="text-gray-400 block text-[10px] mb-0.5">Delivery Short Address:</span>
                    <span className="font-bold text-gray-800 bg-white p-1.5 border border-gray-100 rounded-lg block leading-relaxed">
                      {activeReceiptOrder.address.label} • {activeReceiptOrder.address.description} <br/>
                      <span className="text-primary font-black uppercase text-[10px]">{activeReceiptOrder.address.nationalShortAddress}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Items Table inside Dialog */}
              <div className="space-y-2">
                <span className="block text-[10px] font-black text-gray-400 uppercase tracking-wider">Ordered Items:</span>
                <div className="space-y-1.5">
                  {activeReceiptOrder.items.map(item => (
                    <div key={item.id} className="flex justify-between items-center p-2 bg-white border border-gray-100 rounded-xl">
                      <div>
                        <div className="flex items-center gap-1 font-bold text-gray-900">
                          <span>{item.quantity}x</span>
                          <span>{isRTL ? item.nameAr : item.nameEn}</span>
                        </div>
                        {item.selectedModifiers.length > 0 && (
                          <p className="text-[9.5px] text-gray-400 pl-4 mt-0.5">
                            + {item.selectedModifiers.map(m => isRTL ? m.nameAr : m.nameEn).join(', ')}
                          </p>
                        )}
                      </div>
                      <span className="font-black text-secondary">{formatSAR(item.price * item.quantity, adminLang)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Simple billing table */}
              <div className="pt-2 border-t border-gray-100 space-y-1">
                <div className="flex justify-between text-gray-500">
                  <span>Subtotal:</span>
                  <span>{formatSAR(activeReceiptOrder.subtotal, adminLang)}</span>
                </div>
                {activeReceiptOrder.deliveryFee > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Delivery Fee:</span>
                    <span>+{formatSAR(activeReceiptOrder.deliveryFee, adminLang)}</span>
                  </div>
                )}
                {(activeReceiptOrder.discountAmount ?? 0) > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>{isRTL ? 'خصم القسيمة' : 'Coupon Discount'}:</span>
                    <span>-{formatSAR(activeReceiptOrder.discountAmount ?? 0, adminLang)}</span>
                  </div>
                )}
                {(activeReceiptOrder.loyaltyDiscountAmount ?? 0) > 0 && (
                  <div className="flex justify-between text-purple-600">
                    <span>{isRTL ? 'خصم نقاط الولاء' : 'Loyalty Discount'}:</span>
                    <span>-{formatSAR(activeReceiptOrder.loyaltyDiscountAmount ?? 0, adminLang)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-gray-900 text-sm pt-1 border-t border-gray-50">
                  <span>Grand Total (VAT Inclusive):</span>
                  <span>{formatSAR(activeReceiptOrder.total, adminLang)}</span>
                </div>
              </div>

              {/* Mandatory VAT details stamp */}
              <div className="p-2 bg-gray-50 rounded-lg text-[9.5px] text-gray-400 flex justify-between">
                <span>{brandSettings?.vatPercentage || 15}% Saudi VAT component:</span>
                <span className="font-semibold">{formatSAR(getVATBreakdown(activeReceiptOrder.total, brandSettings?.vatPercentage || 15).vatAmount, adminLang)}</span>
              </div>

            </div>
          </div>
        </div>
      )}
    </>
  );
};
