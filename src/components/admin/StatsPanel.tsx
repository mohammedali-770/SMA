import React from 'react';
import { useApp } from '../../context/AppContext';
import { ADMIN_LOCALES } from './adminLocales';
import { Price } from '../Price';

export const StatsPanel: React.FC = () => {
  const { orders, branches, adminLang } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';

  const totalRevenue = orders
    .filter(o => o.status === 'delivered')
    .reduce((acc, o) => acc + o.total, 0);
  const activeOrdersCount = orders
    .filter(o => o.status !== 'delivered' && o.status !== 'cancelled')
    .length;
  const averageTicketValue = orders.length > 0
    ? Number((orders.reduce((acc, o) => acc + o.total, 0) / orders.length).toFixed(2))
    : 0;
  const operationalBranchesCount = branches.filter(b => b.isActive).length;

  return (
            <div className="space-y-4 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                
                {/* Metric Gross revenue */}
                <div className="glass-card p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.stats_revenue}</span>
                  <p className="text-xl font-black text-primary mt-1"><Price amount={totalRevenue} /></p>
                  <p className="text-[9px] text-green-600 font-bold mt-1">↑ 12.5% {isRTL ? 'منذ الأمس' : 'vs yesterday'}</p>
                </div>

                {/* Metric Active order counts */}
                <div className="glass-card p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.stats_orders}</span>
                  <p className="text-xl font-black text-secondary mt-1">{activeOrdersCount} {isRTL ? 'طلبات قيد المتابعة' : 'Active'}</p>
                  <p className="text-[9px] text-primary font-bold mt-1">● {orders.length - activeOrdersCount} {isRTL ? 'طلبات مكتملة اليوم' : 'Completed today'}</p>
                </div>

                {/* Metric ticket value */}
                <div className="glass-card p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.stats_ticket}</span>
                  <p className="text-xl font-black text-slate-800 mt-1"><Price amount={averageTicketValue} /></p>
                  <p className="text-[9px] text-gray-400 mt-1">{isRTL ? 'شامل ضريبة القيمة المضافة ١٥٪' : 'VAT-inclusive average ticket'}</p>
                </div>

                {/* Metric Operational branches */}
                <div className="glass-card p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.stats_branches}</span>
                  <p className="text-xl font-black text-green-700 mt-1">{operationalBranchesCount} / {branches.length}</p>
                  <p className="text-[9px] text-secondary font-bold mt-1">⚠ {branches.length - operationalBranchesCount} {isRTL ? 'فروع مغلقة للصيانة' : 'branches closed'}</p>
                </div>

              </div>

              {/* Graphic Daily Sales distribution Chart - SVG */}
              <div className="glass-card p-4 rounded-2xl">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider">{isRTL ? 'مبيعات فروع المملكة اليومية مقارنة بالأمس' : 'Daily Branch Sales Performance Distribution'}</h3>
                  <span className="text-[10px] bg-purple-50 text-primary font-bold px-2 py-0.5 rounded-full">{isRTL ? 'تحديث تلقائي' : 'Realtime Sync'}</span>
                </div>

                {/* SVG Chart */}
                <div className="h-44 w-full flex items-end justify-around pt-4 border-b border-gray-100">
                  {branches.map((b, i) => {
                    const bOrders = orders.filter(o => o.branchId === b.id);
                    const bSum = bOrders.reduce((acc, o) => acc + o.total, 0);
                    // calculate dynamic height percentage
                    const maxScale = Math.max(...branches.map(br => orders.filter(o => o.branchId === br.id).reduce((acc, o) => acc + o.total, 0))) || 100;
                    const pct = Math.max(12, (bSum / maxScale) * 100);

                    return (
                      <div key={b.id} className="flex flex-col items-center w-1/4">
                        <div className="text-[9px] font-black text-secondary mb-1">{bSum.toFixed(0)} {isRTL ? 'ر.س' : 'SAR'}</div>
                        
                        {/* Dynamic Bar */}
                        <div 
                          className="w-8 rounded-t-lg bg-gradient-to-t from-primary to-secondary transition-all duration-500 shadow-xs"
                          style={{ height: `${pct}px` }}
                        ></div>
                        
                        <div className="text-[9.5px] font-extrabold text-gray-700 mt-2 truncate w-full text-center">
                          {isRTL ? b.nameAr.split('،')[0] : b.nameEn.split(',')[0]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
  );
};
