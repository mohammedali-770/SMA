import { describe, it, expect } from 'vitest';
import { classifyWatchdogProbe, watchdogTabVisible } from './orderIntegrityCapability';

describe('classifyWatchdogProbe', () => {
  it('no error → available', () => {
    expect(classifyWatchdogProbe(null)).toBe('available');
    expect(classifyWatchdogProbe(undefined)).toBe('available');
  });

  it('PostgREST PGRST202 (function not in schema cache) → absent', () => {
    expect(classifyWatchdogProbe({
      code: 'PGRST202',
      message: 'Could not find the function public.order_integrity_admin_summary without parameters in the schema cache',
    })).toBe('absent');
  });

  it('a PostgREST message naming our RPC (no code) → absent', () => {
    expect(classifyWatchdogProbe({
      message: 'Could not find the function public.order_integrity_admin_summary in the schema cache',
    })).toBe('absent');
  });

  it('Postgres 42883 undefined_function for our RPC → absent', () => {
    expect(classifyWatchdogProbe({
      code: '42883',
      message: 'function public.order_integrity_admin_summary() does not exist',
    })).toBe('absent');
  });

  it('network error → unknown (NOT reported as migration absent)', () => {
    expect(classifyWatchdogProbe({ message: 'TypeError: Failed to fetch' })).toBe('unknown');
    expect(classifyWatchdogProbe(new Error('Network request failed'))).toBe('unknown');
  });

  it('authorization error (42501) → unknown (function exists, caller not staff)', () => {
    expect(classifyWatchdogProbe({
      code: '42501',
      message: 'Only staff may view order integrity health',
    })).toBe('unknown');
  });

  it('a generic server error → unknown', () => {
    expect(classifyWatchdogProbe({ code: 'XX000', message: 'internal error' })).toBe('unknown');
  });

  it('a "does not exist" error for an UNRELATED object → unknown (not our migration)', () => {
    expect(classifyWatchdogProbe({
      code: '42P01',
      message: 'relation "some_other_table" does not exist',
    })).toBe('unknown');
  });

  it('a missing DEPENDENT order_integrity object (function exists, but a table is gone) → unknown', () => {
    // Partial migration / schema drift: order_integrity_admin_summary ran but a
    // dependent table is missing. The function EXISTS → the error must surface
    // in-panel, NOT hide the tab as "migration absent".
    expect(classifyWatchdogProbe({
      code: '42P01',
      message: 'relation "order_integrity_incidents" does not exist',
    })).toBe('unknown');
    expect(classifyWatchdogProbe({
      code: '42883',
      message: 'function public.order_integrity_list_incidents(text) does not exist',
    })).toBe('unknown');
  });
});

describe('watchdogTabVisible (tab gating)', () => {
  it('RPC available → tab shown', () => {
    expect(watchdogTabVisible('available')).toBe(true);
  });

  it('RPC missing (absent) → tab hidden', () => {
    expect(watchdogTabVisible('absent')).toBe(false);
  });

  it('panel is never shown while unavailable or still probing', () => {
    // 'absent' = confirmed missing migration; 'loading' = probe not yet resolved.
    expect(watchdogTabVisible('absent')).toBe(false);
    expect(watchdogTabVisible('loading')).toBe(false);
  });

  it('transient/auth errors keep the tab visible (surfaced in-panel, not hidden as absent)', () => {
    expect(watchdogTabVisible('unknown')).toBe(true);
  });
});

// End-to-end gating contract: the panel mounts only when the probe says the RPCs
// exist (or a transient error we surface in-panel) — never on a confirmed absent
// migration and never before the probe resolves.
describe('capability gate → panel mount decision', () => {
  const shouldMountPanel = (activeTab: string, cap: Parameters<typeof watchdogTabVisible>[0]) =>
    activeTab === 'integrity' && watchdogTabVisible(cap);

  it('does not mount when the migration is absent, even if the tab is active', () => {
    expect(shouldMountPanel('integrity', 'absent')).toBe(false);
  });
  it('does not mount while the probe is still loading', () => {
    expect(shouldMountPanel('integrity', 'loading')).toBe(false);
  });
  it('mounts when available and the tab is active', () => {
    expect(shouldMountPanel('integrity', 'available')).toBe(true);
  });
  it('never mounts when a different tab is active', () => {
    expect(shouldMountPanel('stats', 'available')).toBe(false);
  });
});
