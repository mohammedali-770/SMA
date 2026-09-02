/**
 * Pure view-state for the Order Integrity Watchdog.
 *
 * Everything here is a total function of its inputs — no React, no fetch, no
 * clock except one that is injectable. That is the point: the panel's derived
 * values (relative ages, the affected-branch set, the suppression deadline,
 * whether a reason is acceptable) were previously inline expressions that could
 * only be checked by looking at a rendered table. They are now checkable.
 *
 * NOTHING in this module changes behaviour. Each function is the expression
 * that was already there, lifted verbatim:
 *
 *   ageLabel            identical thresholds (60s / 3600s / 86400s) and suffixes
 *   deriveAffectedBranches   `status !== 'resolved' && branch_id`, de-duplicated,
 *                            first-seen order preserved via Set insertion order
 *   suppressUntilIso    `Date.now() + hours * 3600_000` → ISO
 *   isSuppressReasonValid    `reason.trim()` must be non-empty
 *
 * The tone maps translate the panel's ad-hoc Tailwind pairs to design-system
 * StatusPill tones. Severity and status keep their exact previous meaning; only
 * the colour source changes.
 */
import type { PillTone } from '../../../../design-system/ui/StatusPill';

/** Incident shape this module needs. Narrower than OrderIntegrityIncident on purpose. */
export interface IncidentLike {
  status: string;
  branch_id?: string | null;
}

/**
 * Relative age, coarsest useful unit. Clamped at zero so a row whose timestamp
 * is fractionally ahead of the client clock reads "0s" rather than a negative.
 *
 * `now` is injectable ONLY so this can be tested; production passes nothing and
 * gets Date.now(), exactly as before.
 */
export function ageLabel(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Branches with at least one UNRESOLVED incident.
 *
 * Resolved incidents are excluded deliberately: this line tells an operator
 * where to look right now, and a branch whose only defect is already resolved
 * is not somewhere to look.
 */
export function deriveAffectedBranches(incidents: IncidentLike[]): string[] {
  return Array.from(
    new Set(
      incidents
        .filter((i) => i.status !== 'resolved' && i.branch_id)
        .map((i) => i.branch_id as string),
    ),
  );
}

/** Suppression deadline: `hours` from now, as an ISO instant for the RPC. */
export function suppressUntilIso(hours: number, now: number = Date.now()): string {
  return new Date(now + hours * 3600_000).toISOString();
}

/**
 * A suppression MUST carry a reason. Suppressing a payment-integrity defect is
 * a decision someone has to be able to answer for later, so an empty or
 * whitespace-only reason is refused before the RPC is called.
 */
export function isSuppressReasonValid(reason: string): boolean {
  return reason.trim().length > 0;
}

/** Hours input is clamped to a minimum of 1 — a zero-hour suppression is a no-op. */
export function clampSuppressHours(raw: number): number {
  return Math.max(1, Number(raw));
}

/** Overall watchdog state → pill tone. */
export function stateTone(state: string | null | undefined): PillTone {
  switch (state) {
    case 'healthy': return 'success';
    case 'degraded': return 'warning';
    case 'failing':
    case 'configuration_error': return 'danger';
    default: return 'neutral';
  }
}

/** Incident severity → pill tone. */
export function severityTone(severity: string): PillTone {
  return severity === 'critical' ? 'danger' : 'warning';
}

/**
 * Incident status → pill tone.
 *
 * `acknowledged` is INFO, not success: someone has seen it, nothing is fixed.
 * `suppressed` is neutral — deliberately muted, because a suppressed defect is
 * hidden on purpose and should not compete for attention with an open one.
 */
export function statusTone(status: string): PillTone {
  switch (status) {
    case 'open': return 'danger';
    case 'acknowledged': return 'info';
    case 'resolved': return 'success';
    case 'suppressed':
    default: return 'neutral';
  }
}

/**
 * Rule codes offered in the filter. Order is the displayed order.
 *
 * THIS LIST MUST MATCH THE RULES THE WATCHDOG ACTUALLY EVALUATES. It is the only
 * source for the dropdown (`IntegrityFilters.tsx`), so a code missing here means
 * incidents that exist, page somebody, and then cannot be filtered like every
 * other rule. Nothing tied the two together until 2026-08-31 — the rules live in
 * a migration and this list is TypeScript, so they drifted silently the moment
 * R12/R13 were added. `integrityRuleParity.test.ts` now pins them.
 */
export const RULE_CODES = [
  'PAID_ORDER_NOT_SYNCED', 'PAID_ORDER_AWAITING_PAYMENT', 'CAPTURED_PAYMENT_WITHOUT_ORDER',
  'PAYMENT_AMOUNT_MISMATCH', 'DUPLICATE_PROVIDER_REFERENCE', 'MULTIPLE_SUCCESSFUL_CAPTURES',
  'PAID_ORDER_DEAD_LETTER', 'SYNCED_WITHOUT_USABLE_REFERENCE', 'REFERENCE_WITH_NON_SYNCED_STATE',
  'OVERDUE_SYNC_RETRY', 'ABANDONED_AWAITING_PAYMENT',
  'UNPAID_ORDER_NOT_SYNCED', 'UNPAID_ORDER_DEAD_LETTER',
];

/** Short display form for a branch/order uuid. */
export function shortId(id: string | null | undefined): string {
  return id ? `${id.slice(0, 8)}…` : '—';
}
