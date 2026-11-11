/**
 * First-run and review-prompt decisions — pure, so the rules are tested rather
 * than trusted. The AsyncStorage side lives in `firstRunStore.ts`.
 *
 * Two independent one-shot moments:
 *
 *  1. NOTIFICATIONS — once, on the first run after sign-in, the in-app consent
 *     screen is offered, and the OS notification prompt follows only if the
 *     customer taps Allow there (`firstRunNotificationStep`). The OS dialog
 *     cannot say that offers come with order updates; the screen does.
 *     Location is NOT asked here: it is asked where it is used, on the pickup
 *     tab and at "Use my location" on the delivery map.
 *
 *  2. REVIEW PROMPT — offered once, after their first completed order.
 *     Deliberately NOT while the confirmation screen is open: customers show
 *     that screen to a cashier, and a system rating dialog would cover the
 *     order number at the counter. It fires as they LEAVE the screen instead,
 *     which is still "after completing the order" and never blocks the number.
 */

export interface FirstRunState {
  /**
   * The first run has been spent on this device: the consent screen was shown,
   * or there was nothing to ask. The storage key predates the consent screen
   * and is deliberately unchanged, so nobody already through first run is
   * asked again.
   */
  permissionsRequested: boolean;
  /** We have already asked for a store review; we never ask twice ourselves. */
  reviewAsked: boolean;
}

export const DEFAULT_FIRST_RUN: FirstRunState = { permissionsRequested: false, reviewAsked: false };

/**
 * Spend the first run once, for a signed-in customer.
 *
 * Signed-in specifically: a granted notification permission is only useful once
 * there is an account to register the device against, and asking a
 * not-yet-signed-in visitor spends the one prompt iOS allows on someone we
 * cannot yet deliver to.
 */
export function shouldRequestFirstRunPermissions(state: FirstRunState, signedIn: boolean): boolean {
  return signedIn && !state.permissionsRequested;
}

/**
 * What the first run does about notifications.
 *
 * `offer_consent`: show the in-app consent screen. The OS prompt is raised only
 * from its Allow button, so the one ask iOS allows is never spent on someone
 * who has not read what they are allowing — order updates AND occasional
 * offers, which are on by default (CLAUDE.md §7).
 *
 * `nothing`, whenever there is nothing honest to ask:
 *  - not signed in, already spent on this device, or the push kill switch off;
 *  - permission already granted. That is an existing customer, or Android 12
 *    and older, where notifications are granted at install and the OS never
 *    asks. Neither is registered from here (`shouldRegisterOnFirstRun`): the
 *    sign-in claim and the one-time consent notice cover them instead;
 *  - permission refused for good (`canAskAgain: false`). The OS would show
 *    nothing, so a screen promising a prompt would be a dead end; the Profile
 *    toggle explains how to turn it back on in Settings. The web build lands
 *    here too, because it can never ask (pushRegistration.web.ts).
 */
export type FirstRunNotificationStep = 'offer_consent' | 'nothing';

export function firstRunNotificationStep(input: {
  state: FirstRunState;
  signedIn: boolean;
  pushEnabled: boolean;
  permission: { granted: boolean; canAskAgain: boolean };
}): FirstRunNotificationStep {
  if (!shouldRequestFirstRunPermissions(input.state, input.signedIn)) return 'nothing';
  if (!input.pushEnabled) return 'nothing';
  if (input.permission.granted || !input.permission.canAskAgain) return 'nothing';
  return 'offer_consent';
}

/**
 * Whether first run may REGISTER this device for push.
 *
 * False whenever the OS permission was already granted before this run — and,
 * since the consent screen can wait a while for a calm moment, it is checked
 * again when the customer taps Allow: a grant that arrived some other way in
 * the meantime (a Profile toggle, or the OS Settings app) is the customer's own
 * choice and stands untouched.
 *
 * The first-run flag is a storage key that no existing install has, so "first
 * run" is also every existing customer's next launch after upgrading. Those
 * customers already hold OS permission and are already registered under
 * preferences they chose themselves. `register_push_device` upserts
 * `is_active = true` together with both preference columns
 * (20260714090000_push_notifications.sql:157), so registering again would
 * reactivate a device the customer had deliberately switched off in Profile
 * and overwrite their promotions setting.
 *
 * Asking someone who has not been asked is the entire purpose of first run.
 * Restating an answer they already gave is not.
 */
export function shouldRegisterOnFirstRun(permissionAlreadyGranted: boolean): boolean {
  return !permissionAlreadyGranted;
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
