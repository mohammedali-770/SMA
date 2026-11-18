/**
 * Supabase API keys for Edge Functions — the opaque `sb_publishable_…` /
 * `sb_secret_…` keys, and nothing else.
 *
 * WHY THIS EXISTS. Supabase retired the JWT-based `anon` / `service_role` keys
 * (supabase.com/docs/guides/getting-started/migrating-to-new-api-keys). This
 * module was written for the cut-over, when it preferred the new keys and fell
 * back to the legacy ones; step 9 of `docs/SUPABASE_API_KEYS.md` §3 removed the
 * fallback, after the legacy keys had been deactivated (step 8) and that had
 * held. The new keys are NOT JWTs, and that changes three things:
 *
 *   1. They go on the `apikey` header ONLY. Supabase's migration guide: "Send
 *      publishable and secret keys on the `apikey` header only. If you also
 *      pass the key on the `Authorization: Bearer` header … the platform tries
 *      to parse it as a JWT and rejects the request".
 *   2. The gateway's `verify_jwt` does "not verify the `apikey` header" for the
 *      new keys. Every function that one of OUR functions calls is
 *      `verify_jwt = false`, so a receiver checks the key itself —
 *      `isServiceCall`.
 *   3. supabase-js 2.x sends `Authorization: Bearer <key>` whenever there is no
 *      user session, so a client built with an opaque key would put it on both
 *      headers. `withoutOpaqueBearer` removes that one header and nothing else.
 *
 * FAIL CLOSED. `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` are the only
 * sources. There is no legacy fallback: a missing, empty or malformed variable,
 * or one whose entries are not opaque keys of the right kind, yields `null`, and
 * every caller turns that into its own refusal (`MISSING_SECRET_KEY` /
 * `MISSING_PUBLISHABLE_KEY` below). A legacy JWT is never accepted from either
 * variable and never matched by the receiver.
 *
 * Nothing in the tree reads a legacy key any more, `_shared/paymentSync.ts`'s
 * post-payment kick included. `legacyKeyGuard.test.ts` fails on any legacy read
 * or legacy key JWT outside test files.
 *
 * Pure: Web-standard APIs only, environment read through `globalThis.Deno` so
 * Vitest can execute it (see apiKeys.test.ts).
 */

export interface ApiKey {
  value: string;
}

/** The error a function throws when it has no usable secret key. */
export const MISSING_SECRET_KEY = 'Missing SUPABASE_URL / SUPABASE_SECRET_KEYS (no sb_secret_ key)';

/** The error a function throws when it has no usable publishable key. */
export const MISSING_PUBLISHABLE_KEY = 'Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEYS (no sb_publishable_ key)';

function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;
  return deno?.env?.get(name);
}

const SECRET_PREFIX = /^sb_secret_/;
const PUBLISHABLE_PREFIX = /^sb_publishable_/;

/** True for a new-style opaque key. A legacy key is a JWT and never starts with `sb_`. */
export function isOpaqueKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^sb_(?:publishable|secret)_/.test(value);
}

/**
 * Every key of the expected kind in a `SUPABASE_*_KEYS` JSON map, `default`
 * first. Malformed JSON, a non-object, non-string values and values of the wrong
 * kind (a legacy JWT, or a publishable key in the secret map) yield nothing
 * rather than throwing, so the caller reports the key as missing.
 */
function keyMap(name: string, kind: RegExp): string[] {
  const raw = env(name);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const entries = Object.entries(parsed as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === 'string' && kind.test(e[1]),
  );
  entries.sort(([a], [b]) => (a === 'default' ? -1 : b === 'default' ? 1 : 0));
  return entries.map(([, v]) => v);
}

function pick(name: string, kind: RegExp): ApiKey | null {
  const value = keyMap(name, kind)[0];
  return value ? { value } : null;
}

/** The service identity: the `default` secret key. Bypasses RLS. Null when none is configured. */
export function secretKey(): ApiKey | null {
  return pick('SUPABASE_SECRET_KEYS', SECRET_PREFIX);
}

/** The public identity: the `default` publishable key. Null when none is configured. */
export function publishableKey(): ApiKey | null {
  return pick('SUPABASE_PUBLISHABLE_KEYS', PUBLISHABLE_PREFIX);
}

/**
 * Headers that authenticate one of our functions calling another as the
 * service: `apikey` only, per point 1 above.
 */
export function serviceCallHeaders(key: ApiKey): Record<string, string> {
  return { apikey: key.value };
}

/** Constant-time string equality; same contract as `whatsapp.ts`'s. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Did one of OUR functions (or anything else holding the secret key) make this
 * call? True only when `apikey` equals ANY key in `SUPABASE_SECRET_KEYS` — any,
 * not only `default`, so rotating a secret key never strands a sender. The
 * legacy `Authorization: Bearer <service_role>` form is no longer accepted, and
 * a publishable key never matches: it is not in the secret map.
 */
export function isServiceCall(req: Request): boolean {
  const apikey = req.headers.get('apikey') ?? '';
  if (!SECRET_PREFIX.test(apikey)) return false;
  let match = false;
  // Compare against every key without returning early, so the time taken does
  // not reveal which entry (if any) matched.
  for (const candidate of keyMap('SUPABASE_SECRET_KEYS', SECRET_PREFIX)) {
    if (sameSecret(apikey, candidate)) match = true;
  }
  return match;
}

/**
 * A `fetch` for supabase-js that drops `Authorization: Bearer sb_…` — the one
 * header supabase-js adds on its own when a client is built with an opaque key
 * and has no user session. A real user JWT (`Bearer eyJ…`) passes untouched, so
 * a user-scoped client still acts as the user.
 */
export function withoutOpaqueBearer(base: typeof fetch = fetch): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const auth = headers.get('Authorization');
    if (auth && /^Bearer\s+sb_(?:publishable|secret)_/i.test(auth)) headers.delete('Authorization');
    return base(input, { ...init, headers });
  };
}
