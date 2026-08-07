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
  const sum = (overall_state: string, critical_attention_count = 0) =>
    ({ overall_state, critical_attention_count });

  it('badges the three states that warrant interrupting someone', () => {
    for (const state of ['degraded', 'failing', 'configuration_error']) {
      expect(deriveHealthBadge(sum(state, 3), true)).toEqual({ state, count: 3 });
    }
  });

  it('shows NOTHING for a healthy or idle platform', () => {
    // A badge that is always present is furniture — operators stop seeing it,
    // which is the failure mode this whole card exists to avoid.
    expect(deriveHealthBadge(sum('healthy', 0), true)).toBeNull();
    expect(deriveHealthBadge(sum('idle', 0), true)).toBeNull();
  });

  it('shows nothing for an unrecognised state rather than guessing', () => {
    expect(deriveHealthBadge(sum('something_new', 9), true)).toBeNull();
  });

  it('shows nothing before the probe resolves, or when the tab is hidden', () => {
    expect(deriveHealthBadge(null, true)).toBeNull();
    expect(deriveHealthBadge(undefined, true)).toBeNull();
    expect(deriveHealthBadge(sum('failing', 4), false)).toBeNull();
  });

  it('never renders a zero — a badged state always shows at least 1', () => {
    // `critical_attention_count` counts itemised attention rows, and a
    // subsystem can be degraded without producing one. Showing "0" beside a
    // danger badge contradicts the state that earned it.
    expect(deriveHealthBadge(sum('degraded', 0), true)).toEqual({ state: 'degraded', count: 1 });
    expect(deriveHealthBadge({ overall_state: 'failing' }, true)).toEqual({ state: 'failing', count: 1 });
  });

  it('passes the real count through when there is one', () => {
    expect(deriveHealthBadge(sum('failing', 12), true)).toEqual({ state: 'failing', count: 12 });
  });
});
