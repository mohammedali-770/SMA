/**
 * Observability wiring for the ADMIN/STAFF console (root Vite app,
 * surface tag 'admin-web').
 *
 * The implementation lives in the shared browser core
 * (apps/mobile/src/lib/observability/webCore.ts) together with the
 * framework-free, unit-tested sanitization/classification/route modules —
 * one privacy pipeline for every web surface. This module only feeds it the
 * Vite-specific environment inputs and re-exports the safe API.
 *
 * ADMIN PRIVACY CONTRACT (stricter than the customer app): never pass table
 * contents, customer/order/payment records, account-deletion requests, alert
 * or digest payloads, health snapshots, credentials, staff identities, or
 * search/filter values. Only safe operational metadata — panel name,
 * operation, safe error code, HTTP status, latency, counts. Everything is
 * deep-sanitized anyway, but the contract is codes + names, not payloads.
 * No admin user identity is attached at all in v1.
 */
export {
  captureWebException, captureWebMessage, addSafeWebBreadcrumb,
  setSafeWebContext, withWebErrorMonitoring, captureWebRenderError,
  isWebObservabilityInitialized, webObservabilityEnvironment,
  type SafeWebCaptureContext, type WebObservabilitySubsystem,
} from '../../../apps/mobile/src/lib/observability/webCore';

import { initWebObservability } from '../../../apps/mobile/src/lib/observability/webCore';

/**
 * Initialize browser Sentry exactly once for the admin console. Call before
 * the React root renders. Returns whether the SDK is enabled (always false
 * under vitest and in dev without VITE_SENTRY_DEV=1). Never throws.
 */
export function initAdminObservability(): boolean {
  // Every value is read as a DIRECT `import.meta.env.X` member expression —
  // never through an alias — because vite.config.ts injects the two
  // VITE_VERCEL_* values via `define`, and static replacement of the literal
  // expression is the only behavior Vite guarantees across versions.
  return initWebObservability({
    surface: 'admin-web',
    dsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
    explicitEnv: import.meta.env.VITE_SENTRY_ENV as string | undefined,
    // Injected at build time from Vercel's system env (see vite.config.ts);
    // empty when absent — hostname heuristics cover that case.
    vercelEnv: import.meta.env.VITE_VERCEL_ENV as string | undefined,
    commitSha: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined,
    isDevBuild: Boolean(import.meta.env.DEV),
    devOptIn: import.meta.env.VITE_SENTRY_DEV === '1',
    testRunnerEnv: { MODE: import.meta.env.MODE as string | undefined },
  });
}
