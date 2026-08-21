/**
 * Keeps THIS device's push registration correct across sign-in. Together with
 * the sign-out path no longer deactivating the row, this is what makes
 * notifications survive a sign-out and re-login.
 *
 * Sign-out deliberately leaves `push_devices` alone (see ProfileScreen), so a
 * customer's own phone keeps receiving updates for orders that are still in
 * flight while they are signed out. What still has to happen at sign-in is
 * CLAIMING the token for whoever just signed in: on a shared phone the row may
 * still belong to the previous account, and `register_push_device` reassigns
 * it. `shouldRegisterOnSignIn` owns that decision and is unit-tested.
 *
 * NEVER PROMPTS. `hasNotificationPermission` only reads the current status —
 * iOS allows a single ask and `useFirstRunPermissions` owns it. Spending that
 * one ask here would burn it on an app launch with no context.
 *
 * TRANSIENT FAILURES ARE RETRIED, not swallowed, and that matters in both
 * directions:
 *
 *  - a failed LOOKUP must never be read as "no row" — registering on it would
 *    reactivate a device the customer switched off and flip promotions back on
 *    (`lookupThisDevice` reports `indeterminate` precisely so this cannot
 *    happen);
 *  - a failed CLAIM must not end silently — because sign-out no longer
 *    deactivates, the PREVIOUS owner's row stays active until someone claims
 *    the token, so giving up here can leave one customer's order updates
 *    arriving on a phone another customer now holds.
 *
 * So the attempt is marked complete only on a DEFINITIVE outcome, and an
 * indeterminate one is retried a bounded number of times before giving up until
 * the next sign-in.
 */
import { useEffect, useRef } from 'react';

import { PUSH_CLIENT_ENABLED, shouldRegisterOnSignIn } from './notificationPolicy';
import { hasNotificationPermission, lookupThisDevice, registerThisDevice } from './pushRegistration';

/** Bounded: a few quick tries, then wait for the next sign-in. */
const RETRY_DELAYS_MS = [2_000, 6_000];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One claim attempt. Returns true when the outcome is DEFINITIVE — registered,
 * or established that there is nothing to do — and false when something was
 * indeterminate and the attempt is worth repeating.
 */
async function attemptClaim(lang: 'en' | 'ar'): Promise<boolean> {
  let permissionGranted: boolean;
  try {
    permissionGranted = await hasNotificationPermission();
  } catch {
    return false; // could not even read the status
  }
  // Definitive: without permission there is nothing to register, and this hook
  // must not ask. A grant arriving later is picked up by the Profile toggle or
  // the next sign-in.
  if (!permissionGranted) return true;

  const lookup = await lookupThisDevice();
  if (!shouldRegisterOnSignIn({ permissionGranted, lookup: lookup.status })) {
    // 'found' → the row is mine and its state is my choice: definitively done.
    // 'indeterminate' → the lookup failed; retry rather than assume anything.
    return lookup.status === 'found';
  }

  try {
    // Default preferences: both channels on, per the OS-grant consent model
    // (DEFAULT_DEVICE_PREFS). A null return means no token, so nothing landed.
    return (await registerThisDevice(lang)) !== null;
  } catch {
    return false;
  }
}

export function usePushDeviceSync(signedIn: boolean, lang: 'en' | 'ar'): void {
  // One settled claim per sign-in. Reset on sign-out so the NEXT sign-in — which
  // may be a different customer on the same phone — is evaluated again. Guarding
  // with a ref rather than the effect deps also stops a language change from
  // re-running the claim mid-session.
  const claimed = useRef(false);

  useEffect(() => {
    if (!signedIn) { claimed.current = false; return; }
    if (!PUSH_CLIENT_ENABLED || claimed.current) return;

    let cancelled = false;
    void (async () => {
      for (let attempt = 0; ; attempt += 1) {
        if (cancelled) return;
        if (await attemptClaim(lang)) { claimed.current = true; return; }
        if (attempt >= RETRY_DELAYS_MS.length) return; // give up until next sign-in
        await delay(RETRY_DELAYS_MS[attempt]);
      }
    })();

    return () => { cancelled = true; };
  }, [signedIn, lang]);
}
