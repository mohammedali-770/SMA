/**
 * The first run after sign-in, once per device: OFFERS the notification consent
 * screen. It never raises an OS dialog on its own.
 *
 * WHAT CHANGED, AND WHY (2026-11-10). This used to raise the OS notification
 * prompt and then the OS location prompt straight away, with no in-app screen
 * in front of either — both on top of the order-type pop-up. Both asked before
 * telling the customer why:
 *
 *  - Notifications. Marketing is opt-out (DEFAULT_DEVICE_PREFS, CLAUDE.md §7),
 *    so granting the OS prompt also turns offers on — which the OS dialog has
 *    no way to say. Apple 4.5.4 wants that said in the app's own UI first. The
 *    consent screen says it, and the OS prompt follows only from its Allow
 *    button (`allow`). "Not now" asks nothing; the Profile toggles stay the way
 *    in later.
 *  - Location is no longer asked here at all. It is asked where it is used:
 *    the pickup tab (nearest branches) and "Use my location" on the delivery
 *    map. Google Play expects a permission to be requested in that context.
 *
 * ONE-SHOT, and it must stay that way on iOS: a notification denial there is
 * permanent (`canAskAgain: false`). The storage key is UNCHANGED on purpose, so
 * every customer who already went through first run is never asked again.
 *
 * The flag is written when the screen is actually SHOWN (`shown`), not when it
 * is decided. The screen waits for a calm moment — a tab, with no order-type
 * pop-up up (`consentScreenVisible`) — that may not come this session; nothing
 * is asked before then, so offering it again on the next launch costs nothing.
 * When there is nothing to ask, the flag is written at once, as before.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PUSH_CLIENT_ENABLED } from '../notifications/notificationPolicy';
import {
  ensureAndroidChannel,
  ensureNotificationPermission,
  hasNotificationPermission,
  readNotificationPermission,
  registerThisDevice,
} from '../notifications/pushRegistration';
import { firstRunNotificationStep, shouldRegisterOnFirstRun, shouldRequestFirstRunPermissions } from './firstRun';
import { markPermissionsRequested, readFirstRun } from './firstRunStore';

export interface FirstRunConsentOffer {
  /** The consent screen is on screen: spends this device's first run. */
  shown: () => void;
  /** The customer tapped Allow: raise the OS prompt, and register on a grant. */
  allow: () => Promise<void>;
  /** The customer chose "Not now": withdraw the offer, asking nothing. */
  close: () => void;
}

/** A permission that cannot be read is treated as one there is nothing to ask about. */
const UNREADABLE = { granted: true, canAskAgain: false };

export function useFirstRunPermissions(signedIn: boolean, lang: 'en' | 'ar'): FirstRunConsentOffer | null {
  // Guards against a second run from a re-render while the first is still in
  // flight — the storage flag alone is written asynchronously.
  const started = useRef(false);
  const [offered, setOffered] = useState(false);

  useEffect(() => {
    if (!signedIn) {
      setOffered(false);
      return;
    }
    if (started.current) return;
    started.current = true;

    void (async () => {
      const state = await readFirstRun();
      if (!shouldRequestFirstRunPermissions(state, signedIn)) return;

      let permission = UNREADABLE;
      try {
        permission = await readNotificationPermission();
      } catch {
        /* a permission check must never break app start */
      }
      const step = firstRunNotificationStep({ state, signedIn, pushEnabled: PUSH_CLIENT_ENABLED, permission });
      if (step === 'offer_consent') setOffered(true);
      else await markPermissionsRequested(); // nothing honest to ask: spend the first run now
    })();
  }, [signedIn]);

  const shown = useCallback(() => {
    void markPermissionsRequested();
  }, []);

  const allow = useCallback(async () => {
    setOffered(false);
    try {
      // The Android channel must exist before the prompt; a no-op on iOS.
      await ensureAndroidChannel();

      // ONLY register when the customer grants permission ON THIS RUN.
      //
      // The screen can wait a while for a calm moment, so this is checked again
      // now rather than trusted from when the screen was offered. A grant that
      // arrived some other way meanwhile — a Profile toggle, or the OS Settings
      // app — came with a choice of its own, and `register_push_device` upserts
      // `is_active = true` along with both preference columns
      // (20260714090000_push_notifications.sql:157): registering here would
      // overwrite that choice. First run is for ASKING someone who has not been
      // asked, never for restating an answer already given.
      if (!shouldRegisterOnFirstRun(await hasNotificationPermission())) return;

      if (await ensureNotificationPermission()) {
        // Both channels on. The customer has just read that offers come with
        // order updates and where to turn them off (DEFAULT_DEVICE_PREFS, owner
        // decision 2026-08-20; CLAUDE.md section 7).
        await registerThisDevice(lang);
      }
    } catch {
      /* a permission prompt must never break the app */
    }
  }, [lang]);

  const close = useCallback(() => setOffered(false), []);

  return useMemo(() => (offered ? { shown, allow, close } : null), [offered, shown, allow, close]);
}
