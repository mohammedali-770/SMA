/**
 * Deterministic fixtures for Operations Alerts.
 *
 * Fixed ids and fixed ISO timestamps, so a test asserts on what the panel does
 * rather than on when it ran. Nothing here reaches the network; these are the
 * shapes `operationsAlertsApi` returns, built by hand.
 *
 * TEST-ONLY. Nothing in `src/components` imports this module, and it is not
 * reachable from any rendered surface.
 */
import type {
  OperationsAlert,
  OperationsAlertEvent,
  OperationsAlertSettings,
  OperationsAlertSettingsBundle,
  OperationsAlertsSummary,
  OperationsDigest,
} from '../../../../lib/operationsAlertsApi';

/** The clock every fixture timestamp is relative to. */
export const FIXED_NOW = Date.parse('2026-03-14T12:00:00.000Z');

export function alertFixture(over: Partial<OperationsAlert> = {}): OperationsAlert {
  return {
    id: 'alert-1',
    fingerprint: 'payment:TAP_WEBHOOK_LATENCY:v1',
    subsystem: 'payment',
    condition_code: 'TAP_WEBHOOK_LATENCY',
    severity: 'critical',
    status: 'open',
    generation: 3,
    baseline: false,
    first_seen_at: '2026-03-14T09:00:00.000Z',
    last_seen_at: '2026-03-14T11:55:00.000Z',
    occurrence_count: 42,
    last_notified_at: null,
    last_reminder_at: null,
    recovered_at: null,
    safe_evidence: {},
    ...over,
  };
}

export function eventFixture(over: Partial<OperationsAlertEvent> = {}): OperationsAlertEvent {
  return {
    id: 'event-1',
    event_type: 'opened',
    severity: 'critical',
    notification_suppressed: false,
    safe_evidence: {},
    created_at: '2026-03-14T09:00:00.000Z',
    ...over,
  };
}

export function summaryFixture(over: Partial<OperationsAlertsSummary> = {}): OperationsAlertsSummary {
  return {
    generated_at: '2026-03-14T12:00:00.000Z',
    open_critical_count: 2,
    open_warning_count: 5,
    open_total: 7,
    open_baseline_count: 1,
    recovered_last_24h: 4,
    last_evaluation: { finished_at: '2026-03-14T11:58:00.000Z' },
    last_digest: null,
    alert_evaluation_enabled: true,
    digest_generation_enabled: true,
    external_dispatch_enabled: false,
    ...over,
  };
}

export function digestFixture(over: Partial<OperationsDigest> = {}): OperationsDigest {
  return {
    scope: 'platform',
    digest_date: '2026-03-13',
    language: 'en',
    timezone: 'Asia/Riyadh',
    period_start_utc: '2026-03-12T21:00:00.000Z',
    period_end_utc: '2026-03-13T21:00:00.000Z',
    overall_state: 'degraded',
    opened_count: 6,
    recovered_count: 4,
    unresolved_count: 2,
    critical_open_count: 1,
    warning_open_count: 1,
    content: {},
    rendered_subject: 'Daily operations digest — 2026-03-13',
    rendered_body: 'Two alerts remain open.',
    ...over,
  };
}

export function settingsFixture(over: Partial<OperationsAlertSettings> = {}): OperationsAlertSettings {
  return {
    alert_evaluation_enabled: true,
    digest_generation_enabled: false,
    external_dispatch_enabled: false,
    timezone: 'Asia/Riyadh',
    digest_local_time: '08:00',
    warning_reminder_minutes: 180,
    critical_reminder_minutes: 60,
    recovery_notifications_enabled: true,
    optional_system_alerts_enabled: false,
    system_rule_overrides: {},
    updated_at: '2026-03-14T10:00:00.000Z',
    ...over,
  };
}

export function settingsBundleFixture(
  over: Partial<OperationsAlertSettings> = {},
): OperationsAlertSettingsBundle {
  return {
    settings: settingsFixture(over),
    last_evaluation_run: null,
    last_digest_run: null,
  };
}
