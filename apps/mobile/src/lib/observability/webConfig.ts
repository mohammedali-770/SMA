/**
 * Web Sentry configuration resolution — FRAMEWORK-FREE and fully unit-tested.
 *
 * Shared by BOTH web surfaces:
 *   - the admin/staff console (root Vite app, platform tag 'admin-web');
 *   - the customer Expo web export served at /app (platform tag 'expo-web').
 *
 * Every function here is parametric (no process.env / import.meta.env access)
 * because the two runtimes inline environment variables differently: Vite only
 * statically replaces `import.meta.env.VITE_*` and Metro only inlines
 * `process.env.EXPO_PUBLIC_*`. Callers read their own mechanism and pass
 * plain values in. This is also why `../config` (which reads process.env at
 * module scope) must never be imported into the Vite bundle.
 */

/**
 * Owner-provided public DSN — Sentry's PUBLIC ingestion identifier, safe in
 * client bundles by design. Kept as a literal (instead of importing
 * `DEFAULT_SENTRY_DSN` from ./config) because ./config touches process.env at
 * module scope, which throws in a Vite browser bundle. A unit test pins both
 * constants equal so they can never drift.
 */
export const WEB_DEFAULT_SENTRY_DSN =
  'https://fcdc98794ff4488c9e1bc7ac4efed315@o4511778933243904.ingest.de.sentry.io/4511778937765968';

/** Sentry ingest origin (must be present in the deployed CSP connect-src). */
export const SENTRY_INGEST_ORIGIN = 'https://o4511778933243904.ingest.de.sentry.io';

export type WebSentryEnvironment = 'development' | 'preview' | 'production';

/** Platform tag values that distinguish web surfaces from mobile events. */
export type WebSurface = 'admin-web' | 'expo-web';

const VALID_ENVS: ReadonlyArray<WebSentryEnvironment> = ['development', 'preview', 'production'];

/**
 * Environment resolution, first match wins:
 *  1. an explicit override (VITE_SENTRY_ENV / EXPO_PUBLIC_SENTRY_ENV);
 *  2. Vercel's build environment when exposed ('preview' / 'production');
 *  3. hostname heuristics — localhost/127.* is development, Vercel per-branch
 *     preview URLs (…-git-….vercel.app) are preview;
 *  4. dev builds are development; anything else is production (fail toward
 *     the strictest sampling/reporting rules).
 */
export function resolveWebEnvironment(input: {
  explicitEnv?: string | null;
  vercelEnv?: string | null;
  hostname?: string | null;
  isDevBuild: boolean;
}): WebSentryEnvironment {
  const explicit = (input.explicitEnv ?? '').trim().toLowerCase();
  if ((VALID_ENVS as readonly string[]).includes(explicit)) return explicit as WebSentryEnvironment;

  const vercel = (input.vercelEnv ?? '').trim().toLowerCase();
  if (vercel === 'preview') return 'preview';
  if (vercel === 'production') return 'production';
  if (vercel === 'development') return 'development';

  const host = (input.hostname ?? '').trim().toLowerCase();
  if (host === 'localhost' || host.startsWith('127.') || host.endsWith('.local')) {
    return 'development';
  }
  if (host.endsWith('.vercel.app') && host.includes('-git-')) return 'preview';

  return input.isDevBuild ? 'development' : 'production';
}

/**
 * Conservative browser sampling. Profiling stays OFF everywhere (0) — same
 * policy as mobile; enabling it needs separate owner approval.
 */
export function webSampleRates(env: WebSentryEnvironment): {
  tracesSampleRate: number;
  profilesSampleRate: number;
} {
  switch (env) {
    case 'production': return { tracesSampleRate: 0.05, profilesSampleRate: 0 };
    case 'preview': return { tracesSampleRate: 0.15, profilesSampleRate: 0 };
    default: return { tracesSampleRate: 0, profilesSampleRate: 0 };
  }
}

/** True while running under a JS test runner (parametric mirror of ../config). */
export function isWebTestRunner(env: {
  VITEST?: string | boolean;
  JEST_WORKER_ID?: string;
  NODE_ENV?: string;
  MODE?: string;
}): boolean {
  return Boolean(env.VITEST) || Boolean(env.JEST_WORKER_ID)
    || env.NODE_ENV === 'test' || env.MODE === 'test';
}

/**
 * Master enable switch — same semantics as the mobile `isSentryEnabled`:
 * never in test runners, never without a DSN, development only with the
 * explicit opt-in flag, always in preview/production.
 */
export function isWebSentryEnabled(input: {
  env: WebSentryEnvironment;
  testRunner: boolean;
  hasDsn: boolean;
  devOptIn: boolean;
}): boolean {
  if (input.testRunner || !input.hasDsn) return false;
  if (input.env === 'development') return input.devOptIn;
  return true;
}

/**
 * Web release naming: `spicy-meal-web@<12-char commit sha>`. Both web bundles
 * deploy atomically from one commit on Vercel, so they share a release and are
 * distinguished by the surface tag. Symbolication itself relies on Debug IDs,
 * not the release name. Returns undefined (SDK default) when no sha is known
 * (e.g. local development).
 */
export function buildWebRelease(commitSha?: string | null): string | undefined {
  const sha = (commitSha ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return undefined;
  return `spicy-meal-web@${sha.slice(0, 12)}`;
}
