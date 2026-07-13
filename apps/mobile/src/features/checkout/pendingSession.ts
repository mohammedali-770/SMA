/**
 * Interrupted-online-payment recovery — PURE logic (no React Native / Supabase
 * imports), so it is unit-testable and reusable from both the checkout screen
 * and the payment-return deep-link route.
 *
 * Why this exists: with the checkout-session flow the order is created ONLY after
 * the backend verifies the charge. If the app is killed (or the user closes the
 * pay sheet) while a charge is in flight, the session id lived only in component
 * state — on relaunch the cart was still full, so tapping "Place Order" again
 * opened a SECOND charge for an order the backend may have already created. We
 * persist the pending session id and, before ever beginning a new checkout,
 * resolve the old one via the server (verifySession) — recovering the paid order,
 * resuming a still-pending one, or clearing a terminal one. A new charge is never
 * opened while an unresolved session exists.
 */

/** AsyncStorage key holding the single in-flight checkout session, if any. */
export const PENDING_SESSION_KEY = 'sm.pendingCheckoutSession';

export interface PendingSession {
  sessionId: string;
  /** epoch ms when the pay flow started (for optional staleness display). */
  at: number;
}

/** Parse a stored record; null if absent, malformed, or wrong-shaped. */
export function parsePendingSession(raw: string | null | undefined): PendingSession | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && typeof o.sessionId === 'string' && o.sessionId.length > 0) {
      return { sessionId: o.sessionId, at: typeof o.at === 'number' ? o.at : 0 };
    }
  } catch {
    /* corrupt value → treat as absent */
  }
  return null;
}

/** Serialize a pending session for storage. */
export function serializePendingSession(sessionId: string, at: number): string {
  return JSON.stringify({ sessionId, at });
}

/** The result of verifySession, narrowed to what the decision needs. */
export interface VerifyOutcome {
  status: string;               // 'paid' | 'pending' | 'failed' | 'cancelled' | 'expired' | ...
  orderId?: string | null;      // present (with status 'paid') once the order exists
}

export type PendingAction =
  | { kind: 'receipt'; orderId: string }  // paid → open the receipt, clear cart + key
  | { kind: 'keep' }                       // still pending / transient error → leave the key
  | { kind: 'clear' };                     // terminal (failed/cancelled/expired) → drop the key

/**
 * Decide what to do with a stored pending session given a verifySession result
 * (or null when the verify call itself failed / couldn't run). Conservative: a
 * missing/unknown result KEEPS the session so a transient network error can never
 * strand or double-charge the customer.
 */
export function decidePendingAction(res: VerifyOutcome | null | undefined): PendingAction {
  if (!res) return { kind: 'keep' };
  if (res.status === 'paid' && res.orderId) return { kind: 'receipt', orderId: res.orderId };
  if (res.status === 'paid') return { kind: 'keep' };     // paid but order id not resolved yet → retry verify
  if (res.status === 'pending') return { kind: 'keep' };
  return { kind: 'clear' };                                // failed | cancelled | expired | unknown-terminal
}

export type RecoverResult =
  | { kind: 'none' }                        // nothing pending → safe to begin a new checkout
  | { kind: 'receipt'; orderId: string }    // the pending payment succeeded → go to the receipt
  | { kind: 'resume'; sessionId: string }   // still unresolved → resume THAT session (never a new charge)
  | { kind: 'cleared' };                    // pending session was terminal → cleared, safe to begin new

/**
 * Resolve any interrupted payment BEFORE a new checkout is begun. Dependency-
 * injected (read / verify / clear) so it is unit-testable without AsyncStorage or
 * Supabase. Guarantees: while a pending session is unresolved it returns 'resume'
 * or 'receipt' (never 'none'/'cleared'), so the caller must NOT open a new charge.
 */
export async function recoverPendingSession(deps: {
  read: () => Promise<PendingSession | null>;
  verify: (sessionId: string) => Promise<VerifyOutcome>;
  clear: () => Promise<void>;
}): Promise<RecoverResult> {
  const pending = await deps.read();
  if (!pending) return { kind: 'none' };

  let res: VerifyOutcome | null = null;
  try {
    res = await deps.verify(pending.sessionId);
  } catch {
    res = null; // transient — keep the session for a later retry
  }

  const action = decidePendingAction(res);
  if (action.kind === 'receipt') {
    await deps.clear();
    return { kind: 'receipt', orderId: action.orderId };
  }
  if (action.kind === 'clear') {
    await deps.clear();
    return { kind: 'cleared' };
  }
  return { kind: 'resume', sessionId: pending.sessionId };
}
