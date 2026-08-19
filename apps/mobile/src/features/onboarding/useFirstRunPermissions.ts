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

import { PUSH_CLIENT_ENABLED } from '../notifications/notificationPolicy';
import {
  ensureAndroidChannel, ensureNotificationPermission, hasNotificationPermission,
  registerThisDevice,
} from '../notifications/pushRegistration';
import { shouldRegisterOnFirstRun, shouldRequestFirstRunPermissions } from './firstRun';
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

          // ONLY register when the customer grants permission ON THIS RUN.
          //
          // This flag is a new storage key, so first run is also every EXISTING
          // customer's next launch. Such a customer already holds OS permission,
          // which means `ensureNotificationPermission` returns true without
          // showing anything — and `register_push_device` upserts
          // `is_active = true` along with both preference columns
          // (20260714090000_push_notifications.sql:157). Registering here would
          // therefore silently rewrite a choice the customer made deliberately:
          // it would reactivate a device they had switched off in Profile, and
          // overwrite their promotions setting in whichever direction this
          // call happens to pass. First run is for ASKING someone who has not
          // been asked, never for restating an answer already given.
          if (shouldRegisterOnFirstRun(await hasNotificationPermission())) {
            const granted = await ensureNotificationPermission();
            if (granted) {
              // Promotions stay FALSE — marketing is a separate consent the
              // customer gives in Profile, not something a system permission
              // grant implies (CLAUDE.md section 7).
              await registerThisDevice(lang, { orderUpdatesEnabled: true, promosEnabled: false });
            }
          }
        } catch { /* a permission prompt must never break app start */ }
      }

      try {
        await Location.requestForegroundPermissionsAsync();
      } catch { /* likewise */ }
    })();
  }, [signedIn, lang]);
}
