/**
 * The full branch table behind "View all branches" — PRESENTATION ONLY.
 *
 * Everything the chart cannot show without becoming unreadable: order count,
 * average ticket and operational status, per branch. It scrolls INTERNALLY on
 * a narrow screen (`overflow-x-auto` on the wrapper, not the page) which is the
 * same idiom the orders table already uses — a wide table is allowed to scroll,
 * the console is not.
 */
import React from 'react';

import { StatusPill, type PillTone } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import { Price } from '../../../Price';
import type { BranchSalesRow, BranchStatus } from './branchSales';
import { STATS_COPY, type StatsLang } from './statsCopy';

const TH = 'px-3 py-2 text-start';
const TD = 'px-3 py-3 align-top';

const STATUS_TONE: Record<BranchStatus, PillTone> = {
  open: 'success',
  temporarily_unavailable: 'warning',
  closed: 'danger',
};

export function statusLabel(status: BranchStatus, lang: StatsLang): string {
  const c = STATS_COPY[lang];
  if (status === 'open') return c.statusOpen;
  return status === 'temporarily_unavailable' ? c.statusTemporary : c.statusClosed;
}

/**
 * The reason a branch is not fully open, where the model actually knows one.
 *
 * Derived from the same two flags `BranchCard` edits — there is no free-text
 * reason column, so an open branch gets no reason rather than a filler string.
 */
export function statusReason(status: BranchStatus, lang: StatsLang): string | null {
  const c = STATS_COPY[lang];
  if (status === 'temporarily_unavailable') return c.reasonTemporary;
  if (status === 'closed') return c.reasonClosed;
  return null;
}

export function BranchStatusPill({ status, lang }: { status: BranchStatus; lang: StatsLang }) {
  return <StatusPill label={statusLabel(status, lang)} tone={STATUS_TONE[status]} />;
}

export function BranchSalesTable({
  rows,
  lang,
}: {
  rows: BranchSalesRow[];
  lang: StatsLang;
}) {
  const c = STATS_COPY[lang];
  const headers = [c.colBranch, c.colSales, c.colOrders, c.colAvgTicket, c.colStatus];

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-con-line">
            {headers.map((h) => (
              <th key={h} className={TH}>
                <Text variant="caption" tone="tertiary" as="span">{h}</Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const reason = statusReason(row.status, lang);
            return (
              <tr key={row.id} className="border-t border-con-line">
                <td className={TD}>
                  <Text variant="label" as="p">{lang === 'ar' ? row.nameAr : row.nameEn}</Text>
                </td>
                <td className={TD}>
                  <Text variant="label" as="p"><Price amount={row.sales} lang={lang} /></Text>
                </td>
                <td className={TD}>
                  <Text variant="label" numeric as="p">{row.orderCount}</Text>
                </td>
                <td className={TD}>
                  <Text variant="label" as="p"><Price amount={row.averageTicket} lang={lang} /></Text>
                </td>
                <td className={TD}>
                  <BranchStatusPill status={row.status} lang={lang} />
                  {reason ? (
                    <Text variant="caption" tone="tertiary" as="p" className="mt-1">{reason}</Text>
                  ) : null}
                </td>
              </tr>
            );
          })}

          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="py-12 text-center">
                <Text variant="body" tone="tertiary" as="p">{c.noMatch}</Text>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
