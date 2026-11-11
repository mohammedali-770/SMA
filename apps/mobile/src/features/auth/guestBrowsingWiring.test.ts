import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guest browsing (App Store 5.1.1(v)) is a property of the ROUTING, spread over
 * a dozen files, and nothing else in the suite would notice it regress: until
 * this change no test mentioned a redirect at all. These pin the shape.
 *
 *   - the menu, product, cart and pickup routes are open to a guest;
 *   - every route that belongs to an account still sits behind AuthGate;
 *   - login returns the customer where they were, only through the allow-list.
 */

const SRC = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
/** Source with comments removed, so prose about a symbol cannot satisfy a check. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the menu is open to a guest', () => {
  it('the entry route sends everyone to the tabs, never to login', () => {
    expect(code('app/index.tsx')).not.toContain('/(auth)/login');
    expect(code('app/index.tsx')).toMatch(/<Redirect href="\/\(tabs\)" \/>/);
  });

  it('the tabs no longer redirect a signed-out customer', () => {
    const tabs = code('app/(tabs)/_layout.tsx');
    expect(tabs).not.toContain('/(auth)/login');
    expect(tabs).not.toMatch(/status === 'signed_out'\) return <Redirect/);
  });

  it.each(['app/select.tsx', 'app/cart.tsx', 'app/product/[id].tsx'])('%s is not behind AuthGate', (rel) => {
    expect(code(rel)).not.toMatch(/AuthGate/);
  });
});

describe('account-only routes stay gated', () => {
  it.each([
    'app/checkout.tsx',
    'app/receipt/[id].tsx',
    'app/profile/account.tsx',
    'app/profile/addresses.tsx',
    'app/profile/address/[id].tsx',
    'app/profile/notifications.tsx',
    'app/account/delete.tsx',
  ])('%s is wrapped in AuthGate', (rel) => {
    expect(code(rel)).toMatch(/<AuthGate>/);
  });

  it('AuthGate sends a guest to login carrying the current route', () => {
    const gate = code('components/AuthGate.tsx');
    expect(gate).toMatch(/<Redirect href=\{loginHref\(pathname\)\} \/>/);
    expect(gate).not.toContain('href="/(auth)/login"');
  });
});

describe('an account is asked for at the point it is needed', () => {
  it('checkout, from the cart', () => {
    expect(code('features/cart/CartScreen.tsx')).toContain(
      "router.push(status === 'signed_in' ? '/checkout' : loginHref('/checkout'))",
    );
  });

  it('delivery, from the order-type popup and from the delivery tab', () => {
    expect(code('app/(tabs)/_layout.tsx')).toContain("router.push(loginHref('/select?type=delivery'))");
    expect(code('features/order/OrderTypeSelectScreen.tsx')).toContain('returnTo="/select?type=delivery"');
  });

  it('the Orders tab, with a return to that tab', () => {
    const orders = code('app/(tabs)/orders.tsx');
    // OrdersScreen only for a KNOWN session. During `loading` it would send its
    // orders query with no session; ordersTabGate.test.tsx renders every state.
    expect(orders).toContain("if (status === 'signed_in') return <OrdersScreen />;");
    expect(orders.match(/<OrdersScreen\b/g)).toHaveLength(1);
    expect(orders).toContain('returnTo="/(tabs)/orders"');
  });

  it('the Profile tab, which stays usable for language and legal pages', () => {
    const profile = code('features/profile/ProfileScreen.tsx');
    expect(profile).toContain('returnTo="/(tabs)/profile"');
    // Signing out now leaves the customer here as a guest; login is not a dead end.
    expect(profile).not.toContain("router.replace('/(auth)/login')");
  });
});

describe('login returns the customer, only through the allow-list', () => {
  it('the route passes the untrusted `next` straight through', () => {
    expect(code('app/(auth)/login.tsx')).toContain('<LoginScreen returnTo=');
    expect(code('features/auth/LoginScreen.tsx')).toContain('<PhoneOtpLogin returnTo={returnTo} />');
  });

  it('PhoneOtpLogin navigates through safeReturnPath and has no hard-coded destination', () => {
    const otp = code('features/auth/PhoneOtpLogin.tsx');
    // dismissTo, not replace: login opens above the tabs (stackedTabsWiring.test.ts).
    expect(otp).toContain('router.dismissTo(safeReturnPath(returnTo) ?? HOME_ROUTE)');
    expect(otp).not.toContain("router.replace('/(tabs)')");
  });

  it('the login screen is never a dead end', () => {
    expect(code('features/auth/LoginScreen.tsx')).toContain(
      'router.canGoBack() ? router.back() : router.replace(HOME_ROUTE)',
    );
  });

  it('the frozen checkout screen is not part of this change', () => {
    expect(code('features/checkout/CheckoutScreen.tsx')).not.toMatch(/returnPath|loginHref|SignInPrompt/);
  });
});
