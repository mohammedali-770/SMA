import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-shape tripwires for the two halves of "the customer is told the truth
 * about the POS", in the established style of `adminAuthWiring.test.ts` and
 * `lazywaitBaseUrlWiring.test.ts` — and equally honest about the limit: both
 * handlers import Deno-only modules, so Vitest cannot execute them and
 * `deno check` only typechecks. What no runtime test can pin is WHICH function
 * sends the customer's first message, and that is the whole property.
 *
 * TWO DEFECTS THIS EXISTS FOR, both found 2026-08-27.
 *
 * 1. order-intake's sync kick read `if (order_type === 'pickup')`, correct only
 *    while the insert trigger parked every delivery order at `blocked`. Once
 *    migration 20260827120000 opened that gate the condition was a leftover, and
 *    delivery fell through to the once-a-minute cron: 17.8-44.6 s from placing
 *    the order to the branch number appearing, every one a first-attempt
 *    success, so the wait was the tick and never the POS.
 *
 * 2. order-intake pushed `order_status/received` unconditionally — "we received
 *    your order and sent it to the kitchen" — a claim about the BRANCH made
 *    whether or not the branch had heard of the order. The POS outcome now owns
 *    that message, and `lazywait-sync` dispatches it.
 */
function source(fn: string): string {
  return readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
}
/**
 * Comments stripped — BOTH `//` lines and `/* *\/` blocks. These files
 * deliberately document what they no longer do and why, naming the very
 * identifiers being asserted against, so a prose mention would otherwise
 * satisfy a `toContain` or shift a positional index. (It did: the first version
 * of the ordering assertion was measuring this drain's own doc comment.)
 */
function code(fn: string): string {
  return source(fn)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

describe('order-intake — immediate POS sync, and no premature promise', () => {
  const CODE = code('order-intake');

  it('does NOT gate the sync kick on order type', () => {
    expect(CODE).not.toMatch(/order_type\s*\)?\s*===\s*['"]pickup['"]/);
    expect(CODE).not.toMatch(/===\s*['"]pickup['"]\s*\)\s*\{/);
  });

  it('still kicks the worker, with the server-side secret', () => {
    expect(CODE).toContain('/functions/v1/lazywait-sync');
    expect(CODE).toContain("'x-sync-secret'");
    expect(CODE).toContain('sync_trigger_secret');
  });

  it('keeps the sync non-fatal — a POS problem can never fail the order', () => {
    expect(CODE).toContain('SYNC_TIMEOUT_MS');
    expect(CODE).toContain('AbortSignal.timeout');
  });

  it('sends NO push of its own — the POS outcome owns the first message', () => {
    // The regression this blocks: re-adding an unconditional "sent it to the
    // kitchen" push here, which is a claim about the branch that this function
    // is in no position to make.
    expect(CODE).not.toContain('push-dispatch');
    expect(CODE).not.toContain('order_status');
  });
});

describe('lazywait-sync — dispatches the POS lifecycle messages', () => {
  const CODE = code('lazywait-sync');

  it('drains pending pos_sync events to push-dispatch', () => {
    // Before this, record_lazywait_sync and the reaper enqueued these rows and
    // NOTHING ever sent them: no cron, no trigger, no caller.
    expect(CODE).toContain('dispatchPendingPosSync');
    expect(CODE).toContain('/functions/v1/push-dispatch');
    expect(CODE).toContain("action: 'pos_sync'");
    expect(CODE).toContain("'notification_log'");
    expect(CODE).toContain("'pending'");
  });

  it('drains in the SAME run that produced the events', () => {
    // order-intake invokes this worker synchronously on checkout, so the
    // confirmation push must ride that invocation rather than wait for a tick.
    // Positional: the drain call has to come after the order loop's recording.
    const record = CODE.lastIndexOf('record_lazywait_sync');
    const drain = CODE.indexOf('await dispatchPendingPosSync');
    expect(record).toBeGreaterThan(-1);
    expect(drain).toBeGreaterThan(record);
  });

  it('bounds the drain so a backlog cannot fan out without limit', () => {
    expect(CODE).toContain('POS_NOTIFY_DRAIN_LIMIT');
    expect(CODE).toMatch(/\.limit\(POS_NOTIFY_DRAIN_LIMIT\)/);
  });

  it('announces a confirmed order on EVERY success, not only after a failure', () => {
    // The old gate — `priorFailure ? 'pos_confirmed' : null` — meant a clean
    // order enqueued nothing, which is why zero pos_sync rows had ever existed
    // and why the missing dispatcher stayed invisible.
    expect(CODE).not.toMatch(/priorFailure\w*\s*\?\s*'pos_confirmed'/);
    expect(CODE).not.toMatch(/first_pos_sync_failure_at\s*!=\s*null\s*\?\s*'pos_confirmed'/);
    expect(CODE).toContain("p_notify_status: 'pos_confirmed'");
  });
});
