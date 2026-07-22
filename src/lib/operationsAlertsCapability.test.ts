import { describe, expect, it } from 'vitest';
import {
  classifyOperationsAlertsProbe,
  operationsAlertsTabVisible,
} from './operationsAlertsCapability';

describe('classifyOperationsAlertsProbe', () => {
  it('returns available when the probe succeeds', () => {
    expect(classifyOperationsAlertsProbe(null)).toBe('available');
    expect(classifyOperationsAlertsProbe(undefined)).toBe('available');
  });

  it('returns absent for the exact PostgREST missing-RPC response', () => {
    expect(classifyOperationsAlertsProbe({
      code: 'PGRST202',
      message: 'Could not find the function public.operations_alerts_admin_summary in the schema cache',
    })).toBe('absent');
  });

  it('returns absent for a database missing-function error naming only the probed RPC', () => {
    expect(classifyOperationsAlertsProbe({
      code: '42883',
      message: 'function public.operations_alerts_admin_summary() does not exist',
    })).toBe('absent');
  });

  it('does not treat a missing DEPENDENT object as an absent probe RPC', () => {
    expect(classifyOperationsAlertsProbe({
      code: '42P01',
      message: 'relation "operations_alert_state" does not exist',
    })).toBe('unknown');
    expect(classifyOperationsAlertsProbe({
      code: '42883',
      message: 'function public.operations_health_snapshot_internal() does not exist',
    })).toBe('unknown');
  });

  it('keeps auth, network and server failures visible', () => {
    expect(classifyOperationsAlertsProbe({ code: '42501', message: 'Only staff may view operations alerts' })).toBe('unknown');
    expect(classifyOperationsAlertsProbe(new Error('Network request failed'))).toBe('unknown');
    expect(classifyOperationsAlertsProbe({ code: '500', message: 'internal server error' })).toBe('unknown');
    expect(classifyOperationsAlertsProbe({})).toBe('unknown');
  });
});

describe('operationsAlertsTabVisible', () => {
  it('hides only while loading or when the RPC is confirmed absent', () => {
    expect(operationsAlertsTabVisible('loading')).toBe(false);
    expect(operationsAlertsTabVisible('absent')).toBe(false);
    expect(operationsAlertsTabVisible('available')).toBe(true);
    expect(operationsAlertsTabVisible('unknown')).toBe(true);
  });
});
