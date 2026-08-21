import { describe, expect, it } from 'vitest';

import { makeRefreshQueue } from './opsRefreshQueue';

/** A refresh whose completion the test controls. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('makeRefreshQueue', () => {
  it('runs a refresh when nothing is in flight', async () => {
    let calls = 0;
    const q = makeRefreshQueue(async () => { calls += 1; });
    await q.run();
    expect(calls).toBe(1);
  });

  it('KEEPS a change that arrives mid-refresh, instead of dropping it', async () => {
    // The bug this exists for: the in-flight queries may already have read past
    // the changed row, so discarding the event leaves the board stale until the
    // 60-second backstop poll.
    const first = deferred();
    let calls = 0;
    const q = makeRefreshQueue(async () => {
      calls += 1;
      if (calls === 1) await first.promise;
    });

    const running = q.run();
    await q.run();                    // arrives while the first is in flight
    expect(calls).toBe(1);            // not started yet — correctly queued

    first.resolve();
    await running;
    expect(calls).toBe(2);            // the trailing run happened
  });

  it('collapses a burst into ONE trailing run, not one per event', async () => {
    const first = deferred();
    let calls = 0;
    const q = makeRefreshQueue(async () => {
      calls += 1;
      if (calls === 1) await first.promise;
    });

    const running = q.run();
    await Promise.all([q.run(), q.run(), q.run(), q.run()]);
    first.resolve();
    await running;
    expect(calls).toBe(2);
  });

  it('a failing refresh still lets the trailing run happen', async () => {
    // A refresh that throws must not wedge the queue: the feed is what recovers
    // the board after a transient error.
    const first = deferred();
    let calls = 0;
    const q = makeRefreshQueue(async () => {
      calls += 1;
      if (calls === 1) { await first.promise; throw new Error('boom'); }
    });

    const running = q.run();
    await q.run();
    first.resolve();
    await running;
    expect(calls).toBe(2);
  });

  it('stops running once disposed, and drops any queued run', async () => {
    const first = deferred();
    let calls = 0;
    const q = makeRefreshQueue(async () => {
      calls += 1;
      if (calls === 1) await first.promise;
    });

    const running = q.run();
    await q.run();
    q.dispose();
    first.resolve();
    await running;
    expect(calls).toBe(1);            // the trailing run was abandoned

    await q.run();
    expect(calls).toBe(1);            // and nothing new starts
  });
});
