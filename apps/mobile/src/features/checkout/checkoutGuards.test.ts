import { describe, expect, it } from 'vitest';

import { appliedCouponSurvives, decideCompChange, decideQuantityChange, resolveBlockReason } from './checkoutGuards';

/**
 * Replays a sequence of stepper taps the way CheckoutScreen does: a synchronous
 * guard ref that the first applied change sets, against a FIXED quantity
 * snapshot — because rapid same-frame taps arrive before React re-renders the
 * cart, so every tap in the burst reads the same starting quantity. Returns what
 * actually happened: which mutations were enqueued and whether the
 * "Remove this item?" confirm was shown.
 */
function replayTaps(startQty: number, taps: Array<1 | -1>) {
  let guard: string | null = null;
  let confirmShown = false;
  const mutations: Array<1 | -1> = [];
  for (const dir of taps) {
    const decision = decideQuantityChange({
      recalcActive: guard !== null,
      quantity: startQty,
      direction: dir,
    });
    if (decision.kind === 'ignore') continue;
    if (decision.kind === 'confirm-remove') { confirmShown = true; continue; }
    // Handler sets the ref BEFORE mutating the cart.
    guard = 'line';
    mutations.push(decision.direction);
  }
  return { confirmShown, mutations };
}

describe('decideQuantityChange', () => {
  it('applies a normal decrement above 1', () => {
    expect(decideQuantityChange({ recalcActive: false, quantity: 2, direction: -1 }))
      .toEqual({ kind: 'apply', direction: -1 });
  });

  it('routes a decrement at quantity 1 to the confirm modal, never a silent remove', () => {
    expect(decideQuantityChange({ recalcActive: false, quantity: 1, direction: -1 }))
      .toEqual({ kind: 'confirm-remove' });
  });

  it('ignores any tap while a change for the line is still settling', () => {
    expect(decideQuantityChange({ recalcActive: true, quantity: 2, direction: -1 }))
      .toEqual({ kind: 'ignore' });
    expect(decideQuantityChange({ recalcActive: true, quantity: 5, direction: 1 }))
      .toEqual({ kind: 'ignore' });
  });

  it('always applies an increment', () => {
    expect(decideQuantityChange({ recalcActive: false, quantity: 1, direction: 1 }))
      .toEqual({ kind: 'apply', direction: 1 });
  });
});

describe('rapid stepper taps cannot silently remove a line (PR #103 double-tap bug)', () => {
  it('a fast double "−" at qty 2 enqueues ONE decrement and shows no modal (2→1, not 2→1→0)', () => {
    // Old behaviour: the settling guard was set and cleared in the same frame, so
    // it never held; both taps read quantity===2, both decremented, and the
    // functional cart mutation ran 2→1→0 — removing the line past the confirm.
    const { mutations, confirmShown } = replayTaps(2, [-1, -1]);
    expect(mutations).toEqual([-1]); // exactly one decrement survives the burst
    expect(mutations.length).toBe(1); // never two — the line cannot reach 0
    expect(confirmShown).toBe(false);
  });

  it('a triple "−" at qty 2 still only decrements once', () => {
    const { mutations } = replayTaps(2, [-1, -1, -1]);
    expect(mutations).toEqual([-1]);
  });

  it('a fast double "−" at qty 1 shows the confirm and enqueues NO mutation', () => {
    // Removal is only ever reachable through the modal, never a raw decrement.
    const { mutations, confirmShown } = replayTaps(1, [-1, -1]);
    expect(mutations).toEqual([]);
    expect(confirmShown).toBe(true);
  });

  it('a fast double "+" enqueues only one increment', () => {
    const { mutations } = replayTaps(1, [1, 1]);
    expect(mutations).toEqual([1]);
  });
});

describe('resolveBlockReason — footer priority', () => {
  const ok = {
    hasBranch: true,
    branchOpen: true,
    hasOrderType: true,
    isEmpty: false,
    belowMinimum: false,
    paymentUnavailable: false,
    deliveryBlocked: false,
    needsDescription: false,
  };

  it('returns null when nothing blocks the order', () => {
    expect(resolveBlockReason(ok)).toBeNull();
  });

  it('shows "empty cart", not "below minimum", when the last line is removed (PR #103 P3)', () => {
    // An empty cart is trivially under any delivery minimum, so both flags are
    // set at once — the empty-cart message must win.
    expect(resolveBlockReason({ ...ok, isEmpty: true, belowMinimum: true }))
      .toBe('empty-cart');
  });

  it('shows "below minimum" only when the cart is non-empty', () => {
    expect(resolveBlockReason({ ...ok, isEmpty: false, belowMinimum: true }))
      .toBe('below-minimum');
  });

  it('orders the upstream gates ahead of the cart state', () => {
    expect(resolveBlockReason({ ...ok, hasBranch: false, isEmpty: true, belowMinimum: true }))
      .toBe('no-branch');
    expect(resolveBlockReason({ ...ok, branchOpen: false, isEmpty: true }))
      .toBe('branch-closed');
    expect(resolveBlockReason({ ...ok, hasOrderType: false, isEmpty: true }))
      .toBe('no-order-type');
  });

  it('orders payment, delivery and description after the cart is valid', () => {
    expect(resolveBlockReason({ ...ok, paymentUnavailable: true, deliveryBlocked: true, needsDescription: true }))
      .toBe('no-payment');
    expect(resolveBlockReason({ ...ok, deliveryBlocked: true, needsDescription: true }))
      .toBe('delivery-unserviceable');
    expect(resolveBlockReason({ ...ok, needsDescription: true }))
      .toBe('need-description');
  });
});

/**
 * A coupon carried past a cart change is not a display bug: place_order re-runs
 * validate_coupon against the recomputed subtotal and raises
 * "Coupon rejected: …", so the order fails at submit. These pin the rule that
 * decides when the applied coupon is dropped.
 */
describe('appliedCouponSurvives', () => {
  const applied = (subtotal: number) => ({ ok: true, subtotal });

  it('survives while the basket it was priced against is unchanged', () => {
    expect(appliedCouponSurvives(applied(104), 104)).toBe(true);
  });

  it('does not survive a basket that grew or shrank', () => {
    expect(appliedCouponSurvives(applied(104), 120)).toBe(false);
    expect(appliedCouponSurvives(applied(104), 88)).toBe(false);
    // The case the stepper never covered: a line edited on the product screen
    // while Checkout stayed mounted.
    expect(appliedCouponSurvives(applied(104), 104.5)).toBe(false);
  });

  it('keeps a rejection message, which is about the code and not the cart', () => {
    const rejected = { ok: false, subtotal: 104 };
    expect(appliedCouponSurvives(rejected, 104)).toBe(true);
    expect(appliedCouponSurvives(rejected, 999)).toBe(true);
  });

  it('treats "no coupon" as nothing to keep', () => {
    expect(appliedCouponSurvives(null, 104)).toBe(false);
    expect(appliedCouponSurvives(undefined, 104)).toBe(false);
  });

  it('is exact — a sub-riyal drift still drops it', () => {
    // An epsilon here would only widen the window where the client shows a
    // discount the server refuses.
    expect(appliedCouponSurvives(applied(104), 104.01)).toBe(false);
  });

  it('drops the coupon when the cart empties', () => {
    expect(appliedCouponSurvives(applied(104), 0)).toBe(false);
  });
});

describe('decideCompChange', () => {
  // An administrator revoked the comp while checkout sat open. Letting this
  // through would charge the customer full price against a screen reading 0.00.
  it('blocks when the comp was lost, and corrects the screen', () => {
    expect(decideCompChange({ displayed: true, fresh: false }))
      .toEqual({ action: 'block', comped: false });
  });

  it('lets a newly-comped order through, charging less than was displayed', () => {
    expect(decideCompChange({ displayed: false, fresh: true }))
      .toEqual({ action: 'update', comped: true });
  });

  it('does nothing when the answer has not changed', () => {
    expect(decideCompChange({ displayed: true, fresh: true }))
      .toEqual({ action: 'none', comped: true });
    expect(decideCompChange({ displayed: false, fresh: false }))
      .toEqual({ action: 'none', comped: false });
  });

  it('never blocks on an unknown answer — the server stays the authority', () => {
    // A flaky network must not refuse a valid order. Critically this holds for
    // a COMPED customer too: null must not be read as "no longer comped".
    expect(decideCompChange({ displayed: true, fresh: null }))
      .toEqual({ action: 'none', comped: true });
    expect(decideCompChange({ displayed: false, fresh: null }))
      .toEqual({ action: 'none', comped: false });
  });
});
