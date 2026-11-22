import { describe, expect, it, vi } from 'vitest';

import {
  cartChangedSince,
  checkoutChangedSince,
  decidePendingAction,
  describeVerifyResult,
  parsePendingSession,
  recoverPendingSession,
  refusalDropsSession,
  serializePendingSession,
  type PendingSession,
  type VerifyOutcome,
} from './pendingSession';

describe('parsePendingSession', () => {
  it('round-trips a saved session', () => {
    const raw = serializePendingSession('sess-1', 1234);
    expect(parsePendingSession(raw)).toEqual({ sessionId: 'sess-1', at: 1234, cartKey: null, checkoutKey: null });
  });
  it('round-trips the cart key a checkout was begun for', () => {
    const raw = serializePendingSession('sess-1', 1234, 'cart-a');
    expect(parsePendingSession(raw)).toEqual({ sessionId: 'sess-1', at: 1234, cartKey: 'cart-a', checkoutKey: null });
  });
  it('reads a record from an older build, which has no cart key, as unknown', () => {
    expect(parsePendingSession('{"sessionId":"s","at":5}')).toEqual({ sessionId: 's', at: 5, cartKey: null, checkoutKey: null });
    expect(parsePendingSession('{"sessionId":"s","cartKey":""}')).toEqual({ sessionId: 's', at: 0, cartKey: null, checkoutKey: null });
    expect(parsePendingSession('{"sessionId":"s","cartKey":7}')).toEqual({ sessionId: 's', at: 0, cartKey: null, checkoutKey: null });
  });
  it('returns null for absent / empty', () => {
    expect(parsePendingSession(null)).toBeNull();
    expect(parsePendingSession(undefined)).toBeNull();
    expect(parsePendingSession('')).toBeNull();
  });
  it('returns null for malformed or wrong-shaped values', () => {
    expect(parsePendingSession('not json')).toBeNull();
    expect(parsePendingSession('{"foo":1}')).toBeNull();
    expect(parsePendingSession('{"sessionId":""}')).toBeNull();
    expect(parsePendingSession('{"sessionId":123}')).toBeNull();
  });
  it('round-trips the card checkout key a checkout was begun under', () => {
    const raw = serializePendingSession('sess-1', 1234, 'cart-a', 'chk-a');
    expect(parsePendingSession(raw)).toEqual({ sessionId: 'sess-1', at: 1234, cartKey: 'cart-a', checkoutKey: 'chk-a' });
    expect(JSON.parse(serializePendingSession('sess-1', 1, null, null))).toEqual({ sessionId: 'sess-1', at: 1 });
  });
  it('reads a record without a checkout key (older build) as unknown', () => {
    expect(parsePendingSession('{"sessionId":"s","at":5,"cartKey":"c"}')).toEqual({ sessionId: 's', at: 5, cartKey: 'c', checkoutKey: null });
    expect(parsePendingSession('{"sessionId":"s","checkoutKey":""}')?.checkoutKey).toBeNull();
    expect(parsePendingSession('{"sessionId":"s","checkoutKey":9}')?.checkoutKey).toBeNull();
  });
  it('defaults a missing timestamp to 0', () => {
    expect(parsePendingSession('{"sessionId":"s"}')).toEqual({ sessionId: 's', at: 0, cartKey: null, checkoutKey: null });
  });
});

describe('decidePendingAction', () => {
  it('paid + orderId -> receipt', () => {
    expect(decidePendingAction({ status: 'paid', orderId: 'o1' })).toEqual({ kind: 'receipt', orderId: 'o1' });
  });
  it('paid without orderId -> keep (verify again)', () => {
    expect(decidePendingAction({ status: 'paid', orderId: null })).toEqual({ kind: 'keep' });
  });
  it('pending -> keep', () => {
    expect(decidePendingAction({ status: 'pending' })).toEqual({ kind: 'keep' });
  });
  it('null/undefined (verify failed) -> keep (never strand or double-charge)', () => {
    expect(decidePendingAction(null)).toEqual({ kind: 'keep' });
    expect(decidePendingAction(undefined)).toEqual({ kind: 'keep' });
  });
  it.each(['failed', 'cancelled', 'expired', 'refunded'])('terminal %s -> clear', (status) => {
    expect(decidePendingAction({ status } as VerifyOutcome)).toEqual({ kind: 'clear' });
  });
  it.each(['unknown', 'weird', 'processing'])('non-terminal %s -> keep (backend may still settle it)', (status) => {
    expect(decidePendingAction({ status } as VerifyOutcome)).toEqual({ kind: 'keep' });
  });
});

describe('recoverPendingSession', () => {
  const pending: PendingSession = { sessionId: 'sess-live', at: 100 };

  it('no pending session -> none (safe to begin a new checkout)', async () => {
    const clear = vi.fn(async () => {});
    const res = await recoverPendingSession({ read: async () => null, verify: async () => ({ status: 'paid' }), clear });
    expect(res).toEqual({ kind: 'none' });
    expect(clear).not.toHaveBeenCalled();
  });

  it('APP-KILLED recovery: pending session already paid -> receipt + key cleared (no second charge)', async () => {
    const clear = vi.fn(async () => {});
    const verify = vi.fn(async () => ({ status: 'paid', orderId: 'order-99' }) as VerifyOutcome);
    const res = await recoverPendingSession({ read: async () => pending, verify, clear });
    expect(verify).toHaveBeenCalledWith('sess-live');
    expect(res).toEqual({ kind: 'receipt', orderId: 'order-99' });
    expect(clear).toHaveBeenCalledOnce();
  });

  it('DUPLICATE-CHARGE PREVENTION: still-pending session -> resume (never none/cleared)', async () => {
    const clear = vi.fn(async () => {});
    const res = await recoverPendingSession({ read: async () => pending, verify: async () => ({ status: 'pending' }), clear });
    expect(res).toEqual({ kind: 'resume', sessionId: 'sess-live' });
    expect(clear).not.toHaveBeenCalled();
  });

  it('TRANSIENT verify failure -> resume, key kept (retry later, no new charge)', async () => {
    const clear = vi.fn(async () => {});
    const verify = vi.fn(async () => { throw new Error('network'); });
    const res = await recoverPendingSession({ read: async () => pending, verify, clear });
    expect(res).toEqual({ kind: 'resume', sessionId: 'sess-live' });
    expect(clear).not.toHaveBeenCalled();
  });

  it('EXPIRED retry: terminal session -> cleared (safe to begin a FRESH session)', async () => {
    const clear = vi.fn(async () => {});
    const res = await recoverPendingSession({ read: async () => pending, verify: async () => ({ status: 'expired' }), clear });
    expect(res).toEqual({ kind: 'cleared' });
    expect(clear).toHaveBeenCalledOnce();
  });

  it('REFUNDED: the money came back -> cleared, so the device is not stuck resuming it', async () => {
    const clear = vi.fn(async () => {});
    const res = await recoverPendingSession({ read: async () => pending, verify: async () => ({ status: 'refunded' }), clear });
    expect(res).toEqual({ kind: 'cleared' });
    expect(clear).toHaveBeenCalledOnce();
  });

  it('COLD-START return routing: paid deep link -> receipt; unresolved -> resume', async () => {
    // The payment/return route uses the same recover(): a captured payment routes
    // to the receipt, an unresolved one resumes the pay flow (not a new charge).
    const paid = await recoverPendingSession({ read: async () => pending, verify: async () => ({ status: 'paid', orderId: 'o' }), clear: async () => {} });
    expect(paid.kind).toBe('receipt');
    const unresolved = await recoverPendingSession({ read: async () => pending, verify: async () => ({ status: 'pending' }), clear: async () => {} });
    expect(unresolved.kind).toBe('resume');
  });
});

describe('describeVerifyResult', () => {
  it('a refunded payment is terminal, shown as failed with the server’s payUnknown', () => {
    expect(describeVerifyResult({ status: 'refunded', messageKey: 'payUnknown' })).toEqual({
      state: 'failed',
      terminal: true,
      messageKey: 'payUnknown',
    });
    // Without a key from the server it still says payUnknown, not payFailed:
    // "contact support if an amount was deducted" is the true sentence here.
    expect(describeVerifyResult({ status: 'refunded' }).messageKey).toBe('payUnknown');
  });

  it('an expired invoice is terminal and says so', () => {
    expect(describeVerifyResult({ status: 'expired', messageKey: 'payExpired' })).toEqual({
      state: 'expired',
      terminal: true,
      messageKey: 'payExpired',
    });
    // Closing the WebView changes nothing once the invoice is dead.
    expect(describeVerifyResult({ status: 'expired' }, { dismissed: true }).messageKey).toBe('payExpired');
  });

  it('a cancelled invoice or voided payment is terminal and says so', () => {
    expect(describeVerifyResult({ status: 'cancelled', messageKey: 'payCancelled' })).toEqual({
      state: 'cancelled',
      terminal: true,
      messageKey: 'payCancelled',
    });
  });

  it('a declined payment keeps the server’s more specific copy', () => {
    expect(describeVerifyResult({ status: 'failed', messageKey: 'payDeclined' })).toEqual({
      state: 'failed',
      terminal: true,
      messageKey: 'payDeclined',
    });
    expect(describeVerifyResult({ status: 'failed' }).messageKey).toBe('payFailed');
  });

  it('pending and unknown keep the session; a dismissal on pending says "not completed"', () => {
    expect(describeVerifyResult({ status: 'pending', messageKey: 'payPending' })).toEqual({
      state: 'pending',
      terminal: false,
      messageKey: 'payPending',
    });
    expect(describeVerifyResult({ status: 'pending' }, { dismissed: true }).messageKey).toBe('payNotCompleted');
    expect(describeVerifyResult({ status: 'unknown', messageKey: 'payUnknown' })).toEqual({
      state: 'pending',
      terminal: false,
      messageKey: 'payUnknown',
    });
  });

  it('never hands the screen a key it has no copy for', () => {
    // t() prints a missing key's own name, so 'payRefunded' would reach the
    // customer as the literal text "payRefunded".
    expect(describeVerifyResult({ status: 'failed', messageKey: 'payRefunded' }).messageKey).toBe('payFailed');
    expect(describeVerifyResult({ status: 'refunded', messageKey: 'payRefunded' }).messageKey).toBe('payUnknown');
    // A real key outside the payment family is not the server's to choose.
    expect(describeVerifyResult({ status: 'failed', messageKey: 'errServer' }).messageKey).toBe('payFailed');
  });

  it.each(['paid', 'pending', 'failed', 'cancelled', 'expired', 'refunded', 'unknown'])(
    'agrees with recovery about whether %s ends the session',
    (status) => {
      // The screen and recovery read one set. If they disagreed, the screen would
      // clear a session recovery keeps resuming, or the reverse.
      const recovery = decidePendingAction({ status, orderId: null });
      expect(describeVerifyResult({ status }).terminal).toBe(recovery.kind === 'clear');
    },
  );
});

describe('refusalDropsSession', () => {
  // Nothing can be paid on a session under Moyasar's 1.00 SAR minimum, so the
  // saved session goes at once.
  it('drops the session only for a total under the minimum', () => {
    expect(refusalDropsSession({ status: 'disabled', reason: 'amount_below_minimum' })).toBe(true);
  });

  // These refusals are made before THAT request opens an attempt, but an earlier
  // attempt on the same session may hold a paid invoice; payment-verify decides.
  it.each([
    [{ status: 'disabled' }],
    [{ status: 'disabled', reason: 'test_mode' }],
    [{ status: 'disabled', reason: null }],
    [{ status: 'already_paid', reason: 'amount_below_minimum' }],
    [{}],
  ])('keeps it for %j', (init) => {
    expect(refusalDropsSession(init)).toBe(false);
  });
});

describe('cartChangedSince', () => {
  it('is true only when both keys are known and differ', () => {
    expect(cartChangedSince({ sessionId: 's', at: 0, cartKey: 'a' }, 'b')).toBe(true);
    expect(cartChangedSince({ sessionId: 's', at: 0, cartKey: 'a' }, 'a')).toBe(false);
    expect(cartChangedSince({ sessionId: 's', at: 0, cartKey: null }, 'b')).toBe(false);
    expect(cartChangedSince({ sessionId: 's', at: 0 }, 'b')).toBe(false);
    expect(cartChangedSince({ sessionId: 's', at: 0, cartKey: 'a' }, null)).toBe(false);
    expect(cartChangedSince({ sessionId: 's', at: 0, cartKey: 'a' }, undefined)).toBe(false);
  });
});

// 2026-11-18: a customer whose card payment was refused changed their cart from
// a 17.00 SAR meal to a 1.00 SAR water, and was shown the 17.00 page again,
// because an unresolved checkout is always resumed before a new one begins.
describe('recoverPendingSession — a checkout the customer replaced by changing the cart', () => {
  const old: PendingSession = { sessionId: 'sess-old', at: 100, cartKey: 'cart-meal' };
  const stillOpen = async () => ({ status: 'pending' }) as VerifyOutcome;

  it('drops it and lets a new checkout begin when the server cancelled it', async () => {
    const clear = vi.fn(async () => {});
    const abandon = vi.fn(async () => ({ status: 'cancelled' }) as VerifyOutcome);
    const res = await recoverPendingSession({
      read: async () => old, verify: stillOpen, clear, currentCartKey: 'cart-water', abandon,
    });
    expect(abandon).toHaveBeenCalledWith('sess-old');
    expect(res).toEqual({ kind: 'cleared' });
    expect(clear).toHaveBeenCalledOnce();
  });

  it('resumes it when the server refuses because a payment is under way', async () => {
    const clear = vi.fn(async () => {});
    const abandon = vi.fn(async () => ({ status: 'pending' }) as VerifyOutcome);
    const res = await recoverPendingSession({
      read: async () => old, verify: stillOpen, clear, currentCartKey: 'cart-water', abandon,
    });
    expect(res).toEqual({ kind: 'resume', sessionId: 'sess-old' });
    expect(clear).not.toHaveBeenCalled();
  });

  it('resumes it when the abandon call fails (could not find out)', async () => {
    const clear = vi.fn(async () => {});
    const abandon = vi.fn(async () => { throw new Error('network'); });
    const res = await recoverPendingSession({
      read: async () => old, verify: stillOpen, clear, currentCartKey: 'cart-water', abandon,
    });
    expect(res).toEqual({ kind: 'resume', sessionId: 'sess-old' });
    expect(clear).not.toHaveBeenCalled();
  });

  it('opens the receipt when the old checkout turned out to be paid', async () => {
    const clear = vi.fn(async () => {});
    const abandon = vi.fn(async () => ({ status: 'paid', orderId: 'order-7' }) as VerifyOutcome);
    const res = await recoverPendingSession({
      read: async () => old, verify: stillOpen, clear, currentCartKey: 'cart-water', abandon,
    });
    expect(res).toEqual({ kind: 'receipt', orderId: 'order-7' });
    expect(clear).toHaveBeenCalledOnce();
  });

  it('never asks to abandon the checkout for the SAME cart', async () => {
    const abandon = vi.fn(async () => ({ status: 'cancelled' }) as VerifyOutcome);
    const res = await recoverPendingSession({
      read: async () => old, verify: stillOpen, clear: async () => {}, currentCartKey: 'cart-meal', abandon,
    });
    expect(abandon).not.toHaveBeenCalled();
    expect(res).toEqual({ kind: 'resume', sessionId: 'sess-old' });
  });

  it('never asks for a record without a cart key (older build, payment return link)', async () => {
    const abandon = vi.fn(async () => ({ status: 'cancelled' }) as VerifyOutcome);
    const res = await recoverPendingSession({
      read: async () => ({ sessionId: 'sess-old', at: 1, cartKey: null }),
      verify: stillOpen, clear: async () => {}, currentCartKey: 'cart-water', abandon,
    });
    expect(abandon).not.toHaveBeenCalled();
    expect(res).toEqual({ kind: 'resume', sessionId: 'sess-old' });
  });

  it('does not ask when verify already settled it (paid or terminal)', async () => {
    const abandon = vi.fn(async () => ({ status: 'cancelled' }) as VerifyOutcome);
    const paid = await recoverPendingSession({
      read: async () => old, verify: async () => ({ status: 'paid', orderId: 'o' }), clear: async () => {},
      currentCartKey: 'cart-water', abandon,
    });
    const dead = await recoverPendingSession({
      read: async () => old, verify: async () => ({ status: 'expired' }), clear: async () => {},
      currentCartKey: 'cart-water', abandon,
    });
    expect(abandon).not.toHaveBeenCalled();
    expect(paid).toEqual({ kind: 'receipt', orderId: 'o' });
    expect(dead).toEqual({ kind: 'cleared' });
  });
});

describe('checkoutChangedSince', () => {
  it('is true only when both checkout keys are known and differ', () => {
    expect(checkoutChangedSince({ sessionId: 's', at: 0, checkoutKey: 'a' }, 'b')).toBe(true);
    expect(checkoutChangedSince({ sessionId: 's', at: 0, checkoutKey: 'a' }, 'a')).toBe(false);
    expect(checkoutChangedSince({ sessionId: 's', at: 0, checkoutKey: null }, 'b')).toBe(false);
    expect(checkoutChangedSince({ sessionId: 's', at: 0 }, 'b')).toBe(false);
    expect(checkoutChangedSince({ sessionId: 's', at: 0, checkoutKey: 'a' }, null)).toBe(false);
    expect(checkoutChangedSince({ sessionId: 's', at: 0, checkoutKey: 'a' }, undefined)).toBe(false);
  });
});

// Audit F-X02-001: the same items, but the customer switched pickup to
// delivery (or changed branch, address, coupon, points or notes). The cart key
// did not move, so the old checkout was resumed and its old total charged.
describe('recoverPendingSession — a checkout the customer replaced by changing the order details', () => {
  const old: PendingSession = { sessionId: 'sess-old', at: 100, cartKey: 'cart-meal', checkoutKey: 'chk-pickup' };
  const stillOpen = async () => ({ status: 'pending' }) as VerifyOutcome;

  it('asks to abandon it when only the checkout key changed, and begins anew once cancelled', async () => {
    const clear = vi.fn(async () => {});
    const abandon = vi.fn(async () => ({ status: 'cancelled' }) as VerifyOutcome);
    const res = await recoverPendingSession({
      read: async () => old, verify: stillOpen, clear,
      currentCartKey: 'cart-meal', currentCheckoutKey: 'chk-delivery', abandon,
    });
    expect(abandon).toHaveBeenCalledWith('sess-old');
    expect(res).toEqual({ kind: 'cleared' });
    expect(clear).toHaveBeenCalledOnce();
  });

  it('resumes it when a payment on it is under way (the screen then checks the total)', async () => {
    const abandon = vi.fn(async () => ({ status: 'pending' }) as VerifyOutcome);
    const res = await recoverPendingSession({
      read: async () => old, verify: stillOpen, clear: async () => {},
      currentCartKey: 'cart-meal', currentCheckoutKey: 'chk-delivery', abandon,
    });
    expect(res).toEqual({ kind: 'resume', sessionId: 'sess-old' });
  });

  it('does not ask when the details are the same', async () => {
    const abandon = vi.fn(async () => ({ status: 'cancelled' }) as VerifyOutcome);
    const res = await recoverPendingSession({
      read: async () => old, verify: stillOpen, clear: async () => {},
      currentCartKey: 'cart-meal', currentCheckoutKey: 'chk-pickup', abandon,
    });
    expect(abandon).not.toHaveBeenCalled();
    expect(res).toEqual({ kind: 'resume', sessionId: 'sess-old' });
  });

  it('on screen entry (no checkout key passed) behaves exactly as before', async () => {
    const abandon = vi.fn(async () => ({ status: 'cancelled' }) as VerifyOutcome);
    const res = await recoverPendingSession({
      read: async () => old, verify: stillOpen, clear: async () => {}, currentCartKey: 'cart-meal', abandon,
    });
    expect(abandon).not.toHaveBeenCalled();
    expect(res).toEqual({ kind: 'resume', sessionId: 'sess-old' });
  });

  it('still abandons on an item change when the record has no checkout key', async () => {
    const abandon = vi.fn(async () => ({ status: 'cancelled' }) as VerifyOutcome);
    const res = await recoverPendingSession({
      read: async () => ({ sessionId: 'sess-old', at: 1, cartKey: 'cart-meal', checkoutKey: null }),
      verify: stillOpen, clear: async () => {},
      currentCartKey: 'cart-water', currentCheckoutKey: 'chk-any', abandon,
    });
    expect(abandon).toHaveBeenCalledOnce();
    expect(res).toEqual({ kind: 'cleared' });
  });
});
