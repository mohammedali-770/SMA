import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Leaving a screen for a route that is already in the stack must go BACK to it
 * (`router.dismissTo`), never put a new copy on top (`router.replace`).
 *
 * WHAT WENT WRONG. The order-type screen, login, the cart, the receipt and the
 * address editor all open above the tabs. Each one that left with
 * `router.replace('/(tabs)')`, or by replacing itself with a tab route, swapped
 * itself for a NEW tabs layout and left the old one underneath. Measured on
 * production 2026-11-11: four changes of order type took the page from one tabs
 * layout to five, and Back walked through each stale Home. On a phone every copy
 * also runs the tabs layout's own work (the notification consent flow, the
 * device claim, the deletion check and the order-type pop-up), so a customer
 * could be shown the consent screen twice.
 *
 * `dismissTo` pops back to the route when it is in the stack, and replaces the
 * current screen only when it is not, so a deep link still lands where it did.
 */

const SRC = resolve(__dirname, '../..');
/** Source with comments removed, so prose about a call cannot satisfy a check. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = (rel: string) => strip(readFileSync(resolve(SRC, rel), 'utf8'));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const LEAVERS: [file: string, call: string, times: number][] = [
  ['features/order/OrderTypeSelectScreen.tsx', "router.dismissTo('/(tabs)')", 2],
  ['features/auth/PhoneOtpLogin.tsx', 'router.dismissTo(safeReturnPath(returnTo) ?? HOME_ROUTE)', 1],
  ['features/cart/CartScreen.tsx', "router.dismissTo('/(tabs)')", 1],
  ['features/cart/CartScreen.tsx', "router.dismissTo('/select')", 1],
  ['features/orders/ReceiptScreen.tsx', 'router.dismissTo(href)', 1],
  ['features/profile/AddressEditScreen.tsx', "router.dismissTo('/profile/addresses')", 1],
];

describe('screens opened above another route go back to it', () => {
  it.each(LEAVERS)('%s leaves with %s', (file, call, times) => {
    expect(code(file).split(call).length - 1).toBe(times);
  });

  it.each([...new Set(LEAVERS.map(([file]) => file))])('%s replaces nothing', (file) => {
    expect(code(file)).not.toMatch(/router\.replace\(/);
  });
});

describe('nothing in the app replaces the current screen with the tabs', () => {
  // Login's "Not now" is the one allowed replace: it runs only when there is
  // nothing to go back to, so there is no second copy to make.
  const GUARDED = 'router.canGoBack() ? router.back() : router.replace(HOME_ROUTE)';

  it('no router.replace targets a tabs route', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => {
        const source = strip(readFileSync(file, 'utf8')).split(GUARDED).join('');
        return (
          /router\.replace\(\s*['"`]\/\(tabs\)/.test(source) ||
          /router\.replace\(\s*HOME_ROUTE\b/.test(source)
        );
      })
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('the allowed replace in login keeps its guard', () => {
    expect(code('features/auth/LoginScreen.tsx')).toContain(GUARDED);
  });
});
