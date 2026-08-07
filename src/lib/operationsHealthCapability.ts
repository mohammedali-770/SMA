/**
 * Capability probe for the Operations Health Center admin tab.
 *
 * The web bundle may deploy before the repository migration is applied. Hide
 * the tab only when PostgREST confirms that the probed RPC itself is missing.
 * Network, authorization, 5xx and dependent-object failures remain visible so
 * operators see the real error instead of a silently hidden health surface.
 */
export type OperationsHealthCapability = 'available' | 'absent' | 'unknown';

const PROBED_FUNCTION = 'operations_health_summary';

export function classifyOperationsHealthProbe(error: unknown): OperationsHealthCapability {
  if (!error) return 'available';

  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code.toUpperCase() : '';
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';

  if (code === 'PGRST202') return 'absent';

  if (
    (code === '42883' || message.includes('could not find the function') || message.includes('does not exist'))
    && message.includes(PROBED_FUNCTION)
  ) {
    return 'absent';
  }

  return 'unknown';
}

export function operationsHealthTabVisible(
  capability: OperationsHealthCapability | 'loading',
): boolean {
  return capability === 'available' || capability === 'unknown';
}

/**
 * What the sidebar badge should say, given a health summary.
 *
 * Pure so it can be tested without a DOM: which states earn an interruption is
 * a judgement call, and a judgement call that lives inline in a 270-line
 * component is a judgement call nobody can check.
 *
 * `null` means show nothing. That is the answer for a healthy platform, for an
 * `idle` one, while the probe is still resolving, and when the health tab is
 * hidden altogether — in every one of those cases the console does not know of
 * a problem, and a badge would be asserting one.
 */
export type HealthBadge = {
  state: OperationsHealthBadgeState;
  /**
   * Which counter the number came from, and therefore how it must be worded.
   * A `degraded` platform emits WARNING attention items, so its
   * `critical_attention_count` is 0 — announcing that as "1 critical alert"
   * both invents a number and overstates the severity.
   */
  severity: 'critical' | 'warning';
  count: number;
} | null;

/** The three states bad enough to interrupt someone on another tab. */
export type OperationsHealthBadgeState = 'degraded' | 'failing' | 'configuration_error';

/** Which counter each badge-worthy state should be read from. */
const BADGE_SEVERITY: Record<OperationsHealthBadgeState, 'critical' | 'warning'> = {
  failing: 'critical',
  configuration_error: 'critical',
  degraded: 'warning',
};

export interface HealthBadgeSource {
  overall_state?: string;
  critical_attention_count?: number;
  warning_attention_count?: number;
}

export function deriveHealthBadge(
  summary: HealthBadgeSource | null | undefined,
  tabVisible: boolean,
): HealthBadge {
  if (!tabVisible || !summary) return null;

  const state = summary.overall_state ?? '';
  if (!(state in BADGE_SEVERITY)) return null;
  const badgeState = state as OperationsHealthBadgeState;
  const severity = BADGE_SEVERITY[badgeState];

  // Read the counter that matches the severity. Reading `critical` for a
  // degraded platform is how "1 critical operations alert" got announced for a
  // state that raised no critical item at all.
  const raw = severity === 'critical'
    ? summary.critical_attention_count
    : summary.warning_attention_count;

  // Fall back to 1, not 0. A subsystem can reach a badge-worthy state without
  // producing an itemised attention row, and a danger badge reading "0"
  // contradicts the state that earned it.
  const count = typeof raw === 'number' && raw > 0 ? raw : 1;

  return { state: badgeState, severity, count };
}
