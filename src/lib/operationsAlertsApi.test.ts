import { describe, expect, it } from 'vitest';
import {
  normalizeAlertSeverity,
  normalizeAlertStatus,
  normalizeOperationsAlert,
  normalizeOperationsAlertEvent,
  normalizeOperationsAlertSettings,
  normalizeOperationsAlertsSummary,
  normalizeOperationsDigest,
  safeAlertCount,
} from './operationsAlertsApi';

describe('safeAlertCount', () => {
  it('accepts finite non-negative numbers and floors fractions', () => {
    expect(safeAlertCount(0)).toBe(0);
    expect(safeAlertCount(7)).toBe(7);
    expect(safeAlertCount(2.9)).toBe(2);
  });

  it('clamps negative, non-finite and non-numeric values to zero', () => {
    expect(safeAlertCount(-3)).toBe(0);
    expect(safeAlertCount(Number.NaN)).toBe(0);
    expect(safeAlertCount(Infinity)).toBe(0);
    expect(safeAlertCount('5')).toBe(0);
    expect(safeAlertCount(null)).toBe(0);
    expect(safeAlertCount(undefined)).toBe(0);
    expect(safeAlertCount({})).toBe(0);
  });
});

describe('normalizeAlertSeverity / normalizeAlertStatus', () => {
  it('only recognizes the backend enum values', () => {
    expect(normalizeAlertSeverity('critical')).toBe('critical');
    expect(normalizeAlertSeverity('warning')).toBe('warning');
    expect(normalizeAlertSeverity('CRITICAL')).toBe('warning');
    expect(normalizeAlertSeverity(undefined)).toBe('warning');

    expect(normalizeAlertStatus('recovered')).toBe('recovered');
    expect(normalizeAlertStatus('open')).toBe('open');
    expect(normalizeAlertStatus('resolved')).toBe('open');
    expect(normalizeAlertStatus(null)).toBe('open');
  });
});

describe('normalizeOperationsAlert', () => {
  it('normalizes a complete backend row', () => {
    const alert = normalizeOperationsAlert({
      id: 'a1',
      fingerprint: 'push:failed_deliveries',
      subsystem: 'push',
      condition_code: 'failed_deliveries',
      severity: 'critical',
      status: 'open',
      generation: 2,
      baseline: false,
      first_seen_at: '2026-07-22T08:00:00Z',
      last_seen_at: '2026-07-22T09:00:00Z',
      occurrence_count: 4,
      last_notified_at: '2026-07-22T08:00:00Z',
      last_reminder_at: null,
      recovered_at: null,
      safe_evidence: { failed_count: 3 },
    });

    expect(alert.fingerprint).toBe('push:failed_deliveries');
    expect(alert.severity).toBe('critical');
    expect(alert.status).toBe('open');
    expect(alert.generation).toBe(2);
    expect(alert.occurrence_count).toBe(4);
    expect(alert.safe_evidence).toEqual({ failed_count: 3 });
  });

  it('survives malformed input without crashing', () => {
    const empty = normalizeOperationsAlert(undefined);
    expect(empty.fingerprint).toBe('unknown');
    expect(empty.subsystem).toBe('unknown');
    expect(empty.severity).toBe('warning');
    expect(empty.status).toBe('open');
    expect(empty.generation).toBe(1);
    expect(empty.occurrence_count).toBe(1);
    expect(empty.safe_evidence).toEqual({});

    const bad = normalizeOperationsAlert({
      generation: -4,
      occurrence_count: Number.NaN,
      baseline: 'yes',
      safe_evidence: ['not', 'an', 'object'],
      first_seen_at: 42,
    });
    expect(bad.generation).toBe(1);
    expect(bad.occurrence_count).toBe(1);
    expect(bad.baseline).toBe(false);
    expect(bad.safe_evidence).toEqual({});
    expect(bad.first_seen_at).toBeNull();
  });
});

describe('normalizeOperationsAlertEvent', () => {
  it('keeps known event types and severities', () => {
    const ev = normalizeOperationsAlertEvent({
      id: 'e1',
      event_type: 'escalated',
      severity: 'critical',
      notification_suppressed: false,
      safe_evidence: { previous_severity: 'warning' },
      created_at: '2026-07-22T09:00:00Z',
    });
    expect(ev.event_type).toBe('escalated');
    expect(ev.severity).toBe('critical');
    expect(ev.notification_suppressed).toBe(false);
  });

  it('falls back for unknown event types and preserves the info severity', () => {
    const ev = normalizeOperationsAlertEvent({ event_type: 'exploded', severity: 'info' });
    expect(ev.event_type).toBe('opened');
    expect(ev.severity).toBe('info');
    expect(normalizeOperationsAlertEvent(null).notification_suppressed).toBe(false);
  });
});

describe('normalizeOperationsAlertsSummary', () => {
  it('normalizes counts and never invents enabled engine flags', () => {
    const summary = normalizeOperationsAlertsSummary({
      generated_at: '2026-07-22T10:00:00Z',
      open_critical_count: 2,
      open_warning_count: 1,
      open_total: 3,
      open_baseline_count: 1,
      recovered_last_24h: 4,
      last_evaluation: { status: 'success' },
      last_digest: null,
      alert_evaluation_enabled: false,
      digest_generation_enabled: false,
      external_dispatch_enabled: false,
    });
    expect(summary.open_critical_count).toBe(2);
    expect(summary.open_total).toBe(3);
    expect(summary.recovered_last_24h).toBe(4);
    expect(summary.last_evaluation).toEqual({ status: 'success' });
    expect(summary.external_dispatch_enabled).toBe(false);
  });

  it('treats a malformed payload as zeros/disabled — never as healthy-enabled', () => {
    const summary = normalizeOperationsAlertsSummary({
      open_critical_count: -1,
      open_warning_count: 'many',
      recovered_last_24h: Infinity,
      alert_evaluation_enabled: 'true',
      external_dispatch_enabled: 1,
      last_evaluation: ['nope'],
    });
    expect(summary.open_critical_count).toBe(0);
    expect(summary.open_warning_count).toBe(0);
    expect(summary.recovered_last_24h).toBe(0);
    expect(summary.alert_evaluation_enabled).toBe(false);
    expect(summary.external_dispatch_enabled).toBe(false);
    expect(summary.last_evaluation).toBeNull();
    expect(normalizeOperationsAlertsSummary(undefined).open_total).toBe(0);
  });
});

describe('normalizeOperationsDigest', () => {
  it('normalizes a generated digest row', () => {
    const digest = normalizeOperationsDigest({
      id: 'd1',
      scope: 'daily',
      digest_date: '2026-07-21',
      language: 'ar',
      timezone: 'Asia/Riyadh',
      period_start_utc: '2026-07-20T21:00:00Z',
      period_end_utc: '2026-07-21T21:00:00Z',
      overall_state: 'healthy',
      opened_count: 0,
      recovered_count: 1,
      unresolved_count: 0,
      critical_open_count: 0,
      warning_open_count: 0,
      content: { lines: [] },
      rendered_subject: 'ملخص العمليات اليومي',
      rendered_body: 'لا توجد حوادث خلال هذه الفترة.',
      generated_at: '2026-07-22T05:00:00Z',
    });
    expect(digest.language).toBe('ar');
    expect(digest.digest_date).toBe('2026-07-21');
    expect(digest.rendered_subject).toContain('ملخص');
    expect(digest.preview).toBe(false);
  });

  it('defaults malformed digests to a safe unavailable shape', () => {
    const digest = normalizeOperationsDigest({ language: 'fr', opened_count: -2 });
    expect(digest.language).toBe('en');
    expect(digest.scope).toBe('daily');
    expect(digest.timezone).toBe('Asia/Riyadh');
    expect(digest.overall_state).toBe('unavailable');
    expect(digest.opened_count).toBe(0);
    expect(digest.rendered_body).toBe('');
    expect(normalizeOperationsDigest(null).content).toEqual({});
  });
});

describe('normalizeOperationsAlertSettings', () => {
  it('keeps valid backend settings', () => {
    const s = normalizeOperationsAlertSettings({
      alert_evaluation_enabled: false,
      digest_generation_enabled: false,
      external_dispatch_enabled: false,
      timezone: 'Asia/Riyadh',
      digest_local_time: '08:00:00',
      warning_reminder_minutes: 1440,
      critical_reminder_minutes: 240,
      recovery_notifications_enabled: true,
      optional_system_alerts_enabled: false,
      system_rule_overrides: { push: { muted: true } },
      updated_at: '2026-07-22T10:00:00Z',
    });
    expect(s.timezone).toBe('Asia/Riyadh');
    expect(s.warning_reminder_minutes).toBe(1440);
    expect(s.critical_reminder_minutes).toBe(240);
    expect(s.recovery_notifications_enabled).toBe(true);
    expect(s.system_rule_overrides).toEqual({ push: { muted: true } });
  });

  it('falls back to dormant defaults for malformed settings', () => {
    const s = normalizeOperationsAlertSettings({
      external_dispatch_enabled: 'yes',
      warning_reminder_minutes: -10,
      critical_reminder_minutes: 999999,
      timezone: 7,
      system_rule_overrides: 'oops',
    });
    expect(s.alert_evaluation_enabled).toBe(false);
    expect(s.external_dispatch_enabled).toBe(false);
    expect(s.timezone).toBe('Asia/Riyadh');
    expect(s.digest_local_time).toBe('08:00');
    expect(s.warning_reminder_minutes).toBe(1440);
    expect(s.critical_reminder_minutes).toBe(240);
    expect(s.system_rule_overrides).toEqual({});
    expect(normalizeOperationsAlertSettings(undefined).digest_generation_enabled).toBe(false);
  });
});
