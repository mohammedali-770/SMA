/**
 * What the receipt screen shows while the branch's order number is awaited.
 *
 * The owner's rule (2026-11-18, repeated): the customer sees the ORDER PAGE
 * only with the branch's (Lazywait) order number. Until it exists they see a
 * WAITING WINDOW: a live counter, and a request to keep the app open
 * (view/OrderWaitingView.tsx). The receipt polls every 2 s (ordersRefresh.ts),
 * so the order page replaces the window the moment the number arrives: about
 * 6 s after payment (SM-2026-000101 to -000103).
 *
 * THE ORDER PAGE IS NEVER SHOWN WITHOUT THE NUMBER WHILE THE ORDER IS IN
 * FLIGHT. An earlier version (#499) fell back to the page after 20 s; the
 * owner rejected it. A slow POS is handled inside the window instead: after
 * WAITING_SLOW_AFTER_MS it stops asking the customer to wait, says the order
 * is safe, and offers My Orders. It never strands them, and it keeps polling.
 *
 * Every other state (confirmed, uncertain, not sent, failed, cancelled) shows
 * the page at once, because each tells the customer something they must know.
 */
import type { CustomerOrderState } from './orderConfirmation';

/** When the window stops saying "a few seconds" and offers a way out. */
export const WAITING_SLOW_AFTER_MS = 30_000;

/** True while the receipt must show the waiting window instead of the page. */
export function awaitingBranchNumber(state: CustomerOrderState): boolean {
  return state === 'sending_to_branch';
}

export type WaitingPhase = 'active' | 'slow';

export function waitingPhase(waitedMs: number): WaitingPhase {
  return waitedMs >= WAITING_SLOW_AFTER_MS ? 'slow' : 'active';
}
