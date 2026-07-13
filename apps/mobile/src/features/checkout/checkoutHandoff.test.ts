import { describe, expect, it } from 'vitest';

import {
  readCheckoutHandoff,
  settleCheckoutHandoff,
  startCheckoutHandoff,
} from './checkoutHandoff';

const URL_A = 'https://checkout.tap.company/pay/aaa?token=secret-a';
const URL_B = 'https://checkout.tap.company/pay/bbb?token=secret-b';

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
