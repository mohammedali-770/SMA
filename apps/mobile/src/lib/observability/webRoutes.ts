/**
 * Web route/transaction normalization — FRAMEWORK-FREE and fully unit-tested.
 *
 * Browser tracing names pageload/navigation transactions after the raw URL,
 * and navigation breadcrumbs carry raw from/to paths. Dynamic values (order
 * ids, customer ids, payment refs, phones, emails, opaque tokens) must never
 * appear there. This module reduces any URL or path to a TEMPLATED route:
 *
 *   /orders/7c2f0a1e-…       → /orders/[id]
 *   /customers/0501234567    → /customers/[id]
 *   /payments/tap_abc123     → /payments/[id]
 *   /admin/orders?id=42#x    → /admin/orders
 *
 * Query strings and fragments are dropped entirely (same policy as
 * sanitize.ts). Already-templated segments ([id], (tabs), :id) pass through.
 */

const TEMPLATE_SEGMENT = /^(\[.*\]|\(.*\)|:.+|\*)$/;

/** Segment patterns that are always dynamic values, never route words. */
const DYNAMIC_SEGMENT_PATTERNS: ReadonlyArray<RegExp> = [
  // UUIDs (any case, with dashes)
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // Long hex identifiers (hashes, opaque ids)
  /^[0-9a-f]{12,}$/i,
  // Pure numeric ids of any length
  /^\d+$/,
  // Provider-style prefixed references (tap_x, chg_x, tok_x, ord_x, trk_x, …)
  /^[a-z]{2,10}_[A-Za-z0-9-]{4,}$/,
  // Phone-shaped segments (+9665…, 05…, +intl, digit runs with separators)
  /^\+?\d[\d\s()-]{7,}$/,
  // Email-shaped segments
  /^[^/\s@]+@[^/\s@]+\.[^/\s@]+$/,
  // Long opaque mixed tokens (base64ish / random ids) — 20+ chars with digits
  /^(?=.*\d)[A-Za-z0-9_-]{20,}$/,
];

function isDynamicSegment(segment: string): boolean {
  if (TEMPLATE_SEGMENT.test(segment)) return false;
  const decoded = safeDecode(segment);
  return DYNAMIC_SEGMENT_PATTERNS.some((re) => re.test(decoded));
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Normalize a URL or path to a templated route:
 *  - the origin (scheme://host[:port]) is removed;
 *  - the query string and fragment are dropped entirely;
 *  - every dynamic segment becomes '[id]';
 *  - a trailing slash (except root) is removed for stable grouping.
 */
export function normalizeWebRoute(urlOrPath: string): string {
  let path = urlOrPath.trim();
  // Strip scheme://host (any scheme), keeping the path.
  const schemeMatch = path.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i);
  if (schemeMatch) path = path.slice(schemeMatch[0].length);
  // Drop query + fragment.
  path = path.split(/[?#]/)[0];
  if (path === '' || path === '/') return '/';
  const normalized = path
    .split('/')
    .map((segment) => (segment !== '' && isDynamicSegment(segment) ? '[id]' : segment))
    .join('/');
  const noTrailing = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  return noTrailing.startsWith('/') ? noTrailing : `/${noTrailing}`;
}

/**
 * Normalize a transaction name. URL-shaped names go through route
 * normalization; non-URL names (component names, custom ops) pass through so
 * grouping is preserved.
 */
export function normalizeTransactionName(name: string): string {
  if (name.startsWith('/') || /^[a-z][a-z0-9+.-]*:\/\//i.test(name)) {
    return normalizeWebRoute(name);
  }
  return name;
}
