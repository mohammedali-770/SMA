import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  callerTarget,
  cleanSelect,
  isRow,
  restProviderConfig,
  restRpc,
  restSelectMaybeSingle,
  serviceTarget,
  type RestTarget,
} from './rest.ts';

/**
 * EXECUTABLE tests, not source-shape tripwires — the distinction is the reason
 * `rest.ts` was written with Web-standard APIs only.
 *
 * Every other guard around order-intake has to assert that the code LOOKS
 * right, because the handler imports Deno-only modules and Vitest cannot run it.
 * `rest.ts` can be run, so the things that would actually break a hand-written
 * PostgREST client are tested against real behaviour: the exact URL, the exact
 * headers, whitespace in `select`, maybeSingle's collapse rule, the error
 * mapping, and the retry policy.
 *
 * The reference for all of it is package source — `@supabase/postgrest-js` and
 * `@supabase/supabase-js` 2.112.4, read from the Deno cache, not from
 * documentation. Not "the package the function was running": `npm:…@2` floats,
 * and which 2.x the deployed bundle contained is recorded nowhere. Where a
 * behaviour changed inside v2 the boundary is named — `maybeSingle()` at
 * 2.100.1 is the one that did.
 */

const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

function stubEnv(overrides: Record<string, string | undefined> = {}) {
  const merged = { ...ENV, ...overrides };
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => (merged[k] === undefined ? undefined : merged[k]) },
  });
}

/** A caller target built without touching the environment. */
const CALLER: RestTarget = {
  baseUrl: 'https://proj.supabase.co',
  apikey: 'anon-key',
  authorization: 'Bearer user-jwt',
  service: false,
};

type Call = { url: string; init: RequestInit };

function mockFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    return next.clone();
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const headerOf = (call: Call, name: string) =>
  (call.init.headers as Record<string, string>)[name];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('cleanSelect — whitespace stripped exactly as postgrest-js stripped it', () => {
  // NOT because PostgREST would reject the unstripped string — it would not, and
  // an earlier comment here claimed otherwise. Its parser has the space
  // character inside the identifier charset and trims each identifier, which was
  // confirmed read-only against live PostgREST. Stripping is fidelity, plus the
  // fact that an INTERNAL space is preserved as part of an identifier, so the
  // tolerance only covers spaces that sit next to a delimiter.
  it('strips every unquoted whitespace character', () => {
    expect(cleanSelect('id, status, order_type')).toBe('id,status,order_type');
    expect(cleanSelect('a(b, c(d, e))')).toBe('a(b,c(d,e))');
    expect(cleanSelect('id,\n  status')).toBe('id,status');
  });

  it('preserves whitespace INSIDE double-quoted identifiers', () => {
    // postgrest-js toggles on `"` and leaves quoted spans alone. A column named
    // `"my column"` is legal PostgREST and must survive.
    expect(cleanSelect('id, "my column", x')).toBe('id,"my column",x');
  });

  it('matches the algorithm postgrest-js applied to the same input', () => {
    // Reimplementation of PostgrestQueryBuilder.select's cleaner, v2, run over
    // the real order-intake column list. If cleanSelect ever drifts, this fails
    // on the exact string that matters. The algorithm is unchanged across every
    // v2 release checked.
      const source = readFileSync(new URL('../order-intake/index.ts', import.meta.url), 'utf8');
    const literal = /const ORDER_SELECT =([\s\S]*?);\n/.exec(source);
    expect(literal, 'ORDER_SELECT literal not found').not.toBeNull();
    // eslint-disable-next-line no-new-func
    const columns = new Function(`return (${(literal as RegExpExecArray)[1]})`)() as string;

    let quoted = false;
    const postgrestJs = columns.split('').map((c) => {
      if (/\s/.test(c) && !quoted) return '';
      if (c === '"') quoted = !quoted;
      return c;
    }).join('');

    expect(cleanSelect(columns)).toBe(postgrestJs);
    expect(cleanSelect(columns)).not.toMatch(/\s/);
    // And the embed survives, which is the part a naive `.replace(/ /g,'')`
    // would also pass while a `.split(',')` normalisation would not.
    expect(cleanSelect(columns)).toContain('order_items(id,name_en,name_ar,unit_price,quantity,order_item_modifiers(id,name_en,name_ar,price))');
  });
});

describe('restSelectMaybeSingle', () => {
  it('builds the PostgREST URL with a stripped select and the filter', async () => {
    const calls = mockFetch([jsonResponse([{ id: 'o1' }])]);
    await restSelectMaybeSingle(CALLER, 'orders', 'id, status', { id: 'eq.o1' });

    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe('https://proj.supabase.co/rest/v1/orders');
    expect(url.searchParams.get('select')).toBe('id,status');
    expect(url.searchParams.get('id')).toBe('eq.o1');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('sends the caller identity, not a key-derived one', async () => {
    const calls = mockFetch([jsonResponse([])]);
    await restSelectMaybeSingle(CALLER, 'orders', 'id', { id: 'eq.o1' });
    expect(headerOf(calls[0], 'apikey')).toBe('anon-key');
    expect(headerOf(calls[0], 'Authorization')).toBe('Bearer user-jwt');
    expect(headerOf(calls[0], 'Accept-Profile')).toBe('public');
    // No Accept override: maybeSingle is a client-side rule, and asking for
    // vnd.pgrst.object+json would turn "no such row" into a 406.
    expect(headerOf(calls[0], 'Accept')).toBeUndefined();
  });

  it('collapses exactly as postgrest-js does: one row -> object', async () => {
    mockFetch([jsonResponse([{ id: 'o1', status: 'pending' }])]);
    const { data, error } = await restSelectMaybeSingle(CALLER, 'orders', 'id', { id: 'eq.o1' });
    expect(error).toBeNull();
    expect(data).toEqual({ id: 'o1', status: 'pending' });
  });

  it('zero rows -> null data and NO error', async () => {
    mockFetch([jsonResponse([])]);
    const { data, error } = await restSelectMaybeSingle(CALLER, 'orders', 'id', { id: 'eq.nope' });
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('more than one row -> PGRST116 at 406, matching postgrest-js', async () => {
    mockFetch([jsonResponse([{ id: 'a' }, { id: 'b' }])]);
    const { data, error, status } = await restSelectMaybeSingle(CALLER, 'orders', 'id', {});
    expect(data).toBeNull();
    expect(error?.code).toBe('PGRST116');
    expect(status).toBe(406);
  });

  it('surfaces a PostgREST error body verbatim', async () => {
    mockFetch([jsonResponse({ code: '42501', message: 'permission denied for table orders', details: null, hint: null }, 403)]);
    const { data, error, status } = await restSelectMaybeSingle(CALLER, 'orders', 'id', {});
    expect(data).toBeNull();
    expect(error?.message).toBe('permission denied for table orders');
    expect(status).toBe(403);
  });
});

describe('isRow — the shape test that `??` cannot do', () => {
  // EXECUTABLE, which is the point. order-intake's fallback decision rests on
  // this predicate, and a source-shape tripwire could only assert that the call
  // is spelled correctly. These assert what it DOES.

  it('accepts a row', () => {
    expect(isRow({ id: 'o1' })).toBe(true);
    expect(isRow({})).toBe(true); // an empty object is still an object
  });

  it('REJECTS an empty array — the case `??` gets wrong', () => {
    // A 404 with an array body comes back as `[]` with NO error, and `[]` is
    // truthy. `data ?? fallback` keeps it; order-intake would then answer with
    // something shaped like a result that has none of a row's fields, and the
    // client would navigate to /receipt/undefined.
    expect(isRow([])).toBe(false);
    expect(isRow([{ id: 'o1' }])).toBe(false);
  });

  it('rejects every other failure shape restSelectMaybeSingle can return', () => {
    expect(isRow(null)).toBe(false);
    expect(isRow(undefined)).toBe(false);
  });

  it('rejects primitives, which a scalar RPC could return', () => {
    for (const v of ['', 'o1', 0, 1, false, true]) {
      expect(isRow(v), JSON.stringify(v)).toBe(false);
    }
  });

  it('agrees with restSelectMaybeSingle end to end on every non-retrying shape', async () => {
    // Run against the real transport, so the table in isRow's own doc comment is
    // verified rather than asserted. The transport-failure row is omitted here
    // ONLY because it pays the genuine 1s/2s/4s retry and would need fake timers;
    // it returns `data: null` and is covered in the retry describe above.
    const cases: Array<[string, () => void, boolean]> = [
      ['one row', () => mockFetch([jsonResponse([{ id: 'o1' }])]), true],
      ['zero rows', () => mockFetch([jsonResponse([])]), false],
      ['PostgREST 4xx', () => mockFetch([jsonResponse({ message: 'nope' }, 403)]), false],
      ['multiple rows (PGRST116)', () => mockFetch([jsonResponse([{ id: 'a' }, { id: 'b' }])]), false],
      ['404 + array body', () => mockFetch([jsonResponse([], 404)]), false],
      ['404 + empty body', () => mockFetch([new Response('', { status: 404 })]), false],
    ];
    for (const [name, arrange, expected] of cases) {
      arrange();
      const { data } = await restSelectMaybeSingle(CALLER, 'orders', 'id', { id: 'eq.o1' });
      expect(isRow(data), name).toBe(expected);
      vi.unstubAllGlobals();
    }
  });
});

describe('filter values cannot escape into the query', () => {
  it('percent-encodes & and = so a value cannot add a clause', () => {
    // Structural, not a validation: `URLSearchParams` encodes the separators,
    // so no filter value can introduce `or=`, `limit=` or a second filter. The
    // ids this module is passed are server-derived uuids today, but the guard
    // that matters is the one that survives somebody later passing something
    // else — and the refactor this blocks is building the query string by
    // concatenation, which would look equivalent and would not be.
    const calls = mockFetch([jsonResponse([])]);
    return restSelectMaybeSingle(CALLER, 'orders', 'id', { id: 'eq.x&or=(id.gt.0)&limit=100' })
      .then(() => {
        const url = new URL(calls[0].url);
        expect([...url.searchParams.keys()].sort()).toEqual(['id', 'select']);
        expect(url.searchParams.get('id')).toBe('eq.x&or=(id.gt.0)&limit=100');
        expect(calls[0].url).toContain('id=eq.x%26or%3D');
      });
  });
});

describe('the two odd 404 shapes postgrest-js special-cases', () => {
  it('a 404 with an ARRAY body is an empty success, and maybeSingle does NOT collapse it', async () => {
    // An embedded-resource miss. The order re-read embeds order_items, so this
    // path is reachable rather than theoretical.
    //
    // The `[]` rather than `null` is the point, and it is not a nicety: in
    // postgrest-js the maybeSingle collapse sits INSIDE the `res.ok` branch of
    // processResponse, while this case is handled in the `else` branch, so the
    // collapse never runs on it. An earlier revision of rest.ts collapsed
    // afterwards and quietly returned `null` here — a divergence the caller can
    // see, in a file whose entire claim is that it changes only the dependency.
    mockFetch([jsonResponse([], 404)]);
    const { data, error, status } = await restSelectMaybeSingle(CALLER, 'orders', 'id', {});
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(status).toBe(200);
  });

  it('a 404 with an EMPTY body carries no error either', async () => {
    mockFetch([new Response('', { status: 404 })]);
    const { error, status } = await restSelectMaybeSingle(CALLER, 'orders', 'id', {});
    expect(error).toBeNull();
    expect(status).toBe(204);
  });

  it('a 404 with an OBJECT body is still an error', async () => {
    mockFetch([jsonResponse({ code: 'PGRST202', message: 'function not found' }, 404)]);
    const { error } = await restRpc(CALLER, 'no_such_fn', {});
    expect(error?.message).toBe('function not found');
  });
});

describe('restRpc', () => {
  it('POSTs named arguments to /rest/v1/rpc/<fn>', async () => {
    const calls = mockFetch([jsonResponse({ id: 'o1' })]);
    await restRpc(CALLER, 'place_customer_order', { p_branch_id: 'b1', p_loyalty_points: 0 });

    expect(calls[0].url).toBe('https://proj.supabase.co/rest/v1/rpc/place_customer_order');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ p_branch_id: 'b1', p_loyalty_points: 0 });
    expect(headerOf(calls[0], 'Content-Type')).toBe('application/json');
    expect(headerOf(calls[0], 'Content-Profile')).toBe('public');
    expect(headerOf(calls[0], 'Authorization')).toBe('Bearer user-jwt');
  });

  it('returns a scalar jsonb result as the object itself, not wrapped', async () => {
    // place_customer_order `returns jsonb`. PostgREST answers with the value.
    mockFetch([jsonResponse({ id: 'o1', total: '68.00' })]);
    const { data } = await restRpc<Record<string, unknown>>(CALLER, 'place_customer_order', {});
    expect(data).toEqual({ id: 'o1', total: '68.00' });
  });

  it('maps a 400 to error.message — the string order-intake returns to the app', async () => {
    mockFetch([jsonResponse({ code: 'P0001', message: 'Branch is closed', details: null, hint: null }, 400)]);
    const { data, error } = await restRpc(CALLER, 'place_customer_order', {});
    expect(data).toBeNull();
    expect(error?.message).toBe('Branch is closed');
  });
});

describe('a transport failure is an error, never a rejection', () => {
  it('a network error on POST resolves with status 0 and a message', async () => {
    // This is the behaviour order-intake depends on: postgrest-js swallowed the
    // throw so checkout answered 400 with a message. Rejecting instead would
    // surface as an unhandled 500 and change what the customer sees.
    mockFetch([new TypeError('network error')]);
    const { data, error, status } = await restRpc(CALLER, 'place_customer_order', {});
    expect(data).toBeNull();
    expect(status).toBe(0);
    expect(error?.message).toContain('network error');
  });

  it('does NOT retry a POST — place_customer_order creates an order', async () => {
    const calls = mockFetch([new TypeError('network error')]);
    await restRpc(CALLER, 'place_customer_order', {});
    expect(calls).toHaveLength(1);
  });

  it('an aborted GET is not retried either — BOTH signalling arms', async () => {
    // postgrest-js tests `name === 'AbortError' || code === 'ABORT_ERR'`,
    // because runtimes disagree on which one they set. Checking only `name`
    // means an abort on one runtime is retried three times with 7 s of sleeps
    // on the customer's awaited path.
    for (const shape of [{ name: 'AbortError' }, { name: 'Error', code: 'ABORT_ERR' }]) {
      const calls = mockFetch([Object.assign(new Error('aborted'), shape)]);
      const { status } = await restSelectMaybeSingle(CALLER, 'orders', 'id', {});
      expect(calls, JSON.stringify(shape)).toHaveLength(1);
      expect(status).toBe(0);
      vi.unstubAllGlobals();
    }
  });
});

describe('retry — replicated from postgrest-js rather than dropped', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  async function runWithTimers<T>(p: Promise<T>): Promise<T> {
    // Four attempts, three sleeps of 1s/2s/4s. Advancing generously is enough
    // because each sleep resolves before the next fetch is issued.
    for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(5_000);
    return p;
  }

  it('retries a GET three times on a network error, then gives up', async () => {
    const calls = mockFetch([new TypeError('boom')]);
    const res = await runWithTimers(restSelectMaybeSingle(CALLER, 'orders', 'id', {}));
    expect(calls).toHaveLength(4);
    expect(res.status).toBe(0);
    expect(headerOf(calls[1], 'X-Retry-Count')).toBe('1');
    expect(headerOf(calls[3], 'X-Retry-Count')).toBe('3');
  });

  it('retries a GET on 503 and succeeds when the next attempt does', async () => {
    const calls = mockFetch([new Response('', { status: 503 }), jsonResponse([{ id: 'o1' }])]);
    const res = await runWithTimers(restSelectMaybeSingle(CALLER, 'orders', 'id', {}));
    expect(calls).toHaveLength(2);
    expect(res.data).toEqual({ id: 'o1' });
  });

  it('honours Retry-After when the server sends one', async () => {
    const calls = mockFetch([
      new Response('', { status: 503, headers: { 'Retry-After': '2' } }),
      jsonResponse([]),
    ]);
    const p = restSelectMaybeSingle(CALLER, 'orders', 'id', {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(1); // still waiting out the 2 s
    await vi.advanceTimersByTimeAsync(1_500);
    await p;
    expect(calls).toHaveLength(2);
  });

  it('does NOT retry a POST on 503 either — the status path, not just transport', async () => {
    // The transport-path test above proves a network error is not retried. This
    // is the other arm: `shouldRetry` gates on the method for status retries
    // too, and a POST retried on a 503 would create a second order.
    const calls = mockFetch([new Response('', { status: 503 }), jsonResponse({ id: 'o1' })]);
    const res = await runWithTimers(restRpc(CALLER, 'place_customer_order', {}));
    expect(calls).toHaveLength(1);
    expect(res.status).toBe(503);
  });

  it('does not retry a status that is not 503/520', async () => {
    const calls = mockFetch([jsonResponse({ message: 'nope' }, 500)]);
    await runWithTimers(restSelectMaybeSingle(CALLER, 'orders', 'id', {}));
    expect(calls).toHaveLength(1);
  });
});

describe('identities', () => {
  beforeEach(() => stubEnv());

  it('callerTarget forwards the request header verbatim and uses the anon key', () => {
    const t = callerTarget('Bearer the-users-jwt');
    expect(t).toEqual({
      baseUrl: 'https://proj.supabase.co',
      apikey: 'anon-key',
      authorization: 'Bearer the-users-jwt',
      service: false,
    });
  });

  it('serviceTarget uses the service key for BOTH headers and flags itself', () => {
    const t = serviceTarget();
    expect(t.apikey).toBe('service-key');
    expect(t.authorization).toBe('Bearer service-key');
    expect(t.service).toBe(true);
  });

  it('never lets the service key become a caller identity', () => {
    expect(callerTarget('Bearer u').apikey).not.toBe('service-key');
    expect(callerTarget('Bearer u').authorization).not.toContain('service-key');
  });

  it('trims a trailing slash so the path never doubles up', () => {
    stubEnv({ SUPABASE_URL: 'https://proj.supabase.co/' });
    expect(callerTarget('Bearer u').baseUrl).toBe('https://proj.supabase.co');
  });

  it('throws the SAME messages the supabase-js factories threw', () => {
    // Parity matters: `serviceTarget()` throwing is what order-intake's try/catch
    // is written around, and `callerTarget()` throwing is what a misconfigured
    // environment has always produced.
    stubEnv({ SUPABASE_ANON_KEY: undefined });
    expect(() => callerTarget('Bearer u')).toThrow('Missing SUPABASE_URL / SUPABASE_ANON_KEY');
    stubEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(() => serviceTarget()).toThrow('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  });
});

describe('restProviderConfig', () => {
  const SERVICE: RestTarget = {
    baseUrl: 'https://proj.supabase.co',
    apikey: 'service-key',
    authorization: 'Bearer service-key',
    service: true,
  };

  it('reads the row with the service identity and maps it', async () => {
    const calls = mockFetch([jsonResponse([{
      enabled: true,
      provider_name: 'lazywait',
      public_config: { base_url: 'https://pos.example' },
      secret_config: { sync_trigger_secret: 's3cret' },
    }])]);

    const cfg = await restProviderConfig(SERVICE, 'lazywait');
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/rest/v1/integration_settings');
    expect(url.searchParams.get('select')).toBe('enabled,provider_name,public_config,secret_config');
    expect(url.searchParams.get('provider_type')).toBe('eq.lazywait');
    expect(headerOf(calls[0], 'apikey')).toBe('service-key');
    expect(cfg).toEqual({
      enabled: true,
      providerName: 'lazywait',
      publicConfig: { base_url: 'https://pos.example' },
      secretConfig: { sync_trigger_secret: 's3cret' },
    });
  });

  it('returns null when the provider row is missing', async () => {
    mockFetch([jsonResponse([])]);
    await expect(restProviderConfig(SERVICE, 'lazywait')).resolves.toBeNull();
  });

  it('throws on an error, so the caller decides how to degrade', async () => {
    mockFetch([jsonResponse({ message: 'permission denied' }, 403)]);
    await expect(restProviderConfig(SERVICE, 'lazywait')).rejects.toBeTruthy();
  });

  it('coerces missing json columns to empty objects, like getProviderConfig', async () => {
    mockFetch([jsonResponse([{ enabled: false, provider_name: null, public_config: null, secret_config: null }])]);
    await expect(restProviderConfig(SERVICE, 'lazywait')).resolves.toEqual({
      enabled: false, providerName: null, publicConfig: {}, secretConfig: {},
    });
  });
});

describe('the two provider-config readers must not drift', () => {
  // `secrets.ts` keeps the supabase-js implementation for the other twenty-odd
  // functions; `rest.ts` has the fetch one. Two implementations of one read is
  // a real drift risk, so the shared facts are pinned rather than trusted.
  const secrets = readFileSync(new URL('./secrets.ts', import.meta.url), 'utf8');
  const rest = readFileSync(new URL('./rest.ts', import.meta.url), 'utf8');

  it('read the same table, the same columns and the same filter column', () => {
    expect(secrets).toContain("from('integration_settings')");
    expect(rest).toContain("'integration_settings'");
    expect(secrets).toContain("select('enabled, provider_name, public_config, secret_config')");
    expect(rest).toContain("'enabled, provider_name, public_config, secret_config'");
    expect(secrets).toContain("eq('provider_type', provider)");
    expect(rest).toContain('provider_type: `eq.${provider}`');
  });

  it('declare the same ProviderType union', () => {
    const union = (s: string) => {
      const m = /export type ProviderType =([^;]+);/.exec(s);
      expect(m, 'ProviderType not found').not.toBeNull();
      return (m as RegExpExecArray)[1].split('|').map((p) => p.trim()).filter(Boolean).sort();
    };
    expect(union(rest)).toEqual(union(secrets));
  });

  it('neither of them logs ANYTHING — the only claim worth making here', () => {
    // Deliberately not a keyword check on the word "secret": a blacklist over
    // identifier names is the shape that has already been shown two escapes in
    // this repository. Both readers handle `secret_config`, and neither has any
    // business emitting a log line at all, so the assertion is that there are
    // ZERO console calls in either file. That cannot be dodged by renaming.
    for (const [name, src] of [['secrets.ts', secrets], ['rest.ts', rest]] as const) {
      const logs = src.replace(/\/\*[\s\S]*?\*\//g, '').match(/\bconsole\.\w+\(/g) ?? [];
      expect(logs, `${name} must not log`).toEqual([]);
    }
  });
});
