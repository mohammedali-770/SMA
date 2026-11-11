/**
 * Notifications after sign-in, in one place: what the tabs layout used to do
 * with two hooks, plus the consent screen that now stands in front of the OS.
 *
 *  - FIRST RUN (`useFirstRunPermissions`): once per device, the consent screen
 *    in PROMPT mode. The OS prompt is raised only from its Allow button.
 *  - EVERY SIGN-IN (`usePushDeviceSync`): claims this device's push token for
 *    whoever just signed in, exactly as before, and reports the row it settled
 *    on.
 *  - THE NOTICE: if that row has offers on and this customer has not seen the
 *    consent text on this device, the same screen in NOTICE mode, once. That is
 *    Android 12 and older, where the OS never asks, and a second account on a
 *    shared phone.
 *
 * Nothing here changes who receives what. Prompt mode registers only what the
 * old first run registered — a device granted on this run, with the default
 * preferences — and the notice writes nothing at all. The screen discloses the
 * opt-out model (CLAUDE.md §7); it does not alter it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { markConsentSeen, readConsentSeen } from '../notifications/consentNoticeStore';
import { shouldShowConsentNotice } from '../notifications/notificationPolicy';
import { usePushDeviceSync } from '../notifications/usePushDeviceSync';
import { useFirstRunPermissions } from './useFirstRunPermissions';

export type ConsentMode = 'prompt' | 'notice';

export interface NotificationConsent {
  mode: ConsentMode;
  /** The screen is on screen. Records that the customer has seen the text. */
  onShown: () => void;
  /** Prompt: "Allow notifications", which raises the OS prompt. Notice: "OK". */
  onAccept: () => void;
  /** Prompt: "Not now", which asks nothing. Notice: closes, the same as OK. */
  onDecline: () => void;
}

export function useNotificationOnboarding(
  signedIn: boolean,
  userId: string | null,
  lang: 'en' | 'ar',
): NotificationConsent | null {
  const firstRun = useFirstRunPermissions(signedIn, lang);
  const settled = usePushDeviceSync(signedIn, lang);
  const [noticeOwed, setNoticeOwed] = useState(false);

  useEffect(() => {
    if (!signedIn || !userId || settled === undefined) {
      setNoticeOwed(false);
      return;
    }
    let active = true;
    void readConsentSeen(userId).then((seen) => {
      if (active) setNoticeOwed(shouldShowConsentNotice({ seen, device: settled }));
    });
    return () => {
      active = false;
    };
  }, [signedIn, userId, settled]);

  const markSeen = useCallback(() => {
    if (userId) void markConsentSeen(userId);
  }, [userId]);

  return useMemo((): NotificationConsent | null => {
    // Prompt mode first: it is the one that can still ask, and a customer who
    // reads it has read everything the notice would say.
    if (firstRun) {
      return {
        mode: 'prompt',
        onShown: () => {
          firstRun.shown();
          markSeen();
        },
        onAccept: () => void firstRun.allow(),
        onDecline: firstRun.close,
      };
    }
    if (noticeOwed) {
      const close = () => setNoticeOwed(false);
      return { mode: 'notice', onShown: markSeen, onAccept: close, onDecline: close };
    }
    return null;
  }, [firstRun, noticeOwed, markSeen]);
}
