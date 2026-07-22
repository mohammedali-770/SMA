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
