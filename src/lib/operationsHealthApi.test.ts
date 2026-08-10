import { describe, expect, it } from 'vitest';
import { pushFailureMetrics, unavailableOperationsHealthSummary } from './operationsHealthApi';

describe('pushFailureMetrics', () => {
  it('reads both distinct units when present', () => {
    expect(pushFailureMetrics({ failed_deliveries_24h: 2, failed_send_events_24h: 1, failed_sends_24h: 2 }))
      .toEqual({ failedDeliveries: 2, failedSendEvents: 1 });
  });

  it('surfaces a zero-delivery lifecycle failure (0 deliveries, 1 event)', () => {
    expect(pushFailureMetrics({ failed_deliveries_24h: 0, failed_send_events_24h: 1 }))
      .toEqual({ failedDeliveries: 0, failedSendEvents: 1 });
  });

  it('falls back to the failed_sends_24h alias when the new field is absent', () => {
    expect(pushFailureMetrics({ failed_sends_24h: 3 }))
      .toEqual({ failedDeliveries: 3, failedSendEvents: 0 });
  });

  it('treats a missing details bag safely as zeros', () => {
    expect(pushFailureMetrics(undefined)).toEqual({ failedDeliveries: 0, failedSendEvents: 0 });
    expect(pushFailureMetrics(null)).toEqual({ failedDeliveries: 0, failedSendEvents: 0 });
    expect(pushFailureMetrics({})).toEqual({ failedDeliveries: 0, failedSendEvents: 0 });
  });

  it('clamps negative, null, non-finite and malformed values to zero', () => {
    expect(pushFailureMetrics({ failed_deliveries_24h: -5, failed_send_events_24h: -1 }))
      .toEqual({ failedDeliveries: 0, failedSendEvents: 0 });
    expect(pushFailureMetrics({ failed_deliveries_24h: Number.NaN, failed_send_events_24h: Infinity }))
      .toEqual({ failedDeliveries: 0, failedSendEvents: 0 });
    // Non-number delivery field is treated as absent -> falls back to the alias.
    expect(pushFailureMetrics({ failed_deliveries_24h: '2' as unknown as number, failed_sends_24h: 4 }))
      .toEqual({ failedDeliveries: 4, failedSendEvents: 0 });
  });

  it('floors fractional counts', () => {
    expect(pushFailureMetrics({ failed_deliveries_24h: 2.9, failed_send_events_24h: 1.2 }))
      .toEqual({ failedDeliveries: 2, failedSendEvents: 1 });
  });
});

describe('unavailableOperationsHealthSummary', () => {
  it('never reports a client fetch failure as healthy', () => {
    const summary = unavailableOperationsHealthSummary('2026-07-22T00:00:00.000Z');

    expect(summary.overall_state).toBe('degraded');
    expect(summary.warning_attention_count).toBe(1);
    expect(summary.systems_unavailable_count).toBe(9);
    expect(summary.systems).toHaveLength(9);
    expect(summary.systems.every((system) => system.state === 'unavailable')).toBe(true);
    // 3 critical application crons + 2 non-critical internal automation crons.
    expect(summary.jobs).toHaveLength(5);
    expect(summary.jobs.every((job) => job.state === 'unavailable')).toBe(true);
  });

  it('includes the internal automation crons as non-critical jobs', () => {
    const summary = unavailableOperationsHealthSummary('2026-07-22T00:00:00.000Z');
    const byName = Object.fromEntries(summary.jobs.map((job) => [job.job_name, job]));

    expect(byName['operations-alerts-evaluator']?.critical).toBe(false);
    expect(byName['operations-alerts-evaluator']?.expected_schedule).toBe('*/5 * * * *');
    expect(byName['operations-digest-generator']?.critical).toBe(false);
    expect(byName['operations-digest-generator']?.expected_schedule).toBe('0 * * * *');
    // The three pre-existing application crons stay critical.
    expect(byName['account-deletion-processor']?.critical).toBe(true);
    expect(byName['lazywait-sync']?.critical).toBe(true);
    expect(byName['order-integrity-watchdog']?.critical).toBe(true);
  });

  it('uses a fixed safe error code and contains no raw provider or customer data', () => {
    const text = JSON.stringify(unavailableOperationsHealthSummary()).toLowerCase();

    expect(text).toContain('client_fetch_failed');
    expect(text).not.toContain('secret_config');
    expect(text).not.toContain('customer_name');
    expect(text).not.toContain('customer_phone');
    expect(text).not.toContain('provider_ref');
    expect(text).not.toContain('raw_error');
  });
});
