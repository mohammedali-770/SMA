/**
 * Where a customer goes after signing in — and the only place that decides it.
 *
 * Guest browsing (App Store guideline 5.1.1(v)) lets a signed-out customer use
 * the menu, and asks for an account only where one is needed: checkout,
 * delivery (addresses belong to a customer), orders, profile, receipts. Each of
 * those sends the customer to login carrying where they were, so they land back
 * there afterwards instead of on the home tab.
 *
 * That destination travels as a URL query parameter, and on the web export
 * (`/app`) a query parameter is something anyone can write into a link. Used as
 * given it is an open redirect: `…/login?next=https://evil.example` would sign a
 * customer in and hand them to a look-alike page. So the value is never used as
 * given. It is checked against an ALLOW-LIST of this app's own routes — when a
 * login link is built AND again when login consumes it, because the second
 * check is the one an edited URL cannot skip. Anything else is refused and the
 * customer lands on the home tab.
 */
import type { Href } from 'expo-router';

import { NEW_ADDRESS } from '../../store/addressBook';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LENGTH = 200;

/** The home tab, in the form `router.replace` takes without replaying the intro. */
export const HOME_ROUTE = '/(tabs)';

/** The tab routes, keyed by every spelling the app produces for them. */
const TAB_ROUTES: Readonly<Record<string, string>> = {
  '/': HOME_ROUTE,
  '/(tabs)': HOME_ROUTE,
  '/orders': '/(tabs)/orders',
  '/(tabs)/orders': '/(tabs)/orders',
  '/profile': '/(tabs)/profile',
  '/(tabs)/profile': '/(tabs)/profile',
};

/** Root-stack routes a customer may be returned to, as `usePathname()` reports them. */
const STACK_ROUTES: ReadonlySet<string> = new Set([
  '/cart',
  '/checkout',
  '/select',
  '/profile/account',
  '/profile/addresses',
  '/profile/notifications',
  '/account/delete',
]);

/**
 * The checked return path, in canonical form, or `null` when `raw` is not one
 * of this app's own routes. `null` means "go home", never "go to `raw`".
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  // An in-app absolute path, and nothing a URL parser could read as a host.
  // Refused: `//host` (protocol-relative), any `:` (a scheme), `\` (`/\host` is
  // `//host` to some parsers), `@` (userinfo tricks), `%` (nothing on the
  // allow-list needs encoding, and decoding twice is how filters are bypassed),
  // `#`, and any whitespace or control character.
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\\:@%#\s\u0000-\u001f\u007f]/.test(raw)) return null;

  const parts = raw.split('?');
  if (parts.length > 2) return null;
  const [path, query] = parts;

  if (query !== undefined) {
    // Exactly one route takes a parameter: the order-type chooser.
    return path === '/select' && (query === 'type=pickup' || query === 'type=delivery')
      ? `${path}?${query}`
      : null;
  }
  if (TAB_ROUTES[path]) return TAB_ROUTES[path];
  if (STACK_ROUTES.has(path)) return path;

  const receipt = /^\/receipt\/([^/]+)$/.exec(path);
  if (receipt && UUID_RE.test(receipt[1])) return path;
  const address = /^\/profile\/address\/([^/]+)$/.exec(path);
  if (address && (address[1] === NEW_ADDRESS || UUID_RE.test(address[1]))) return path;
  return null;
}

/**
 * The login route, carrying `next` only when it passes the allow-list. An
 * unsafe or missing destination produces a plain login link, which lands on the
 * home tab — it is never forwarded.
 */
export function loginHref(next?: string | null): Href {
  const safe = safeReturnPath(next);
  return safe ? { pathname: '/(auth)/login', params: { next: safe } } : '/(auth)/login';
}
