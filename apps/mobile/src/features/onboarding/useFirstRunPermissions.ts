/**
 * Raises the OS permission dialogs once, on the first run after sign-in.
 *
 * No in-app screen sits in front of them: the system asks, and whatever the
 * customer allows is what the app uses from then on. Notifications first —
 * granting it registers this device so order updates actually arrive — then
 * location, which the branch picker and delivery flow already consume.
 *
 * Renders nothing and blocks nothing. A customer who denies either one keeps
 * full use of the app, and both remain changeable later in Profile / iOS
 * Settings.
 *
 * ONE-SHOT, and it must stay that way on iOS: a notification denial there is
 * permanent (`canAskAgain: false`), so the flag is written BEFORE the prompts
 * are raised. If the app is killed mid-sequence we lose the remaining asks
 * rather than risk re-prompting on every launch.
 */
import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';

import { NOTIFICATIONS_ON, PUSH_CLIENT_ENABLED } from '../notifications/notificationPolicy';
import {
  ensureAndroidChannel, ensureNotificationPermission, registerThisDevice,
} from '../notifications/pushRegistration';
import { shouldRequestFirstRunPermissions } from './firstRun';
import { markPermissionsRequested, readFirstRun } from './firstRunStore';

export function useFirstRunPermissions(signedIn: boolean, lang: 'en' | 'ar'): void {
  // Guards against a second run from a re-render while the first is still in
  // flight — the storage flag alone is written asynchronously.
  const started = useRef(false);

  useEffect(() => {
    if (!signedIn || started.current) return;
    started.current = true;

    void (async () => {
      const state = await readFirstRun();
      if (!shouldRequestFirstRunPermissions(state, signedIn)) return;
      await markPermissionsRequested();

      if (PUSH_CLIENT_ENABLED) {
        try {
          // The Android channel must exist before the prompt; a no-op on iOS.
          await ensureAndroidChannel();
          const granted = await ensureNotificationPermission();
          if (granted) {
            // Use what the customer just allowed. Notifications are a single
            // choice (owner decision 2026-08-18), so allowing them registers
            // both order updates and offers; the customer turns the lot off
            // again from Profile or iOS Settings.
            await registerThisDevice(lang, NOTIFICATIONS_ON);
          }
        } catch { /* a permission prompt must never break app start */ }
      }

      try {
        await Location.requestForegroundPermissionsAsync();
      } catch { /* likewise */ }
    })();
  }, [signedIn, lang]);
}
