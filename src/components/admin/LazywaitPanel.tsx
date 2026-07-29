import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2, AlertCircle, Check, PlugZap } from 'lucide-react';
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
const STATE_TONE: Record<string, string> = {
  synced: 'bg-green-100 text-green-700',
  syncing: 'bg-blue-100 text-blue-700',
  pending: 'bg-slate-100 text-slate-600',
  failed: 'bg-amber-100 text-amber-700',
  blocked: 'bg-red-100 text-red-700',
  dead_letter: 'bg-red-200 text-red-800',
  skipped: 'bg-slate-100 text-slate-400',
};
const RETRYABLE = new Set(['failed', 'blocked', 'dead_letter', 'skipped']);

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
    <div className="glass-card p-4 rounded-2xl bg-white/40 space-y-4">
      <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <PlugZap className="w-4 h-4 text-primary" />
          <div>
            <h4 className="text-xs font-black text-slate-800 uppercase">Lazywait POS — Sync Monitor</h4>
            <p className="text-[9.5px] text-slate-600 font-bold mt-0.5">Catalog id mapping + per-order sync status & retry</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="text-[10px] font-black text-primary flex items-center gap-1 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="text-[10px] font-bold text-red-700 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{error}</div>
      )}
      {msg && (
        <div className="text-[10px] font-bold text-green-700 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</div>
      )}

      {/* Catalog pull + id mapping (branches/categories/products/groups/modifiers) */}
      <LazywaitCatalogMapping disabled={disabled} />

      {/* Per-order sync status */}
      <div className="border-t border-slate-100 pt-3">
        <span className="text-[10px] font-black text-slate-600 uppercase">Recent Order Sync</span>
        {orderRows.length === 0 ? (
          <p className="text-[10px] text-slate-600 font-bold mt-2">No orders queued for Lazywait sync yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-slate-600 font-black uppercase text-[8.5px] text-left">
                  <th className="py-1 pr-2">Order</th>
                  <th className="py-1 pr-2">State</th>
                  <th className="py-1 pr-2">POS Ref / #</th>
                  <th className="py-1 pr-2">Attempts</th>
                  <th className="py-1 pr-2">Reason / Error</th>
                  <th className="py-1 pr-2"></th>
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
                    <tr key={o.id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2 font-bold text-slate-700">{o.order_number}</td>
                      <td className="py-1.5 pr-2">
                        <span className={`px-1.5 py-0.5 rounded-full font-black text-[8.5px] ${STATE_TONE[state] ?? 'bg-slate-100 text-slate-600'}`}>{state}</span>
                      </td>
                      <td className="py-1.5 pr-2 font-mono text-slate-600">
                        {o.lazywait_order_number || (o.lazywait_ref ? `${o.lazywait_ref.slice(0, 8)}…` : '—')}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-600">{o.sync_attempt_count ?? 0}</td>
                      <td className="py-1.5 pr-2 text-slate-600 max-w-[220px] truncate" title={o.sync_last_error || o.sync_blocked_reason || ''}>
                        {o.sync_blocked_reason || o.sync_last_error || (
                          state === 'synced'
                            // 'synced' is only truly confirmed WITH a USABLE POS ref;
                            // flag a marker-only / ref-less synced row instead of "OK".
                            ? (isUsablePosRef(o.lazywait_ref)
                                ? 'OK'
                                : <span className="text-amber-700 font-bold">synced without usable POS ref — verify</span>)
                            : '—')}
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        {canRetry ? (
                          <button
                            onClick={() => retry(o.id)}
                            disabled={busy === `order:${o.id}`}
                            className="text-[9px] font-black text-primary flex items-center gap-1 disabled:opacity-50 ml-auto"
                          >
                            {busy === `order:${o.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Retry
                          </button>
                        ) : eligMsg ? (
                          // No Retry action for an expired / ambiguous order — show a
                          // clear internal reason instead of a button that would fail.
                          <span className="text-[8.5px] font-bold text-slate-600 leading-tight block max-w-[150px] ml-auto">{eligMsg}</span>
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

      <p className="text-[8.5px] text-slate-600 font-bold leading-snug">
        Delivery orders are intentionally not synced (Lazywait delivery Create Order schema unconfirmed).
        Blocked = missing mapping or config; dead-letter = exhausted retries. Configure credentials in the Lazywait card above.
      </p>
    </div>
  );
};
