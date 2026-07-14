import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEVICE_PREFS, deviceShouldStayActive, enableFlowPlan, NOTIFICATION_FALLBACK_ROUTE,
  notificationResponseKey, resolveNotificationRoute, shouldHandleResponse, toggleRequiresPermission,
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
  it('order updates default ON, promotions default OFF (strict opt-in)', () => {
    expect(DEFAULT_DEVICE_PREFS).toEqual({ orderUpdatesEnabled: true, promosEnabled: false });
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
