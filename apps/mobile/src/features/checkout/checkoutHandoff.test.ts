import { describe, expect, it } from 'vitest';

import {
  readCheckoutHandoff,
  settleCheckoutHandoff,
  startCheckoutHandoff,
} from './checkoutHandoff';

const URL_A = 'https://checkout.moyasar.com/invoices/aaaaaaaa-0000-4000-8000-000000000001?lang=en';
const URL_B = 'https://checkout.moyasar.com/invoices/bbbbbbbb-0000-4000-8000-000000000002?lang=ar';

describe('checkoutHandoff', () => {
  it('exposes the in-flight url only for the matching session id', () => {
    startCheckoutHandoff('s1', URL_A);
    expect(readCheckoutHandoff('s1')).toEqual({ checkoutUrl: URL_A });
    expect(readCheckoutHandoff('other')).toBeNull();
    settleCheckoutHandoff('s1', 'dismissed');
  });

  it('resolves the awaited promise with the settled result exactly once', async () => {
    const p = startCheckoutHandoff('s2', URL_A);
    settleCheckoutHandoff('s2', 'completed');
    // A second settle is a no-op; the promise keeps its first value.
    settleCheckoutHandoff('s2', 'dismissed');
    await expect(p).resolves.toBe('completed');
  });

  it('stops exposing the url after settlement', () => {
    startCheckoutHandoff('s3', URL_A);
    settleCheckoutHandoff('s3', 'completed');
    expect(readCheckoutHandoff('s3')).toBeNull();
  });

  it('supersedes an open handoff — the old awaiter resolves dismissed, the new url wins', async () => {
    const first = startCheckoutHandoff('s4', URL_A);
    const second = startCheckoutHandoff('s5', URL_B);
    await expect(first).resolves.toBe('dismissed');
    expect(readCheckoutHandoff('s4')).toBeNull();
    expect(readCheckoutHandoff('s5')).toEqual({ checkoutUrl: URL_B });
    settleCheckoutHandoff('s5', 'completed');
    await expect(second).resolves.toBe('completed');
  });

  it('a settle for a stale session never disturbs the current one', async () => {
    const p = startCheckoutHandoff('s6', URL_A);
    settleCheckoutHandoff('stale-session', 'completed'); // no-op
    expect(readCheckoutHandoff('s6')).toEqual({ checkoutUrl: URL_A });
    settleCheckoutHandoff('s6', 'dismissed');
    await expect(p).resolves.toBe('dismissed');
  });
});

describe('payment page first paint (timing only)', () => {
  it('records the first paint of the live handoff and keeps it after settling', async () => {
    const { startCheckoutHandoff, markCheckoutPageReady, readCheckoutPageReady, settleCheckoutHandoff } =
      await import('./checkoutHandoff');
    void startCheckoutHandoff('s-paint', 'https://checkout.example/1');
    expect(readCheckoutPageReady('s-paint')).toBeNull();
    markCheckoutPageReady('s-paint', 1_000);
    markCheckoutPageReady('s-paint', 2_000);
    expect(readCheckoutPageReady('s-paint')).toBe(1_000);
    settleCheckoutHandoff('s-paint', 'completed');
    expect(readCheckoutPageReady('s-paint')).toBe(1_000);
  });

  it('ignores a paint for another session or after settling', async () => {
    const { startCheckoutHandoff, markCheckoutPageReady, readCheckoutPageReady, settleCheckoutHandoff } =
      await import('./checkoutHandoff');
    void startCheckoutHandoff('s-a', 'https://checkout.example/a');
    markCheckoutPageReady('s-other', 1_000);
    expect(readCheckoutPageReady('s-a')).toBeNull();
    expect(readCheckoutPageReady('s-other')).toBeNull();
    settleCheckoutHandoff('s-a', 'dismissed');
    markCheckoutPageReady('s-a', 3_000);
    expect(readCheckoutPageReady('s-a')).toBeNull();
  });
});
