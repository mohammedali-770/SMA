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
 * Defaults applied when a device registers without an explicit choice.
 *
 * ORDER UPDATES ON, OFFERS OFF (owner decision 2026-11-18). Granting the OS
 * notification permission turns on order-status updates only. Offers are
 * opt-IN: a customer receives them only after switching "Offers & promotions"
 * on in Profile › Notifications, which is a separate, prior consent to
 * marketing (the PDPL reading in docs/OWNER_ACTIONS.md §44 item 6).
 *
 * This SUPERSEDES the 2026-08-20 opt-out decision, under which both channels
 * defaulted on. That decision is recorded in CLAUDE.md §7, marked superseded.
 * The change is prospective only: it decides what a NEW registration gets.
 * `shouldRegisterOnFirstRun` and `shouldRegisterOnSignIn` never rewrite an
 * existing row, so a device that already has offers on keeps them until its
 * customer turns them off. Whether to reset those rows is a separate owner
 * decision and is not taken here.
 *
 * WHAT THE CUSTOMER IS TOLD. The in-app consent screen in front of the OS
 * prompt (NotificationConsentModal) says notifications are for order updates
 * and that offers stay off unless turned on in Profile. The one-time notice
 * (`shouldShowConsentNotice`) still keys on a row that HAS offers on, so it now
 * fires only where that is actually true — never for a new default device.
 *
 * The database column keeps its own `default false`
 * (20260714090000_push_notifications.sql:25), which now agrees with this value.
 * It still never decides a real device's targeting: every registration path
 * passes both preferences explicitly through `register_push_device`.
 *
 * Store-review note: Apple guideline 4.5.4 expects explicit consent before
 * marketing push, plus an in-app opt-out. Opt-in through the Profile toggle is
 * that consent, and the same toggle is the opt-out. Recorded in CLAUDE.md
 * section 7 and docs/OWNER_ACTIONS.md sections 10 and 44.
 */
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
 * In Profile, permission is requested only WHEN THE CUSTOMER TURNS A TOGGLE ON
 * (clear context — never an app-launch nag). The only other way to the OS
 * prompt is the first-run consent screen's Allow button. Returns true when the
 * toggle change requires the OS permission flow first.
 */
export function toggleRequiresPermission(before: DevicePrefs, after: DevicePrefs): boolean {
  const wasOff = !before.orderUpdatesEnabled && !before.promosEnabled;
  const nowOn = after.orderUpdatesEnabled || after.promosEnabled;
  return wasOff && nowOn;
}

/**
 * Whether signing in should CLAIM this device for the customer who just
 * signed in.
 *
 * `register_push_device` reassigns the Expo token to the caller, so this one
 * decision carries both the "notifications survive a sign-out" rule and the
 * shared-phone safety rule:
 *
 *  - no OS permission   → false. Never register what the OS will not deliver,
 *                         and never prompt from here: iOS allows a single ask
 *                         and `useFirstRunPermissions` owns it.
 *  - lookup 'found'        → false. The token is already mine, so whatever state
 *                            it is in is a state I chose — still active, or
 *                            switched off deliberately. Re-registering would
 *                            reactivate a device the customer had silenced and
 *                            overwrite their promotions choice. "To stop
 *                            notifications the customer turns them off" only
 *                            holds if the next sign-in respects that.
 *  - lookup 'absent'       → true. Either this device has never registered, or
 *                            the token still belongs to a PREVIOUS account on a
 *                            shared phone. Both want a fresh registration under
 *                            the current customer — which is also what stops the
 *                            previous owner being targeted on a phone they no
 *                            longer hold.
 *  - lookup 'indeterminate'→ false. The lookup FAILED; it is not evidence of
 *                            absence. Registering here would apply default
 *                            preferences over a row we simply could not read —
 *                            reactivating a silenced device and flipping
 *                            promotions back on, from nothing worse than a
 *                            dropped request. The caller retries instead.
 *
 * Note the asymmetry: only a DEFINITE absence justifies a write. Everything
 * else does nothing, because every wrong answer here rewrites a consent choice.
 */
export type DeviceLookupState = 'found' | 'absent' | 'indeterminate';

export function shouldRegisterOnSignIn(input: {
  permissionGranted: boolean;
  lookup: DeviceLookupState;
}): boolean {
  if (!input.permissionGranted) return false;
  return input.lookup === 'absent';
}

/**
 * Whether the language the server holds for THIS device must follow the app.
 *
 * `push_devices.lang` is written only by `register_push_device`, and the
 * server picks every push's copy from it, so a customer who switches the app
 * language after registering would otherwise keep receiving pushes in the old
 * one (audit F-X08-001). Returns the preferences to PASS THROUGH to that RPC —
 * exactly as stored — or `null` when nothing should be written.
 *
 * The RPC has no language-only form: it upserts the preferences with the
 * language and sets `is_active = true`. Two consequences are decided here, so
 * that a language change can never rewrite a consent choice (CLAUDE.md §7,
 * "existing rows are never silently rewritten"):
 *
 *  - the stored preferences go back UNCHANGED. Never `DEFAULT_DEVICE_PREFS`:
 *    that would turn a customer's offers switch off, or on, as a side effect
 *    of tapping a language button;
 *  - an INACTIVE row is left alone (`null`). Registering would reactivate a
 *    device the customer deliberately silenced. Its language is refreshed by
 *    the registration made when they turn notifications back on, which always
 *    passes the current language.
 *
 * `device` must be a row the CALLER owns for THIS token (the RLS-scoped lookup
 * guarantees ownership), so this never reassigns a token.
 */
export function deviceLangSyncPrefs(input: {
  lang: 'en' | 'ar';
  device: {
    lang: 'en' | 'ar';
    is_active: boolean;
    order_updates_enabled: boolean;
    promos_enabled: boolean;
  } | null | undefined;
}): DevicePrefs | null {
  const { lang, device } = input;
  if (!device || !device.is_active || device.lang === lang) return null;
  return {
    orderUpdatesEnabled: device.order_updates_enabled,
    promosEnabled: device.promos_enabled,
  };
}

/**
 * Whether to show the one-time consent NOTICE: so that offers never reach a
 * customer who was not told about them.
 *
 * Where the OS asks first (iOS, Android 13+), the consent screen precedes that
 * prompt. Where it never asks, nobody would: Android 12 and older grant
 * notifications at install, and a second account on a shared phone inherits a
 * grant someone else gave — in both, the sign-in claim registers the device
 * without any screen.
 *
 * The notice is owed whenever THIS customer's row for THIS device has offers on
 * and they have not seen the consent text on this device. Since offers became
 * opt-IN (2026-11-18) a new registration has offers OFF, so a default device
 * never triggers it: it now fires only for a row that really carries offers —
 * one registered under the earlier opt-out default, or one whose customer
 * switched offers on. Its text ("…and send occasional offers") is true for
 * exactly those rows. It writes nothing and changes no one's targeting; it
 * only discloses what the row already says, and points at the switch.
 */
export function shouldShowConsentNotice(input: {
  seen: boolean;
  device: { is_active: boolean; promos_enabled: boolean } | null | undefined;
}): boolean {
  if (input.seen || !input.device) return false;
  return input.device.is_active && input.device.promos_enabled;
}

/** The tab routes as `usePathname()` reports them (route groups are dropped). */
export const CONSENT_SCREEN_ROUTES: ReadonlySet<string> = new Set(['/', '/orders', '/profile']);

/**
 * Where the consent screen may appear: on a tab, and never while the order-type
 * pop-up is up. Both are native modals, which iOS does not reliably stack; and
 * after sign-in at checkout the customer must be able to finish the order
 * before being asked about anything else, so the screen never covers checkout,
 * a receipt or the branch picker.
 */
export function consentScreenVisible(input: { pathname: string; blocked: boolean }): boolean {
  return !input.blocked && CONSENT_SCREEN_ROUTES.has(input.pathname);
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
