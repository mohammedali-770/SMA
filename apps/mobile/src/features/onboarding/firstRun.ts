/**
 * First-run and review-prompt decisions — pure, so the rules are tested rather
 * than trusted. The AsyncStorage side lives in `firstRunStore.ts`.
 *
 * Two independent one-shot moments:
 *
 *  1. ONBOARDING — shown once, after the customer's first successful sign-in
 *     (not before: the name is saved to their profile, which needs a session).
 *
 *  2. REVIEW PROMPT — offered once, after their first completed order.
 *     Deliberately NOT while the confirmation screen is open: customers show
 *     that screen to a cashier, and a system rating dialog would cover the
 *     order number at the counter. It fires as they LEAVE the screen instead,
 *     which is still "after completing the order" and never blocks the number.
 */

export interface FirstRunState {
  /** The onboarding flow has been completed or explicitly skipped. */
  onboarded: boolean;
  /** We have already asked for a store review; we never ask twice ourselves. */
  reviewAsked: boolean;
}

export const DEFAULT_FIRST_RUN: FirstRunState = { onboarded: false, reviewAsked: false };

/** Onboarding is for signed-in customers who have not been through it. */
export function shouldShowOnboarding(state: FirstRunState, signedIn: boolean): boolean {
  return signedIn && !state.onboarded;
}

/**
 * Whether to offer the store-review dialog.
 *
 * Every condition here is a deliberate guard:
 *  - `reviewAsked` — one ask, ever, from our side.
 *  - `orderCompleted` — a review request after a failed or unconfirmed order
 *    invites a one-star rating for something the customer is still upset about.
 *  - `leavingConfirmation` — never over the order number (see file header).
 *  - `available` — the OS may refuse entirely (no store, quota spent). Apple
 *    also caps its own dialog at three prompts per year and decides whether to
 *    show it at all, so this is a request, never a guarantee.
 */
export function shouldRequestReview(input: {
  state: FirstRunState;
  orderCompleted: boolean;
  leavingConfirmation: boolean;
  available: boolean;
}): boolean {
  if (!input.available) return false;
  if (input.state.reviewAsked) return false;
  if (!input.orderCompleted) return false;
  return input.leavingConfirmation;
}

/**
 * A completed order from the customer's point of view: the branch has it and
 * nothing failed. Anything mid-flight or broken is not a moment to ask for
 * five stars.
 */
export function isCompletedForReview(status: string | null | undefined, syncState?: string | null): boolean {
  if (!status) return false;
  if (syncState && syncState !== 'synced') return false;
  return status === 'delivered' || status === 'ready' || status === 'out_for_delivery' || status === 'preparing' || status === 'received';
}
