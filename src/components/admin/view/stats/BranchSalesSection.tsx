/**
 * Branch sales — the ranked chart, its controls and the full table.
 *
 * Replaces a chart that gave every branch a fixed quarter-width column inside
 * one flex row. With four branches that looked deliberate; with twenty-three it
 * produced overlapping labels, a row wider than the console and a picket fence
 * of identical 12px stubs for every branch that had not sold anything — the
 * branches that HAD traded were the minority of the ink.
 *
 * Three changes fix that, and none of them touch a number:
 *
 *   Bars run HORIZONTALLY. A branch name then occupies a line of text rather
 *   than a column heading, so it can be read at any length and any language
 *   without rotating, truncating to three characters or colliding with its
 *   neighbour. Adding branches makes the list taller, never wider.
 *
 *   The default is the top 8 by sales, not everything.
 *
 *   Branches with no sales are counted in one line instead of drawn. They are
 *   still in the data, still in every KPI, and their names are one click away.
 *
 * The bar fills from the inline-start edge, so it grows left-to-right in
 * English and right-to-left in Arabic with no direction branching.
 */
import React, { useState } from 'react';

import { Button } from '../../../../design-system/ui/Button';
import { Card } from '../../../../design-system/ui/Card';
import { Field } from '../../../../design-system/ui/Field';
import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import { Price } from '../../../Price';
import {
  DEFAULT_BRANCH_SCOPE, barPercent, filterBranchRows, maxSales, selectBranchView,
  type BranchSalesRow, type BranchScope,
} from './branchSales';
import { BranchSalesTable } from './BranchSalesTable';
import { STATS_COPY, type StatsLang } from './statsCopy';

/**
 * A scope selector, local to this panel.
 *
 * Not `ToggleChip`: that one is an on/off STATE and appends "ON"/"OFF" to its
 * label, which is wrong for a three-way choice where exactly one is selected.
 * Not the design-system Button either — four buttons of equal weight beside a
 * search box would put four ember rectangles on a surface whose primary action
 * is elsewhere. `aria-pressed` carries the selection to a screen reader.
 */
function ScopeChip({
  label, selected, onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={[
        'ds-motion inline-flex min-h-9 items-center justify-center rounded-[var(--radius-ds-md)] border px-3',
        'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
        selected
          ? 'border-ember bg-ember'
          : 'border-con-line bg-con-surface-2 hover:bg-con-surface',
      ].join(' ')}
    >
      <Text variant="caption" tone={selected ? 'onEmber' : 'secondary'} as="span">{label}</Text>
    </button>
  );
}

function BranchBar({
  row, rank, max, lang,
}: {
  row: BranchSalesRow;
  rank: number;
  max: number;
  lang: StatsLang;
}) {
  return (
    <li className="flex items-center gap-3">
      <Text variant="caption" tone="tertiary" numeric as="span" className="w-5 shrink-0 text-end">
        {rank}
      </Text>

      {/* Capped rather than fixed: a long Arabic branch name truncates instead
          of pushing the bar off the card. */}
      <Text variant="label" as="span" className="w-24 shrink-0 truncate sm:w-40">
        {lang === 'ar' ? row.nameAr : row.nameEn}
      </Text>

      <span className="h-2.5 min-w-0 flex-1 rounded-full bg-con-surface-2" aria-hidden="true">
        <span
          className="ds-motion block h-full rounded-full bg-ember transition-all duration-500"
          style={{ width: `${barPercent(row.sales, max)}%` }}
        />
      </span>

      <Text variant="label" as="span" className="shrink-0">
        <Price amount={row.sales} lang={lang} />
      </Text>
    </li>
  );
}

export function BranchSalesSection({
  rows,
  lang,
}: {
  /** Every branch, already ranked. Never pre-filtered — this panel scopes it. */
  rows: BranchSalesRow[];
  lang: StatsLang;
}) {
  const c = STATS_COPY[lang];
  const [scope, setScope] = useState<BranchScope>(DEFAULT_BRANCH_SCOPE);
  const [query, setQuery] = useState('');
  const [showTable, setShowTable] = useState(false);
  const [showZeroNames, setShowZeroNames] = useState(false);

  const { bars, zeroSales } = selectBranchView(rows, scope, query);
  const max = maxSales(bars);

  // The table means "all branches", so it answers to the search box but not to
  // the Top-N scope — otherwise "View all" would show eight.
  const tableRows = filterBranchRows(rows, query);

  const scopes: { id: BranchScope; label: string }[] = [
    { id: 'top5', label: c.top5 },
    { id: 'top8', label: c.top8 },
    { id: 'active', label: c.allActive },
  ];

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Text variant="heading" as="h3">{c.branchSales}</Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-0.5">{c.ranked}</Text>
        </div>
        <StatusPill label={lang === 'ar' ? 'تحديث تلقائي' : 'Realtime Sync'} tone="info" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {scopes.map((s) => (
            <ScopeChip
              key={s.id}
              label={s.label}
              selected={scope === s.id}
              onSelect={() => setScope(s.id)}
            />
          ))}
        </div>

        <Field
          label={c.searchLabel}
          value={query}
          onValueChange={setQuery}
          placeholder={c.searchPlaceholder}
          type="search"
          className="w-full min-w-0 sm:w-56"
        />

        <Button
          label={showTable ? c.hideAll : c.viewAll}
          variant="secondary"
          onClick={() => setShowTable((open) => !open)}
        />
      </div>

      {bars.length > 0 ? (
        <ol className="space-y-2.5" data-testid="branch-bars">
          {bars.map((row, i) => (
            <BranchBar key={row.id} row={row} rank={i + 1} max={max} lang={lang} />
          ))}
        </ol>
      ) : zeroSales.length === 0 ? (
        <Text variant="body" tone="tertiary" as="p" className="py-6 text-center">
          {query.trim().length > 0 ? c.noMatch : c.noSalesAtAll}
        </Text>
      ) : (
        // Branches matched, they simply have not traded. The summary below
        // says so; "no branch matches that search" would be a lie.
        null
      )}

      {/* One line for every branch that sold nothing, expandable to names.
          They remain in `rows` and in every KPI above — this is a drawing
          decision, not a filter. */}
      {zeroSales.length > 0 ? (
        <div className="rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Text variant="caption" tone="secondary" as="p">{c.zeroSales(zeroSales.length)}</Text>
            <button
              type="button"
              aria-expanded={showZeroNames}
              onClick={() => setShowZeroNames((open) => !open)}
              className="ds-motion rounded-[var(--radius-ds-sm)] underline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Text variant="caption" tone="ember" as="span">
                {showZeroNames ? c.hideNames : c.showNames}
              </Text>
            </button>
          </div>

          {showZeroNames ? (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {zeroSales.map((row) => (
                <li key={row.id}>
                  <Text variant="caption" tone="tertiary" as="span">
                    {lang === 'ar' ? row.nameAr : row.nameEn}
                  </Text>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {showTable ? <BranchSalesTable rows={tableRows} lang={lang} /> : null}
    </Card>
  );
}
