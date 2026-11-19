import { describe, expect, it } from 'vitest';

import { createCheckoutTimeline } from './checkoutTimeline';

function clock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('checkout timeline', () => {
  it('records milliseconds from the tap to each step', () => {
    const c = clock();
    const tl = createCheckoutTimeline(c.now);
    c.advance(400);
    tl.mark('session_begun');
    c.advance(2_000);
    tl.mark('page_requested');
    c.advance(30_000);
    tl.mark('page_left');
    c.advance(900);
    tl.mark('verified');
    expect(tl.marks()).toEqual({
      session_begun: 400,
      page_requested: 2_400,
      page_left: 32_400,
      verified: 33_300,
    });
  });

  it('accepts a step recorded elsewhere at an absolute time', () => {
    const c = clock(10_000);
    const tl = createCheckoutTimeline(c.now);
    c.advance(5_000);
    tl.mark('page_ready', 12_500);
    expect(tl.marks()).toEqual({ page_ready: 2_500 });
  });

  it('keeps the first time of a repeated step', () => {
    const c = clock();
    const tl = createCheckoutTimeline(c.now);
    c.advance(100);
    tl.mark('verified');
    c.advance(100);
    tl.mark('verified');
    expect(tl.marks().verified).toBe(100);
  });

  it('never reports a negative duration', () => {
    const tl = createCheckoutTimeline(() => 5_000);
    tl.mark('page_ready', 4_000);
    expect(tl.marks().page_ready).toBe(0);
  });

  it('allows exactly one report per checkout', () => {
    const tl = createCheckoutTimeline(() => 0);
    expect(tl.claimReport()).toBe(true);
    expect(tl.claimReport()).toBe(false);
  });

  it('hands back a copy, so a caller cannot rewrite the record', () => {
    const tl = createCheckoutTimeline(() => 0);
    tl.mark('session_begun');
    const m = tl.marks();
    m.session_begun = 999;
    expect(tl.marks().session_begun).toBe(0);
  });
});
