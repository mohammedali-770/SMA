import { describe, expect, it } from 'vitest';

import { HOME_ROUTE, loginHref, safeReturnPath } from './returnPath';

/**
 * The return path after sign-in comes from a URL parameter, which on the web
 * export anyone can write. These cases pin that only this app's own routes get
 * through, and that every refusal degrades to the home tab rather than to the
 * value given.
 */

const ORDER = '0b4c1d2e-3f40-4a51-8b62-7c83d94ea5f6';

describe('safeReturnPath — what is allowed through', () => {
  it.each([
    ['/checkout', '/checkout'],
    ['/cart', '/cart'],
    ['/select', '/select'],
    ['/profile/account', '/profile/account'],
    ['/profile/addresses', '/profile/addresses'],
    ['/profile/notifications', '/profile/notifications'],
    ['/account/delete', '/account/delete'],
    [`/receipt/${ORDER}`, `/receipt/${ORDER}`],
    [`/profile/address/${ORDER}`, `/profile/address/${ORDER}`],
    ['/profile/address/new', '/profile/address/new'],
  ])('%s', (raw, expected) => {
    expect(safeReturnPath(raw)).toBe(expected);
  });

  it('canonicalises every spelling of a tab to its group form, so home never replays the intro', () => {
    expect(safeReturnPath('/')).toBe(HOME_ROUTE);
    expect(safeReturnPath('/(tabs)')).toBe(HOME_ROUTE);
    expect(safeReturnPath('/orders')).toBe('/(tabs)/orders');
    expect(safeReturnPath('/(tabs)/orders')).toBe('/(tabs)/orders');
    expect(safeReturnPath('/profile')).toBe('/(tabs)/profile');
    expect(safeReturnPath('/(tabs)/profile')).toBe('/(tabs)/profile');
  });

  it('lets the order-type chooser keep exactly its two legal parameters', () => {
    expect(safeReturnPath('/select?type=delivery')).toBe('/select?type=delivery');
    expect(safeReturnPath('/select?type=pickup')).toBe('/select?type=pickup');
  });
});

describe('safeReturnPath — what is refused', () => {
  it.each([
    ['an absolute URL', 'https://evil.example/login'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash host', '/\\evil.example'],
    ['a scheme', 'javascript:alert(1)'],
    ['a relative path', 'checkout'],
    ['percent-encoding', '/%2F%2Fevil.example'],
    ['userinfo', '/@evil.example'],
    ['a fragment', '/checkout#x'],
    ['whitespace', '/check out'],
    ['a newline', '/checkout\n'],
    ['a control character', '/checkout\u0000'],
    ['an unknown route', '/admin'],
    ['the login route itself (no loops)', '/login'],
    ['a payment route', '/payment/return'],
    ['a malformed receipt id', '/receipt/not-a-uuid'],
    ['a receipt with a trailing segment', `/receipt/${ORDER}/x`],
    ['a malformed address id', '/profile/address/../../x'],
    ['a parameter on a route that takes none', '/checkout?next=//evil.example'],
    ['an unknown chooser type', '/select?type=dinein'],
    ['an extra chooser parameter', '/select?type=delivery&x=1'],
    ['two query separators', '/select?type=delivery?x'],
    ['the empty string', ''],
    ['an over-long path', `/checkout${'/x'.repeat(200)}`],
  ])('%s', (_label, raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });

  it('refuses anything that is not a string', () => {
    for (const raw of [undefined, null, 42, ['/checkout'], { pathname: '/checkout' }]) {
      expect(safeReturnPath(raw)).toBeNull();
    }
  });
});

describe('loginHref', () => {
  it('carries a safe destination as `next`', () => {
    expect(loginHref('/checkout')).toEqual({ pathname: '/(auth)/login', params: { next: '/checkout' } });
    expect(loginHref('/select?type=delivery')).toEqual({
      pathname: '/(auth)/login',
      params: { next: '/select?type=delivery' },
    });
  });

  it('carries the canonical form, not the spelling it was given', () => {
    expect(loginHref('/orders')).toEqual({ pathname: '/(auth)/login', params: { next: '/(tabs)/orders' } });
  });

  it('drops an unsafe or missing destination instead of forwarding it', () => {
    expect(loginHref('https://evil.example')).toBe('/(auth)/login');
    expect(loginHref('/admin')).toBe('/(auth)/login');
    expect(loginHref(undefined)).toBe('/(auth)/login');
    expect(loginHref(null)).toBe('/(auth)/login');
  });
});
