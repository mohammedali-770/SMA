import React, { useMemo, useState } from 'react';

import { useApp } from '../../context/AppContext';
import { Card } from '../../design-system/ui/Card';
import { Text } from '../../design-system/ui/Text';
import { Price } from '../Price';
import { ADMIN_LOCALES } from './adminLocales';
import { BranchAvailabilityPanel, OperationalBranchesCard } from './view/stats/BranchAvailability';
import { BranchSalesSection } from './view/stats/BranchSalesSection';
import { buildBranchSalesRows } from './view/stats/branchSales';

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

  const [showAvailability, setShowAvailability] = useState(false);

  // One pass over orders for all branches, rather than a full scan per branch
  // plus a full scan per branch to recompute the maximum — which is what the
  // inline version did, inside the render loop.
  const branchRows = useMemo(
    () => buildBranchSalesRows(branches, orders),
    [branches, orders],
  );

  return (
    // Capped so the console does not stretch a four-tile row and a bar chart
    // across an ultrawide monitor, which is most of where the "empty canvas"
    // around the old chart came from.
    <div className="mx-auto w-full max-w-[1200px] space-y-4">
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
