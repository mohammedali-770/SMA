import React, { useEffect, useMemo, useState } from 'react';

import { useApp } from '../../context/AppContext';
import { Card } from '../../design-system/ui/Card';
import { Text } from '../../design-system/ui/Text';
import { isMissingFunctionError, orders as ordersApi, type AdminOrderStats } from '../../lib/api';
import { Price } from '../Price';
import { ADMIN_LOCALES } from './adminLocales';
import { BranchAvailabilityPanel, OperationalBranchesCard } from './view/stats/BranchAvailability';
import { BranchSalesSection } from './view/stats/BranchSalesSection';
import { buildBranchSalesRowsFromTotals, type BranchTotals } from './view/stats/branchSales';

/**
 * The dashboard's four headline figures and the branch sales section.
 *
 * EVERY DERIVATION BELOW IS UNCHANGED. The four KPI expressions are the same
 * four expressions, and per-branch sales are still the sum of `total` over a
 * branch's orders — `buildBranchSalesRows` performs that sum once for all
 * branches instead of once per branch per render, which is a different amount
 * of work arriving at the identical number.
 *
 * What changed is the information architecture:
 *
 *   The branch chart no longer gives every branch a fixed quarter-width column
 *   in one horizontal row. That layout overlapped names, overflowed the page
 *   and spent most of its ink on 12px stubs for branches with no sales. Bars
 *   run down the page now, top 8 by default, with the zero-sales branches
 *   counted in a line instead of drawn.
 *
 *   The Operational Branches tile opens onto the branches behind it, grouped
 *   by the availability flags the branch model already has.
 *
 * Two pieces of COPY remain corrected from earlier work, and both were saying
 * something the numbers did not support:
 *
 *   The revenue tile carried a hardcoded "↑ 12.5% vs yesterday". It was a
 *   literal, not a calculation — there is no yesterday comparison anywhere in
 *   this file — so it is gone rather than restyled. A fabricated trend on the
 *   first tile of the dashboard is worse than no trend at all.
 *
 *   The orders tile labelled `orders.length - activeOrdersCount` as "Completed
 *   today". That count is delivered AND cancelled, over all time, not today.
 *   The number is untouched; the label says what it counts.
 *
 * Branch totals render through <Price>, so they get the SAMA riyal glyph
 * instead of the literal "SAR" / "ر.س" the design system forbids.
 */
export const StatsPanel: React.FC = () => {
  const { branches, adminLang, ordersLastUpdated } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';

  // These four figures used to be summed from `useApp().orders`, which is why
  // that list had to hold EVERY order ever placed. They are now aggregated
  // server-side by `admin_order_stats`, whose definitions match the previous
  // expressions exactly — including `total_amount` spanning cancelled orders,
  // which is what the average-ticket tile has always divided by.
  const [stats, setStats] = useState<AdminOrderStats | null>(null);
  // A KIND rather than a formatted string — see the same note in ReportsPanel.
  const [statsError, setStatsError] =
    useState<{ kind: 'missing-migration' } | { kind: 'other'; message: string } | null>(null);

  // Re-read when the order list changes, so the tiles still move with the live
  // board. `ordersLastUpdated` is stamped by every refresh and poll.
  useEffect(() => {
    let cancelled = false;
    ordersApi.stats()
      .then(res => { if (!cancelled) { setStats(res); setStatsError(null); } })
      .catch(e => {
        if (cancelled) return;
        // See ReportsPanel: a missing function is an unapplied migration, which
        // is a different thing from a broken one.
        setStatsError(isMissingFunctionError(e)
          ? { kind: 'missing-migration' }
          : { kind: 'other', message: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [ordersLastUpdated]);

  const totalRevenue = stats?.delivered_revenue ?? 0;
  const activeOrdersCount = stats?.active_orders ?? 0;
  const totalOrdersCount = stats?.total_orders ?? 0;
  const averageTicketValue = stats && stats.total_orders > 0
    ? Number((stats.total_amount / stats.total_orders).toFixed(2))
    : 0;
  const operationalBranchesCount = branches.filter(b => b.isActive).length;
  const closedBranchesCount = branches.length - operationalBranchesCount;

  const [showAvailability, setShowAvailability] = useState(false);

  // Same rows as before, from server-side sums rather than a client-side pass
  // over every order. A branch with no orders is absent from the aggregate and
  // falls back to zero, exactly as an empty bucket did.
  const branchRows = useMemo(
    () => buildBranchSalesRowsFromTotals(
      branches,
      new Map<string, BranchTotals>(
        (stats?.branches ?? []).map(b => [b.branch_id, { sales: b.sales, orderCount: b.order_count }]),
      ),
    ),
    [branches, stats],
  );

  return (
    // Capped so the console does not stretch a four-tile row and a bar chart
    // across an ultrawide monitor, which is most of where the "empty canvas"
    // around the old chart came from.
    <div className="mx-auto w-full max-w-[1200px] space-y-4">
      {/* A failed aggregate read must SAY so. Without this the tiles would fall
          back to their zero defaults and the dashboard would report no revenue
          and no orders, which reads as a catastrophe rather than a fetch error. */}
      {statsError ? (
        <Card>
          <Text variant="caption" tone="danger" as="p">
            {statsError.kind === 'missing-migration'
              ? (isRTL
                ? 'تتطلب لوحة الإحصاءات ترحيل قاعدة بيانات لم يُطبَّق بعد على هذا المشروع (admin_order_stats).'
                : 'The dashboard figures require a database migration that has not been applied to this project yet (admin_order_stats).')
              : (isRTL
                ? `تعذّر تحميل إحصاءات الطلبات: ${statsError.message}`
                : `Could not load order statistics: ${statsError.message}`)}
          </Text>
        </Card>
      ) : null}

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
            {totalOrdersCount - activeOrdersCount} {isRTL ? 'مسلَّمة أو ملغاة' : 'delivered or cancelled'}
          </Text>
        </Card>

        <Card>
          <Text variant="caption" tone="tertiary" as="p">{t.stats_ticket}</Text>
          <Text variant="title" as="p" className="mt-1"><Price amount={averageTicketValue} lang={adminLang} /></Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-1">
            {isRTL ? 'شامل ضريبة القيمة المضافة ١٥٪' : 'VAT-inclusive average ticket'}
          </Text>
        </Card>

        <OperationalBranchesCard
          label={t.stats_branches}
          operationalCount={operationalBranchesCount}
          totalCount={branches.length}
          closedCount={closedBranchesCount}
          expanded={showAvailability}
          onToggle={() => setShowAvailability((open) => !open)}
          lang={adminLang}
        />
      </div>

      {showAvailability ? <BranchAvailabilityPanel rows={branchRows} lang={adminLang} /> : null}

      <BranchSalesSection rows={branchRows} lang={adminLang} />
    </div>
  );
};
