/**
 * Expo push-token registration for the signed-in customer.
 *
 * Flow (driven by the Profile notification toggles — never an app-launch nag):
 *  1. The customer turns a toggle ON → OS permission is requested with that
 *     clear context.
 *  2. On grant, the Expo push token is fetched (real devices only) and
 *     upserted into push_devices via the RLS-scoped client — a customer can
 *     only ever write their own device rows.
 *  3. Turning both toggles OFF deactivates the device row (is_active=false);
 *     the token is never targeted again until re-enabled.
 *
 * Sending is entirely server-side (push-dispatch) and further gated by the
 * admin master flag — nothing here can cause a send.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { pushDevices } from '../../services/api';
import { DEFAULT_DEVICE_PREFS, type DevicePrefs } from './notificationPolicy';
import type { DbPushDevice } from '../../types/db';

/**
 * True when the OS has ALREADY granted permission — asks the customer nothing.
 *
 * Callers need this to tell "the customer just granted permission" apart from
 * "permission was granted at some point in the past", because
 * `ensureNotificationPermission` returns true for both without showing a
 * dialog, and the two must not lead to the same write. See the first-run hook.
 */
export async function hasNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  return current.granted;
}

/** Ask (or re-check) OS notification permission. Returns true when granted. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/** The Expo push token for THIS physical device (null on simulators/web). */
export async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    const res = await Notifications.getExpoPushTokenAsync({ projectId });
    return res.data ?? null;
  } catch {
    return null;
  }
}

/** Find the row for THIS device among my registered devices. */
export async function findThisDevice(): Promise<DbPushDevice | null> {
  const token = await getExpoPushToken();
  if (!token) return null;
  try {
    const mine = await pushDevices.mine();
    return mine.find((d) => d.expo_push_token === token) ?? null;
  } catch {
    return null;
  }
}

/**
 * Register (or refresh) this device with the given preferences. Requires the
 * OS permission to already be granted and a signed-in customer. The RPC
 * reassigns the token's row when the device changed accounts, so a shared
 * phone never keeps the previous owner's targeting.
 */
export async function registerThisDevice(
  lang: 'en' | 'ar',
  prefs: DevicePrefs = DEFAULT_DEVICE_PREFS,
): Promise<DbPushDevice | null> {
  const token = await getExpoPushToken();
  if (!token) return null;
  return pushDevices.register({
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    lang,
    orderUpdatesEnabled: prefs.orderUpdatesEnabled,
    promosEnabled: prefs.promosEnabled,
  });
}

/**
 * Silence THIS device — STRICT variant: throws on token/RPC failure so the
 * caller can surface the error and revert optimistic UI (the Profile opt-out
 * toggles must never show "off" while the server row is still active —
 * review finding).
 */
export async function deactivateThisDeviceStrict(): Promise<void> {
  if (!Device.isDevice) return;
  const token = await getExpoPushToken();
  if (!token) throw new Error('push token unavailable');
  await pushDevices.deactivateToken(token);
}

/**
 * Silence THIS device — BEST-EFFORT variant for the sign-out path only:
 * failures are swallowed because sign-out must never block. (Deliberately
 * NOT used by the settings opt-out flow, which needs the strict variant.)
 */
export async function deactivateThisDevice(): Promise<void> {
  try {
    await deactivateThisDeviceStrict();
  } catch { /* best-effort */ }
}

/** Android needs an explicit channel for heads-up notifications. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Spicy Meal',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
}
