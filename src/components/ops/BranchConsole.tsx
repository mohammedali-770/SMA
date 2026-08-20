/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, RefreshCw, Search, Store } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { BranchAvailabilityRow, OpsReasonCode, opsApi } from '../../lib/opsApi';
import type { Product } from '../../types';
import {
  ClosedItem,
  closedItems,
  closedProductIds,
  formatRemaining,
  searchableGroups,
} from './branchConsole';
import { CloseItemDialog } from './CloseItemDialog';
import type { OpsLangValue } from './useOpsLang';

/**
 * The screen a cashier uses on the POS iPad.
 *
 * Three decisions worth stating, because each replaces something the admin
 * console does differently:
 *
 *  - The branch is PINNED from the server-side assignment. There is no branch
 *    picker, so the "closed the item at the wrong branch" mistake that
 *    STAFF_MANUAL warns about cannot be made here.
 *  - Closed items sit at the TOP with live countdowns. What a cashier needs
 *    mid-rush is "what is off, and when does it come back" — not the menu.
 *  - The list is searched and grouped by category. The equivalent admin control
 *    is a 140px-tall scroll of every product in the catalog.
 */
export const BranchConsole: React.FC<{ branchId: string | null; i18n: OpsLangValue }> = ({
  branchId,
  i18n,
}) => {
  const { branches, products, categories } = useApp();
  const { t, isRTL } = i18n;

  const [rows, setRows] = useState<BranchAvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Drives the countdowns. One timer for the whole screen rather than one per
  // row, so a branch with thirty closed items still ticks once a second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const branch = useMemo(() => branches.find((b) => b.id === branchId) ?? null, [branches, branchId]);

  const refresh = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setError(null);
    try {
      setRows(await opsApi.branchAvailability(branchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // A timer that has run out is only reopened by the server sweeper, which runs
  // once a minute. Re-reading shortly after expiry keeps the screen honest
  // instead of leaving a row stuck at "reopening now".
  const expired = useMemo(
    () => rows.some((r) => !r.isAvailable && r.snoozedUntil !== null
      && Date.parse(r.snoozedUntil) <= now),
    [rows, now],
  );
  useEffect(() => {
    if (!expired) return;
    const id = window.setTimeout(() => { void refresh(); }, 15_000);
    return () => window.clearTimeout(id);
  }, [expired, refresh]);

  const closed = useMemo(() => closedItems(products, rows), [products, rows]);
  const closedIds = useMemo(() => closedProductIds(rows), [rows]);
  const groups = useMemo(
    () => searchableGroups(products, categories, query),
    [products, categories, query],
  );

  const categoryName = (id: string | null) => {
    if (id === null) return t('uncategorized');
    const c = categories.find((x) => x.id === id);
    return c ? (isRTL ? c.nameAr : c.nameEn) : t('uncategorized');
  };
  const productName = (p: Product) => (isRTL ? p.nameAr : p.nameEn);

  const confirmClose = async (minutes: number, reason: OpsReasonCode, note: string) => {
    if (!branchId || !target) return;
    setBusy(true); setDialogError(null);
    try {
      await opsApi.snoozeProduct({ branchId, productId: target.id, minutes, reasonCode: reason, note });
      setTarget(null);
      await refresh();
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (productId: string) => {
    if (!branchId) return;
    setBusy(true); setError(null);
    try {
      await opsApi.reopenProduct(branchId, productId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!branchId) {
    return (
      <Card className="p-5">
        <Notice title={t('noBranchTitle')} action={t('noBranchBody')} tone="warning" />
      </Card>
    );
  }

  const countdownFor = (item: ClosedItem) => {
    if (!item.snoozedUntil) return t('untimed');
    const remaining = formatRemaining(item.snoozedUntil, now);
    return remaining ? `${t('backIn')} ${remaining}` : t('reopeningNow');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Store className="size-6 text-ember shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <Text variant="title" as="h1">{branch ? (isRTL ? branch.nameAr : branch.nameEn) : ''}</Text>
            <Text variant="caption" tone="tertiary" as="p">{t('branchConsole')}</Text>
          </div>
        </div>
        <Button
          label={t('refresh')}
          onClick={() => { void refresh(); }}
          disabled={loading || busy}
          variant="secondary"
          leading={<RefreshCw className="size-4" />}
        />
      </div>

      {branch && !branch.isActive ? <Notice title={t('branchClosed')} tone="warning" /> : null}
      {error ? <Notice title={t('loadFailed')} action={error} tone="blocking" /> : null}

      {/* ---- what is off right now ---- */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-ember" aria-hidden="true" />
          <Text variant="heading" as="h2">{t('closedNow')}</Text>
          {closed.length > 0 ? <StatusPill label={String(closed.length)} tone="warning" /> : null}
        </div>

        {loading ? (
          <Text variant="body" tone="tertiary" as="p">{t('loading')}</Text>
        ) : closed.length === 0 ? (
          <Notice title={t('closedNoneTitle')} action={t('closedNoneBody')} tone="success" />
        ) : (
          <div className="space-y-2">
            {closed.map((item) => (
              <div
                key={item.product.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3"
              >
                <div className="min-w-0">
                  <Text variant="label" as="p">{productName(item.product)}</Text>
                  <Text variant="caption" tone="tertiary" as="p" numeric>
                    {countdownFor(item)}
                  </Text>
                </div>
                <Button
                  label={t('reopen')}
                  onClick={() => { void reopen(item.product.id); }}
                  disabled={busy}
                  variant="secondary"
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---- the menu ---- */}
      <Card className="space-y-3 p-4">
        <Text variant="heading" as="h2">{t('allItems')}</Text>
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

        {groups.length === 0 ? (
          <Text variant="body" tone="tertiary" as="p">{t('noResults')}</Text>
        ) : (
          groups.map((g) => (
            <div key={g.categoryId ?? '__none'} className="space-y-2">
              <Text variant="caption" tone="tertiary" as="h3">{categoryName(g.categoryId)}</Text>
              {g.products.map((p) => {
                const isClosed = closedIds.has(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Text variant="label" as="span">{productName(p)}</Text>
                      {isClosed ? <StatusPill label={t('close')} tone="danger" /> : null}
                    </div>
                    <Button
                      label={isClosed ? t('reopen') : t('close')}
                      onClick={() => { if (isClosed) { void reopen(p.id); } else { setDialogError(null); setTarget(p); } }}
                      disabled={busy}
                      variant="secondary"
                    />
                  </div>
                );
              })}
            </div>
          ))
        )}
      </Card>

      {target ? (
        <CloseItemDialog
          productName={productName(target)}
          i18n={i18n}
          busy={busy}
          error={dialogError}
          onCancel={() => { if (!busy) setTarget(null); }}
          onConfirm={(m, r, n) => { void confirmClose(m, r, n); }}
        />
      ) : null}
    </div>
  );
};
