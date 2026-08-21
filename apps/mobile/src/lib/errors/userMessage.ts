/**
 * Turn any thrown value into something a CUSTOMER can act on.
 *
 * Why this exists: a customer on a corporate Wi-Fi that intercepts TLS saw
 *
 *   fetch failed: UnexpectedException: A TLS error caused the secure
 *   connection to fail. (at ExpoModulesCore/Promise.swift:56)
 *
 * printed on the login screen. That text tells them nothing they can do, names
 * an internal Swift file, and reads like the app is broken when the network is
 * the thing at fault. Screens used to render `err.message` verbatim, so ANY
 * transport failure could surface like that.
 *
 * This module is the single place that decides what a failure means. It is
 * pure and framework-free (no React Native, Expo or Sentry imports) so the unit
 * suite can exercise every branch directly; the reporting side lives in
 * `reportFailure.ts`.
 *
 * The technical text is never discarded — it is handed to the caller for
 * Sentry, so the friendly message costs us nothing diagnostically.
 */
import type { StringKey } from '../../i18n/strings';

export type FailureKind =
  /** No usable connection at all. */
  | 'offline'
  /** Reachable network, but something between us and the server refused the
   *  connection — captive portals and TLS-inspecting corporate proxies. */
  | 'network_blocked'
  | 'timeout'
  | 'rate_limited'
  /** The server answered, and it was a server-side fault. */
  | 'server'
  /** Anything we have not taught this module to recognise. */
  | 'unknown';

export interface Failure {
  kind: FailureKind;
  /** Localized, customer-safe copy. */
  messageKey: StringKey;
  /** The original text, for diagnostics ONLY — never render this. */
  technical: string;
}

const MESSAGE_KEY: Record<FailureKind, StringKey> = {
  offline: 'errOffline',
  network_blocked: 'errNetworkBlocked',
  timeout: 'errTimeout',
  rate_limited: 'errRateLimited',
  server: 'errServer',
  unknown: 'somethingWentWrong',
};

/** The raw text of whatever was thrown, without assuming it was an Error. */
export function technicalText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return String(err ?? '');
}

/**
 * Classify a thrown value.
 *
 * ORDER MATTERS. A TLS failure arrives wrapped as "fetch failed: … A TLS error
 * …", so the interception case must be tested BEFORE the generic fetch-failure
 * case or every blocked corporate network would be reported to the customer as
 * "you appear to be offline" — which is both wrong and unactionable, since
 * their connection is fine.
 */
export function describeFailure(err: unknown): Failure {
  const technical = technicalText(err);
  const s = technical.toLowerCase();

  const kind: FailureKind =
    /\btls\b|\bssl\b|certificate|secure connection|sslhandshake|cert_authority/.test(s)
      ? 'network_blocked'
    : /rate.?limit|too many requests|\b429\b|too many attempts/.test(s)
      ? 'rate_limited'
    : /timeout|timed out|\baborted\b|abort ?error/.test(s)
      ? 'timeout'
    : /network request failed|failed to fetch|fetch failed|network error|no internet|offline|unable to resolve host|could not connect/.test(s)
      ? 'offline'
    : /\b5\d\d\b|internal server error|service unavailable|bad gateway|gateway timeout/.test(s)
      ? 'server'
    : 'unknown';

  return { kind, messageKey: MESSAGE_KEY[kind], technical };
}

/** True when the failure is the network's fault rather than ours. */
export function isConnectivityFailure(kind: FailureKind): boolean {
  return kind === 'offline' || kind === 'network_blocked' || kind === 'timeout';
}
