/**
 * PostgREST over plain `fetch` — no `npm:@supabase/supabase-js`.
 *
 * WHY THIS EXISTS — AND WHY THE ORIGINAL REASON WAS WRONG.
 *
 * This module was written to take `npm:@supabase/supabase-js@2` off
 * `order-intake`'s boot path, on the theory that evaluating that module graph
 * was a large part of the 2351 ms front measured on SM-2026-000073
 * (`isolate_age_ms: 3`, `execution_time_ms 11024` against the handler's own
 * `total_ms 8673`). Imports ARE evaluated before `Deno.serve` registers the
 * handler, so nothing inside the handler can see them, and that made the theory
 * comfortable and unfalsifiable from where anyone was looking.
 *
 * IT IS FALSE, and the disproof was in the same log stream all along — the
 * runtime emits its own `booted` event, and nobody had queried it:
 *
 *     05:19:04  v10  WITH supabase-js     26 ms
 *     05:33:48  v10  WITH supabase-js     23 ms   <- SM-2026-000073 itself
 *     06:52:50  v11  WITHOUT supabase-js  23 ms   <- first boot of a new deploy
 *
 * Identical. Supabase bundles an Edge Function into an eszip at DEPLOY time
 * (hence the `ezbr_sha256` on every deployment), so npm resolution happens then,
 * not at boot; at runtime the whole graph is already inside the bundle and
 * loading it costs ~23 ms either way. Module evaluation was never two seconds,
 * and the 2351 ms front remains UNEXPLAINED.
 *
 * So what is this module for now? Not a boot-time fix — `booted` is unchanged,
 * and no claim that it shrinks boot should be reintroduced. Whether it moves the
 * FULL front is a separate question and is still open: that needs an
 * authenticated order on this version, and the only post-deploy request so far
 * was an `OPTIONS` preflight, which short-circuits before the auth check and
 * touches no database. Unmeasured is not the same as zero, in either direction.
 *
 * What the module does do is keep the hottest customer path free of a dependency
 * it does not need, behind executable tests it never had. That is worth having
 * on its own terms; it is not what it was sold as, and the record says so rather
 * than retro-fitting a better reason.
 *
 * This module is the replacement for the three calls order-intake actually
 * made.
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
 * FIDELITY IS THE POINT. Every behaviour below was read out of package source —
 * `@supabase/postgrest-js` and `@supabase/supabase-js` 2.112.4, from the Deno
 * cache — and not from documentation or memory. Stated precisely, because
 * `npm:@supabase/supabase-js@2` is a FLOATING specifier: it resolves at build
 * time, so which 2.x the deployed function actually bundled is not something
 * this repository records. 2.112.4 is what Deno resolves here and 2.110.0 is
 * what the repo's node_modules holds; the two produce identical requests apart
 * from the version string in `X-Client-Info`. Where a behaviour CHANGED within
 * v2 it is called out in place — `maybeSingle()` is the one that did, at
 * 2.100.1.
 *
 * Where this file deliberately differs it says so in place. The goal of the
 * change that introduced it was to remove ONE thing — the dependency — and to
 * leave every observable behaviour alone.
 *
 * SECRETS. `restProviderConfig` reads `integration_settings.secret_config` with
 * the service-role identity. That value must never be returned to a client, put
 * in a log line, or included in an error. It is the same contract as
 * `getProviderConfig` in `secrets.ts`, which is the supabase-js-based twin of
 * this function; `rest.test.ts` ("the two provider-config readers must not
 * drift") asserts they read the same table, the same columns and the same
 * filter, so they cannot drift apart unnoticed.
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
 * WHY, STATED CORRECTLY — an earlier version of this comment gave a reason that
 * is false, and review caught it. It claimed `select=a, b` is a PostgREST parse
 * error and that forwarding the string unstripped would 400 every checkout. It
 * does not. PostgREST's own parser puts the space character *inside* the
 * identifier charset and then `T.strip`s each identifier
 * (`QueryParams.hs`: `pIdentifierChar = letter <|> digit <|> oneOf "_ $"`), so
 * `select=id, status` parses to the same two columns. That was confirmed
 * read-only against this project's live PostgREST: `select=id, name_en` on
 * `branches` returns 200 with both columns projected correctly, while a genuine
 * parse error still returns PGRST100/400.
 *
 * Strip anyway, for two reasons that ARE true:
 *
 *   1. Fidelity. It is what postgrest-js put on the wire
 *      (`PostgrestQueryBuilder.select`, v2), and the goal of this module is to
 *      change the dependency and nothing else.
 *   2. The tolerance is not general. Whitespace is trimmed only where it is
 *      adjacent to a delimiter; an *internal* space is PRESERVED as part of the
 *      identifier — PostgREST's own doctest parses `identifier with spaces` as
 *      one column name. Today's string is saved only by where its spaces happen
 *      to fall.
 *
 * The correction matters more than the conclusion. Left as it was, a reviewer
 * who checked the claim would have found it false and might reasonably have
 * deleted the stripping — which would then fail SILENTLY on the next select
 * that is shaped differently, rather than loudly on this one.
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
 * still arrives; without it the response carries `order: null` at HTTP 200 —
 * and `placeAndSync` in apps/mobile/src/services/api.ts THROWS on that
 * (`if (!res.order) throw new Error('Order was not created.')`), telling a
 * customer their order failed when it exists. There is no polling fallback for
 * that case; an earlier version of this comment said there was. Tune the retry
 * later, visibly, on its own.
 */
const MAX_RETRIES = 3;
const RETRYABLE_STATUS = [503, 520];
const RETRYABLE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const retryDelayMs = (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `maybeSingle` is applied HERE rather than by the caller, and that placement is
 * load-bearing rather than tidy. In postgrest-js the collapse sits inside the
 * `res.ok` branch of `processResponse` (2.112.4, lines 469-485), so the
 * 404-with-an-array-body case in the `else` branch NEVER reaches it and comes
 * back as a bare `[]` even under `maybeSingle()`. Collapsing afterwards — which
 * an earlier revision of this file did — turns that `[]` into `null`, a
 * divergence the caller can see. Mirroring the structure makes the parity
 * obvious rather than something to re-derive.
 */
async function restFetch(
  target: RestTarget,
  method: 'GET' | 'POST',
  url: URL,
  opts: { body?: unknown; maybeSingle?: boolean } = {},
): Promise<RestResult<unknown>> {
  const { body, maybeSingle = false } = opts;
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
      const err = e as { name?: string; message?: string; code?: string };
      // An abort is the caller's own decision and is never retried, matching
      // postgrest-js — which tests BOTH arms, because runtimes disagree on how
      // they signal it. It still returns as an `error` rather than throwing.
      const abort = err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
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
      let data: unknown = null;
      if (text !== '') {
        try {
          data = JSON.parse(text);
        } catch {
          // postgrest-js reports unparseable success bodies as `{ message: body }`.
          return { data: null, error: { message: text }, status: res.status };
        }
      }
      if (maybeSingle && Array.isArray(data)) {
        if (data.length > 1) {
          return {
            data: null,
            error: {
              code: 'PGRST116',
              details: `Results contain ${data.length} rows, application/vnd.pgrst.object+json requires 1 row`,
              hint: null,
              message: 'JSON object requested, multiple (or no) rows returned',
            },
            status: 406,
          };
        }
        return { data: data.length === 1 ? data[0] : null, error: null, status: res.status };
      }
      return { data, error: null, status: res.status };
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
 * MAYBESINGLE IS A CLIENT-SIDE RULE, not a header. postgrest-js (since 2.100.1)
 * does NOT send `Accept: application/vnd.pgrst.object+json` for `maybeSingle()` —
 * that is `single()`. It requests the ordinary array and then collapses it:
 * one row becomes the object, zero rows become null, and MORE THAN ONE becomes
 * a PGRST116 error with status 406. Sending the object header instead would
 * turn "no such row" into a 406 error, which is the opposite of what
 * `maybeSingle` means and would make a missing order look like a failure.
 *
 * The collapse itself lives in `restFetch`, deliberately — see the note there on
 * why doing it out here silently diverged on the 404-with-array case.
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

  const res = await restFetch(target, 'GET', url, { maybeSingle: true });
  return { data: res.data as T | null, error: res.error, status: res.status };
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
  const res = await restFetch(target, 'POST', url, { body: args });
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
 * hoped about: `rest.test.ts` pins both against each other — same table, same
 * columns, same filter, same `ProviderType` union.
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
