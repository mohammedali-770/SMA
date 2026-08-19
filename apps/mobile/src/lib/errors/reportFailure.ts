/**
 * The bridge between "something failed" and what the customer reads.
 *
 * One call does both halves of the contract:
 *   1. the customer gets localized, actionable copy — never provider text;
 *   2. we keep the full technical detail, in Sentry, with the subsystem and
 *      operation attached, so a report of "it didn't work on the office Wi-Fi"
 *      is still investigable.
 *
 * `captureException` already downgrades expected failures to breadcrumbs, so
 * routine offline blips do not become Sentry noise.
 */
import { captureException, type ObservabilitySubsystem } from '../observability';
import { describeFailure, type Failure } from './userMessage';
import type { StringKey } from '../../i18n/strings';

interface Options {
  subsystem: ObservabilitySubsystem;
  /** Short machine-readable operation, e.g. 'send_login_code'. */
  op: string;
  /**
   * Key to use when the failure is not one we recognise. Defaults to the
   * generic apology; pass a screen-specific one where that reads better.
   */
  fallbackKey?: StringKey;
}

export interface ReportedFailure extends Failure {
  /** Sentry event id when one was sent (null for expected failures). */
  eventId: string | null;
}

/**
 * Classify, report, and return the failure. Callers render
 * `t(result.messageKey)` — never `result.technical`.
 */
export function reportFailure(err: unknown, options: Options): ReportedFailure {
  const failure = describeFailure(err);
  const eventId = captureException(err, {
    subsystem: options.subsystem,
    op: options.op,
    // Safe, machine-readable, and stable — good for grouping and alerting.
    code: `UI_${failure.kind.toUpperCase()}`,
    extra: {
      // Bounded so a huge provider blob cannot bloat the event.
      technical: failure.technical.slice(0, 300),
    },
    tags: { failure_kind: failure.kind },
  });

  return {
    ...failure,
    messageKey: failure.kind === 'unknown' && options.fallbackKey
      ? options.fallbackKey
      : failure.messageKey,
    eventId,
  };
}

/**
 * Convenience for the common case: report, and hand back the string to show.
 * `t` is passed in rather than imported so this stays usable outside a
 * component and trivially mockable in tests.
 */
export function failureMessage(
  err: unknown,
  t: (key: StringKey) => string,
  options: Options,
): string {
  return t(reportFailure(err, options).messageKey);
}
