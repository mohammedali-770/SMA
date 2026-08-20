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
 * Renders nothing and blocks nothing; every failure is swallowed so a push
 * bookkeeping problem can never stop the app starting.
 */
import { useEffect, useRef } from 'react';

import { PUSH_CLIENT_ENABLED, shouldRegisterOnSignIn } from './notificationPolicy';
import { findThisDevice, hasNotificationPermission, registerThisDevice } from './pushRegistration';

export function usePushDeviceSync(signedIn: boolean, lang: 'en' | 'ar'): void {
  // One claim per sign-in. Reset on sign-out so the NEXT sign-in — which may be
  // a different customer on the same phone — is evaluated again. Guarding with
  // a ref rather than the effect deps also stops a language change from
  // re-running the claim mid-session.
  const claimed = useRef(false);

  useEffect(() => {
    if (!signedIn) { claimed.current = false; return; }
    if (!PUSH_CLIENT_ENABLED || claimed.current) return;
    claimed.current = true;

    void (async () => {
      try {
        const permissionGranted = await hasNotificationPermission();
        // Only look up the row when permission makes registration possible;
        // without it there is nothing to decide and no reason to hit the API.
        const mine = permissionGranted ? await findThisDevice() : null;
        if (shouldRegisterOnSignIn({
          permissionGranted,
          myDevice: mine ? { isActive: mine.is_active } : null,
        })) {
          // Default preferences: both channels on, per the OS-grant consent
          // model (DEFAULT_DEVICE_PREFS).
          await registerThisDevice(lang);
        }
      } catch { /* push bookkeeping must never break sign-in */ }
    })();
  }, [signedIn, lang]);
}
