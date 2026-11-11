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
 *
 * IT REPORTS WHAT IT SETTLED ON. The hook returns this customer's row for this
 * device once the claim is definitive, which is what the one-time consent
 * notice reads (`shouldShowConsentNotice`, via useNotificationOnboarding): a
 * claim on a device the OS never asked about registers it with offers on, and
 * the customer is told so. The claim itself is unchanged by that.
 *
 * An attempt that finishes after its sign-in has ended (sign-out, or a language
 * change re-running the effect) records nothing: marking it complete then would
 * block the claim at the NEXT sign-in, which may be a different customer.
 */
import { useEffect, useRef, useState } from 'react';

import type { DbPushDevice } from '../../types/db';
import { PUSH_CLIENT_ENABLED, shouldRegisterOnSignIn } from './notificationPolicy';
import { hasNotificationPermission, lookupThisDevice, registerThisDevice } from './pushRegistration';

/** Bounded: a few quick tries, then wait for the next sign-in. */
const RETRY_DELAYS_MS = [2_000, 6_000];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What one claim attempt established. */
interface ClaimOutcome {
  /**
   * DEFINITIVE — registered, or established that there is nothing to do. False
   * when something was indeterminate and the attempt is worth repeating.
   */
  done: boolean;
  /** This customer's row for this device, when the attempt ended with one. */
  device: DbPushDevice | null;
}

const RETRY: ClaimOutcome = { done: false, device: null };

/** One claim attempt. */
async function attemptClaim(lang: 'en' | 'ar'): Promise<ClaimOutcome> {
  let permissionGranted: boolean;
  try {
    permissionGranted = await hasNotificationPermission();
  } catch {
    return RETRY; // could not even read the status
  }
  // Definitive: without permission there is nothing to register, and this hook
  // must not ask. A grant arriving later is picked up by the Profile toggle or
  // the next sign-in.
  if (!permissionGranted) return { done: true, device: null };

  const lookup = await lookupThisDevice();
  if (!shouldRegisterOnSignIn({ permissionGranted, lookup: lookup.status })) {
    // 'found' → the row is mine and its state is my choice: definitively done.
    // 'indeterminate' → the lookup failed; retry rather than assume anything.
    return lookup.status === 'found' ? { done: true, device: lookup.device } : RETRY;
  }

  try {
    // Default preferences: both channels on (DEFAULT_DEVICE_PREFS). Where the
    // OS never asked, the customer is told once by the consent notice. A null
    // return means no token, so nothing landed.
    const row = await registerThisDevice(lang);
    return { done: row !== null, device: row };
  } catch {
    return RETRY;
  }
}

/**
 * Claims this device's push token at every sign-in, and returns the row the
 * claim settled on: `undefined` until it settles (signed out, in flight, or
 * given up after the retries), `null` when it settled with no row (no OS
 * permission), else this customer's row for this device.
 */
export function usePushDeviceSync(signedIn: boolean, lang: 'en' | 'ar'): DbPushDevice | null | undefined {
  // One settled claim per sign-in. Reset on sign-out so the NEXT sign-in — which
  // may be a different customer on the same phone — is evaluated again. Guarding
  // with a ref rather than the effect deps also stops a language change from
  // re-running the claim mid-session.
  const claimed = useRef(false);
  const [settled, setSettled] = useState<DbPushDevice | null | undefined>(undefined);

  useEffect(() => {
    if (!signedIn) {
      claimed.current = false;
      setSettled(undefined);
      return;
    }
    if (!PUSH_CLIENT_ENABLED || claimed.current) return;

    let cancelled = false;
    void (async () => {
      for (let attempt = 0; ; attempt += 1) {
        if (cancelled) return;
        const outcome = await attemptClaim(lang);
        // Finished after its sign-in ended: record nothing (see file header).
        if (cancelled) return;
        if (outcome.done) {
          claimed.current = true;
          setSettled(outcome.device);
          return;
        }
        if (attempt >= RETRY_DELAYS_MS.length) return; // give up until next sign-in
        await delay(RETRY_DELAYS_MS[attempt]);
      }
    })();

    return () => { cancelled = true; };
  }, [signedIn, lang]);

  return settled;
}
