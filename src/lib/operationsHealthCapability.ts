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
export type HealthBadge = { state: OperationsHealthBadgeState; count: number } | null;

/** The three states bad enough to interrupt someone on another tab. */
export type OperationsHealthBadgeState = 'degraded' | 'failing' | 'configuration_error';

const BADGE_STATES: readonly string[] = ['degraded', 'failing', 'configuration_error'];

export function deriveHealthBadge(
  summary: { overall_state?: string; critical_attention_count?: number } | null | undefined,
  tabVisible: boolean,
): HealthBadge {
  if (!tabVisible || !summary) return null;

  const state = summary.overall_state ?? '';
  if (!BADGE_STATES.includes(state)) return null;

  // Fall back to 1 rather than 0. `critical_attention_count` counts itemised
  // attention rows, and a subsystem can be `degraded` without producing one —
  // rendering "0" or nothing at all would then contradict the state that
  // earned the badge in the first place.
  const raw = summary.critical_attention_count;
  const count = typeof raw === 'number' && raw > 0 ? raw : 1;

  return { state: state as OperationsHealthBadgeState, count };
}
