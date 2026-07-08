import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2, AlertCircle, Check, MapPin, PlugZap } from 'lucide-react';
import { catalog, orders as ordersApi, admin as adminApi, DbBranch, DbOrder } from '../../lib/api';

/**
 * Admin-only Lazywait POS visibility + controls (secure: talks to Supabase via
 * RLS-guarded api calls; no Lazywait secret ever reaches the browser):
 *  - map each local branch to its Lazywait branch_id,
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
  const [branches, setBranches] = useState<DbBranch[]>([]);
  const [orderRows, setOrderRows] = useState<DbOrder[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, o] = await Promise.all([catalog.branches(), ordersApi.list()]);
      setBranches(b);
      setMapping(Object.fromEntries(b.map((x) => [x.id, x.lazywait_branch_id ?? ''])));
      setOrderRows(o.filter((x) => x.lazywait_sync_state && x.lazywait_sync_state !== 'skipped').slice(0, 50));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Lazywait status');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveBranch = async (id: string) => {
    setBusy(`branch:${id}`);
    setMsg(null);
    setError(null);
    try {
      await adminApi.updateBranch(id, { lazywait_branch_id: mapping[id]?.trim() || null });
      setMsg('Branch mapping saved');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

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

  const unmapped = branches.filter((b) => !b.lazywait_branch_id).length;

  return (
    <div className="glass-card p-4 rounded-2xl bg-white/40 space-y-4">
      <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <PlugZap className="w-4 h-4 text-primary" />
          <div>
            <h4 className="text-xs font-black text-slate-800 uppercase">Lazywait POS — Sync Monitor</h4>
            <p className="text-[9.5px] text-slate-400 font-bold mt-0.5">Branch mapping + per-order sync status & retry</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="text-[10px] font-black text-primary flex items-center gap-1 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="text-[10px] font-bold text-red-600 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{error}</div>
      )}
      {msg && (
        <div className="text-[10px] font-bold text-green-600 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</div>
      )}

      {/* Branch mapping */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <MapPin className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[10px] font-black text-slate-600 uppercase">Branch Mapping</span>
          {unmapped > 0 && <span className="text-[8px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{unmapped} unmapped</span>}
        </div>
        <div className="space-y-2">
          {branches.map((b) => (
            <div key={b.id} className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-700 w-40 truncate" title={b.name_en}>{b.name_en}</span>
              <input
                type="text"
                value={mapping[b.id] ?? ''}
                disabled={disabled}
                placeholder="lazywait_branch_id"
                aria-label={`Lazywait branch id for ${b.name_en}`}
                onChange={(e) => setMapping((m) => ({ ...m, [b.id]: e.target.value }))}
                className="glass-input flex-1 p-1.5 font-mono text-[11px] text-slate-800 disabled:opacity-50"
              />
              <button
                onClick={() => saveBranch(b.id)}
                disabled={disabled || busy === `branch:${b.id}`}
                className="glass-btn-primary text-[9px] py-1 px-3 font-black text-white disabled:opacity-50 flex items-center gap-1"
              >
                {busy === `branch:${b.id}` && <Loader2 className="w-3 h-3 animate-spin" />} Save
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Per-order sync status */}
      <div>
        <span className="text-[10px] font-black text-slate-600 uppercase">Recent Order Sync</span>
        {orderRows.length === 0 ? (
          <p className="text-[10px] text-slate-400 font-bold mt-2">No orders queued for Lazywait sync yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-slate-400 font-black uppercase text-[8.5px] text-left">
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
                  const canRetry = !disabled && RETRYABLE.has(state) && o.order_type !== 'delivery';
                  return (
                    <tr key={o.id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2 font-bold text-slate-700">{o.order_number}</td>
                      <td className="py-1.5 pr-2">
                        <span className={`px-1.5 py-0.5 rounded-full font-black text-[8.5px] ${STATE_TONE[state] ?? 'bg-slate-100 text-slate-500'}`}>{state}</span>
                      </td>
                      <td className="py-1.5 pr-2 font-mono text-slate-500">
                        {o.lazywait_order_number || (o.lazywait_ref ? `${o.lazywait_ref.slice(0, 8)}…` : '—')}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-500">{o.sync_attempt_count ?? 0}</td>
                      <td className="py-1.5 pr-2 text-slate-500 max-w-[220px] truncate" title={o.sync_last_error || o.sync_blocked_reason || ''}>
                        {o.sync_blocked_reason || o.sync_last_error || (state === 'synced' ? 'OK' : '—')}
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        {canRetry && (
                          <button
                            onClick={() => retry(o.id)}
                            disabled={busy === `order:${o.id}`}
                            className="text-[9px] font-black text-primary flex items-center gap-1 disabled:opacity-50 ml-auto"
                          >
                            {busy === `order:${o.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[8.5px] text-slate-400 font-bold leading-snug">
        Delivery orders are intentionally not synced (Lazywait delivery Create Order schema unconfirmed).
        Blocked = missing mapping or config; dead-letter = exhausted retries. Configure credentials in the Lazywait card above.
      </p>
    </div>
  );
};
