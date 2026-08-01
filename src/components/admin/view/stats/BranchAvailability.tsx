/**
 * The Operational Branches KPI, made answerable.
 *
 * The tile said "18 / 23" and "5 branches closed", which is the moment an
 * operator asks "which five?" — and then leaves the dashboard for Branch
 * Management to find out. The number is unchanged; it now opens onto the
 * branches behind it, grouped by the state they are already in.
 *
 * No availability rule is introduced here. `open`, `temporarily unavailable`
 * and `closed` are the three combinations of the two flags the branch model
 * already carries and `BranchCard` already edits, and the reason line is
 * derived from those same flags — the model has no free-text reason, so none
 * is invented.
 *
 * The KPI stays a single tile in the grid; the breakdown renders full-width
 * BELOW the row, because three lists of branch names inside a quarter-width
 * card is how the old chart's crowding started.
 */
import React from 'react';

import { Card } from '../../../../design-system/ui/Card';
import { Text } from '../../../../design-system/ui/Text';
import { BranchStatusPill, statusReason } from './BranchSalesTable';
import { groupByStatus, type BranchSalesRow, type BranchStatus } from './branchSales';
import { STATS_COPY, type StatsLang } from './statsCopy';

export function OperationalBranchesCard({
  label,
  operationalCount,
  totalCount,
  closedCount,
  expanded,
  onToggle,
  lang,
}: {
  /** The KPI's own name, from ADMIN_LOCALES — unchanged by this reorganisation. */
  label: string;
  operationalCount: number;
  totalCount: number;
  closedCount: number;
  expanded: boolean;
  onToggle: () => void;
  lang: StatsLang;
}) {
  const c = STATS_COPY[lang];
  const isRTL = lang === 'ar';

  return (
    // Tinted only when a branch is actually closed, so a healthy board
    // stays quiet and a real closure stands out.
    <Card tone={closedCount > 0 ? 'warning' : 'surface'} flush>
      {/* The whole tile is the control. Its children are spans, not
          paragraphs: a button may only contain phrasing content, and a <p>
          inside one is invalid markup that browsers silently restructure. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? c.hideBreakdown : c.showBreakdown}
        className={[
          'ds-motion flex w-full flex-col rounded-[var(--radius-ds-lg)] p-4 text-start',
          'transition-colors duration-150 hover:bg-con-surface',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
        ].join(' ')}
      >
        <Text variant="caption" tone="tertiary" as="span" className="block">
          {label}
        </Text>

        <Text variant="title" numeric as="span" className="mt-1 block">
          {operationalCount} / {totalCount}
        </Text>

        <Text
          variant="caption"
          tone={closedCount > 0 ? 'warning' : 'tertiary'}
          as="span"
          className="mt-1 block"
        >
          {closedCount} {isRTL ? 'فروع مغلقة للصيانة' : 'branches closed'}
        </Text>

        <Text variant="caption" tone="ember" as="span" className="mt-2 block">
          {expanded ? c.hideBreakdown : c.showBreakdown}
        </Text>
      </button>
    </Card>
  );
}

function StatusColumn({
  status, rows, lang,
}: {
  status: BranchStatus;
  rows: BranchSalesRow[];
  lang: StatsLang;
}) {
  const c = STATS_COPY[lang];
  const reason = statusReason(status, lang);

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <BranchStatusPill status={status} lang={lang} />
        <Text variant="caption" tone="tertiary" numeric as="span">{rows.length}</Text>
      </div>

      {reason ? (
        <Text variant="caption" tone="tertiary" as="p">{reason}</Text>
      ) : null}

      {rows.length > 0 ? (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.id}>
              <Text variant="body" as="span" className="block truncate">
                {lang === 'ar' ? row.nameAr : row.nameEn}
              </Text>
            </li>
          ))}
        </ul>
      ) : (
        <Text variant="caption" tone="tertiary" as="p">{c.none}</Text>
      )}
    </div>
  );
}

export function BranchAvailabilityPanel({
  rows,
  lang,
}: {
  rows: BranchSalesRow[];
  lang: StatsLang;
}) {
  const c = STATS_COPY[lang];
  const groups = groupByStatus(rows);

  return (
    <Card className="space-y-3">
      <Text variant="heading" as="h3">{c.breakdownTitle}</Text>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatusColumn status="open" rows={groups.open} lang={lang} />
        <StatusColumn status="temporarily_unavailable" rows={groups.temporarily_unavailable} lang={lang} />
        <StatusColumn status="closed" rows={groups.closed} lang={lang} />
      </div>
    </Card>
  );
}
