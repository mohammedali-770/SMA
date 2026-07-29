import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldAlert, AlertTriangle, CheckCircle2, Clock, EyeOff, ChevronDown, Loader2 } from 'lucide-react';
import {
  orderIntegrity, OrderIntegrityHealth, OrderIntegrityIncident,
} from '../../lib/api';
import { showAcknowledge, showSuppress } from '../../lib/orderIntegrityTriage';

/**
 * Order Integrity Watchdog — admin monitoring (READ + acknowledge/suppress only).
 * Observe-only: NO Retry / Refund / Resend / Mark-Paid / Auto-Fix actions exist.
 * Every field shown comes from SECURITY DEFINER, staff-gated RPCs that return
 * safe (no-PII) projections; no payment reference, phone, address, provider
 * payload, token or secret is ever fetched here.
 */
const STATE_TONE: Record<string, string> = {
  healthy: 'bg-green-100 text-green-700',
  degraded: 'bg-amber-100 text-amber-700',
  failing: 'bg-red-100 text-red-700',
  configuration_error: 'bg-red-200 text-red-800',
};
const SEV_TONE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
};
const STATUS_TONE: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  acknowledged: 'bg-blue-100 text-blue-700',
  suppressed: 'bg-slate-200 text-slate-600',
  resolved: 'bg-green-100 text-green-700',
};
const RULE_CODES = [
  'PAID_ORDER_NOT_SYNCED', 'PAID_ORDER_AWAITING_PAYMENT', 'CAPTURED_PAYMENT_WITHOUT_ORDER',
  'PAYMENT_AMOUNT_MISMATCH', 'DUPLICATE_PROVIDER_REFERENCE', 'MULTIPLE_SUCCESSFUL_CAPTURES',
  'PAID_ORDER_DEAD_LETTER', 'SYNCED_WITHOUT_USABLE_REFERENCE', 'REFERENCE_WITH_NON_SYNCED_STATE',
  'OVERDUE_SYNC_RETRY', 'ABANDONED_AWAITING_PAYMENT',
];

const ageLabel = (iso: string | null): string => {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

/**
 * @param canTriage  Only admins may acknowledge/suppress (the RPCs are is_admin()
 *   gated and return 42501 otherwise). Accountants get read-only access, so the
 *   triage controls are not rendered for them — the UI never offers an action the
 *   caller cannot perform.
 */
export const OrderIntegrityPanel: React.FC<{ canTriage?: boolean }> = ({ canTriage = false }) => {
  const [health, setHealth] = useState<OrderIntegrityHealth | null>(null);
  const [incidents, setIncidents] = useState<OrderIntegrityIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fSeverity, setFSeverity] = useState<string>('');
  // Default to unresolved (open+acknowledged+suppressed) so the list matches the
  // health counts — acknowledging/suppressing a defect must not hide it from view.
  const [fStatus, setFStatus] = useState<string>('unresolved');
  const [fRule, setFRule] = useState<string>('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Record<string, unknown> | null>(null);
  const [suppressFor, setSuppressFor] = useState<string | null>(null);
  const [supReason, setSupReason] = useState('');
  const [supHours, setSupHours] = useState(24);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [h, list] = await Promise.all([
        orderIntegrity.summary(),
        orderIntegrity.list({
          severity: fSeverity || null, status: fStatus || null, ruleCode: fRule || null, limit: 200,
        }),
      ]);
      setHealth(h); setIncidents(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load order integrity data');
    } finally {
      setLoading(false);
    }
  }, [fSeverity, fStatus, fRule]);
  useEffect(() => { load(); }, [load]);

  const affectedBranches = useMemo(
    () => Array.from(new Set(incidents.filter((i) => i.status !== 'resolved' && i.branch_id).map((i) => i.branch_id as string))),
    [incidents],
  );

  const acknowledge = async (id: string) => {
    setBusy(id); setMsg(null); setError(null);
    try { await orderIntegrity.acknowledge(id); setMsg('Incident acknowledged'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Acknowledge failed'); }
    finally { setBusy(null); }
  };
  const submitSuppress = async (id: string) => {
    if (!supReason.trim()) { setError('A suppression reason is required'); return; }
    setBusy(id); setMsg(null); setError(null);
    try {
      const until = new Date(Date.now() + supHours * 3600_000).toISOString();
      await orderIntegrity.suppress(id, until, supReason.trim());
      setMsg('Incident suppressed'); setSuppressFor(null); setSupReason(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Suppress failed'); }
    finally { setBusy(null); }
  };
  const toggleTimeline = async (id: string) => {
    if (expanded === id) { setExpanded(null); setTimeline(null); return; }
    setExpanded(id); setTimeline(null);
    try { setTimeline(await orderIntegrity.timeline(id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load timeline'); }
  };

  const state = health?.overall_state ?? 'healthy';

  return (
    <div className="glass-card p-4 rounded-2xl bg-white/40 space-y-4">
      <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-primary" />
          <div>
            {/* Title dropped — the shell header carries it. */}
            <p className="text-[9.5px] text-slate-600 font-medium">
              Observe-only shadow mode — no automatic remediation. Alerts are not dispatched in v1.
            </p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="text-[10px] font-black text-primary flex items-center gap-1 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="text-[10px] font-bold text-red-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{error}</div>}
      {msg && <div className="text-[10px] font-bold text-green-700 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />{msg}</div>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="glass-card p-3 rounded-xl bg-white/50">
          <p className="text-[8.5px] font-bold text-slate-600">Overall State</p>
          <span className={`mt-1 inline-block px-2 py-0.5 rounded-full font-black text-[10px] ${STATE_TONE[state] ?? 'bg-slate-100 text-slate-600'}`}>{state}</span>
          <p className="text-[8.5px] text-slate-600 font-medium mt-1">
            cron {health?.watchdog_cron_active ? 'active' : 'inactive'}
          </p>
        </div>
        <div className="glass-card p-3 rounded-xl bg-white/50">
          <p className="text-[8.5px] font-bold text-slate-600">Open Critical</p>
          {/* A red zero reads as "something is wrong" when nothing is. Colour the
              figure only when there is actually something open. */}
          <p className={`text-lg font-black tabular-nums ${(health?.open_critical_count ?? 0) > 0 ? 'text-red-700' : 'text-slate-900'}`}>{health?.open_critical_count ?? 0}</p>
          <p className="text-[8.5px] text-slate-600 font-medium">oldest {ageLabel(health?.oldest_open_critical_at ?? null)}</p>
        </div>
        <div className="glass-card p-3 rounded-xl bg-white/50">
          <p className="text-[8.5px] font-bold text-slate-600">Open Warning</p>
          <p className={`text-lg font-black tabular-nums ${(health?.open_warning_count ?? 0) > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{health?.open_warning_count ?? 0}</p>
          <p className="text-[8.5px] text-slate-600 font-medium">ack {health?.acknowledged_count ?? 0} · suppressed {health?.suppressed_count ?? 0}</p>
        </div>
        <div className="glass-card p-3 rounded-xl bg-white/50">
          <p className="text-[8.5px] font-bold text-slate-600 flex items-center gap-1"><Clock className="w-3 h-3" /> Last Scan</p>
          <p className="text-[11px] font-bold text-slate-700">{health?.latest_successful_run_at ? `${ageLabel(health.latest_successful_run_at)} ago` : '—'}</p>
          <p className="text-[8.5px] text-slate-600 font-medium">24h: +{health?.incidents_opened_last_24h ?? 0} / -{health?.incidents_resolved_last_24h ?? 0}</p>
        </div>
      </div>

      {affectedBranches.length > 0 && (
        <div className="text-[9px] font-bold text-slate-600">
          Affected branches: {affectedBranches.map((b) => <span key={b} className="font-mono">{b.slice(0, 8)}… </span>)}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={fSeverity} onChange={(e) => setFSeverity(e.target.value)} className="text-[10px] font-bold rounded-lg border border-slate-200 px-2 py-1 bg-white/60">
          <option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option>
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="text-[10px] font-bold rounded-lg border border-slate-200 px-2 py-1 bg-white/60">
          <option value="unresolved">Unresolved (active)</option><option value="">All statuses</option>
          <option value="open">Open</option><option value="acknowledged">Acknowledged</option>
          <option value="suppressed">Suppressed</option><option value="resolved">Resolved</option>
        </select>
        <select value={fRule} onChange={(e) => setFRule(e.target.value)} className="text-[10px] font-bold rounded-lg border border-slate-200 px-2 py-1 bg-white/60 max-w-[220px]">
          <option value="">All rules</option>
          {RULE_CODES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Incident list */}
      <div className="overflow-x-auto">
        {incidents.length === 0 ? (
          <p className="text-[10px] text-slate-600 font-medium py-3">No incidents match the current filters.</p>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-slate-600 font-bold text-xs text-left">
                <th className="py-1 pr-2">Rule</th><th className="py-1 pr-2">Sev</th><th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2">Order</th><th className="py-1 pr-2">Branch</th>
                <th className="py-1 pr-2">Last seen</th><th className="py-1 pr-2">Occ</th><th className="py-1 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <React.Fragment key={i.id}>
                  <tr className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-2 font-mono text-slate-700">{i.rule_code}</td>
                    <td className="py-1.5 pr-2"><span className={`px-1.5 py-0.5 rounded-full font-black text-[8.5px] ${SEV_TONE[i.severity]}`}>{i.severity}</span></td>
                    <td className="py-1.5 pr-2"><span className={`px-1.5 py-0.5 rounded-full font-black text-[8.5px] ${STATUS_TONE[i.status]}`}>{i.status}</span></td>
                    <td className="py-1.5 pr-2 font-mono text-slate-600">{i.order_number ?? '—'}</td>
                    <td className="py-1.5 pr-2 font-mono text-slate-600">{i.branch_id ? `${i.branch_id.slice(0, 8)}…` : '—'}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{ageLabel(i.last_detected_at)}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{i.occurrence_count}</td>
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                      <button onClick={() => toggleTimeline(i.id)} className="text-[9px] font-black text-slate-600 inline-flex items-center gap-0.5 mr-2">
                        <ChevronDown className={`w-3 h-3 transition-transform ${expanded === i.id ? 'rotate-180' : ''}`} /> Timeline
                      </button>
                      {showAcknowledge(canTriage, i.status) && (
                        <button onClick={() => acknowledge(i.id)} disabled={busy === i.id}
                          className="text-[9px] font-black text-blue-600 disabled:opacity-50 mr-2 inline-flex items-center gap-0.5">
                          {busy === i.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Ack
                        </button>
                      )}
                      {showSuppress(canTriage, i.status) && (
                        <button onClick={() => { setSuppressFor(suppressFor === i.id ? null : i.id); setSupReason(''); }}
                          className="text-[9px] font-black text-slate-600 inline-flex items-center gap-0.5">
                          <EyeOff className="w-3 h-3" /> Suppress
                        </button>
                      )}
                    </td>
                  </tr>
                  {suppressFor === i.id && (
                    <tr className="bg-slate-50/60"><td colSpan={8} className="py-2 px-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input value={supReason} onChange={(e) => setSupReason(e.target.value)} placeholder="Reason (required)"
                          className="text-[10px] rounded-lg border border-slate-200 px-2 py-1 flex-1 min-w-[160px]" />
                        <label className="text-[9px] font-bold text-slate-600">for
                          <input type="number" min={1} value={supHours} onChange={(e) => setSupHours(Math.max(1, Number(e.target.value)))}
                            className="w-14 text-[10px] rounded-lg border border-slate-200 px-1 py-1 mx-1" />h
                        </label>
                        <button onClick={() => submitSuppress(i.id)} disabled={busy === i.id}
                          className="text-[9px] font-black text-white bg-slate-600 rounded-lg px-2 py-1 disabled:opacity-50">Confirm suppress</button>
                      </div>
                    </td></tr>
                  )}
                  {expanded === i.id && (
                    <tr className="bg-slate-50/60"><td colSpan={8} className="py-2 px-2">
                      <pre className="text-[9px] text-slate-600 whitespace-pre-wrap break-all">
                        {timeline ? JSON.stringify(timeline, null, 2) : 'Loading timeline…'}
                      </pre>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[8.5px] text-slate-600 font-medium leading-snug">
        Detection only. Investigate and remediate through the existing order / payment / Lazywait tools — this panel never
        creates, cancels, resends, refunds, or marks orders paid.
      </p>
    </div>
  );
};
