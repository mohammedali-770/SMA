import { describe, expect, it } from 'vitest';
import {
  classifyOperationsHealthProbe,
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
