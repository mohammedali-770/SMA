/**
 * Navigation policy for the in-app Tap checkout WebView. PURE and framework-free
 * (no React Native / Expo / Supabase imports) so the security-critical allow-list
 * runs under Node in the unit suite (see webviewPolicy.test.ts) and is imported
 * unchanged by the WebView screen.
 *
 * The WebView is the ONLY place a Tap hosted-checkout page renders inside the app.
 * For every navigation it attempts, decideNavigation returns one of:
 *   - 'allow'    → let the WebView load it (the Tap hosted checkout + Tap-hosted
 *                  3DS, which stay on Tap domains in TEST mode).
 *   - 'complete' → our payment-return was reached (https page or the spicymeal://
 *                  deep link it bounces to). STOP the navigation and hand control
 *                  back to the app, which runs the AUTHORITATIVE server verify.
 *   - 'block'    → refuse. Arbitrary external https hosts, http://, javascript:,
 *                  file:, data:, blob:, and any unknown scheme are a hard wall.
 *
 * Security stance:
 *   - The decision NEVER creates an order and NEVER trusts a success/failure query
 *     param. 'complete' means only "the browser reached OUR return URL" — the app
 *     still asks payment-verify (server-to-server) what actually happened.
 *   - Nothing here reads card data or injects JS. The only value ever surfaced for
 *     logging is the bare hostname (safeHostForLog) — never a path, query or token.
 */

/** Registrable Tap domains. Hosted checkout + Tap-hosted 3DS live under these. */
const TAP_DOMAINS = ['tap.company', 'gosell.io', 'gosellapi.com'] as const;

/** The fixed app deep link the payment-return page bounces to. */
const RETURN_DEEP_LINK_PREFIX = 'spicymeal://payment/return';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NavDecision = 'allow' | 'block' | 'complete';

export interface WebviewNavConfig {
  /**
   * Host of the Tap hosted-checkout URL returned by payment-initiate. It comes
   * from our own server, so its exact host is trusted even if a future Tap host
   * ever falls outside TAP_DOMAINS.
   */
  checkoutHost: string;
  /** Host of our Supabase Edge Functions (serves the payment-return page). */
  returnHost: string;
  /** Path (prefix) of the payment-return function, e.g. /functions/v1/payment-return. */
  returnPath: string;
}

export interface NavResult {
  decision: NavDecision;
  /** For 'complete': the checkout-session UUID carried by the return URL (if valid). */
  session?: string;
  /** Safe, token-free reason for dev logging. */
  reason: string;
}

/** Decide what to do with a URL the WebView is about to load. */
export function decideNavigation(rawUrl: string, cfg: WebviewNavConfig): NavResult {
  const raw = String(rawUrl ?? '');
  const lower = raw.toLowerCase();

  // 1) Our own app deep link — matched on the RAW string so a URL-parser quirk in
  //    any JS engine can never make us miss (or mishandle) our completion signal.
  if (lower.startsWith(RETURN_DEEP_LINK_PREFIX)) {
    return { decision: 'complete', session: sessionFromRaw(raw), reason: 'app-return-deeplink' };
  }
  // Any OTHER spicymeal:// target inside the checkout WebView is unexpected.
  if (lower.startsWith('spicymeal:')) {
    return { decision: 'block', reason: 'unknown-app-scheme' };
  }

  // 2) Inert browser-internal frames (3DS iframes may use these). Harmless to allow;
  //    blocking about:blank can wedge WKWebView. No network, no content of ours.
  if (lower === 'about:blank' || lower.startsWith('about:srcdoc') || lower === 'about:') {
    return { decision: 'allow', reason: 'about-inert' };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { decision: 'block', reason: 'unparseable-url' };
  }

  // 3) Only https is ever loaded. http://, javascript:, file:, data:, blob:, tel:,
  //    mailto:, intent: … are all refused.
  const scheme = url.protocol.toLowerCase();
  if (scheme !== 'https:') {
    return { decision: 'block', reason: `blocked-scheme:${scheme.replace(':', '')}` };
  }

  const host = url.hostname.toLowerCase();

  // 4) Our payment-return page over https → complete BEFORE it renders. We read
  //    only the strict-UUID session; Tap's tap_id / status params are ignored.
  if (host === cfg.returnHost.toLowerCase() && pathMatches(url.pathname, cfg.returnPath)) {
    return { decision: 'complete', session: extractUuid(url.searchParams.get('session')), reason: 'payment-return-url' };
  }

  // 5) Tap hosted checkout + Tap-hosted 3DS, and the exact server-supplied host.
  if (isAllowedHost(host, cfg.checkoutHost)) {
    return { decision: 'allow', reason: 'tap-domain' };
  }

  // 6) Anything else is an arbitrary external site → hard block.
  return { decision: 'block', reason: 'external-host' };
}

/** Bare hostname for dev logging — never a path, query string or token. */
export function safeHostForLog(rawUrl: string): string {
  const raw = String(rawUrl ?? '');
  if (raw.toLowerCase().startsWith('spicymeal:')) return 'spicymeal://(app)';
  try {
    return new URL(raw).hostname || '(no-host)';
  } catch {
    return '(unparseable)';
  }
}

function isAllowedHost(host: string, checkoutHost: string): boolean {
  const ch = (checkoutHost ?? '').toLowerCase();
  if (ch && host === ch) return true;
  return TAP_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

/** Exact match or a true path-segment prefix (so `…-return-evil` never matches). */
function pathMatches(pathname: string, prefix: string): boolean {
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return pathname === p || pathname.startsWith(p + '/');
}

function extractUuid(v: string | null | undefined): string | undefined {
  return typeof v === 'string' && UUID_RE.test(v) ? v : undefined;
}

/** Pull a strict-UUID `session` out of a raw deep-link string without URL parsing. */
function sessionFromRaw(raw: string): string | undefined {
  const m = raw.match(/[?&]session=([^&#]+)/i);
  if (!m) return undefined;
  let v = m[1];
  try {
    v = decodeURIComponent(v);
  } catch {
    /* keep raw */
  }
  return UUID_RE.test(v) ? v : undefined;
}
