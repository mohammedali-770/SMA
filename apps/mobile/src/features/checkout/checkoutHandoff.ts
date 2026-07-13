/**
 * In-memory bridge between CheckoutScreen (which awaits the payment outcome) and
 * the pushed in-app Tap WebView screen (which settles it).
 *
 * Why in memory: the Tap hosted-checkout URL carries a short-lived Tap token. It
 * is held ONLY here — never placed in navigation route params, never written to
 * AsyncStorage, never logged. The route carries only the non-secret checkout-
 * session UUID; the WebView screen exchanges that id for the URL through this
 * module. The authoritative payment state always comes from the server verify,
 * so this bridge only signals "the user finished / dismissed the WebView".
 *
 * Pure module (no React Native / Expo) so the settlement + supersede logic is
 * unit-tested under Node (see checkoutHandoff.test.ts).
 */

export type CheckoutHandoffResult =
  | 'completed' // the WebView reached our payment-return (server verify decides the truth)
  | 'dismissed'; // the user closed / backed out without finishing

interface Handoff {
  sessionId: string;
  checkoutUrl: string;
  resolve: (r: CheckoutHandoffResult) => void;
  settled: boolean;
}

let current: Handoff | null = null;

/**
 * Begin a handoff for `sessionId` and return the promise the caller awaits. Any
 * still-open prior handoff is superseded (resolved 'dismissed') so a resumed /
 * retried payment never leaves an earlier awaiter hanging.
 */
export function startCheckoutHandoff(sessionId: string, checkoutUrl: string): Promise<CheckoutHandoffResult> {
  if (current && !current.settled) {
    current.settled = true;
    current.resolve('dismissed');
  }
  return new Promise<CheckoutHandoffResult>((resolve) => {
    current = { sessionId, checkoutUrl, resolve, settled: false };
  });
}

/** The WebView screen exchanges its session id for the in-flight checkout URL. */
export function readCheckoutHandoff(sessionId: string): { checkoutUrl: string } | null {
  return current && !current.settled && current.sessionId === sessionId
    ? { checkoutUrl: current.checkoutUrl }
    : null;
}

/**
 * Settle the handoff exactly once. A call for a session that is not the current
 * open one (already settled, or superseded by a newer attempt) is a safe no-op —
 * this is what makes the WebView screen's unmount cleanup idempotent.
 */
export function settleCheckoutHandoff(sessionId: string, result: CheckoutHandoffResult): void {
  if (current && !current.settled && current.sessionId === sessionId) {
    current.settled = true;
    current.resolve(result);
  }
}
