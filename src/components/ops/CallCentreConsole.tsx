/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, Headset, RefreshCw } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { LiveModeBadge } from '../admin/view/LiveModeBadge';
import { DeliveryArea, WorkingHoursDay, branchConfig } from '../../lib/branchConfigApi';
import {
  BranchAvailabilityRow, BranchModifierAvailabilityRow, DeliveryReasonCode, opsApi,
} from '../../lib/opsApi';
import {
  BranchClosureSummary, buildClosureSummaries, newlyClosedBranchIds, optionOnlyBranches,
  returnLabel, severityBand,
} from './callCentre';
import { PauseDeliveryDialog } from './PauseDeliveryDialog';
import { BranchDetailPanel } from './BranchDetailPanel';
import { playAlertBeep } from './alertSound';
import { useOpsChangeFeed } from './useOpsChangeFeed';
import type { OpsLangValue } from './useOpsLang';

const SOUND_KEY = 'sm-ops-sound';

const TILE_TONE: Record<'critical' | 'warning' | 'info', string> = {
  critical: 'border-danger-line bg-danger-tint',
  warning: 'border-warn-line bg-warn-tint',
  info: 'border-con-line bg-con-surface',
};

/**
 * The cross-branch board.
 *
 * It shows ONLY branches with something wrong. A dashboard that lists every
 * healthy branch so an operator can hunt for the one that is not has stopped
 * answering the question it exists for — and on a phone, mid-call, that hunt is
 * the whole cost.
 *
 * Tiles are colour-banded rather than numerically ranked, because someone
 * scanning a wall reads a colour, not a count. Delivery being off is always
 * critical: it is the only state that stops a customer ordering at all.
 */
export const CallCentreConsole: React.FC<{ i18n: OpsLangValue }> = ({ i18n }) => {
  const { branches, products, modifierGroups } = useApp();
  const { t, isRTL, lang } = i18n;

  const [availability, setAvailability] = useState<(BranchAvailabilityRow & { branchId: string })[]>([]);
  const [modAvailability, setModAvailability] =
    useState<(BranchModifierAvailabilityRow & { branchId: string })[]>([]);
  const [areas, setAreas] = useState<DeliveryArea[]>([]);
  const [hours, setHours] = useState<WorkingHoursDay[]>([]);
  const [hoursBranchId, setHoursBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const [openBranchId, setOpenBranchId] = useState<string | null>(null);
  const [pauseBranchId, setPauseBranchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [sound, setSound] = useState<boolean>(() => {
    try { return window.localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(SOUND_KEY, sound ? 'on' : 'off'); } catch { /* private mode */ }
  }, [sound]);

  // One timer for the whole board rather than one per countdown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      // One round of reads, and one failure mode. A partial board is worse than
      // an error here: an operator cannot tell "no options closed" from "the
      // option read failed", and would tell a customer the item is fine.
      const [avail, modAvail, allAreas] = await Promise.all([
        opsApi.allAvailability(),
        opsApi.allModifierAvailability(),
        branchConfig.allAreas(),
      ]);
      setAvailability(avail);
      setModAvailability(modAvail);
      setAreas(allAreas);
      setLastUpdated(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const liveMode = useOpsChangeFeed(refresh, { channelKey: 'call-centre' });

  const boardInput = useMemo(
    () => ({
      branches, products, availability, areas,
      modifierGroups, modifierAvailability: modAvailability,
    }),
    [branches, products, availability, areas, modifierGroups, modAvailability],
  );
  const summaries = useMemo(() => buildClosureSummaries(boardInput), [boardInput]);
  // Branches whose only issue is an option that blocks nothing. Not board-worthy
  // — every item is still orderable — but "can I get garlic sauce at Jeddah?" is
  // a real call, and without this it has no answer anywhere.
  const optionOnly = useMemo(() => optionOnlyBranches(boardInput), [boardInput]);

  // Alert on a branch that has just appeared or got worse. Comparing per-branch
  // severity rather than a total means one branch recovering cannot mask another
  // failing — which is precisely when someone needs telling.
  const previous = useRef<BranchClosureSummary[] | null>(null);
  useEffect(() => {
    // Gate on the fetch, not on the ref. The effect runs once before any data
    // arrives, so the ref captured an EMPTY board and the first successful load
    // then read as "every branch just broke" — a toast and a beep per branch,
    // every time an operator opened the console.
    if (loading || lastUpdated === null) return;
    const before = previous.current;
    previous.current = summaries;
    if (!before) return;                       // first load is not news
    const fresh = newlyClosedBranchIds(before, summaries);
    if (fresh.length === 0) return;
    const first = summaries.find((s) => s.branch.id === fresh[0]);
    setToast(`${t('newClosure')}: ${first ? (isRTL ? first.branch.nameAr : first.branch.nameEn) : ''}`);
    if (sound) playAlertBeep();
  }, [summaries, sound, t, isRTL, loading, lastUpdated]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Trading hours are only needed once a panel is open, so they load then.
  useEffect(() => {
    if (!openBranchId || openBranchId === hoursBranchId) return;
    let disposed = false;
    void (async () => {
      try {
        const rows = await branchConfig.workingHours(openBranchId);
        if (!disposed) { setHours(rows); setHoursBranchId(openBranchId); }
      } catch {
        if (!disposed) { setHours([]); setHoursBranchId(openBranchId); }
      }
    })();
    return () => { disposed = true; };
  }, [openBranchId, hoursBranchId]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setActionError(null);
    try { await fn(); await refresh(); }
    catch (e) { setActionError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const openSummary = summaries.find((s) => s.branch.id === openBranchId) ?? null;
  const pauseBranch = branches.find((b) => b.id === pauseBranchId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Headset className="size-6 text-ember shrink-0" aria-hidden="true" />
          <Text variant="title" as="h1">{t('callCentreConsole')}</Text>
          <LiveModeBadge mode={liveMode} lastUpdated={lastUpdated} lang={lang} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={sound}
            onClick={() => setSound((v) => !v)}
            aria-label={sound ? t('soundOn') : t('soundOff')}
            className="ds-motion inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 transition-colors duration-150 hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {sound ? <Bell className="size-4 text-ember" aria-hidden="true" />
                   : <BellOff className="size-4 text-con-text-3" aria-hidden="true" />}
            <Text variant="label" tone="secondary" as="span">{sound ? t('soundOn') : t('soundOff')}</Text>
          </button>
          <Button label={t('refresh')} onClick={() => { void refresh(); }} disabled={loading || busy}
            variant="secondary" leading={<RefreshCw className="size-4" />} />
        </div>
      </div>

      {toast ? <Notice title={toast} tone="warning" /> : null}
      {error ? <Notice title={t('loadFailed')} action={error} tone="blocking" /> : null}
      {actionError ? <Notice title={t('loadFailed')} action={actionError} tone="blocking" /> : null}

      {loading ? (
        <Text variant="body" tone="tertiary" as="p">{t('loading')}</Text>
      ) : error ? (
        // Deliberately nothing. An empty board next to a load error is not an
        // all-clear, and rendering "every branch is running normally" beside a
        // red banner is the one output an operator must never be given.
        null
      ) : summaries.length === 0 ? (
        <Notice title={t('boardAllClearTitle')} action={t('boardAllClearBody')} tone="success" />
      ) : (
        <>
          <Text variant="heading" as="h2">
            {t('boardNeedsAttention')} ({summaries.length})
          </Text>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((s) => {
              const band = severityBand(s);
              const soonest = s.closedProducts[0];
              // One triage number, and it is the one the sort uses. Two numbers
              // to add up is one number too many for someone scanning a wall.
              const unavailable = s.closedProducts.length + s.blockedProducts.length;
              return (
                <button
                  key={s.branch.id}
                  type="button"
                  onClick={() => { setActionError(null); setOpenBranchId(s.branch.id); }}
                  className={`ds-motion rounded-[var(--radius-ds-lg)] border p-4 text-start transition-colors duration-150 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 ${TILE_TONE[band]}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Text variant="heading" as="span">{isRTL ? s.branch.nameAr : s.branch.nameEn}</Text>
                    {s.deliveryPaused
                      ? <StatusPill label={t('deliveryPausedLabel')} tone="danger" />
                      : null}
                  </div>
                  <div className="mt-2 space-y-0.5">
                    {unavailable > 0 ? (
                      <Text variant="caption" tone="secondary" as="p" numeric>
                        {unavailable} {t('itemsUnavailableCount')}
                      </Text>
                    ) : null}
                    {s.blockedProducts.length > 0 ? (
                      <Text variant="caption" tone="danger" as="p" numeric>
                        {s.blockedProducts.length} {t('blockedCountLabel')}
                      </Text>
                    ) : null}
                    {s.disabledAreas.length > 0 ? (
                      <Text variant="caption" tone="secondary" as="p" numeric>
                        {s.disabledAreas.length} {t('areasDisabledCount')}
                      </Text>
                    ) : null}
                    <Text variant="caption" tone="tertiary" as="p" numeric>
                      {(() => {
                        // Delivery first. It is the only state that stops a
                        // customer ordering at all, it is what makes this tile
                        // red, and "when does delivery come back" is the
                        // question being asked while the tile is on screen.
                        if (s.deliveryPaused) {
                          if (!s.deliveryUntil) return t('deliveryPausedUntimed');
                          const r = returnLabel(s.deliveryUntil, now);
                          return r ? `${t('deliveryResumesIn')} ${r}` : t('deliveryResumingNow');
                        }
                        if (soonest) {
                          const r = returnLabel(soonest.snoozedUntil, now);
                          if (!soonest.snoozedUntil) return t('untimed');
                          return r ? `${t('backIn')} ${r}` : t('reopeningNow');
                        }
                        // A branch whose ONLY problem is blocked products used to
                        // show no time at all — no time for exactly the case this
                        // board could not previously see. `earliestReturn` is
                        // derived arithmetic, so it never borrows `backIn`, which
                        // an operator has learned to read as a time a human set.
                        const first = s.blockedProducts[0];
                        if (!first) return null;
                        if (!first.earliestReturn) return t('returnUnknown');
                        const r = returnLabel(first.earliestReturn, now);
                        // `reopeningNow` is what a branch timer says when it
                        // lapses. A prediction gets its own word for the same
                        // moment, or it starts sounding like a promise.
                        return r ? `${t('earliestReturn')} ${r}` : t('returnLapsed');
                      })()}
                    </Text>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {optionOnly.length > 0 ? (
        <Card className="space-y-2 p-4">
          <Text variant="label" as="h2">{t('optionOnlyTitle')}</Text>
          <Text variant="caption" tone="tertiary" as="p">{t('optionOnlyBody')}</Text>
          {optionOnly.map((b) => (
            <div key={b.branch.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Text variant="caption" tone="secondary" as="span">
                {isRTL ? b.branch.nameAr : b.branch.nameEn}
              </Text>
              {/* Names, not a count. "Jeddah: 2 options closed" cannot answer
                  "can I get garlic sauce?", which is the only reason to show
                  this at all. */}
              <Text variant="caption" tone="tertiary" as="span">
                {b.closedOptions
                  .map((o) => (isRTL ? o.modifier.nameAr : o.modifier.nameEn))
                  .join(isRTL ? '، ' : ', ')}
              </Text>
            </div>
          ))}
        </Card>
      ) : null}

      {openSummary ? (
        <BranchDetailPanel
          summary={openSummary}
          hours={hoursBranchId === openSummary.branch.id ? hours : []}
          areas={areas.filter((a) => a.branchId === openSummary.branch.id)}
          now={now}
          busy={busy}
          error={actionError}
          i18n={i18n}
          onClose={() => { if (!busy) setOpenBranchId(null); }}
          onResumeDelivery={() => { void act(() => opsApi.resumeDelivery(openSummary.branch.id)); }}
          onPauseDelivery={() => { setPauseBranchId(openSummary.branch.id); setOpenBranchId(null); }}
          onToggleArea={(a) => {
            void act(() => a.isDisabled
              ? opsApi.enableArea(a.id)
              : opsApi.disableArea({ areaId: a.id, minutes: 60, reasonCode: 'area_incident' }));
          }}
        />
      ) : null}

      {pauseBranch ? (
        <PauseDeliveryDialog
          branchName={isRTL ? pauseBranch.nameAr : pauseBranch.nameEn}
          lang={lang}
          busy={busy}
          error={actionError}
          onCancel={() => { if (!busy) setPauseBranchId(null); }}
          onConfirm={(minutes, reason: DeliveryReasonCode, note) => {
            void act(async () => {
              await opsApi.pauseDelivery({ branchId: pauseBranch.id, minutes, reasonCode: reason, note });
              setPauseBranchId(null);
            });
          }}
        />
      ) : null}
    </div>
  );
};
