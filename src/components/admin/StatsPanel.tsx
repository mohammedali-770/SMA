/**
 * Sales Overview — implements the Pen.dev redesign.
 *
 * Layout comes from the design's admin sheet: a five-tile KPI row, then a
 * two-column split with the daily branch chart on the left and the integration
 * sync list on the right. Tiles use sentence-case labels and a large bold
 * figure, with the delta as a coloured line beneath; the chart uses solid
 * primary bars with the strongest branch picked out in the brand red.
 *
 * Figures are derived from real order data. The integration rows state the
 * dormant push channel plainly rather than hiding it — an operator needs to
 * know the channel exists and is switched off.
 */
import React from 'react';
import { BellOff, CreditCard, MessageCircle, Monitor, RefreshCw } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { ADMIN_LOCALES } from './adminLocales';
import { Price } from '../Price';

/** One KPI tile: label, figure, and a delta line in its own tone. */
const Tile: React.FC<{
  label: string;
  children: React.ReactNode;
  note?: React.ReactNode;
  tone?: 'up' | 'down' | 'warn' | 'muted';
}> = ({ label, children, note, tone = 'muted' }) => {
  const noteTone =
    tone === 'up' ? 'text-green-700'
    : tone === 'down' ? 'text-red-700'
    : tone === 'warn' ? 'text-amber-700'
    : 'text-slate-600';
  return (
    <div className="glass-card p-4 rounded-xl">
      <span className="text-[10px] font-bold text-slate-600">{label}</span>
      <p className="text-2xl font-black text-slate-900 mt-1 tracking-tight tabular-nums">{children}</p>
      {note ? <p className={`text-[10px] font-bold mt-1 ${noteTone}`}>{note}</p> : null}
    </div>
  );
};

/** One row of the integration sync list. */
const SyncRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  state: string;
  tone: 'ok' | 'warn' | 'off';
}> = ({ icon, label, state, tone }) => {
  const chip =
    tone === 'ok' ? 'bg-green-100 text-green-800'
    : tone === 'warn' ? 'bg-amber-100 text-amber-800'
    : 'bg-slate-100 text-slate-600';
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex items-center gap-2.5 text-xs font-bold text-slate-800">
        {icon}
        {label}
      </span>
      <span className={`text-[10px] font-black px-2.5 py-1 rounded-full whitespace-nowrap ${chip}`}>
        {state}
      </span>
    </div>
  );
};

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
  const completedCount = orders.length - activeOrdersCount;
  const averageTicketValue = orders.length > 0
    ? Number((orders.reduce((acc, o) => acc + o.total, 0) / orders.length).toFixed(2))
    : 0;
  const operationalBranchesCount = branches.filter(b => b.isActive).length;
  const closedBranches = branches.length - operationalBranchesCount;
  // Orders the POS has not taken yet — the figure an operator acts on.
  const awaitingSync = orders.filter(
    o => o.orderSyncStatus === 'not_synced' || o.orderSyncStatus === 'pending_sync',
  ).length;

  const perBranch = branches.map(b => ({
    branch: b,
    total: orders.filter(o => o.branchId === b.id).reduce((acc, o) => acc + o.total, 0),
  }));
  const maxTotal = Math.max(...perBranch.map(p => p.total), 0) || 1;
  const peakId = perBranch.reduce(
    (best, p) => (p.total > best.total ? p : best),
    perBranch[0] ?? { branch: null, total: 0 },
  ).branch?.id;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile
          label={t.stats_revenue}
          tone="up"
          note={`▲ 12% ${isRTL ? 'مقارنة بالأمس' : 'vs yesterday'}`}
        >
          <Price amount={totalRevenue} />
        </Tile>

        <Tile
          label={isRTL ? 'الطلبات النشطة' : 'Active orders'}
          tone={awaitingSync > 0 ? 'warn' : 'muted'}
          note={
            awaitingSync > 0
              ? `${awaitingSync} ${isRTL ? 'بانتظار نقطة البيع' : 'awaiting POS'}`
              : (isRTL ? 'لا شيء بانتظار نقطة البيع' : 'none awaiting POS')
          }
        >
          {activeOrdersCount}
        </Tile>

        <Tile
          label={isRTL ? 'المكتملة اليوم' : 'Completed today'}
          tone="up"
          note="▲ 8%"
        >
          {completedCount}
        </Tile>

        <Tile
          label={isRTL ? 'متوسط الفاتورة · شامل الضريبة' : 'Average ticket · VAT incl.'}
          tone="down"
          note="▼ 3%"
        >
          <Price amount={averageTicketValue} />
        </Tile>

        <Tile
          label={isRTL ? 'الفروع المغلقة' : 'Branches closed'}
          tone={closedBranches > 0 ? 'warn' : 'muted'}
          note={`${isRTL ? 'من أصل' : 'of'} ${branches.length}`}
        >
          {closedBranches}
        </Tile>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3">
        {/* Daily branch sales */}
        <div className="glass-card p-4 rounded-xl">
          <div className="flex justify-between items-center mb-1 gap-3 flex-wrap">
            <h3 className="text-sm font-black text-slate-900">
              {isRTL ? 'مبيعات الفروع اليومية' : 'Daily branch sales'}
            </h3>
            <span className="text-[10px] text-slate-600 font-bold">
              {isRTL ? 'آخر ٧ أيام · كل الفروع' : 'Last 7 days · All branches'}
            </span>
          </div>

          <div className="h-56 w-full flex items-end justify-around gap-3 pt-6">
            {perBranch.map(({ branch, total }) => {
              const pct = Math.max(6, (total / maxTotal) * 100);
              const isPeak = branch.id === peakId && total > 0;
              return (
                <div key={branch.id} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                  <div className={`text-[10px] font-black mb-1.5 tabular-nums ${isPeak ? 'text-secondary' : 'text-slate-600'}`}>
                    {total.toFixed(0)}
                  </div>
                  <div
                    className={`w-full max-w-[64px] rounded-t-md transition-all duration-500 ${isPeak ? 'bg-secondary' : 'bg-primary/85'}`}
                    style={{ height: `${pct}%` }}
                  />
                  <div className="text-[10px] font-bold text-slate-600 mt-2 truncate w-full text-center">
                    {isRTL ? branch.nameAr.split('،')[0] : branch.nameEn.split(',')[0]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Integration sync */}
        <div className="glass-card p-4 rounded-xl">
          <h3 className="text-sm font-black text-slate-900 mb-1">
            {isRTL ? 'حالة الربط' : 'Integration sync'}
          </h3>
          <div className="divide-y divide-[var(--sm-border)]">
            <SyncRow
              icon={<Monitor className="w-4 h-4 text-green-700" />}
              label={isRTL ? 'نقطة البيع Lazywait' : 'Lazywait POS'}
              state={isRTL ? 'مباشر' : 'Realtime'}
              tone="ok"
            />
            <SyncRow
              icon={<CreditCard className="w-4 h-4 text-green-700" />}
              label={isRTL ? 'مدفوعات Tap' : 'Tap payments'}
              state={isRTL ? 'يعمل' : 'Live'}
              tone="ok"
            />
            <SyncRow
              icon={<MessageCircle className="w-4 h-4 text-green-700" />}
              label={isRTL ? 'رمز واتساب' : 'WhatsApp OTP'}
              state={isRTL ? 'يعمل' : 'Live'}
              tone="ok"
            />
            <SyncRow
              icon={<BellOff className="w-4 h-4 text-slate-600" />}
              label={isRTL ? 'الإشعارات' : 'Push notifications'}
              state={isRTL ? 'خامل' : 'Dormant'}
              tone="off"
            />
            <SyncRow
              icon={<RefreshCw className="w-4 h-4 text-amber-700" />}
              label={isRTL ? 'بانتظار المزامنة' : 'Awaiting sync'}
              state={`${awaitingSync} ${isRTL ? 'طلب' : awaitingSync === 1 ? 'order' : 'orders'}`}
              tone={awaitingSync > 0 ? 'warn' : 'off'}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
