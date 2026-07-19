/**
 * Web build of the notification tap bridge — there are no native notification
 * taps to bridge in the browser, so this mounts nothing. Keeping the module
 * platform-split means expo-notifications is never imported on web.
 */
export function NotificationTapBridge() {
  return null;
}
