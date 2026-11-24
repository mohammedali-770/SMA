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

import { STRINGS, type StringKey } from '../../i18n/strings';

/** AsyncStorage key holding the single in-flight checkout session, if any. */
export const PENDING_SESSION_KEY = 'sm.pendingCheckoutSession';

export interface PendingSession {
  sessionId: string;
  /** epoch ms when the pay flow started (for optional staleness display). */
  at: number;
  /**
   * The cart's idempotency key when this checkout was begun, i.e. which order it
   * is for. Null for a record written by an older build, or from the payment
   * return link, which never knows the cart. See `recoverPendingSession`.
   */
  cartKey?: string | null;
  /**
   * The CARD checkout key it was begun under (checkoutSessionKey): the cart key
   * plus every other input sent to begin_checkout_session. Null for a record
   * written by an older build, or when the checkout was resumed rather than
   * begun. See `checkoutChangedSince`.
   */
  checkoutKey?: string | null;
}

/** Parse a stored record; null if absent, malformed, or wrong-shaped. */
export function parsePendingSession(raw: string | null | undefined): PendingSession | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && typeof o.sessionId === 'string' && o.sessionId.length > 0) {
      return {
        sessionId: o.sessionId,
        at: typeof o.at === 'number' ? o.at : 0,
        cartKey: typeof o.cartKey === 'string' && o.cartKey.length > 0 ? o.cartKey : null,
        checkoutKey: typeof o.checkoutKey === 'string' && o.checkoutKey.length > 0 ? o.checkoutKey : null,
      };
    }
  } catch {
    /* corrupt value → treat as absent */
  }
  return null;
}

/** Serialize a pending session for storage. */
export function serializePendingSession(
  sessionId: string,
  at: number,
  cartKey: string | null = null,
  checkoutKey: string | null = null,
): string {
  return JSON.stringify({
    sessionId,
    at,
    ...(cartKey ? { cartKey } : {}),
    ...(checkoutKey ? { checkoutKey } : {}),
  });
}

/**
 * Is the saved checkout for a DIFFERENT order than the cart now on screen?
 * Only when both keys are known: a record without one (older build, payment
 * return link) is treated as the same order, which is the behaviour before
 * this check existed.
 */
export function cartChangedSince(pending: PendingSession, currentCartKey: string | null | undefined): boolean {
  return Boolean(pending.cartKey && currentCartKey && pending.cartKey !== currentCartKey);
}

/**
 * Was the saved checkout begun for different ORDER DETAILS than the ones on
 * screen now: order type, branch, address, coupon, points or notes, as well as
 * the items (audit F-X02-001)? Only when both keys are known, as with
 * cartChangedSince: an unknown key is treated as the same checkout, and the
 * total check before payment (sessionTotalMatchesShown) still stands.
 */
export function checkoutChangedSince(pending: PendingSession, currentCheckoutKey: string | null | undefined): boolean {
  return Boolean(pending.checkoutKey && currentCheckoutKey && pending.checkoutKey !== currentCheckoutKey);
}

/** The result of verifySession, narrowed to what the decision needs. */
export interface VerifyOutcome {
  status: string;               // 'paid' | 'pending' | 'failed' | 'cancelled' | 'expired' | 'refunded' | 'unknown'
  orderId?: string | null;      // present (with status 'paid') once the order exists
}

export type PendingAction =
  | { kind: 'receipt'; orderId: string }  // paid → open the receipt, clear cart + key
  | { kind: 'keep' }                       // still pending / unknown / transient error → leave the key
  | { kind: 'clear' };                     // terminal (failed/cancelled/expired/refunded) → drop the key

/**
 * payment-verify outcomes that are DEFINITELY terminal — the payment can no longer
 * settle into an order, so the session is safe to drop. 'cancelled' and 'expired'
 * cover a cancelled or expired invoice as well as a voided payment; 'refunded'
 * means the money already came back. Every other value (pending, 'unknown', or any
 * status the backend still leaves open) is KEPT: the backend treats an unknown
 * payment as pending, so clearing here would abandon a possibly-live payment and
 * let the next checkout open a second one.
 *
 * The checkout screen reads this same set through describeVerifyResult, so the
 * screen and recovery cannot disagree about which outcomes end a session.
 */
const TERMINAL_STATUSES = new Set(['failed', 'cancelled', 'expired', 'refunded']);

/**
 * Decide what to do with a stored pending session given a verifySession result
 * (or null when the verify call itself failed / couldn't run). Conservative: only
 * an explicitly terminal status clears the session; a missing/pending/unknown
 * result KEEPS it so a transient error or still-settling charge can never strand
 * or double-charge the customer.
 */
export function decidePendingAction(res: VerifyOutcome | null | undefined): PendingAction {
  if (!res) return { kind: 'keep' };
  if (res.status === 'paid' && res.orderId) return { kind: 'receipt', orderId: res.orderId };
  if (res.status === 'paid') return { kind: 'keep' };        // paid but order id not resolved yet → retry verify
  if (TERMINAL_STATUSES.has(res.status)) return { kind: 'clear' };
  return { kind: 'keep' };                                    // pending | unknown | anything still open
}

/** The overlay state a verify result is shown in (a subset of the screen's PayState). */
export type VerifyPayState = 'pending' | 'failed' | 'cancelled' | 'expired';

export interface VerifyDisplay {
  state: VerifyPayState;
  /** True when the session is dead server-side: clear it, and a retry opens a fresh one. */
  terminal: boolean;
  messageKey: StringKey;
}

/** A server message key the app can actually render: t() prints an unknown key's own name. */
function isPayKey(key: string | null | undefined): key is StringKey {
  return typeof key === 'string' && key.startsWith('pay') && key in STRINGS.en;
}

/**
 * How the checkout screen shows a verify result that did not open a receipt.
 *
 * Only an EXPLICITLY terminal outcome is terminal (see TERMINAL_STATUSES). A
 * refunded payment is shown as failed, with the server's message — payUnknown,
 * whose copy tells the customer to contact support if an amount was deducted. A
 * customer who closed the WebView on a still-open payment sees payNotCompleted.
 * A message key the app has no copy for falls back to the state's own copy
 * rather than reaching the screen as a raw key.
 */
export function describeVerifyResult(
  res: { status: string; messageKey?: string | null },
  opts: { dismissed?: boolean } = {},
): VerifyDisplay {
  const terminal = TERMINAL_STATUSES.has(res.status);
  const state: VerifyPayState =
    res.status === 'cancelled' ? 'cancelled'
    : res.status === 'expired' ? 'expired'
    : terminal ? 'failed'
    : 'pending';
  const messageKey: StringKey =
    state === 'pending' && opts.dismissed ? 'payNotCompleted'
    : isPayKey(res.messageKey) ? res.messageKey
    : res.status === 'refunded' ? 'payUnknown'
    : state === 'cancelled' ? 'payCancelled'
    : state === 'expired' ? 'payExpired'
    : state === 'pending' ? 'payPending'
    : 'payFailed';
  return { state, terminal, messageKey };
}

/**
 * Is a payment-initiate refusal one that leaves NOTHING payable, so the saved
 * session may be dropped at once?
 *
 * Only `amount_below_minimum`: Moyasar will not invoice a total under 1.00 SAR,
 * so no invoice can exist for that session, and the server retires it.
 *
 * Every other {status:'disabled'} — a gateway switched off, missing or in TEST
 * mode — is decided before that request opens an attempt, but the session may
 * already hold an earlier one whose invoice the customer has paid. With the
 * gateway off, the webhook ignores that payment, and dropping the session
 * would leave nothing to confirm it. Those are resolved through payment-verify
 * (recoverPendingSession), which drops a session only when the server answers
 * it terminal.
 */
export function refusalDropsSession(init: { status?: string | null; reason?: string | null }): boolean {
  return init.status === 'disabled' && init.reason === 'amount_below_minimum';
}

/**
 * What payment-verify answers (HTTP 404) when the signed-in customer cannot see
 * the checkout session: it never existed, or it belongs to somebody else (row
 * level security hides it). Either way THIS customer can never resume it, so a
 * saved pointer to it is dead weight rather than something to retry. Pinned
 * against the server's string in pendingSessionPointerWiring.test.ts.
 *
 * Only this exact server sentence counts. A platform "function not found" (a
 * function that is down or not deployed) carries no such sentence, so an outage
 * still keeps the pointer.
 */
export const SESSION_NOT_FOUND_MESSAGE = 'Checkout session not found';

export function isSessionGoneError(err: unknown): boolean {
  return err instanceof Error && err.message === SESSION_NOT_FOUND_MESSAGE;
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
  /**
   * The cart now on screen, and the server call that drops a checkout the
   * customer has replaced (payment-verify, action 'abandon'). Both optional:
   * without them an unresolved checkout is always resumed.
   */
  currentCartKey?: string | null;
  /**
   * The card checkout key for the details now on screen. Passed only where the
   * customer has chosen them (Place Order), never on screen entry, where the
   * screen's defaults are not a choice.
   */
  currentCheckoutKey?: string | null;
  abandon?: (sessionId: string) => Promise<VerifyOutcome>;
}): Promise<RecoverResult> {
  const pending = await deps.read();
  if (!pending) return { kind: 'none' };

  let res: VerifyOutcome | null = null;
  try {
    res = await deps.verify(pending.sessionId);
  } catch (e) {
    // A session this customer cannot see can never be resumed by them: drop the
    // pointer instead of retrying for ever. Without this, a stale pointer (a
    // forged return link, or the previous account on a shared phone) sent every
    // later checkout, cash included, into resuming a checkout that was not
    // theirs (audit findings F-TA5-001 and F-TA5-002).
    if (isSessionGoneError(e)) {
      await deps.clear();
      return { kind: 'cleared' };
    }
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

  // Still open, but for a different order than the cart now on screen: the
  // customer gave up on that payment and changed their cart. Ask the server to
  // drop it. It does so only when nobody has started paying it, after
  // cancelling its invoice at Moyasar; otherwise it answers pending and THAT
  // checkout is resumed, exactly as before, because a payment under way must
  // never be abandoned for a second charge.
  // Since F-X02-001 "a different order" also means different order details
  // with the same items: the server would otherwise invoice the old total.
  if (
    deps.abandon &&
    (cartChangedSince(pending, deps.currentCartKey) || checkoutChangedSince(pending, deps.currentCheckoutKey))
  ) {
    let res2: VerifyOutcome | null = null;
    try {
      res2 = await deps.abandon(pending.sessionId);
    } catch {
      res2 = null; // could not find out → resume, the safe answer
    }
    const after = decidePendingAction(res2);
    if (after.kind === 'receipt') {
      await deps.clear();
      return { kind: 'receipt', orderId: after.orderId };
    }
    if (after.kind === 'clear') {
      await deps.clear();
      return { kind: 'cleared' };
    }
  }
  return { kind: 'resume', sessionId: pending.sessionId };
}
