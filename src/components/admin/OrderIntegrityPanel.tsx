import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react';

import {
  orderIntegrity, OrderIntegrityHealth, OrderIntegrityIncident,
} from '../../lib/api';
import { showAcknowledge, showSuppress } from '../../lib/orderIntegrityTriage';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
import { IntegrityFilters } from './view/integrity/IntegrityFilters';
import { IntegritySummary } from './view/integrity/IntegritySummary';
import { IntegrityTable } from './view/integrity/IntegrityTable';
import {
  clampSuppressHours, deriveAffectedBranches, isSuppressReasonValid, shortId, suppressUntilIso,
} from './view/integrity/integrityView';

/**
 * Order Integrity Watchdog — admin monitoring (READ + acknowledge/suppress only).
 * Observe-only: NO Retry / Refund / Resend / Mark-Paid / Auto-Fix actions exist.
 * Every field shown comes from SECURITY DEFINER, staff-gated RPCs that return
 * safe (no-PII) projections; no payment reference, phone, address, provider
 * payload, token or secret is ever fetched here.
 *
 * This file owns STATE, API CALLS AND PERMISSION DECISIONS. Layout lives in
 * `./view/integrity/*`, and the derived values — relative age, affected
 * branches, the suppression deadline, reason validation — moved to
 * `integrityView.ts` so they can be tested directly instead of being inferred
 * from a rendered table. Each was lifted verbatim; none changed.
 */

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

  const affectedBranches = useMemo(() => deriveAffectedBranches(incidents), [incidents]);

  const acknowledge = async (id: string) => {
    setBusy(id); setMsg(null); setError(null);
    try { await orderIntegrity.acknowledge(id); setMsg('Incident acknowledged'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Acknowledge failed'); }
    finally { setBusy(null); }
  };
  const submitSuppress = async (id: string) => {
    if (!isSuppressReasonValid(supReason)) { setError('A suppression reason is required'); return; }
    setBusy(id); setMsg(null); setError(null);
    try {
      const until = suppressUntilIso(supHours);
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

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3 border-b border-con-line pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldAlert className="size-4 shrink-0 text-ember" aria-hidden="true" />
          <div className="min-w-0">
            <Text variant="heading" as="h4">Order Integrity Watchdog</Text>
            <Text variant="caption" tone="tertiary" as="p">
              Observe-only shadow mode — no automatic remediation. Alerts are not dispatched in v1.
            </Text>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="ds-motion inline-flex min-h-9 shrink-0 items-center gap-1 rounded-[var(--radius-ds-md)] px-2 hover:bg-con-surface-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <RefreshCw className={`size-3.5 text-ember ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <Text variant="label" tone="ember" as="span">Refresh</Text>
        </button>
      </div>

      {/* A failed load is blocking: the table below is stale or empty, and an
          operator must not read it as "no incidents". */}
      {error && <Notice title={error} tone="blocking" />}

      {msg && (
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5 text-mint" aria-hidden="true" />
          <Text variant="label" tone="success" as="span">{msg}</Text>
        </span>
      )}

      <IntegritySummary health={health} />

      {affectedBranches.length > 0 && (
        <Text variant="caption" tone="tertiary" as="p">
          Affected branches:{' '}
          {affectedBranches.map((b) => (
            <span key={b} className="font-ds-num">{shortId(b)} </span>
          ))}
        </Text>
      )}

      <IntegrityFilters
        severity={fSeverity}
        onSeverity={setFSeverity}
        status={fStatus}
        onStatus={setFStatus}
        rule={fRule}
        onRule={setFRule}
      />

      <IntegrityTable
        incidents={incidents}
        busyId={busy}
        expandedId={expanded}
        timeline={timeline}
        suppressForId={suppressFor}
        suppressReason={supReason}
        suppressHours={supHours}
        canAcknowledge={(i) => showAcknowledge(canTriage, i.status)}
        canSuppress={(i) => showSuppress(canTriage, i.status)}
        onToggleTimeline={toggleTimeline}
        onAcknowledge={acknowledge}
        onOpenSuppress={(id) => { setSuppressFor(suppressFor === id ? null : id); setSupReason(''); }}
        onSuppressReason={setSupReason}
        onSuppressHours={(v) => setSupHours(clampSuppressHours(v))}
        onSubmitSuppress={submitSuppress}
      />

      <Text variant="caption" tone="tertiary" as="p">
        Detection only. Investigate and remediate through the existing order / payment / Lazywait tools — this panel never
        creates, cancels, resends, refunds, or marks orders paid.
      </Text>
    </Card>
  );
};
