import { describe, expect, it, vi } from 'vitest';

import {
  decidePendingAction,
  describeVerifyResult,
  parsePendingSession,
  recoverPendingSession,
  serializePendingSession,
  type PendingSession,
  type VerifyOutcome,
} from './pendingSession';

describe('parsePendingSession', () => {
  it('round-trips a saved session', () => {
    const raw = serializePendingSession('sess-1', 1234);
    expect(parsePendingSession(raw)).toEqual({ sessionId: 'sess-1', at: 1234 });
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
  it('defaults a missing timestamp to 0', () => {
    expect(parsePendingSession('{"sessionId":"s"}')).toEqual({ sessionId: 's', at: 0 });
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
