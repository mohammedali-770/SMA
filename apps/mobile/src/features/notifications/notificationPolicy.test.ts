import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEVICE_PREFS, deviceShouldStayActive, enableFlowPlan, NOTIFICATION_FALLBACK_ROUTE,
  notificationResponseKey, PUSH_CLIENT_ENABLED, resolveNotificationRoute, shouldHandleResponse,
  shouldRegisterOnSignIn, toggleRequiresPermission,
} from './notificationPolicy';

const OID = 'a1b2c3d4-0000-4000-8000-000000000001';

describe('resolveNotificationRoute (allow-listed internal routes ONLY)', () => {
  it('order + valid uuid → that receipt', () => {
    expect(resolveNotificationRoute({ type: 'order', orderId: OID })).toBe(`/receipt/${OID}`);
  });
  it('order without a valid uuid → Orders tab', () => {
    expect(resolveNotificationRoute({ type: 'order' })).toBe('/(tabs)/orders');
    expect(resolveNotificationRoute({ type: 'order', orderId: 'not-a-uuid' })).toBe('/(tabs)/orders');
  });
  it('promo → home', () => {
    expect(resolveNotificationRoute({ type: 'promo' })).toBe(NOTIFICATION_FALLBACK_ROUTE);
  });
  it('a payload can NEVER navigate to an arbitrary/external target', () => {
    expect(resolveNotificationRoute({ type: 'order', orderId: '../../payment/checkout' })).toBe('/(tabs)/orders');
    expect(resolveNotificationRoute({ url: 'https://evil.example' })).toBe(NOTIFICATION_FALLBACK_ROUTE);
    expect(resolveNotificationRoute({ type: 'external', route: '/checkout' })).toBe(NOTIFICATION_FALLBACK_ROUTE);
    expect(resolveNotificationRoute('https://evil.example')).toBe(NOTIFICATION_FALLBACK_ROUTE);
    expect(resolveNotificationRoute(null)).toBe(NOTIFICATION_FALLBACK_ROUTE);
  });
});

describe('enableFlowPlan (Android channel MUST precede permission/token)', () => {
  it('orders the steps: channel → permission → token → register', () => {
    const plan = enableFlowPlan();
    expect(plan.indexOf('ensure_android_channel')).toBeLessThan(plan.indexOf('request_permission'));
    expect(plan.indexOf('request_permission')).toBeLessThan(plan.indexOf('get_token'));
    expect(plan.indexOf('get_token')).toBeLessThan(plan.indexOf('register_device'));
    expect(plan).toEqual(['ensure_android_channel', 'request_permission', 'get_token', 'register_device']);
  });
});

describe('exactly-once tap handling (cold start + listener see the SAME response)', () => {
  const response = { notification: { request: { identifier: 'notif-1', content: { data: { type: 'order', orderId: OID } } } }, actionIdentifier: 'default' };
  it('a response is handled exactly once', () => {
    const handled = new Set<string>();
    const key = notificationResponseKey(response);
    expect(shouldHandleResponse(handled, key)).toBe(true);
    expect(shouldHandleResponse(handled, key)).toBe(false); // duplicate ignored
  });
  it('distinct responses are handled independently', () => {
    const handled = new Set<string>();
    expect(shouldHandleResponse(handled, notificationResponseKey(response))).toBe(true);
    const other = { ...response, notification: { request: { identifier: 'notif-2' } } };
    expect(shouldHandleResponse(handled, notificationResponseKey(other))).toBe(true);
  });
  it('malformed responses still produce a stable key (no crash, safe fallback route)', () => {
    expect(notificationResponseKey(null)).toBe('unknown|default');
    expect(notificationResponseKey({})).toBe('unknown|default');
    // and their payloads resolve to the safe route, never an arbitrary target
    expect(resolveNotificationRoute(undefined)).toBe(NOTIFICATION_FALLBACK_ROUTE);
  });
});

describe('device preference defaults + lifecycle', () => {
  it('both channels default ON — the OS permission grant is the consent moment', () => {
    expect(DEFAULT_DEVICE_PREFS).toEqual({ orderUpdatesEnabled: true, promosEnabled: true });
  });
  it('device stays active while any channel is on; deactivates when both off', () => {
    expect(deviceShouldStayActive({ orderUpdatesEnabled: true, promosEnabled: false })).toBe(true);
    expect(deviceShouldStayActive({ orderUpdatesEnabled: false, promosEnabled: true })).toBe(true);
    expect(deviceShouldStayActive({ orderUpdatesEnabled: false, promosEnabled: false })).toBe(false);
  });
  it('OS permission is requested only on the off→on transition (clear context)', () => {
    const off = { orderUpdatesEnabled: false, promosEnabled: false };
    expect(toggleRequiresPermission(off, { orderUpdatesEnabled: true, promosEnabled: false })).toBe(true);
    expect(toggleRequiresPermission({ orderUpdatesEnabled: true, promosEnabled: false }, { orderUpdatesEnabled: true, promosEnabled: true })).toBe(false);
    expect(toggleRequiresPermission({ orderUpdatesEnabled: true, promosEnabled: true }, off)).toBe(false);
  });
});

/**
 * Deliberate tripwire, like the app.json coupling below — a source assertion,
 * because the behaviour it guards is the ABSENCE of a call and nothing else can
 * observe that.
 *
 * Sign-out used to call `deactivateThisDevice()`. Combined with a first-run
 * permission flag that is device-scoped and never re-raised, that left push
 * permanently dead after a single sign-out: the row went inactive and no path
 * ever re-registered it. Re-adding the call would silently restore that bug,
 * and no unit test of the pure rules would notice.
 *
 * Account DELETION still deactivates, in DeleteAccountScreen — that is a
 * different screen and deliberately unaffected.
 */
describe('sign-out must not silence the device (CLAUDE.md §7)', () => {
  const profileSource = readFileSync(
    new URL('../profile/ProfileScreen.tsx', import.meta.url),
    'utf8',
  );

  it('ProfileScreen never deactivates the push device on sign-out', () => {
    expect(profileSource).not.toContain('deactivateThisDevice');
  });

  it('the account-deletion screen still does deactivate', () => {
    const deleteSource = readFileSync(
      new URL('../account/DeleteAccountScreen.tsx', import.meta.url),
      'utf8',
    );
    expect(deleteSource).toContain('deactivateThisDevice');
  });
});

describe('shouldRegisterOnSignIn — surviving sign-out, and shared phones', () => {
  it('claims the device when the signed-in customer has no row for this token', () => {
    // Either a never-registered device, or a token still owned by a PREVIOUS
    // account on a shared phone. Registering reassigns it to the caller.
    expect(shouldRegisterOnSignIn({ permissionGranted: true, myDevice: null })).toBe(true);
  });
  it('never registers without OS permission, and never prompts for it here', () => {
    expect(shouldRegisterOnSignIn({ permissionGranted: false, myDevice: null })).toBe(false);
    expect(shouldRegisterOnSignIn({ permissionGranted: false, myDevice: { isActive: false } })).toBe(false);
  });
  it('leaves an active row of my own alone — re-registering it would be a no-op write', () => {
    expect(shouldRegisterOnSignIn({ permissionGranted: true, myDevice: { isActive: true } })).toBe(false);
  });
  it('does NOT reactivate a row the customer switched off — signing back in must not undo that', () => {
    // The regression this guards: "to stop notifications the customer turns
    // them off" only holds if the next sign-in respects an inactive row.
    expect(shouldRegisterOnSignIn({ permissionGranted: true, myDevice: { isActive: false } })).toBe(false);
  });
});

/**
 * Deliberate tripwire, not a behavioural assertion.
 *
 * The rule this guards is a COUPLING, not a value: the app may only ask a
 * customer for OS notification permission when the binary it ships in can
 * actually receive a notification. An iOS denial is sticky
 * (`canAskAgain: false`), so a prompt raised by a build with no push
 * entitlement permanently costs us that customer's opt-in — and a
 * declared-but-undeliverable capability is a store-review question we cannot
 * answer.
 *
 * Push was enabled by explicit owner approval on 2026-08-17 (CLAUDE.md §5),
 * with EAS credentials in place for both platforms. So instead of pinning the
 * constant to a literal, this asserts the invariant that made enabling it safe:
 * whenever the client gate is open, apps/mobile/app.json MUST carry the native
 * push configuration. Flipping either side alone fails here.
 */
describe('push client gate ↔ native config coupling (CLAUDE.md §7)', () => {
  // Read the REAL manifest — a stub would defeat the point of the tripwire.
  const appJson = JSON.parse(
    readFileSync(new URL('../../../app.json', import.meta.url), 'utf8'),
  ) as {
    expo: {
      plugins?: (string | [string, Record<string, unknown>])[];
      android?: { googleServicesFile?: string; permissions?: string[] };
    };
  };
  const pluginName = (p: string | [string, Record<string, unknown>]) => (Array.isArray(p) ? p[0] : p);
  const hasNotificationsPlugin = (appJson.expo.plugins ?? []).some(
    (p) => pluginName(p) === 'expo-notifications',
  );

  it('ships the expo-notifications plugin whenever the client gate is open', () => {
    // The plugin is what puts the iOS `aps-environment` entitlement and the
    // Android notification channel into the binary. Without it the permission
    // prompt would be asking for something the build cannot honour.
    if (PUSH_CLIENT_ENABLED) expect(hasNotificationsPlugin).toBe(true);
    else expect(hasNotificationsPlugin).toBe(false);
  });

  it('points Android at google-services.json whenever the client gate is open', () => {
    // FCM V1 needs the Firebase config in the build; without it Android
    // registers no token and every send silently targets nobody.
    if (!PUSH_CLIENT_ENABLED) return;
    expect(appJson.expo.android?.googleServicesFile).toBe('./google-services.json');
    expect(appJson.expo.android?.permissions ?? []).toContain('POST_NOTIFICATIONS');
  });

  it('documents what enabling push does NOT unlock', () => {
    // Reminder for whoever reads this next: the client gate only lets a
    // customer OPT IN and register a device. Delivery is separately gated by
    // the server master flag (integration_settings provider_type='push',
    // provider 'expo', enabled=true), re-checked by push-dispatch on every
    // action. Opening this gate cannot by itself send a notification, and
    // enabling the server flag is its own owner-approval-gated step
    // (CLAUDE.md §5).
    expect(typeof PUSH_CLIENT_ENABLED).toBe('boolean');
  });
});
