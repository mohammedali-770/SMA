/**
 * Capability probe for the Operations Alerts admin tab.
 *
 * The web bundle may deploy before the repository migration is applied. Hide
 * the tab only when PostgREST confirms that the probed RPC itself is missing.
 * Network, authorization (42501), 5xx and dependent-object failures remain
 * visible so operators see the real error instead of a silently hidden
 * alerting surface.
 */
export type OperationsAlertsCapability = 'available' | 'absent' | 'unknown';

const PROBED_FUNCTION = 'operations_alerts_admin_summary';

export function classifyOperationsAlertsProbe(error: unknown): OperationsAlertsCapability {
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

export function operationsAlertsTabVisible(
  capability: OperationsAlertsCapability | 'loading',
): boolean {
  return capability === 'available' || capability === 'unknown';
}
