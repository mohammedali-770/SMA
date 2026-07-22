import { describe, expect, it } from 'vitest';
import { unavailableOperationsHealthSummary } from './operationsHealthApi';

describe('unavailableOperationsHealthSummary', () => {
  it('never reports a client fetch failure as healthy', () => {
    const summary = unavailableOperationsHealthSummary('2026-07-22T00:00:00.000Z');

    expect(summary.overall_state).toBe('degraded');
    expect(summary.warning_attention_count).toBe(1);
    expect(summary.systems_unavailable_count).toBe(8);
    expect(summary.systems).toHaveLength(8);
    expect(summary.systems.every((system) => system.state === 'unavailable')).toBe(true);
    expect(summary.jobs).toHaveLength(3);
    expect(summary.jobs.every((job) => job.state === 'unavailable')).toBe(true);
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
