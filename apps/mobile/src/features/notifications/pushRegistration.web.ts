/**
 * Web build of push-token registration — a graceful no-op mirror.
 *
 * Browser push (service workers / VAPID) is a different stack from Expo push
 * tokens, and is deliberately not implemented: push is a native-app channel
 * here even though sending is live. On web: permission is reported
 * as unavailable, no token is fetched, and no push_devices row is written —
 * the Profile notification toggles render their unsupported state instead of
 * failing. Signatures mirror ./pushRegistration exactly (bundler-selected).
 */
import { DEFAULT_DEVICE_PREFS, type DevicePrefs } from './notificationPolicy';
import type { DbPushDevice } from '../../types/db';

export async function hasNotificationPermission(): Promise<boolean> { return false; }

export async function ensureNotificationPermission(): Promise<boolean> {
  return false; // never prompts on web
}

export async function getExpoPushToken(): Promise<string | null> {
  return null; // Expo push tokens are native-only
}

export async function findThisDevice(): Promise<DbPushDevice | null> {
  return null;
}

export async function registerThisDevice(
  _lang: 'en' | 'ar',
  _prefs: DevicePrefs = DEFAULT_DEVICE_PREFS,
): Promise<DbPushDevice | null> {
  return null;
}

export async function deactivateThisDeviceStrict(): Promise<void> { /* no device row on web */ }

export async function deactivateThisDevice(): Promise<void> { /* no device row on web */ }

export async function ensureAndroidChannel(): Promise<void> { /* Android-only */ }
