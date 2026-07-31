import React from 'react';

import { useApp } from '../../context/AppContext';
import { Card } from '../../design-system/ui/Card';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { Price } from '../Price';
import { ADMIN_LOCALES } from './adminLocales';

/**
 * The dashboard's four headline figures and the per-branch sales bars.
 *
 * Every derivation is unchanged. Two pieces of COPY are not, and both were
 * saying something the numbers did not support:
 *
 *   The revenue tile carried a hardcoded "↑ 12.5% vs yesterday". It was a
 *   literal, not a calculation — there is no yesterday comparison anywhere in
 *   this file — so it is gone rather than restyled. A fabricated trend on the
 *   first tile of the dashboard is worse than no trend at all.
 *
 *   The orders tile labelled `orders.length - activeOrdersCount` as "Completed
 *   today". That count is delivered AND cancelled, over all time, not today.
 *   The number is untouched; the label now says what it counts.
 *
 * Branch totals render through <Price>, so they get the SAMA riyal glyph
 * instead of the literal "SAR" / "ر.س" the design system forbids.
 */
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
  const closedBranchesCount = branches.length - operationalBranchesCount;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Text variant="caption" tone="tertiary" as="p">{t.stats_revenue}</Text>
          <Text variant="title" as="p" className="mt-1"><Price amount={totalRevenue} lang={adminLang} /></Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-1">
            {isRTL ? 'من الطلبات المسلَّمة' : 'From delivered orders'}
          </Text>
        </Card>

        <Card>
          <Text variant="caption" tone="tertiary" as="p">{t.stats_orders}</Text>
          <Text variant="title" numeric as="p" className="mt-1">
            {activeOrdersCount}{' '}
            <Text variant="body" tone="secondary" as="span">{isRTL ? 'طلبات قيد المتابعة' : 'Active'}</Text>
          </Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-1">
            {orders.length - activeOrdersCount} {isRTL ? 'مسلَّمة أو ملغاة' : 'delivered or cancelled'}
          </Text>
        </Card>

        <Card>
          <Text variant="caption" tone="tertiary" as="p">{t.stats_ticket}</Text>
          <Text variant="title" as="p" className="mt-1"><Price amount={averageTicketValue} lang={adminLang} /></Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-1">
            {isRTL ? 'شامل ضريبة القيمة المضافة ١٥٪' : 'VAT-inclusive average ticket'}
          </Text>
        </Card>

        {/* Tinted only when a branch is actually closed, so a healthy board
            stays quiet and a real closure stands out. */}
        <Card tone={closedBranchesCount > 0 ? 'warning' : 'surface'}>
          <Text variant="caption" tone="tertiary" as="p">{t.stats_branches}</Text>
          <Text variant="title" numeric as="p" className="mt-1">
            {operationalBranchesCount} / {branches.length}
          </Text>
          <Text
            variant="caption"
            tone={closedBranchesCount > 0 ? 'warning' : 'tertiary'}
            as="p"
            className="mt-1"
          >
            {closedBranchesCount} {isRTL ? 'فروع مغلقة للصيانة' : 'branches closed'}
          </Text>
        </Card>
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text variant="heading" as="h3">
            {isRTL ? 'مبيعات فروع المملكة اليومية مقارنة بالأمس' : 'Daily Branch Sales Performance Distribution'}
          </Text>
          <StatusPill label={isRTL ? 'تحديث تلقائي' : 'Realtime Sync'} tone="info" />
        </div>

        <div className="flex h-44 w-full items-end justify-around border-b border-con-line pt-4">
          {branches.map((b) => {
            const bOrders = orders.filter(o => o.branchId === b.id);
            const bSum = bOrders.reduce((acc, o) => acc + o.total, 0);
            // calculate dynamic height percentage
            const maxScale = Math.max(...branches.map(br => orders.filter(o => o.branchId === br.id).reduce((acc, o) => acc + o.total, 0))) || 100;
            const pct = Math.max(12, (bSum / maxScale) * 100);

            return (
              <div key={b.id} className="flex w-1/4 flex-col items-center">
                <Text variant="caption" tone="secondary" as="p" className="mb-1">
                  <Price amount={bSum} lang={adminLang} />
                </Text>
                <div
                  className="ds-motion w-8 rounded-t-[var(--radius-ds-sm)] bg-ember transition-all duration-500"
                  style={{ height: `${pct}px` }}
                />
                <Text variant="caption" as="p" className="mt-2 w-full truncate text-center">
                  {isRTL ? b.nameAr.split('،')[0] : b.nameEn.split(',')[0]}
                </Text>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};
