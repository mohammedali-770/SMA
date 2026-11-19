/**
 * In-memory bridge between CheckoutScreen (which awaits the payment outcome) and
 * the pushed in-app payment WebView screen (which settles it).
 *
 * Why in memory: the Moyasar invoice URL is a payable link — anyone holding it
 * can pay that invoice. It is held ONLY here — never placed in navigation route
 * params, never written to AsyncStorage, never logged. The route carries only
 * the non-secret checkout-session UUID; the WebView screen exchanges that id for
 * the URL through this module. The authoritative payment state always comes from the server verify,
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
  /** When Moyasar's page first painted (Date.now()); timing only, see checkoutTimeline.ts. */
  pageReadyAt?: number;
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

/**
 * Record when the payment page first painted, for the checkout timeline. Only
 * the first paint of a live handoff counts; anything else is ignored.
 */
export function markCheckoutPageReady(sessionId: string, at: number): void {
  if (current && !current.settled && current.sessionId === sessionId && current.pageReadyAt == null) {
    current.pageReadyAt = at;
  }
}

/** The first-paint time recorded for this session's handoff, settled or not. */
export function readCheckoutPageReady(sessionId: string): number | null {
  return current && current.sessionId === sessionId ? (current.pageReadyAt ?? null) : null;
}
