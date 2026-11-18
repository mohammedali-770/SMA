import { afterEach, describe, expect, it } from 'vitest';

import { runAfterResponse } from './paymentSync.ts';

const rt = globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } };
afterEach(() => {
  delete rt.EdgeRuntime;
});

describe('runAfterResponse', () => {
  it('hands the work to EdgeRuntime.waitUntil and returns without waiting for it', async () => {
    const handed: Promise<unknown>[] = [];
    rt.EdgeRuntime = {
      waitUntil: (p) => {
        handed.push(p);
      },
    };
    let release!: () => void;
    let done = false;
    await runAfterResponse(() =>
      new Promise<void>((r) => {
        release = r;
      }).then(() => {
        done = true;
      }),
    );
    expect(handed).toHaveLength(1);
    expect(done).toBe(false);
    release();
    await handed[0];
    expect(done).toBe(true);
  });

  it('awaits the work where the platform has no waitUntil (never skips it)', async () => {
    let done = false;
    await runAfterResponse(async () => {
      await Promise.resolve();
      done = true;
    });
    expect(done).toBe(true);
  });

  it('awaits the work when waitUntil throws', async () => {
    rt.EdgeRuntime = {
      waitUntil: () => {
        throw new Error('no');
      },
    };
    let done = false;
    await runAfterResponse(async () => {
      await Promise.resolve();
      done = true;
    });
    expect(done).toBe(true);
  });
});
