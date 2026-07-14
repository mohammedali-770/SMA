/**
 * Foreground presentation + tap navigation for push notifications.
 *
 * Taps navigate ONLY through resolveNotificationRoute's allow-list of
 * internal routes ({type:'order', orderId} → receipt; anything else → safe
 * tabs) — a payload can never open an arbitrary route, external URL, or the
 * payment flow.
 *
 * Exactly-once: the same tap can surface TWICE (the live listener AND the
 * cold-start getLastNotificationResponseAsync read). Both paths go through
 * the pure shouldHandleResponse guard keyed by notificationResponseKey, and
 * the consumed cold-start response is CLEARED so a remount can never replay
 * it. Renders nothing.
 */
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';

import { notificationResponseKey, resolveNotificationRoute, shouldHandleResponse } from './notificationPolicy';

// Show foreground notifications as a banner (no sound spam, no badge math).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function NotificationTapBridge() {
  // Survives re-renders; one bridge instance is mounted for the app lifetime.
  const handledKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleOnce = (response: Notifications.NotificationResponse) => {
      if (!shouldHandleResponse(handledKeys.current, notificationResponseKey(response))) return;
      const route = resolveNotificationRoute(response.notification.request.content.data);
      // Defer one tick so navigation never races the root layout mount.
      setTimeout(() => router.push(route as never), 0);
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handleOnce);

    // Cold start from a tap: the response is delivered before the listener
    // attaches — read it once, then CLEAR it so it can never be replayed.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        handleOnce(response);
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => { /* never break startup over notification plumbing */ });

    return () => sub.remove();
  }, []);
  return null;
}
