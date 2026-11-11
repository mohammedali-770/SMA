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
 * Our UUID query value, tolerant of one provider quirk. Moyasar documents no
 * query parameters for success_url or back_url. If it appends its own with a
 * second '?' ('…/payment-return?session=<uuid>?id=…'), the parsed value
 * arrives as '<uuid>?id=…' and strict validation alone would drop it. Only
 * that shape is repaired: everything from the first '?' is discarded, unread,
 * and what remains must still be a strict UUID.
 */
export function queryUuid(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const end = raw.indexOf('?');
  return sanitizeUuid(end === -1 ? raw : raw.slice(0, end));
}

/**
 * Build the fixed spicymeal:// return deep link. The new flow forwards `session`;
 * the legacy flow forwards `order`. Whatever the provider appends (Moyasar's
 * `id`, for one) is ignored — the app re-verifies server-side and never trusts
 * anything in this URL.
 */
export function buildReturnDeepLink(order: string | null | undefined, session: string | null | undefined): string {
  const s = queryUuid(session);
  if (s) return `spicymeal://payment/return?session=${encodeURIComponent(s)}`;
  const o = queryUuid(order);
  if (o) return `spicymeal://payment/return?order=${encodeURIComponent(o)}`;
  return 'spicymeal://payment/return';
}

/** Minimal HTML-attribute escaping for safe embedding in href / content attrs. */
export function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
