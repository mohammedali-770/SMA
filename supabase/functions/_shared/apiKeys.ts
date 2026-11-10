/**
 * Supabase API keys for Edge Functions — the legacy JWT keys AND the new opaque
 * keys, during the cut-over between them.
 *
 * WHY THIS EXISTS. Supabase deprecates the JWT-based `anon` / `service_role`
 * keys "by the end of 2026" and replaces them with opaque `sb_publishable_…` /
 * `sb_secret_…` keys (supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
 * The new keys are NOT JWTs, and that changes three things this codebase relied
 * on:
 *
 *   1. They go on the `apikey` header ONLY. Supabase's migration guide: "Send
 *      publishable and secret keys on the `apikey` header only. If you also
 *      pass the key on the `Authorization: Bearer` header … the platform tries
 *      to parse it as a JWT and rejects the request". (The API-keys page makes an
 *      exception when the bearer exactly equals `apikey`, and the self-hosted
 *      gateway docs say it rebuilds `Authorization` in that case — but the hosted
 *      page also says such a request is "rejected as the value is not a JWT". The
 *      one behaviour every page agrees on is apikey-only, so that is what is sent.)
 *   2. The gateway's `verify_jwt` only understands the legacy keys, and "does
 *      not verify the `apikey` header" for the new ones. Every function that one
 *      of OUR functions calls is already `verify_jwt = false`, so a receiver has
 *      to check the key itself — `isServiceCall`.
 *   3. supabase-js 2.x sends `Authorization: Bearer <key>` whenever there is no
 *      user session, so a client built with an opaque key would put it on both
 *      headers. `withoutOpaqueBearer` removes that one header and nothing else.
 *
 * THE FALLBACK IS THE POINT. Until the owner creates the new keys,
 * `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` are absent or empty, and
 * every function behaves EXACTLY as before — legacy key, same headers, byte for
 * byte. Creating the keys switches senders to the opaque format on their next
 * deploy, and receivers accept both, so deploys need not be atomic.
 *
 * Pure: Web-standard APIs only, environment read through `globalThis.Deno` so
 * Vitest can execute it (see apiKeys.test.ts). Payment functions do not import
 * it — they are frozen (CLAUDE.md §6).
 */

export type KeyKind = 'opaque' | 'legacy';

export interface ApiKey {
  value: string;
  kind: KeyKind;
}

function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;
  return deno?.env?.get(name);
}

/** True for a new-style opaque key. A legacy key is a JWT and never starts with `sb_`. */
export function isOpaqueKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^sb_(?:publishable|secret)_/.test(value);
}

/**
 * Every key in a `SUPABASE_*_KEYS` JSON map, `default` first. Malformed JSON,
 * a non-object, or non-string values yield nothing rather than throwing: a bad
 * new variable must fall back to the legacy key, not take the function down.
 */
function keyMap(name: string): string[] {
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
    (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0,
  );
  entries.sort(([a], [b]) => (a === 'default' ? -1 : b === 'default' ? 1 : 0));
  return entries.map(([, v]) => v);
}

function pick(newVar: string, legacyVar: string): ApiKey | null {
  const opaque = keyMap(newVar)[0];
  if (opaque) return { value: opaque, kind: isOpaqueKey(opaque) ? 'opaque' : 'legacy' };
  const legacy = env(legacyVar);
  return legacy ? { value: legacy, kind: isOpaqueKey(legacy) ? 'opaque' : 'legacy' } : null;
}

/** The service identity: the `default` secret key, else the legacy service_role key. Bypasses RLS. */
export function secretKey(): ApiKey | null {
  return pick('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
}

/** The public identity: the `default` publishable key, else the legacy anon key. */
export function publishableKey(): ApiKey | null {
  return pick('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
}

/**
 * Headers that authenticate one of our functions calling another as the
 * service. Legacy: exactly what every sender sent before (`apikey` +
 * `Authorization: Bearer`). Opaque: `apikey` only, per point 1 above.
 */
export function serviceCallHeaders(key: ApiKey): Record<string, string> {
  return key.kind === 'opaque'
    ? { apikey: key.value }
    : { apikey: key.value, Authorization: `Bearer ${key.value}` };
}

/** Constant-time string equality; same contract as `whatsapp.ts`'s. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Did one of OUR functions (or anything else holding the service key) make
 * this call? Accepts, during the cut-over:
 *   - the legacy form: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`;
 *   - the new form: `apikey` equal to ANY key in `SUPABASE_SECRET_KEYS` — any,
 *     not only `default`, so rotating a secret key never strands a sender.
 * A publishable key never matches: it is not in the secret map.
 */
export function isServiceCall(req: Request): boolean {
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('Authorization') ?? '';
  if (legacy && sameSecret(auth, `Bearer ${legacy}`)) return true;

  const apikey = req.headers.get('apikey') ?? '';
  if (!isOpaqueKey(apikey)) return false;
  let match = false;
  // Compare against every key without returning early, so the time taken does
  // not reveal which entry (if any) matched.
  for (const candidate of keyMap('SUPABASE_SECRET_KEYS')) {
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
