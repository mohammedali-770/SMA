import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, PlugZap, RefreshCw } from 'lucide-react';

import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill, type PillTone } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { orders as ordersApi, DbOrder } from '../../lib/api';
import { lazywaitRequeueEligibility, requeueEligibilityMessage, isUsablePosRef } from '../../lib/lazywaitRequeue';
import { LazywaitCatalogMapping } from './LazywaitCatalogMapping';

/**
 * Admin-only Lazywait POS visibility + controls (secure: talks to Supabase via
 * RLS-guarded api calls; no Lazywait secret ever reaches the browser):
 *  - pull the Lazywait catalog + confirm branch/category/product/group/modifier
 *    id mappings (LazywaitCatalogMapping),
 *  - see per-order sync state / ref / order number / blocked reason / last error,
 *  - re-queue a failed / blocked / dead-lettered order.
 * Self-contained (loads its own data) so it drops into Settings without context wiring.
 */
const STATE_TONE: Record<string, PillTone> = {
  synced: 'success',
  syncing: 'info',
  pending: 'neutral',
  failed: 'warning',
  blocked: 'danger',
  dead_letter: 'danger',
  skipped: 'neutral',
};
const RETRYABLE = new Set(['failed', 'blocked', 'dead_letter', 'skipped']);

const TH = 'py-1 pe-2 text-start';
const TD = 'py-1.5 pe-2 align-top';

export const LazywaitPanel: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const [orderRows, setOrderRows] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const o = await ordersApi.list();
      setOrderRows(o.filter((x) => x.lazywait_sync_state && x.lazywait_sync_state !== 'skipped').slice(0, 50));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Lazywait status');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const retry = async (id: string) => {
    setBusy(`order:${id}`);
    setMsg(null);
    setError(null);
    try {
      await ordersApi.requeueLazywait(id);
      setMsg('Order re-queued for Lazywait sync');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-con-line pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <PlugZap className="size-4 shrink-0 text-ember" aria-hidden="true" />
          <div className="min-w-0">
            <Text variant="heading" as="h4">Lazywait POS — Sync Monitor</Text>
            <Text variant="caption" tone="tertiary" as="p" className="mt-0.5">
              Catalog id mapping + per-order sync status &amp; retry
            </Text>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="ds-motion inline-flex min-h-9 shrink-0 items-center gap-1 rounded-[var(--radius-ds-md)] px-2 transition-colors duration-150 hover:bg-con-surface-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <RefreshCw className={`size-3.5 text-ember ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <Text variant="caption" tone="ember" as="span">Refresh</Text>
        </button>
      </div>

      {error && <Notice title={error} tone="blocking" />}
      {msg && <Notice title={msg} tone="success" />}

      {/* Catalog pull + id mapping (branches/categories/products/groups/modifiers) */}
      <LazywaitCatalogMapping disabled={disabled} />

      <div className="border-t border-con-line pt-3">
        <Text variant="caption" tone="secondary" as="p">Recent Order Sync</Text>
        {orderRows.length === 0 ? (
          <Text variant="caption" tone="tertiary" as="p" className="mt-2">
            No orders queued for Lazywait sync yet.
          </Text>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-con-line">
                  {['Order', 'State', 'POS Ref / #', 'Attempts', 'Reason / Error', ''].map((h, i) => (
                    <th key={h || `sp-${i}`} className={TH}>
                      <Text variant="caption" tone="tertiary" as="span">{h}</Text>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orderRows.map((o) => {
                  const state = o.lazywait_sync_state ?? 'pending';
                  // Deadline-safe eligibility (authoritative in the DB; mirrored here
                  // only to hide the action). Never offer Retry for an expired /
                  // ambiguous / already-sent / attempt-exhausted order.
                  const elig = lazywaitRequeueEligibility(o);
                  const canRetry = !disabled && elig === 'requeued';
                  const eligMsg = RETRYABLE.has(state) ? requeueEligibilityMessage(elig) : null;
                  return (
                    <tr key={o.id} className="border-t border-con-line">
                      <td className={TD}>
                        <Text variant="caption" numeric as="span">{o.order_number}</Text>
                      </td>
                      <td className={TD}>
                        <StatusPill label={state} tone={STATE_TONE[state] ?? 'neutral'} />
                      </td>
                      <td className={TD}>
                        <Text variant="caption" tone="secondary" numeric as="span">
                          {o.lazywait_order_number || (o.lazywait_ref ? `${o.lazywait_ref.slice(0, 8)}…` : '—')}
                        </Text>
                      </td>
                      <td className={TD}>
                        <Text variant="caption" tone="secondary" numeric as="span">{o.sync_attempt_count ?? 0}</Text>
                      </td>
                      <td className={`${TD} max-w-[220px] truncate`} title={o.sync_last_error || o.sync_blocked_reason || ''}>
                        {o.sync_blocked_reason || o.sync_last_error ? (
                          <Text variant="caption" tone="secondary" as="span">
                            {o.sync_blocked_reason || o.sync_last_error}
                          </Text>
                        ) : state === 'synced' ? (
                          // 'synced' is only truly confirmed WITH a USABLE POS ref;
                          // flag a marker-only / ref-less synced row instead of "OK".
                          isUsablePosRef(o.lazywait_ref)
                            ? <Text variant="caption" tone="success" as="span">OK</Text>
                            : <Text variant="caption" tone="warning" as="span">synced without usable POS ref — verify</Text>
                        ) : (
                          <Text variant="caption" tone="tertiary" as="span">—</Text>
                        )}
                      </td>
                      <td className={`${TD} text-end`}>
                        {canRetry ? (
                          <button
                            type="button"
                            onClick={() => retry(o.id)}
                            disabled={busy === `order:${o.id}`}
                            className="ds-motion ms-auto inline-flex min-h-8 items-center gap-1 rounded-[var(--radius-ds-sm)] px-2 transition-colors duration-150 hover:bg-con-surface-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            {busy === `order:${o.id}`
                              ? <Loader2 className="size-3 animate-spin text-ember" aria-hidden="true" />
                              : <RefreshCw className="size-3 text-ember" aria-hidden="true" />}
                            <Text variant="caption" tone="ember" as="span">Retry</Text>
                          </button>
                        ) : eligMsg ? (
                          // No Retry action for an expired / ambiguous order — show a
                          // clear internal reason instead of a button that would fail.
                          <Text variant="caption" tone="tertiary" as="span" className="ms-auto block max-w-[150px]">
                            {eligMsg}
                          </Text>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Text variant="caption" tone="tertiary" as="p">
        Delivery orders sync like pickup. The destination is sent as `delivery_address` and repeated in the ticket note; an order with no usable address is held as `missing_delivery_address`.
        Blocked = missing mapping or config; dead-letter = exhausted retries. Configure credentials in the Lazywait card above.
      </Text>
    </Card>
  );
};
