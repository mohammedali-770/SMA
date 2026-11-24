/**
 * Expo push-token registration for the signed-in customer.
 *
 * Flow (always behind an explicit tap — never an app-launch nag):
 *  1. OS permission is requested from exactly two places, each after the
 *     customer has been told what they are allowing: the consent screen's
 *     Allow button on the first run after sign-in (useFirstRunPermissions),
 *     and a Profile toggle turned ON (NotificationSettings).
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
import { DEFAULT_DEVICE_PREFS, deviceLangSyncPrefs, type DevicePrefs } from './notificationPolicy';
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

/**
 * The OS permission as it stands, asking nothing: granted, and whether the OS
 * would still show its dialog if asked.
 *
 * `canAskAgain` is what keeps the first-run consent screen honest — after a
 * permanent refusal the OS shows nothing, and a screen whose button promises a
 * prompt would be a dead end. Note that Android 12 and older report `granted`
 * from install: there is no runtime permission there, so the OS never asks.
 */
export async function readNotificationPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  const current = await Notifications.getPermissionsAsync();
  return { granted: current.granted, canAskAgain: current.canAskAgain };
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

/**
 * Look up the row for THIS device, keeping "there is no row" DISTINCT from
 * "I could not find out".
 *
 * `pushDevices.mine()` throws on a PostgREST error (`ok()` never returns a
 * silent null) and the token fetch can fail offline. Collapsing those into the
 * same `null` as a genuinely absent row is not survivable for a caller that
 * REGISTERS on absence: a transient network failure would look like a fresh
 * device, and the upsert would reactivate a row the customer had switched off
 * and overwrite their promotions choice. Callers that only render state can
 * still use `findThisDevice` below and treat both as "nothing to show".
 */
export type DeviceLookup =
  | { status: 'found'; device: DbPushDevice }
  | { status: 'absent' }
  | { status: 'indeterminate' };

export async function lookupThisDevice(): Promise<DeviceLookup> {
  const token = await getExpoPushToken();
  // No token: a simulator, or a failed fetch. Either way this says nothing
  // about whether a row exists — and registration could not proceed anyway.
  if (!token) return { status: 'indeterminate' };
  try {
    const mine = await pushDevices.mine();
    const device = mine.find((d) => d.expo_push_token === token);
    return device ? { status: 'found', device } : { status: 'absent' };
  } catch {
    return { status: 'indeterminate' };
  }
}

/**
 * Find the row for THIS device, or null. For display only — null here means
 * "found nothing OR could not look up". Anything that WRITES on the answer must
 * use `lookupThisDevice` and handle `indeterminate` explicitly.
 */
export async function findThisDevice(): Promise<DbPushDevice | null> {
  const result = await lookupThisDevice();
  return result.status === 'found' ? result.device : null;
}

/**
 * Register (or refresh) this device with the given preferences. Requires the
 * OS permission to already be granted and a signed-in customer. The RPC
 * reassigns the token's row when the device changed accounts, so a shared
 * phone never keeps the previous owner's targeting.
 */
export function registerThisDevice(
  lang: 'en' | 'ar',
  prefs: DevicePrefs = DEFAULT_DEVICE_PREFS,
): Promise<DbPushDevice | null> {
  return serialiseDeviceWrite(() => registerUnserialised(lang, prefs));
}

/**
 * Every write to THIS device's row runs one at a time, in the order it was
 * asked for. `register_push_device` rewrites both preferences and forces
 * `is_active = true`, so two writes that overlap can undo each other: the
 * language sync reads the stored preferences and registers them back, and a
 * Profile toggle that lands between that read and that write would be restored
 * to its old value, leaving an opt-out switched off on screen and on in the
 * database (review finding on F-X08-001). One queue covers the sync, the
 * registrations and the deactivation; the sync's read and write sit inside ONE
 * queue entry, so the preferences it passes back are always the latest.
 *
 * A failed write rejects its own caller and never blocks the next one.
 */
let deviceWriteTail: Promise<unknown> = Promise.resolve();
function serialiseDeviceWrite<T>(run: () => Promise<T>): Promise<T> {
  const result = deviceWriteTail.then(run);
  deviceWriteTail = result.catch(() => undefined);
  return result;
}

async function registerUnserialised(
  lang: 'en' | 'ar',
  prefs: DevicePrefs,
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
 * Make the server's language for THIS device follow the app (audit F-X08-001).
 *
 * Re-reads the row first, INSIDE the device-write queue, so the preferences it
 * passes back are the ones stored when this entry runs: a Profile toggle that
 * was queued earlier has already landed, and one asked for later runs after it
 * and wins (the queue is described above `registerUnserialised`). The
 * decision, including never re-defaulting a preference and never reactivating a
 * silenced device, is `deviceLangSyncPrefs`. Returns the updated row, or null
 * when nothing was written. Throws on a failed write so the caller can leave it
 * for the next opportunity; a failed or indeterminate LOOKUP writes nothing.
 */
export function syncDeviceLang(lang: 'en' | 'ar'): Promise<DbPushDevice | null> {
  return serialiseDeviceWrite(async () => {
    const lookup = await lookupThisDevice();
    if (lookup.status !== 'found') return null;
    const prefs = deviceLangSyncPrefs({ lang, device: lookup.device });
    if (!prefs) return null;
    return registerUnserialised(lang, prefs);
  });
}

/**
 * Silence THIS device — STRICT variant: throws on token/RPC failure so the
 * caller can surface the error and revert optimistic UI (the Profile opt-out
 * toggles must never show "off" while the server row is still active —
 * review finding).
 */
export function deactivateThisDeviceStrict(): Promise<void> {
  return serialiseDeviceWrite(async () => {
    if (!Device.isDevice) return;
    const token = await getExpoPushToken();
    if (!token) throw new Error('push token unavailable');
    await pushDevices.deactivateToken(token);
  });
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
