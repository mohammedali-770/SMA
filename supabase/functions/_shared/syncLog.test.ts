import { describe, expect, it } from 'vitest';

import { SYNC_LOG_ERROR_MAX, syncLogOutcome } from './syncLog';

/**
 * The behavioural half of the 2026-09-02 webhook fix. The handlers import
 * Deno-only modules so Vitest cannot execute their control flow — that is what
 * `webhookReliabilityWiring.test.ts` covers structurally. This file tests the
 * decision itself, and each case names the mutation it kills.
 */
describe('syncLogOutcome', () => {
  // THE CASE THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. `lazywait-webhook` wrote
  // `status: 'success'` unconditionally while discarding the write's result.
  // Mutation killed: hardcoding 'success', or treating a truthy error as fine.
  it('reports failed when the write returned an error', () => {
    const out = syncLogOutcome({ code: '23514', message: 'new row violates check constraint' });
    expect(out.status).toBe('failed');
    expect(out.error).toContain('23514');
    expect(out.error).toContain('check constraint');
  });

  // supabase-js RESOLVES with `{ error: null }` rather than throwing, which is
  // exactly why the old code got away with never destructuring it.
  it('reports success for null and for undefined', () => {
    expect(syncLogOutcome(null)).toEqual({ status: 'success', error: null });
    expect(syncLogOutcome(undefined)).toEqual({ status: 'success', error: null });
  });

  it('puts the Postgres code first, where truncation cannot reach it', () => {
    const out = syncLogOutcome({ code: 'PGRST116', message: 'x'.repeat(SYNC_LOG_ERROR_MAX * 2) });
    expect(out.error?.startsWith('[PGRST116]')).toBe(true);
  });

  it('bounds the message so one pathological error cannot dominate the table', () => {
    const out = syncLogOutcome({ code: '', message: 'y'.repeat(SYNC_LOG_ERROR_MAX * 3) });
    expect(out.error).not.toBeNull();
    expect(out.error!.length).toBeLessThanOrEqual(SYNC_LOG_ERROR_MAX);
    expect(out.error!.endsWith('…')).toBe(true);
  });

  it('leaves a short message intact rather than always appending an ellipsis', () => {
    const out = syncLogOutcome({ code: '42501', message: 'permission denied' });
    expect(out.error).toBe('[42501] permission denied');
  });

  // An error object with nothing usable still has to produce a 'failed' row —
  // silently degrading to 'success' is the bug this whole module exists for.
  it('still reports failed when the error carries no detail at all', () => {
    const out = syncLogOutcome({});
    expect(out.status).toBe('failed');
    expect(out.error).toBe('write failed (no error detail supplied)');
  });

  it('ignores non-string code and message rather than stringifying them', () => {
    const out = syncLogOutcome({ code: null, message: null });
    expect(out.status).toBe('failed');
    expect(out.error).toBe('write failed (no error detail supplied)');
  });

  // `integration_sync_logs.status` is constrained to ('success','failed','skipped'),
  // so a value outside that set would make the INSERT itself fail.
  it('only ever returns a status the table constraint accepts', () => {
    for (const e of [null, {}, { code: 'X' }, { message: 'y' }]) {
      expect(['success', 'failed', 'skipped']).toContain(syncLogOutcome(e).status);
    }
  });
});
