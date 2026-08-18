import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEVICE_PREFS, deviceShouldStayActive, enableFlowPlan, NOTIFICATION_FALLBACK_ROUTE,
  NOTIFICATIONS_OFF, NOTIFICATIONS_ON, notificationsEnabled,
  notificationResponseKey, PUSH_CLIENT_ENABLED, resolveNotificationRoute, shouldHandleResponse,
  toggleRequiresPermission,
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
  it('allowing notifications enables both channels', () => {
    // One customer-facing switch: allowing notifications means both channels.
    // The server columns stay separate so the split can return without a
    // schema change (owner decision 2026-08-18).
    expect(DEFAULT_DEVICE_PREFS).toEqual({ orderUpdatesEnabled: true, promosEnabled: true });
  });
  it('device stays active while any channel is on; deactivates when both off', () => {
    expect(deviceShouldStayActive({ orderUpdatesEnabled: true, promosEnabled: false })).toBe(true);
    expect(deviceShouldStayActive({ orderUpdatesEnabled: false, promosEnabled: true })).toBe(true);
    expect(deviceShouldStayActive({ orderUpdatesEnabled: false, promosEnabled: false })).toBe(false);
  });
  it('the single switch maps to both channels together', () => {
    expect(NOTIFICATIONS_ON).toEqual({ orderUpdatesEnabled: true, promosEnabled: true });
    expect(NOTIFICATIONS_OFF).toEqual({ orderUpdatesEnabled: false, promosEnabled: false });
    expect(notificationsEnabled(NOTIFICATIONS_ON)).toBe(true);
    expect(notificationsEnabled(NOTIFICATIONS_OFF)).toBe(false);
    // A device registered under the old two-toggle model still reads as on.
    expect(notificationsEnabled({ orderUpdatesEnabled: true, promosEnabled: false })).toBe(true);
  });

  it('OS permission is requested only on the off→on transition (clear context)', () => {
    const off = { orderUpdatesEnabled: false, promosEnabled: false };
    expect(toggleRequiresPermission(off, { orderUpdatesEnabled: true, promosEnabled: false })).toBe(true);
    expect(toggleRequiresPermission({ orderUpdatesEnabled: true, promosEnabled: false }, { orderUpdatesEnabled: true, promosEnabled: true })).toBe(false);
    expect(toggleRequiresPermission({ orderUpdatesEnabled: true, promosEnabled: true }, off)).toBe(false);
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
