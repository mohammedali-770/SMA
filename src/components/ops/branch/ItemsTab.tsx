/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Clock, Search } from 'lucide-react';

import { Button } from '../../../design-system/ui/Button';
import { Card } from '../../../design-system/ui/Card';
import { Notice } from '../../../design-system/ui/Notice';
import { Text } from '../../../design-system/ui/Text';
import type { Category, Product } from '../../../types';
import type { BranchAvailabilityRow } from '../../../lib/opsApi';
import {
  ClosedItem, closedProductIds, formatRemaining, searchableGroups, tileHue,
} from '../branchConsole';
import type { OpsLangValue } from '../useOpsLang';
import { ItemTile, TileState } from './ItemTile';

/**
 * The tab a cashier lives in.
 *
 * ORDER IS THE DESIGN. What is off right now sits above the menu, because that
 * is the question being asked mid-rush — "is the thing I just promised actually
 * on?" The menu below it is for the other question, "take this off", and that
 * one is never urgent enough to deserve the top of the screen.
 */
export const ItemsTab: React.FC<{
  products: Product[];
  categories: Category[];
  rows: BranchAvailabilityRow[];
  closed: ClosedItem[];
  optionBlockedIds: Set<string>;
  now: number;
  loading: boolean;
  busy: boolean;
  i18n: OpsLangValue;
  onPick: (product: Product) => void;
  onReopenAll: () => void;
}> = ({
  products, categories, rows, closed, optionBlockedIds, now,
  loading, busy, i18n, onPick, onReopenAll,
}) => {
  const { t, isRTL } = i18n;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const closedIds = useMemo(() => closedProductIds(rows), [rows]);
  const groups = useMemo(
    () => searchableGroups(products, categories, query),
    [products, categories, query],
  );
  const shown = useMemo(
    () => (category ? groups.filter((g) => g.categoryId === category) : groups),
    [groups, category],
  );

  const snoozedUntilById = useMemo(
    () => new Map(closed.map((c) => [c.product.id, c.snoozedUntil])), [closed]);

  /**
   * What the badge on a closed tile says.
   *
   * THREE STATES, NOT TWO, and the third is the one a regression hides. An
   * UNTIMED row is an administrator's delisting and never comes back on its own,
   * so labelling it "reopening now" — which is what a bare `formatRemaining`
   * fallback does — tells a cashier to wait for something that will not happen.
   * The suite caught exactly that in the first draft of this tab.
   */
  const badgeFor = (productId: string): string => {
    const until = snoozedUntilById.get(productId) ?? null;
    if (!until) return t('untimed');
    return formatRemaining(until, now) ?? t('reopeningNow');
  };

  const categoryName = (id: string | null) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return t('uncategorized');
    return isRTL ? c.nameAr : c.nameEn;
  };

  return (
    <div className="flex flex-col gap-3">
      {/*
        The closed strip. It is a Notice-toned panel rather than a Card when
        anything is off, so "something is closed" is legible from across the
        counter without reading a word of it.
      */}
      <div
        className={[
          'flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-ds-lg)] border p-4',
          closed.length > 0 ? 'border-warn-line bg-warn-tint' : 'border-con-line bg-con-surface',
        ].join(' ')}
      >
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface">
            <Clock className="size-5 text-ember" aria-hidden="true" />
          </div>
          <div>
            <Text variant="label" as="p">
              {loading
                ? t('loading')
                : closed.length === 0
                  ? t('closedNoneTitle')
                  : `${closed.length} ${t(closed.length === 1 ? 'closedCountOne' : 'closedCount')}`}
            </Text>
            <Text variant="caption" tone="tertiary" as="p">
              {closed.length > 0 ? t('autoReopenNote') : t('closedNoneBody')}
            </Text>
          </div>
        </div>
        {closed.length > 0 ? (
          <Button
            label={t('reopenAll')}
            onClick={onReopenAll}
            disabled={busy || loading}
            variant="primary"
            data-testid="reopen-all"
          />
        ) : null}
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="relative">
          <Search
            className={`pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-con-text-3 ${isRTL ? 'right-3' : 'left-3'}`}
            aria-hidden="true"
          />
          <input
            aria-label={t('searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className={`min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface text-[15px] text-con-text focus-visible:outline-2 focus-visible:outline-offset-2 ${isRTL ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
          />
        </div>

        {/* Category chips. Horizontal scroll rather than a wrap, so the grid
            below keeps a stable position as categories are switched. */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Chip
            label={t('categoryAll')}
            on={category === null}
            onClick={() => setCategory(null)}
          />
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={isRTL ? c.nameAr : c.nameEn}
              on={category === c.id}
              onClick={() => setCategory(c.id)}
            />
          ))}
        </div>

        {loading ? (
          <Text variant="body" tone="tertiary" as="p">{t('loading')}</Text>
        ) : shown.length === 0 ? (
          <Notice title={t('noResults')} tone="info" />
        ) : (
          shown.map((g) => (
            <div key={g.categoryId ?? '__none'} className="flex flex-col gap-2">
              <Text variant="caption" tone="tertiary" as="h3">{categoryName(g.categoryId)}</Text>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {g.products.map((p) => {
                  const isClosed = closedIds.has(p.id);
                  const state: TileState = isClosed
                    ? 'closed'
                    : optionBlockedIds.has(p.id) ? 'partial' : 'open';
                  return (
                    <ItemTile
                      key={p.id}
                      product={p}
                      state={state}
                      hue={tileHue(g.categoryId, categories)}
                      countdown={isClosed ? badgeFor(p.id) : null}
                      i18n={i18n}
                      disabled={busy}
                      onPick={() => onPick(p)}
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
};

const Chip: React.FC<{ label: string; on: boolean; onClick: () => void }> = ({
  label, on, onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    className={[
      'min-h-[38px] whitespace-nowrap rounded-full border px-4 text-[13.5px] font-semibold',
      'focus-visible:outline-2 focus-visible:outline-offset-2',
      on
        ? 'border-brand-ink bg-brand-ink text-white'
        : 'border-con-line bg-con-surface text-con-text-2',
    ].join(' ')}
  >
    {label}
  </button>
);
