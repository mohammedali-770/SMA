/**
 * Capability probe for the Order Integrity Watchdog admin tab.
 *
 * The watchdog migration (and its RPCs) may not exist yet: after this PR merges,
 * the web app can be deployed to Vercel BEFORE the Production migration is applied.
 * During that window the tab must be hidden so staff never see a broken
 * "function not found" panel — and it must reappear automatically on the next
 * refresh once the migration is applied (no permanently hard-coded feature flag).
 *
 * A confirmed missing function is the ONLY signal that the migration is absent:
 * PostgREST surfaces it as error code `PGRST202` (schema-cache miss). Every other
 * failure — network error, authorization (42501), 5xx — is `unknown` and must NOT
 * be reported as "migration absent"; the tab stays visible so the real error is
 * surfaced in the panel rather than silently swallowed.
 */
export type WatchdogCapability = 'available' | 'absent' | 'unknown';

/** Classify the admin-summary probe result. No error → available. */
export function classifyWatchdogProbe(error: unknown): WatchdogCapability {
  if (!error) return 'available';
  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code.toUpperCase() : '';
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  // PostgREST "Could not find the function public.order_integrity_admin_summary …
  // in the schema cache" (PGRST202) is raised only when the PROBED RPC itself is
  // missing → definitive absent.
  if (code === 'PGRST202') return 'absent';
  // Message-fallback: treat as absent ONLY when the error names the probed function
  // (order_integrity_admin_summary) specifically. A missing *dependent* object —
  // e.g. `relation "order_integrity_incidents" does not exist` after a partial
  // migration/schema drift — means the function EXISTS but failed; that must stay
  // 'unknown' so the real error surfaces in-panel rather than silently hiding the tab.
  if (
    (code === '42883' ||
      msg.includes('could not find the function') ||
      msg.includes('does not exist')) &&
    msg.includes('order_integrity_admin_summary')
  ) {
    return 'absent';
  }
  // Network / auth / 5xx / dependent-object / anything else: NOT migration-absent.
  return 'unknown';
}

/**
 * Whether the Order Integrity tab should be shown. Visible when the capability is
 * available OR unknown (so transient/auth errors surface visibly in the panel);
 * hidden only when the migration is confirmed absent, or while still probing.
 */
export function watchdogTabVisible(cap: WatchdogCapability | 'loading'): boolean {
  return cap === 'available' || cap === 'unknown';
}
