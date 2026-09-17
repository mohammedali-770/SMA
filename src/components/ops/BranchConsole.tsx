/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Store } from 'lucide-react';

import { AdminModal } from '../admin/view/shared/AdminModal';
import { useApp } from '../../context/AppContext';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import {
  BranchAvailabilityRow, BranchModifierAvailabilityRow, BranchReferenceRow,
  BranchVariantAvailabilityRow,
  DeliveryReasonCode, DeliveryRequestRow, OpsReasonCode, opsApi,
} from '../../lib/opsApi';
import type { Modifier, Product, ProductVariant } from '../../types';
import {
  ClosedItem,
  ClosedOption,
  ClosedVariant,
  activeVariants,
  closedItems,
  closedModifierIds,
  closedOptions,
  closedProductIds,
  closedVariantIds,
  closedVariants,
  formatRemaining,
  groupsForProduct,
  productBlockedByOptions,
  productBlockedBySizes,
  reopenAllTargets,
} from './branchConsole';
import { BranchTab, BranchTabs } from './branch/BranchTabs';
import { ItemsTab } from './branch/ItemsTab';
import { VariantSheet } from './branch/VariantSheet';
import { useOpsChangeFeed } from './useOpsChangeFeed';
import { BranchReferenceCard } from './BranchReferenceCard';
import { CloseItemDialog } from './CloseItemDialog';
import { DeliveryRequestCard } from './DeliveryRequestCard';
import { PauseDeliveryDialog } from './PauseDeliveryDialog';
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
  const { branches, products, categories, modifierGroups } = useApp();
  const { t, isRTL } = i18n;

  const [rows, setRows] = useState<BranchAvailabilityRow[]>([]);
  const [modRows, setModRows] = useState<BranchModifierAvailabilityRow[]>([]);
  const [varRows, setVarRows] = useState<BranchVariantAvailabilityRow[]>([]);
  // `app_settings.variant_closing_enabled`. Defaults FALSE and stays false if
  // the read fails for any reason, including the migration not being applied —
  // see opsApi.variantClosingEnabled. False is "carry on exactly as before".
  const [perSizeEnabled, setPerSizeEnabled] = useState(false);
  // Which product's options are open. One at a time: on a POS screen an
  // accordion that can be opened everywhere becomes a wall of text.
  const [tab, setTab] = useState<BranchTab>('items');
  // Which product's price tiers are open. One at a time by construction.
  const [sheetFor, setSheetFor] = useState<Product | null>(null);
  const [confirmReopenAll, setConfirmReopenAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // What the close dialog is aimed at. One piece of state, not two, so the two
  // flows cannot both be open at once.
  const [target, setTarget] = useState<
    | { kind: 'product'; product: Product }
    | { kind: 'option'; modifier: Modifier }
    | { kind: 'variant'; variant: ProductVariant }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Delivery-closure requests and the reference sheet. Both are branch-scoped
  // server-side; nothing here re-checks that, and nothing here should.
  const [requests, setRequests] = useState<DeliveryRequestRow[]>([]);
  const [reference, setReference] = useState<BranchReferenceRow[]>([]);
  const [deliveryClosed, setDeliveryClosed] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

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
      const [productRows, optionRows, variantRows, perSize, requestRows, referenceRows,
             deliveryStates] =
        await Promise.all([
          opsApi.branchAvailability(branchId),
          opsApi.branchModifierAvailability(branchId),
          opsApi.branchVariantAvailability(branchId),
          opsApi.variantClosingEnabled(),
          opsApi.deliveryRequests(branchId),
          opsApi.branchReference(branchId),
          opsApi.branchDeliveryState(),
        ]);
      setRows(productRows);
      setModRows(optionRows);
      setVarRows(variantRows);
      setPerSizeEnabled(perSize);
      setRequests(requestRows);
      setReference(referenceRows);
      setDeliveryClosed(
        deliveryStates.find((d) => d.branchId === branchId)?.deliveryTemporarilyClosed ?? false,
      );
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
    () => [...rows, ...modRows, ...varRows].some((r) => !r.isAvailable && r.snoozedUntil !== null
      && Date.parse(r.snoozedUntil) <= now),
    [rows, modRows, varRows, now],
  );
  useEffect(() => {
    if (!expired) return;
    const id = window.setTimeout(() => { void refresh(); }, 15_000);
    return () => window.clearTimeout(id);
  }, [expired, refresh]);

  const closed = useMemo(() => closedItems(products, rows), [products, rows]);
  const closedIds = useMemo(() => closedProductIds(rows), [rows]);
  const closedOptionIds = useMemo(() => closedModifierIds(modRows), [modRows]);
  // Empty while the per-size controls are off — no closed tier can exist then,
  // and pretending otherwise would let a stale row grey out a live size.
  const closedTierIds = useMemo(
    () => (perSizeEnabled ? closedVariantIds(varRows) : new Set<string>()),
    [varRows, perSizeEnabled],
  );
  /**
   * Products a cashier would read as open that customers cannot actually order,
   * because a REQUIRED option group has been emptied. Surfaced on the tile as
   * "partly closed" — otherwise the counter says yes to something checkout says
   * no to.
   */
  const optionBlocked = useMemo(
    () => new Set(
      products
        .filter((p) => productBlockedByOptions(p, modifierGroups, closedOptionIds)
          || productBlockedBySizes(p, closedTierIds))
        .map((p) => p.id),
    ),
    [products, modifierGroups, closedOptionIds, closedTierIds],
  );
  const closedOpts = useMemo(
    () => closedOptions(modifierGroups, modRows), [modifierGroups, modRows]);
  const closedTiers = useMemo<ClosedVariant[]>(
    () => (perSizeEnabled ? closedVariants(products, varRows) : []),
    [products, varRows, perSizeEnabled],
  );
  const productName = (p: Product) => (isRTL ? p.nameAr : p.nameEn);

  /**
   * Live refresh, which is what makes removing the Refresh button honest.
   *
   * The button was load-bearing until now: this screen re-read on mount and 15s
   * after a countdown expired, and nothing else. `useOpsChangeFeed` is the same
   * hook the call-centre board uses — realtime with a 12s fast poll if the
   * channel does not connect, a 60s backstop regardless, hidden tabs skipped and
   * caught up on return. Wired FIRST, button removed second.
   */
  useOpsChangeFeed(refresh, { channelKey: 'branch' });

  /**
   * Ask the call centre to close delivery.
   *
   * On success this refreshes rather than optimistically inserting a row: the
   * server decides the expiry and may refuse for reasons the client cannot see
   * (a request filed from another device a second earlier). Showing a waiting
   * state the server did not create is exactly the lie this screen must avoid.
   */
  const sendRequest = async (minutes: number, reason: DeliveryReasonCode, note: string) => {
    if (!branchId) return;
    setBusy(true); setDialogError(null);
    try {
      await opsApi.requestDeliveryPause({ branchId, minutes, reasonCode: reason, note });
      setRequesting(false);
      await refresh();
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const withdrawRequest = async (requestId: string) => {
    setBusy(true); setRequestError(null);
    try {
      await opsApi.cancelDeliveryRequest(requestId);
      await refresh();
    } catch (e) {
      setRequestError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmClose = async (minutes: number, reason: OpsReasonCode, note: string) => {
    if (!branchId || !target) return;
    setBusy(true); setDialogError(null);
    try {
      if (target.kind === 'product') {
        await opsApi.snoozeProduct({
          branchId, productId: target.product.id, minutes, reasonCode: reason, note });
      } else if (target.kind === 'option') {
        await opsApi.snoozeModifier({
          branchId, modifierId: target.modifier.id, minutes, reasonCode: reason, note });
      } else {
        await opsApi.snoozeVariant({
          branchId, variantId: target.variant.id, minutes, reasonCode: reason, note });
      }
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

  /**
   * One tap, every closed item at THIS branch.
   *
   * Branch-scoped twice over: the ids come from the rows this branch's own
   * availability query returned, and `clear_product_snooze` re-checks the
   * caller's branch server-side. Neither this component nor a tampered client
   * can widen it to another branch.
   *
   * Failures are collected rather than thrown on the first one. A cashier who
   * taps this wants everything back; stopping at the first refusal would leave
   * an arbitrary half reopened with no indication of which half.
   */
  const reopenAll = async () => {
    if (!branchId) return;
    const ids = reopenAllTargets(closed);
    setBusy(true); setError(null);
    let failed = 0;
    for (const id of ids) {
      try { await opsApi.reopenProduct(branchId, id); } catch { failed += 1; }
    }
    setConfirmReopenAll(false);
    await refresh();
    if (failed > 0) setError(`${t('reopenAllFailed')} (${failed}/${ids.length})`);
    setBusy(false);
  };

  const reopenOption = async (modifierId: string) => {
    if (!branchId) return;
    setBusy(true); setError(null);
    try {
      await opsApi.reopenModifier(branchId, modifierId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reopenTier = async (variantId: string) => {
    if (!branchId) return;
    setBusy(true); setError(null);
    try {
      await opsApi.reopenVariant(branchId, variantId);
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

  const countdownFor = (item: ClosedItem | ClosedOption | ClosedVariant) => {
    if (!item.snoozedUntil) return t('untimed');
    const remaining = formatRemaining(item.snoozedUntil, now);
    return remaining ? `${t('backIn')} ${remaining}` : t('reopeningNow');
  };

  const modifierName = (m: Modifier) => (isRTL ? m.nameAr : m.nameEn);
  // The product name comes too: "Large" on its own does not tell a cashier
  // which item they are about to take off the menu.
  const variantName = (v: ProductVariant) => {
    const p = products.find((x) => x.id === v.productId);
    const tier = isRTL ? v.nameAr : v.nameEn;
    return p ? `${isRTL ? p.nameAr : p.nameEn} — ${tier}` : tier;
  };

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-center gap-3">
        <Store className="size-6 shrink-0 text-ember" aria-hidden="true" />
        <div className="min-w-0">
          <Text variant="title" as="h1">{branch ? (isRTL ? branch.nameAr : branch.nameEn) : ''}</Text>
          <Text variant="caption" tone="tertiary" as="p">{t('branchConsole')}</Text>
        </div>
      </div>

      <BranchTabs
        active={tab}
        closedCount={closed.length}
        i18n={i18n}
        onSelect={setTab}
      />

      {branch && !branch.isActive ? <Notice title={t('branchClosed')} tone="warning" /> : null}
      {error ? <Notice title={t('loadFailed')} action={error} tone="blocking" /> : null}

      {tab === 'items' ? (
        <>
          <ItemsTab
            products={products}
            categories={categories}
            rows={rows}
            closed={closed}
            blockedIds={optionBlocked}
            now={now}
            loading={loading}
            busy={busy}
            i18n={i18n}
            onPick={(p) => {
              // A product with tiers opens the sheet; one without goes straight
              // to the action, because a sheet listing a single price is a step
              // that tells a cashier nothing.
              const hasChoices = activeVariants(p).length > 1
                || groupsForProduct(p, modifierGroups).length > 0;
              if (hasChoices) { setSheetFor(p); return; }
              if (closedIds.has(p.id)) { void reopen(p.id); return; }
              setDialogError(null); setTarget({ kind: 'product', product: p });
            }}
            onReopenAll={() => setConfirmReopenAll(true)}
          />

          {/* Sizes that are off. Same reason as the options card below: a
              closed tier never changes the product's own availability row, so
              without this the cashier's only route to "what is off" would be
              opening every item's sheet in turn. Rendered only when it applies,
              and it cannot apply at all while the controls are switched off. */}
          {closedTiers.length > 0 ? (
            <Card className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-ember" aria-hidden="true" />
                <Text variant="heading" as="h2">{t('closedSizes')}</Text>
                <StatusPill label={String(closedTiers.length)} tone="warning" />
              </div>
              <div className="space-y-2">
                {closedTiers.map((tier) => (
                  <div
                    key={tier.variant.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3"
                    data-testid={`closed-size-${tier.variant.id}`}
                  >
                    <div className="min-w-0">
                      <Text variant="label" as="p">
                        {isRTL ? tier.variant.nameAr : tier.variant.nameEn}
                      </Text>
                      <Text variant="caption" tone="tertiary" as="p">
                        {productName(tier.product)}
                      </Text>
                      <Text variant="caption" tone="tertiary" as="p" numeric>
                        {countdownFor(tier)}
                      </Text>
                    </div>
                    <Button
                      label={t('reopen')}
                      onClick={() => { void reopenTier(tier.variant.id); }}
                      disabled={busy}
                      variant="secondary"
                    />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {/* Options that are off. Kept because closing one can take a product
              off the menu without its own row ever changing — but rendered only
              when it applies, which today is one product in the whole catalog. */}
          {closedOpts.length > 0 ? (
            <Card className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-ember" aria-hidden="true" />
                <Text variant="heading" as="h2">{t('closedOptions')}</Text>
                <StatusPill label={String(closedOpts.length)} tone="warning" />
              </div>
              <div className="space-y-2">
                {closedOpts.map((opt) => (
                  <div
                    key={opt.modifier.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3"
                  >
                    <div className="min-w-0">
                      <Text variant="label" as="p">{modifierName(opt.modifier)}</Text>
                      <Text variant="caption" tone="tertiary" as="p">
                        {isRTL ? opt.group.nameAr : opt.group.nameEn}
                      </Text>
                      <Text variant="caption" tone="tertiary" as="p" numeric>
                        {countdownFor(opt)}
                      </Text>
                    </div>
                    <Button
                      label={t('reopen')}
                      onClick={() => { void reopenOption(opt.modifier.id); }}
                      disabled={busy}
                      variant="secondary"
                    />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === 'general' ? (
        <Card className="space-y-3 p-4">
          <Text variant="heading" as="h2">{t('tabGeneral')}</Text>
          <Notice title={t('referenceEmptyTitle')} action={t('referenceEmptyBody')} tone="info" />
        </Card>
      ) : null}

      {tab === 'branch' ? (
        <BranchReferenceCard
          entries={reference}
          i18n={i18n}
          onReveal={(id) => opsApi.revealReference(id)}
        />
      ) : null}

      {tab === 'delivery' ? (
        <DeliveryRequestCard
          requests={requests}
          deliveryClosed={deliveryClosed}
          now={now}
          busy={busy || requesting}
          error={requestError}
          i18n={i18n}
          onRequest={() => { setRequestError(null); setRequesting(true); }}
          onWithdraw={(id) => { void withdrawRequest(id); }}
        />
      ) : null}

      {sheetFor ? (
        <VariantSheet
          product={sheetFor}
          closed={closedIds.has(sheetFor.id)}
          optionGroups={groupsForProduct(sheetFor, modifierGroups)}
          closedOptionIds={closedOptionIds}
          closedVariantIds={closedTierIds}
          perSizeEnabled={perSizeEnabled}
          i18n={i18n}
          busy={busy}
          onCloseOption={(m) => {
            setSheetFor(null); setDialogError(null);
            setTarget({ kind: 'option', modifier: m });
          }}
          onReopenOption={(m) => { setSheetFor(null); void reopenOption(m.id); }}
          onCloseVariant={(v) => {
            setSheetFor(null); setDialogError(null);
            setTarget({ kind: 'variant', variant: v });
          }}
          onReopenVariant={(v) => { setSheetFor(null); void reopenTier(v.id); }}
          onCloseWhole={() => {
            const p = sheetFor;
            setSheetFor(null);
            setDialogError(null);
            setTarget({ kind: 'product', product: p });
          }}
          onReopenWhole={() => { const id = sheetFor.id; setSheetFor(null); void reopen(id); }}
          onDismiss={() => { if (!busy) setSheetFor(null); }}
        />
      ) : null}

      {confirmReopenAll ? (
        <ConfirmReopenAll
          count={closed.length}
          i18n={i18n}
          busy={busy}
          onCancel={() => { if (!busy) setConfirmReopenAll(false); }}
          onConfirm={() => { void reopenAll(); }}
        />
      ) : null}

      {requesting ? (
        <PauseDeliveryDialog
          branchName={branch ? (isRTL ? branch.nameAr : branch.nameEn) : ''}
          lang={isRTL ? 'ar' : 'en'}
          busy={busy}
          error={dialogError}
          onCancel={() => { setRequesting(false); setDialogError(null); }}
          onConfirm={(minutes, reason, note) => { void sendRequest(minutes, reason, note); }}
          titleKey="requestCloseTitle"
          confirmKey="confirmRequest"
          hintKey="requestHint"
        />
      ) : null}

      {target ? (
        <CloseItemDialog
          productName={target.kind === 'product'
            ? productName(target.product)
            : target.kind === 'option'
              ? modifierName(target.modifier)
              : variantName(target.variant)}
          titleKey={target.kind === 'product'
            ? 'closeTitle'
            : target.kind === 'option' ? 'closeOptionTitle' : 'closeSizeTitle'}
          hintKey={target.kind === 'product'
            ? 'autoReopenHint'
            : target.kind === 'option' ? 'optionAutoReopenHint' : 'sizeAutoReopenHint'}
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

/**
 * The confirm in front of "reopen all".
 *
 * A bulk action a cashier can reach in one tap needs one, because the mistake it
 * prevents is silent: reopening everything looks exactly like a screen that has
 * finished loading. The count is in the title so the confirm carries the size of
 * what is about to happen, and the body says the word BRANCH, because "all" on a
 * forty-branch estate is the frightening reading.
 */
const ConfirmReopenAll: React.FC<{
  count: number;
  i18n: OpsLangValue;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ count, i18n, busy, onCancel, onConfirm }) => {
  const { t, isRTL } = i18n;
  return (
    <AdminModal
      title={t('reopenAllTitle')}
      subtitle={`${count} ${t(count === 1 ? 'closedCountOne' : 'closedCount')}`}
      isRTL={isRTL}
      onClose={onCancel}
      footer={(
        <div className="flex gap-3">
          <Button label={t('cancel')} onClick={onCancel} disabled={busy} variant="secondary" />
          <Button
            label={t('reopenAllConfirm')}
            onClick={onConfirm}
            loading={busy}
            disabled={busy}
            variant="primary"
            data-testid="reopen-all-confirm"
          />
        </div>
      )}
    >
      <Notice title={t('reopenAllBody')} tone="warning" />
    </AdminModal>
  );
};
