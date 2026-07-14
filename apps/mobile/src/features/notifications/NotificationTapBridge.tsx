/**
 * Foreground presentation + tap navigation for push notifications.
 *
 * Taps navigate ONLY through resolveNotificationRoute's allow-list of
 * internal routes ({type:'order', orderId} → receipt; anything else → safe
 * tabs) — a payload can never open an arbitrary route, external URL, or the
 * payment flow. Renders nothing.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

import { resolveNotificationRoute } from './notificationPolicy';

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
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      const route = resolveNotificationRoute(data);
      // Defer one tick so navigation never races the root layout mount.
      setTimeout(() => router.push(route as never), 0);
    });
    // A cold start from a notification tap delivers the response before the
    // listener attaches — pick it up once here.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const route = resolveNotificationRoute(response.notification.request.content.data);
      setTimeout(() => router.push(route as never), 0);
    });
    return () => sub.remove();
  }, []);
  return null;
}
