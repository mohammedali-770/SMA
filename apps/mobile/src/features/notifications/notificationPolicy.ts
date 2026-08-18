/**
 * Push-notification client policy — PURE and framework-free so the routing
 * allow-list and preference rules are unit-tested under Node
 * (notificationPolicy.test.ts) and consumed by the registration module and
 * the root-layout tap handler.
 *
 * Security rules this encodes:
 *  - Notification taps can navigate ONLY to allow-listed INTERNAL routes,
 *    derived from typed payload fields — never from a URL in the payload.
 *    A malicious/garbled payload resolves to the safe default (home tab).
 *  - Payloads are expected to carry ONLY { type, orderId? } — no customer,
 *    order-content, or payment data (the server enforces this too).
 */

/**
 * Master client-side gate for the push stack.
 *
 * ENABLED (owner-approved 2026-08-17). The binary can now deliver: EAS holds
 * real credentials for both platforms (iOS APNs key configured for Sandbox &
 * Production; Android FCM V1 service-account key), and `app.json` carries the
 * `expo-notifications` plugin plus `google-services.json`, so the iOS push
 * entitlement and the Android channel exist in the build. Asking a customer for
 * OS notification permission is therefore an honest request for a capability we
 * can actually honour.
 *
 * This stays a build-time constant rather than a read of the server flag on
 * purpose: `integration_settings` is fully revoked from the API, so the client
 * cannot see the real row, and a network-dependent gate would fail open on a
 * timeout — exactly the wrong direction for this decision.
 *
 * SENDING IS STILL SEPARATELY GATED. This constant only controls whether the
 * customer can opt in and register a device. Delivery additionally requires the
 * server master flag (`integration_settings` provider_type='push', provider
 * 'expo', `enabled = true`), which push-dispatch checks on every action and
 * which remains an owner-controlled admin switch. Turning this on cannot by
 * itself cause a single notification to be sent.
 *
 * Reverting to dormancy means flipping this back to `false` in the SAME change
 * that removes the `expo-notifications` plugin from apps/mobile/app.json and
 * disables the server integration row — all three, or none.
 */
export const PUSH_CLIENT_ENABLED = true;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default landing when a payload is missing/unknown/invalid. */
export const NOTIFICATION_FALLBACK_ROUTE = '/(tabs)';

/**
 * Resolve a tap payload to an internal route. Allow-list only:
 *   { type: 'order', orderId: <uuid> } → that order's receipt
 *   { type: 'order' } (no/invalid id)  → the Orders tab
 *   { type: 'promo' }                  → the home menu
 *   anything else                      → the home menu
 */
export function resolveNotificationRoute(data: unknown): string {
  if (!data || typeof data !== 'object') return NOTIFICATION_FALLBACK_ROUTE;
  const d = data as { type?: unknown; orderId?: unknown };
  if (d.type === 'order') {
    if (typeof d.orderId === 'string' && UUID_RE.test(d.orderId)) return `/receipt/${d.orderId}`;
    return '/(tabs)/orders';
  }
  if (d.type === 'promo') return NOTIFICATION_FALLBACK_ROUTE;
  return NOTIFICATION_FALLBACK_ROUTE;
}

export interface DevicePrefs {
  orderUpdatesEnabled: boolean;
  promosEnabled: boolean;
}

/**
 * Notifications are ONE choice for the customer (owner decision 2026-08-18):
 * allowing notifications means both order updates and offers.
 *
 * The two server columns are kept — push_devices still stores them separately,
 * and push-dispatch still targets order_status and broadcast by their own
 * flag — so the split can be reinstated in the UI without a schema change or
 * a re-registration of every device.
 */
export const DEFAULT_DEVICE_PREFS: DevicePrefs = {
  orderUpdatesEnabled: true,
  promosEnabled: true,
};

/** The single switch's two states, so callers cannot drift out of step. */
export const NOTIFICATIONS_ON: DevicePrefs = { orderUpdatesEnabled: true, promosEnabled: true };
export const NOTIFICATIONS_OFF: DevicePrefs = { orderUpdatesEnabled: false, promosEnabled: false };

/** True when the single switch should read as on. */
export function notificationsEnabled(prefs: DevicePrefs): boolean {
  return prefs.orderUpdatesEnabled || prefs.promosEnabled;
}

/**
 * A device row is worth keeping active only while some channel is on; with
 * both toggles off the device deactivates (and the token stops being
 * targeted at all).
 */
export function deviceShouldStayActive(prefs: DevicePrefs): boolean {
  return prefs.orderUpdatesEnabled || prefs.promosEnabled;
}

/**
 * Permission is requested only WHEN THE CUSTOMER TURNS A TOGGLE ON (clear
 * context — never an app-launch nag). Returns true when the toggle change
 * requires the OS permission flow first.
 */
export function toggleRequiresPermission(before: DevicePrefs, after: DevicePrefs): boolean {
  const wasOff = !before.orderUpdatesEnabled && !before.promosEnabled;
  const nowOn = after.orderUpdatesEnabled || after.promosEnabled;
  return wasOff && nowOn;
}

export type RegistrationStep =
  | 'ensure_android_channel'  // Android channel MUST exist before permission/token (iOS no-op)
  | 'request_permission'
  | 'get_token'
  | 'register_device';

/**
 * The MANDATORY enable-flow order. Android requires its notification channel
 * to exist before the permission prompt / token fetch so the first
 * notification can present heads-up correctly; iOS treats the channel step as
 * a no-op. The UI executes exactly this sequence (NotificationSettings).
 */
export function enableFlowPlan(): readonly RegistrationStep[] {
  return ['ensure_android_channel', 'request_permission', 'get_token', 'register_device'];
}

/** Stable identity of a notification RESPONSE (tap), for exactly-once handling. */
export function notificationResponseKey(response: unknown): string {
  const r = response as { notification?: { request?: { identifier?: unknown } }; actionIdentifier?: unknown } | null;
  const id = r?.notification?.request?.identifier;
  const action = r?.actionIdentifier;
  return `${typeof id === 'string' ? id : 'unknown'}|${typeof action === 'string' ? action : 'default'}`;
}

/**
 * Exactly-once guard: the same response may reach us TWICE (cold-start
 * getLastNotificationResponseAsync + the live listener). The first caller
 * wins and marks the key handled; duplicates are ignored — never a double
 * navigation.
 */
export function shouldHandleResponse(handled: Set<string>, key: string): boolean {
  if (handled.has(key)) return false;
  handled.add(key);
  return true;
}
