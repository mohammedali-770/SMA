/**
 * Pure helpers for the payment-return page. No Deno APIs / npm imports so they run
 * under the Node unit suite (returnLink.test.ts). The page marks NOTHING paid — it
 * only bounces the browser back into the app via our FIXED scheme, forwarding at
 * most a strict-UUID id, which keeps it open-redirect safe.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Return the value only when it is a strict UUID, else '' (never trusted raw). */
export function sanitizeUuid(raw: string | null | undefined): string {
  return typeof raw === 'string' && UUID_RE.test(raw) ? raw : '';
}

/**
 * Build the fixed spicymeal:// return deep link. The new flow forwards `session`;
 * the legacy flow forwards `order`. Tap's tap_id / status params are ignored — the
 * app re-verifies server-side and never trusts anything in this URL.
 */
export function buildReturnDeepLink(order: string | null | undefined, session: string | null | undefined): string {
  const s = sanitizeUuid(session);
  if (s) return `spicymeal://payment/return?session=${encodeURIComponent(s)}`;
  const o = sanitizeUuid(order);
  if (o) return `spicymeal://payment/return?order=${encodeURIComponent(o)}`;
  return 'spicymeal://payment/return';
}

/** Minimal HTML-attribute escaping for safe embedding in href / content attrs. */
export function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
