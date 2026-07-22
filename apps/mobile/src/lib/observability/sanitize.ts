/**
 * Sentry payload sanitization — FRAMEWORK-FREE (no React Native / Expo / Sentry
 * imports) so the root vitest suite can verify every rule.
 *
 * Two layers of defense, both applied to every outgoing event, transaction and
 * breadcrumb:
 *   1. KEY-NAME redaction — any object key that looks sensitive is replaced
 *      with '[redacted]' regardless of its value.
 *   2. VALUE-PATTERN redaction — free text is scrubbed for JWTs, bearer
 *      values, emails, phone numbers, card-like digit runs, coordinates and
 *      payment references.
 *
 * Safe diagnostic fields (status codes, safe error codes, subsystem/operation
 * names, route templates, platform, environment, durations, retry counts) do
 * not match the sensitive-key list and pass through untouched.
 */

/** Keys whose VALUES are always redacted, wherever they appear. */
const SENSITIVE_KEY_PARTS = [
  'authorization', 'cookie', 'token', 'jwt', 'secret', 'password', 'passwd',
  'otp', 'apikey', 'api_key', 'api-key', 'session', 'phone', 'mobile',
  'msisdn', 'email', 'e-mail', 'address', 'street', 'latitude', 'longitude',
  'payment', 'tap', 'card', 'cvv', 'customer', 'profile', 'push_token',
  'device_token', 'lazywait', 'anon_key', 'service_role', 'bearer',
  'credential', 'private',
] as const;

/** Exact key names that are sensitive even though short/ambiguous. */
const SENSITIVE_EXACT_KEYS = new Set(['lat', 'lng', 'lon', 'auth', 'pin', 'pan']);

export const REDACTED = '[redacted]';

/** True when an object key must have its value redacted. */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SENSITIVE_EXACT_KEYS.has(k)) return true;
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

/** Free-text value patterns, applied to every string. Order matters. */
const VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // JWT-like three-segment base64url tokens (Supabase access/refresh, anon key)
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g, '[redacted-jwt]'],
  // Authorization schemes with their value
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '[redacted-auth]'],
  // Email addresses
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]'],
  // Saudi phone formats (+9665XXXXXXXX, 9665XXXXXXXX, 05XXXXXXXX)
  [/\+?9665\d{8}\b/g, '[redacted-phone]'],
  [/\b05\d{8}\b/g, '[redacted-phone]'],
  // Generic international numbers (+ then 10-15 digits)
  [/\+\d{10,15}\b/g, '[redacted-phone]'],
  // Card-like long digit runs (13-19 digits, with or without separators)
  [/\b(?:\d[ -]?){13,19}\b/g, '[redacted-number]'],
  // Tap / payment style references (chg_..., tok_..., src_..., card_...)
  [/\b(?:chg|tok|src|card|cus|auth)_[A-Za-z0-9]{6,}\b/g, '[redacted-payment-ref]'],
  // Coordinate pairs with high precision ("24.71355, 46.67529")
  [/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, '[redacted-coords]'],
];

/** Scrub sensitive patterns out of arbitrary text. */
export function sanitizeText(input: string): string {
  let out = input;
  for (const [re, replacement] of VALUE_PATTERNS) out = out.replace(re, replacement);
  return out;
}

const MAX_DEPTH = 6;
const MAX_KEYS = 50;

/**
 * Deep-sanitize any value. Object keys that look sensitive are redacted
 * outright; strings are pattern-scrubbed; depth and key counts are capped so
 * a huge accidental payload cannot be shipped wholesale.
 */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((v) => sanitizeValue(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (kept >= MAX_KEYS) { out['[truncated]'] = true; break; }
      out[k] = isSensitiveKey(k) ? REDACTED : sanitizeValue(v, depth + 1);
      kept += 1;
    }
    return out;
  }
  return String(value);
}

/** Deep-sanitized copy of a metadata object. */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return sanitizeValue(obj) as Record<string, unknown>;
}

/** Strip the query string, then pattern-scrub a URL for breadcrumbs/spans. */
export function sanitizeUrl(url: string): string {
  return sanitizeText(url.split('?')[0]);
}

/**
 * Sanitize a Sentry-style breadcrumb (shape kept structural so this module
 * stays framework-free). HTTP breadcrumbs keep only method/status/clean URL;
 * request and response bodies are never kept.
 */
export interface BreadcrumbLike {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export function sanitizeBreadcrumb<T>(crumb: T): T {
  const out: BreadcrumbLike = { ...(crumb as BreadcrumbLike) };
  if (typeof out.message === 'string') out.message = sanitizeText(out.message);
  if (out.data && typeof out.data === 'object') {
    if (out.category === 'http' || out.category === 'xhr' || out.category === 'fetch') {
      const { method, status_code: statusCode, url } = out.data as Record<string, unknown>;
      out.data = {
        ...(typeof method === 'string' ? { method } : {}),
        ...(typeof statusCode === 'number' ? { status_code: statusCode } : {}),
        ...(typeof url === 'string' ? { url: sanitizeUrl(url) } : {}),
      };
    } else {
      out.data = sanitizeObject(out.data);
    }
  }
  return out as T;
}

/**
 * Sanitize a Sentry event envelope (structural typing; works for error events
 * and transactions). Removes cookies/bodies/IP, redacts headers, keeps only a
 * pseudonymous user id, scrubs all text surfaces.
 */
export interface EventLike {
  message?: unknown;
  request?: {
    cookies?: unknown; data?: unknown; headers?: Record<string, unknown>;
    url?: string; query_string?: unknown;
  };
  user?: Record<string, unknown>;
  breadcrumbs?: BreadcrumbLike[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  transaction?: string;
  exception?: { values?: Array<{ value?: string }> };
}

export function sanitizeEvent<T>(input: T): T {
  // Structural view over Sentry's concrete event types (error/transaction);
  // mutations below stay within this common shape.
  const event = input as EventLike;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.headers) {
      event.request.headers = sanitizeObject(event.request.headers);
    }
    if (typeof event.request.url === 'string') {
      event.request.url = sanitizeUrl(event.request.url);
    }
  }
  if (event.user) {
    // Pseudonymous id only — never email/username/ip/geo.
    event.user = typeof event.user.id === 'string' || typeof event.user.id === 'number'
      ? { id: event.user.id }
      : {};
  }
  if (typeof event.message === 'string') event.message = sanitizeText(event.message);
  if (event.exception?.values) {
    for (const v of event.exception.values) {
      if (typeof v.value === 'string') v.value = sanitizeText(v.value);
    }
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(sanitizeBreadcrumb);
  if (event.extra) event.extra = sanitizeObject(event.extra);
  if (event.contexts) event.contexts = sanitizeObject(event.contexts);
  if (event.tags) event.tags = sanitizeObject(event.tags) as Record<string, unknown>;
  if (typeof event.transaction === 'string') event.transaction = sanitizeText(event.transaction);
  return input;
}
