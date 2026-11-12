/**
 * Navigation policy for the in-app payment WebView, which shows Moyasar's hosted
 * invoice page. PURE and framework-free (no React Native / Expo / Supabase
 * imports) so the security-critical decision runs under Node in the unit suite
 * (see webviewPolicy.test.ts) and is imported unchanged by the WebView screen.
 *
 * For every navigation the WebView attempts, top frame or iframe alike,
 * decideNavigation returns one of:
 *   - 'complete' → our payment-return was reached: the https URL Moyasar uses as
 *                  both success_url and back_url, or the spicymeal:// deep link
 *                  that page bounces to. STOP the navigation and hand control back
 *                  to the app, which runs the AUTHORITATIVE server verify.
 *   - 'allow'    → any other https URL: Moyasar's hosted page, its 3-D Secure
 *                  hop, and the card issuer's challenge page.
 *   - 'block'    → everything else. http://, javascript:, data:, blob:, file:,
 *                  intent:, any other app scheme and any other spicymeal:// path.
 *                  Inert about:blank / about:srcdoc frames are the only non-https
 *                  URLs allowed.
 *
 * WHY THERE IS NO HOST ALLOW-LIST. A live 3-D Secure challenge is served by the
 * card's issuing bank, on the bank's own domain, so no list written in advance
 * can name it — and on iOS react-native-webview runs iframe loads through this
 * same gate, so a list would cancel an iframed challenge too. Moyasar's own SDK
 * WebViews (React Native, iOS, Android, Flutter) make the same choice: they allow
 * every navigation and intercept only their return host. The https-only rule is
 * what stays strict: no cleartext page, no script URL, no hand-off to another app.
 *
 * Security stance:
 *   - The decision NEVER creates an order and NEVER trusts a success/failure query
 *     param. 'complete' means only "the browser reached OUR return URL" — the app
 *     still asks payment-verify (server-to-server) what actually happened.
 *   - Nothing here reads card data or injects JS. The only value ever surfaced for
 *     logging is the bare hostname (safeHostForLog) — never a path, query or token.
 */

/** The fixed app deep link the payment-return page bounces to. */
const RETURN_DEEP_LINK = 'spicymeal://payment/return';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NavDecision = 'allow' | 'block' | 'complete';

export interface WebviewNavConfig {
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
  if (isReturnDeepLink(lower)) {
    return { decision: 'complete', session: sessionFromRaw(raw), reason: 'app-return-deeplink' };
  }
  // Any OTHER spicymeal:// target inside the payment WebView is unexpected.
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
  //    mailto:, intent:, other apps' schemes … are all refused.
  const scheme = url.protocol.toLowerCase();
  if (scheme !== 'https:') {
    return { decision: 'block', reason: `blocked-scheme:${scheme.replace(':', '')}` };
  }

  // 4) Our payment-return page over https → complete BEFORE it renders. The host
  //    must be ours EXACTLY: `<project>.supabase.co.evil.example`, or our path on
  //    another host, is just another https page. Only the strict-UUID session is
  //    read; whatever Moyasar appends to success_url (id, status, message) is
  //    ignored.
  const host = url.hostname.toLowerCase();
  if (host === cfg.returnHost.toLowerCase() && pathMatches(url.pathname, cfg.returnPath)) {
    return { decision: 'complete', session: extractUuid(url.searchParams.get('session')), reason: 'payment-return-url' };
  }

  // 5) Any other https page: Moyasar's hosted page and 3-D Secure hop, and the
  //    issuing bank's challenge page (see the header for why no list is kept).
  return { decision: 'allow', reason: 'https' };
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

/**
 * The return deep link itself, bare or followed by a query or fragment.
 * `spicymeal://payment/returns` is a different path, so it is not the return.
 */
function isReturnDeepLink(lower: string): boolean {
  if (!lower.startsWith(RETURN_DEEP_LINK)) return false;
  const next = lower.charAt(RETURN_DEEP_LINK.length);
  return next === '' || next === '?' || next === '#';
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
