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
 * The push stack is deliberately dormant (CLAUDE.md §7): the `push`/`expo`
 * integration row is disabled, no credentials are configured, and nothing
 * server-side can deliver a notification. While that is true the app must not
 * ask a customer for OS notification permission — a permission prompt for a
 * capability that cannot deliver is a store-review question we would fail to
 * answer, and a denial is sticky (`canAskAgain: false`), so it also poisons the
 * prompt for whenever push does ship.
 *
 * This is a build-time constant rather than a read of the server flag on
 * purpose: `integration_settings` is fully revoked from the API, so the client
 * cannot see the real row, and a network-dependent gate would fail open on a
 * timeout — exactly the wrong direction for this decision.
 *
 * To enable push, this flips to `true` in the SAME change that enables the
 * server integration row and restores the `expo-notifications` plugin in
 * apps/mobile/app.json — all three, or none.
 */
export const PUSH_CLIENT_ENABLED = false;

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

/** Defaults per spec: order updates ON, promotions strictly OPT-IN (OFF). */
export const DEFAULT_DEVICE_PREFS: DevicePrefs = {
  orderUpdatesEnabled: true,
  promosEnabled: false,
};

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
