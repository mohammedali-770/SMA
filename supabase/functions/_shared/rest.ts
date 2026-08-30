/**
 * PostgREST over plain `fetch` — no `npm:@supabase/supabase-js`.
 *
 * WHY THIS EXISTS. `order-intake` sits on the customer's awaited checkout path,
 * and importing supabase-js cost it a cold start. The imports of an Edge
 * Function are evaluated at ISOLATE BOOT, before `Deno.serve` registers the
 * handler, so nothing inside the handler can see that cost — which is precisely
 * why it went unattributed for so long. It was finally measured on
 * SM-2026-000073 (2026-08-30): `isolate_age_ms: 3` proved the request had paid
 * a cold boot, and `execution_time_ms 11024` against the handler's own
 * `total_ms 8673` put the unobservable front at 2351 ms. The supabase-js module
 * graph is the bulk of it. This module is the replacement for the three calls
 * order-intake actually made.
 *
 * PURITY, in the established style of `lazywaitApi.ts` and `lazywaitCatalog.ts`:
 * Web-standard APIs only — no `npm:` specifiers, and no bare `Deno.*` reference
 * outside the guarded `env()` accessor below. That is not decoration. It means
 * this file runs under Deno in the function AND under Vitest on Node, so the
 * things most likely to break silently in a hand-written PostgREST client — URL
 * construction, whitespace in `select`, maybeSingle semantics, error mapping,
 * retry — are covered by REAL executable tests (`rest.test.ts`) rather than by
 * source-shape tripwires. The wiring tests could only ever assert that the code
 * looks right.
 *
 * FIDELITY IS THE POINT. Every behaviour below was read out of the exact
 * package the function was running, `@supabase/postgrest-js@2.112.4` and
 * `@supabase/supabase-js@2.112.4`, not from documentation or memory. Where this
 * file deliberately differs from that package it says so in place. The goal of
 * the change that introduced it was to remove ONE thing — the dependency — and
 * to leave every observable behaviour alone.
 *
 * SECRETS. `restProviderConfig` reads `integration_settings.secret_config` with
 * the service-role identity. That value must never be returned to a client, put
 * in a log line, or included in an error. It is the same contract as
 * `getProviderConfig` in `secrets.ts`, which is the supabase-js-based twin of
 * this function; `restProviderConfigWiring.test.ts` asserts the two read the
 * same table, columns and filter so they cannot drift apart unnoticed.
 */

// ===========================================================================
// Environment — the ONLY place this module touches a runtime global
// ===========================================================================

/**
 * Read an environment variable without a hard `Deno` reference, so the module
 * still loads under Vitest (where `globalThis.Deno` is undefined and this
 * returns undefined for everything). Tests that need a value stub
 * `globalThis.Deno`.
 */
function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;
  return deno?.env?.get(name);
}

// ===========================================================================
// Identity
// ===========================================================================

/**
 * Who a PostgREST request runs as. The two are NOT interchangeable and the
 * distinction is the whole security model of this file:
 *
 *   caller  — the customer's own `Authorization` header, forwarded verbatim, so
 *             `auth.uid()` and every RLS policy apply exactly as they do from
 *             the app. `place_customer_order` and the order re-read MUST use
 *             this. Running either as `service` would silently disable RLS and
 *             let one customer's request touch another customer's row.
 *   service — the service-role key, which BYPASSES RLS. Used for exactly one
 *             thing here: reading the integration secret, a table the customer
 *             has no grant on at all.
 *
 * `service` is a boolean rather than an inferred property so a test can assert
 * which identity each call site passed.
 */
export interface RestTarget {
  /** Project base URL, no trailing slash. */
  baseUrl: string;
  /** PostgREST `apikey` header. */
  apikey: string;
  /** Full `Authorization` header value, including the `Bearer ` prefix. */
  authorization: string;
  /** True ONLY for the service-role identity. RLS is bypassed. */
  service: boolean;
}

function requireEnv(url: string | undefined, key: string | undefined, message: string): [string, string] {
  if (!url || !key) throw new Error(message);
  return [url.replace(/\/+$/, ''), key];
}

/**
 * Acts AS THE CALLING USER by forwarding their Authorization header, so RLS and
 * auth.uid() apply exactly as they do from the app.
 *
 * Mirrors `userClient()` in `supabaseClient.ts`, including its error message, so
 * a misconfigured environment fails identically either way. supabase-js sends
 * the anon key as `apikey` and lets a caller-supplied `Authorization` win over
 * the key-derived Bearer (`fetchWithAuth` only fills a header that is ABSENT);
 * passing the header through untouched is the same wire result.
 */
export function callerTarget(authHeader: string): RestTarget {
  const [baseUrl, apikey] = requireEnv(
    env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'),
    'Missing SUPABASE_URL / SUPABASE_ANON_KEY',
  );
  return { baseUrl, apikey, authorization: authHeader, service: false };
}

/**
 * SERVER-SIDE ONLY service-role identity. Bypasses RLS. The key comes from the
 * Edge Function environment and MUST NEVER be sent to any client.
 *
 * Mirrors `adminClient()` in `supabaseClient.ts`, error message included — it
 * THROWS on a missing key, and callers that must not fail the request on a
 * misconfigured environment have to keep the call inside their own try.
 */
export function serviceTarget(): RestTarget {
  const [baseUrl, key] = requireEnv(
    env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'),
    'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
  );
  return { baseUrl, apikey: key, authorization: `Bearer ${key}`, service: true };
}

// ===========================================================================
// Result shape — deliberately postgrest-js's, not a nicer one
// ===========================================================================

export interface RestError {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * `{ data, error }`, matching postgrest-js so call sites keep reading the same
 * way. In particular a NETWORK failure is an `error`, never a rejected promise —
 * see `restFetch`.
 */
export interface RestResult<T> {
  data: T | null;
  error: RestError | null;
  /** 0 for a transport-level failure, mirroring postgrest-js. */
  status: number;
}

// ===========================================================================
// select() — whitespace, exactly as postgrest-js strips it
// ===========================================================================

/**
 * Remove whitespace from a `select` column list, ignoring whitespace inside
 * double-quoted identifiers.
 *
 * THIS IS NOT COSMETIC. PostgREST's `select` grammar has no room for spaces;
 * `select=a, b` is a parse error, not a tolerated variant. postgrest-js strips
 * whitespace for you (`PostgrestQueryBuilder.select`, v2.112.4), which is why
 * the order-intake column list could be written across several concatenated
 * lines with a space after every comma and still work. A hand-written client
 * that forwards that string unchanged gets a 400 and returns no order — for
 * every customer, immediately. Byte-for-byte the same algorithm, for that
 * reason.
 */
export function cleanSelect(columns: string): string {
  let quoted = false;
  return columns
    .split('')
    .map((c) => {
      if (/\s/.test(c) && !quoted) return '';
      if (c === '"') quoted = !quoted;
      return c;
    })
    .join('');
}

// ===========================================================================
// Transport
// ===========================================================================

/**
 * postgrest-js retries GET/HEAD/OPTIONS up to three times on a transport error
 * or a 503/520, backing off 1 s, 2 s, 4 s, and it is ON by default (supabase-js
 * passes no `retry` option, and `PostgrestBuilder` defaults it to true). A POST
 * is never retried.
 *
 * Replicated rather than dropped. Removing it would be a second change riding
 * along with the dependency removal, and it would change what a customer sees
 * on a transient 503: today the order re-read retries and the branch number
 * still arrives; without it the response carries `order: null` and the app has
 * to fall back to polling. Tune it later, visibly, on its own.
 */
const MAX_RETRIES = 3;
const RETRYABLE_STATUS = [503, 520];
const RETRYABLE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const retryDelayMs = (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function restFetch(
  target: RestTarget,
  method: 'GET' | 'POST',
  url: URL,
  body?: unknown,
): Promise<RestResult<unknown>> {
  const headers: Record<string, string> = {
    apikey: target.apikey,
    Authorization: target.authorization,
    // supabase-js defaults `db.schema` to 'public' and postgrest-js turns that
    // into Accept-Profile on reads / Content-Profile on writes. 'public' is also
    // PostgREST's default, so this is belt and braces — kept because the point
    // of this module is to change the dependency and nothing else.
    ...(method === 'GET' ? { 'Accept-Profile': 'public' } : { 'Content-Profile': 'public' }),
    ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
    // supabase-js sends its own version string here. This is the one header
    // that deliberately differs: it identifies these requests in the platform
    // logs, which is how the removal can be confirmed to have taken effect on a
    // live request rather than assumed.
    'X-Client-Info': 'sma-edge-rest/1',
  };

  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers: attempt > 0 ? { ...headers, 'X-Retry-Count': String(attempt) } : headers,
        // The bigint replacer is postgrest-js's, kept for parity rather than
        // for a case that can arise here — the arguments this module sends come
        // from `req.json()`, which cannot produce one.
        body: method === 'GET'
          ? undefined
          : JSON.stringify(body ?? {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      });
    } catch (e) {
      const err = e as { name?: string; message?: string };
      // An abort is the caller's own decision and is never retried, matching
      // postgrest-js. It still returns as an `error` rather than throwing.
      const abort = err?.name === 'AbortError';
      if (!abort && RETRYABLE_METHODS.includes(method) && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(attempt));
        attempt += 1;
        continue;
      }
      // A TRANSPORT failure is an `error`, NOT a rejection. postgrest-js
      // swallows the throw and hands back `{ error, status: 0 }`, and
      // order-intake relies on that: it turns the failure into a 400 with a
      // message. Rejecting here instead would surface as an unhandled 500 and
      // change what the app shows the customer.
      return {
        data: null,
        error: { message: `${err?.name ?? 'FetchError'}: ${err?.message ?? ''}`, code: '', details: '', hint: '' },
        status: 0,
      };
    }

    if (
      RETRYABLE_METHODS.includes(method)
      && RETRYABLE_STATUS.includes(res.status)
      && attempt < MAX_RETRIES
    ) {
      const retryAfter = res.headers?.get?.('Retry-After') ?? null;
      const delay = retryAfter !== null
        ? Math.max(0, parseInt(retryAfter, 10) || 0) * 1000
        : retryDelayMs(attempt);
      await res.text();
      await sleep(delay);
      attempt += 1;
      continue;
    }

    const text = await res.text();
    if (res.ok) {
      if (text === '') return { data: null, error: null, status: res.status };
      try {
        return { data: JSON.parse(text), error: null, status: res.status };
      } catch {
        // postgrest-js reports unparseable success bodies as `{ message: body }`.
        return { data: null, error: { message: text }, status: res.status };
      }
    }
    try {
      const parsed = JSON.parse(text);
      // postgrest-js's one odd case, replicated rather than tidied away: a 404
      // whose body is an ARRAY is an embedded-resource miss, not a failure, and
      // it is reported as an empty successful result. Reachable only through an
      // embed — `order_items(...)` in the order re-read is exactly that shape.
      if (Array.isArray(parsed) && res.status === 404) {
        return { data: [] as unknown, error: null, status: 200 };
      }
      return { data: null, error: parsed as RestError, status: res.status };
    } catch {
      // A 404 with an EMPTY body is postgrest-js's 204, carrying no error.
      if (res.status === 404 && text === '') return { data: null, error: null, status: 204 };
      return { data: null, error: { message: text }, status: res.status };
    }
  }
}

// ===========================================================================
// Query helpers
// ===========================================================================

/**
 * `from(table).select(columns).<filters>.maybeSingle()`.
 *
 * MAYBESINGLE IS A CLIENT-SIDE RULE, not a header. postgrest-js v2.112.4 does
 * NOT send `Accept: application/vnd.pgrst.object+json` for `maybeSingle()` —
 * that is `single()`. It requests the ordinary array and then collapses it:
 * one row becomes the object, zero rows become null, and MORE THAN ONE becomes
 * a PGRST116 error with status 406. Sending the object header instead would
 * turn "no such row" into a 406 error, which is the opposite of what
 * `maybeSingle` means and would make a missing order look like a failure.
 */
export async function restSelectMaybeSingle<T>(
  target: RestTarget,
  table: string,
  columns: string,
  filters: Record<string, string>,
): Promise<RestResult<T>> {
  const url = new URL(`${target.baseUrl}/rest/v1/${table}`);
  url.searchParams.set('select', cleanSelect(columns));
  for (const [key, value] of Object.entries(filters)) url.searchParams.append(key, value);

  const res = await restFetch(target, 'GET', url);
  if (res.error) return { data: null, error: res.error, status: res.status };

  const rows = res.data;
  if (!Array.isArray(rows)) return { data: (rows ?? null) as T | null, error: null, status: res.status };
  if (rows.length > 1) {
    return {
      data: null,
      error: {
        code: 'PGRST116',
        details: `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
        hint: null,
        message: 'JSON object requested, multiple (or no) rows returned',
      },
      status: 406,
    };
  }
  return { data: (rows.length === 1 ? rows[0] : null) as T | null, error: null, status: res.status };
}

/**
 * `rpc(fn, args)`.
 *
 * POST to `/rest/v1/rpc/<fn>` with the named arguments as the JSON body — the
 * shape postgrest-js uses whenever `head`/`get` are not requested. A function
 * returning a scalar (`place_customer_order` returns `jsonb`) responds with the
 * value itself, NOT wrapped in an array, so the parsed body is the result.
 *
 * No retry: POST is not idempotent and postgrest-js does not retry it either.
 * That matters more here than anywhere else in this file — `place_customer_order`
 * creates an order.
 */
export async function restRpc<T>(
  target: RestTarget,
  fn: string,
  args: Record<string, unknown>,
): Promise<RestResult<T>> {
  const url = new URL(`${target.baseUrl}/rest/v1/rpc/${fn}`);
  const res = await restFetch(target, 'POST', url, args);
  return { data: res.data as T | null, error: res.error, status: res.status };
}

// ===========================================================================
// Provider config
// ===========================================================================

export type ProviderType = 'payment' | 'sms' | 'push' | 'lazywait' | 'whatsapp' | 'email';

export interface RestProviderConfig {
  enabled: boolean;
  providerName: string | null;
  publicConfig: Record<string, unknown>;
  secretConfig: Record<string, unknown>; // NEVER return this to a client
}

/**
 * The fetch-based twin of `getProviderConfig` in `secrets.ts`: same table, same
 * columns, same filter, same service-role identity, same "returns null when the
 * row is missing" contract.
 *
 * Two implementations of one read is a drift risk, so it is guarded rather than
 * hoped about: `restProviderConfigWiring.test.ts` pins both against each other.
 * The alternative — making `secrets.ts` dependency-free and sharing it — would
 * have put a supabase-js `import type` back into order-intake's import graph,
 * and the property worth having is that NOTHING order-intake imports mentions
 * that package at all. That is mechanically checkable; "the import is erased at
 * build time" is not.
 */
export async function restProviderConfig(
  target: RestTarget,
  provider: ProviderType,
): Promise<RestProviderConfig | null> {
  const { data, error } = await restSelectMaybeSingle<Record<string, unknown>>(
    target,
    'integration_settings',
    'enabled, provider_name, public_config, secret_config',
    { provider_type: `eq.${provider}` },
  );
  if (error) throw error;
  if (!data) return null;
  return {
    enabled: Boolean(data.enabled),
    providerName: (data.provider_name as string | null) ?? null,
    publicConfig: (data.public_config ?? {}) as Record<string, unknown>,
    secretConfig: (data.secret_config ?? {}) as Record<string, unknown>,
  };
}
