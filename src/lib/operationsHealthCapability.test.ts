import { describe, expect, it } from 'vitest';
import {
  classifyOperationsHealthProbe,
  deriveHealthBadge,
  operationsHealthTabVisible,
} from './operationsHealthCapability';

describe('classifyOperationsHealthProbe', () => {
  it('returns available when the probe succeeds', () => {
    expect(classifyOperationsHealthProbe(null)).toBe('available');
  });

  it('returns absent for the exact PostgREST missing-RPC response', () => {
    expect(classifyOperationsHealthProbe({
      code: 'PGRST202',
      message: 'Could not find the function public.operations_health_summary in the schema cache',
    })).toBe('absent');
  });

  it('returns absent for a database missing-function error naming only the probed RPC', () => {
    expect(classifyOperationsHealthProbe({
      code: '42883',
      message: 'function public.operations_health_summary() does not exist',
    })).toBe('absent');
  });

  it('keeps dependent-object, auth, network and server failures visible', () => {
    expect(classifyOperationsHealthProbe({
      code: '42P01',
      message: 'relation "order_integrity_incidents" does not exist',
    })).toBe('unknown');
    expect(classifyOperationsHealthProbe({ code: '42501', message: 'permission denied' })).toBe('unknown');
    expect(classifyOperationsHealthProbe(new Error('Network request failed'))).toBe('unknown');
  });
});

describe('operationsHealthTabVisible', () => {
  it('hides only while loading or when the RPC is confirmed absent', () => {
    expect(operationsHealthTabVisible('loading')).toBe(false);
    expect(operationsHealthTabVisible('absent')).toBe(false);
    expect(operationsHealthTabVisible('available')).toBe(true);
    expect(operationsHealthTabVisible('unknown')).toBe(true);
  });
});

describe('deriveHealthBadge', () => {
  const sum = (overall_state: string, critical = 0, warning = 0) =>
    ({ overall_state, critical_attention_count: critical, warning_attention_count: warning });

  it('reads the CRITICAL counter for failing and configuration_error', () => {
    for (const state of ['failing', 'configuration_error']) {
      expect(deriveHealthBadge(sum(state, 3, 9), true))
        .toEqual({ state, severity: 'critical', count: 3 });
    }
  });

  it('reads the WARNING counter for degraded', () => {
    // The bug this pins: a degraded platform raises WARNING attention items, so
    // its critical_attention_count is 0. Reading the critical counter produced
    // "1 critical operations alert" for a state that raised no critical item at
    // all — an invented number and an overstated severity.
    expect(deriveHealthBadge(sum('degraded', 0, 4), true))
      .toEqual({ state: 'degraded', severity: 'warning', count: 4 });
  });

  it('does not collapse several warnings into one', () => {
    expect(deriveHealthBadge(sum('degraded', 0, 7), true).count).toBe(7);
  });

  it('shows NOTHING for a healthy or idle platform', () => {
    // A badge that is always present is furniture — operators stop seeing it,
    // which is the failure mode this whole feature exists to avoid.
    expect(deriveHealthBadge(sum('healthy'), true)).toBeNull();
    expect(deriveHealthBadge(sum('idle'), true)).toBeNull();
  });

  it('shows nothing for an unrecognised state rather than guessing', () => {
    expect(deriveHealthBadge(sum('something_new', 9, 9), true)).toBeNull();
  });

  it('shows nothing before the probe resolves, or when the tab is hidden', () => {
    expect(deriveHealthBadge(null, true)).toBeNull();
    expect(deriveHealthBadge(undefined, true)).toBeNull();
    expect(deriveHealthBadge(sum('failing', 4), true)).not.toBeNull();
    expect(deriveHealthBadge(sum('failing', 4), false)).toBeNull();
  });

  it('never renders a zero — a badged state always shows at least 1', () => {
    // A subsystem can reach a badge-worthy state without producing an itemised
    // attention row. A badge reading "0" contradicts the state that earned it.
    expect(deriveHealthBadge(sum('degraded', 0, 0), true))
      .toEqual({ state: 'degraded', severity: 'warning', count: 1 });
    expect(deriveHealthBadge({ overall_state: 'failing' }, true))
      .toEqual({ state: 'failing', severity: 'critical', count: 1 });
  });
});
