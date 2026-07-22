/**
 * Sentry configuration resolution — FRAMEWORK-FREE and fully unit-tested.
 *
 * The DSN below is Sentry's PUBLIC ingestion identifier for
 * org `first-taste-trading-company`, project `react-native`. A DSN is not a
 * privileged secret and is expected to ship inside client bundles. The
 * SENTRY_AUTH_TOKEN (management/upload token) is a real secret and must exist
 * ONLY in EAS/CI encrypted secret storage — never in this repository.
 */

export const SENTRY_ORG = 'first-taste-trading-company';
export const SENTRY_PROJECT = 'react-native';

/** Owner-provided public DSN (the baked-in fallback). */
export const DEFAULT_SENTRY_DSN =
  'https://fcdc98794ff4488c9e1bc7ac4efed315@o4511778933243904.ingest.de.sentry.io/4511778937765968';

/** Effective DSN (env override supported for future rotation). */
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? DEFAULT_SENTRY_DSN;

export type SentryEnvironment = 'development' | 'preview' | 'production';

const VALID_ENVS: ReadonlyArray<SentryEnvironment> = ['development', 'preview', 'production'];

/**
 * Environment resolution:
 *  - an explicit EXPO_PUBLIC_SENTRY_ENV (set per EAS build profile) wins;
 *  - otherwise __DEV__ implies 'development';
 *  - otherwise a release binary defaults to 'production'.
 */
export function resolveSentryEnvironment(input: {
  explicitEnv?: string | null;
  isDev: boolean;
}): SentryEnvironment {
  const explicit = (input.explicitEnv ?? '').trim().toLowerCase();
  if ((VALID_ENVS as readonly string[]).includes(explicit)) return explicit as SentryEnvironment;
  return input.isDev ? 'development' : 'production';
}

/**
 * Conservative sampling. Profiling stays OFF everywhere until separately
 * justified and approved. Development trace rate is irrelevant in practice
 * (the SDK is disabled in development unless explicitly opted in) but is kept
 * at 0 for defense in depth.
 */
export function sentrySampleRates(env: SentryEnvironment): {
  tracesSampleRate: number;
  profilesSampleRate: number;
} {
  switch (env) {
    case 'production': return { tracesSampleRate: 0.08, profilesSampleRate: 0 };
    case 'preview': return { tracesSampleRate: 0.2, profilesSampleRate: 0 };
    default: return { tracesSampleRate: 0, profilesSampleRate: 0 };
  }
}

/** True while running under a JS test runner (vitest/jest). */
export function isTestRunner(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VITEST) || Boolean(env.JEST_WORKER_ID) || env.NODE_ENV === 'test';
}

/**
 * Master enable switch:
 *  - never in test runners;
 *  - never without a DSN;
 *  - in 'development' only with the explicit opt-in flag
 *    EXPO_PUBLIC_SENTRY_DEV=1 (keeps day-to-day dev noise out of Sentry while
 *    still allowing the internal verification flow);
 *  - always in 'preview' and 'production' builds.
 */
export function isSentryEnabled(input: {
  env: SentryEnvironment;
  testRunner: boolean;
  hasDsn: boolean;
  devOptIn: boolean;
}): boolean {
  if (input.testRunner || !input.hasDsn) return false;
  if (input.env === 'development') return input.devOptIn;
  return true;
}

/**
 * Canonical release naming used by Sentry's native SDKs by default:
 *   <bundle id>@<version>+<build number>
 * e.g. com.spicymeal.app@1.0.0+42 (iOS) / sa.com.spicymeal.app@1.0.0+42 (Android).
 * The SDK derives this automatically from the native binary, which is the
 * source of truth under EAS remote versioning; this helper exists so the
 * naming contract is pinned by tests and reusable for any future web release.
 */
export function buildSentryRelease(input: {
  appId?: string | null;
  version?: string | null;
  build?: string | null;
}): string | undefined {
  const { appId, version, build } = input;
  if (!appId || !version || !build) return undefined;
  return `${appId}@${version}+${build}`;
}
