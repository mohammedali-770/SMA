import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEVICE_PREFS, deviceShouldStayActive, NOTIFICATION_FALLBACK_ROUTE,
  resolveNotificationRoute, toggleRequiresPermission,
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
