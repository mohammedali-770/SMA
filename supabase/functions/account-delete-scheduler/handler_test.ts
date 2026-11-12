// The account-delete-scheduler handler, executed — not read.
//
//   deno test --no-lock --node-modules-dir=none --allow-env supabase/functions/*/*_test.ts
//
// Every other check on an Edge Function reads its source or runs an extracted
// helper; this calls the real request handler. The gateway is small and sits on
// an authorization boundary — a cron job's Vault secret on one side, the
// service-role key on the other — so each branch is pinned: method, missing
// configuration, missing secret, refused secret, RPC error, the forward in both
// key formats, and an unreachable processor.
//
// NO NETWORK. `fetch` is replaced for each test, so the Supabase RPC and the
// call to account-delete-process are answered here and recorded. The suite is
// run without --allow-net, so a real request would fail with a permission
// error rather than leave the machine.
//
// The file is named `*_test.ts`, not `*.test.ts`, so Vitest (which collects
// supabase/functions/**/*.test.ts) never picks it up.
import { handler } from './handler.ts';

const URL_ = 'https://project.example';
const RPC_PATH = '/rest/v1/rpc/verify_account_deletion_process_secret';
const PROCESS_PATH = '/functions/v1/account-delete-process';
const LEGACY_KEY = 'legacy-service-role-jwt';
const OPAQUE_KEY = 'sb_secret_testonly';
const ENV_NAMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS'];

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

type Responder = (call: Call) => Response | Promise<Response>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

/**
 * Runs `fn` with the given environment and a recording fetch, then puts both
 * back. A path with no responder fails the test: an unexpected request is a
 * finding, not something to answer with a default.
 */
async function withRuntime(
  env: Record<string, string>,
  responders: Record<string, Responder>,
  fn: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const savedEnv = new Map(ENV_NAMES.map((n) => [n, Deno.env.get(n)]));
  const savedFetch = globalThis.fetch;
  const calls: Call[] = [];
  for (const n of ENV_NAMES) Deno.env.delete(n);
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const call: Call = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: await request.text(),
    };
    calls.push(call);
    const responder = responders[new URL(request.url).pathname];
    if (!responder) throw new Error(`unexpected request: ${call.method} ${call.url}`);
    return responder(call);
  };

  try {
    await fn(calls);
  } finally {
    globalThis.fetch = savedFetch;
    for (const [n, v] of savedEnv) {
      if (v === undefined) Deno.env.delete(n);
      else Deno.env.set(n, v);
    }
  }
}

const post = (headers: Record<string, string> = {}) =>
  new Request('https://edge.example/account-delete-scheduler', { method: 'POST', headers });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const LEGACY_ENV = { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY };

Deno.test('OPTIONS answers the CORS preflight and calls nothing', async () => {
  await withRuntime(LEGACY_ENV, {}, async (calls) => {
    const res = await handler(new Request('https://edge.example/x', { method: 'OPTIONS' }));
    assertEquals(res.status, 200, 'status');
    assertEquals(await res.text(), 'ok', 'body');
    assert(
      (res.headers.get('Access-Control-Allow-Headers') ?? '').includes('x-process-secret'),
      'the preflight must allow x-process-secret',
    );
    assertEquals(calls.length, 0, 'requests made');
  });
});

Deno.test('any method but POST is 405 and calls nothing', async () => {
  await withRuntime(LEGACY_ENV, {}, async (calls) => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await handler(
        new Request('https://edge.example/x', { method, headers: { 'x-process-secret': 's' } }),
      );
      assertEquals(res.status, 405, `${method} status`);
      assertEquals(await res.json(), { error: 'Method not allowed' }, `${method} body`);
    }
    assertEquals(calls.length, 0, 'requests made');
  });
});

Deno.test('missing SUPABASE_URL or service key is 503 before anything is read or sent', async () => {
  const partial: Record<string, string>[] = [
    { SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY },
    { SUPABASE_URL: URL_ },
    {},
  ];
  for (const env of partial) {
    await withRuntime(env, {}, async (calls) => {
      const res = await handler(post({ 'x-process-secret': 's' }));
      assertEquals(res.status, 503, `status with ${Object.keys(env).join('+') || 'nothing'} set`);
      assertEquals(await res.json(), { error: 'scheduler_unavailable' }, 'body');
      assertEquals(calls.length, 0, 'requests made');
    });
  }
});

Deno.test('no x-process-secret is 403 without asking the database', async () => {
  await withRuntime(LEGACY_ENV, {}, async (calls) => {
    const res = await handler(post());
    assertEquals(res.status, 403, 'status');
    assertEquals(await res.json(), { error: 'Forbidden' }, 'body');
    assertEquals(calls.length, 0, 'requests made');
  });
});

Deno.test('a secret the RPC refuses is 403, and the processor is never called', async () => {
  await withRuntime(LEGACY_ENV, { [RPC_PATH]: () => jsonResponse(false) }, async (calls) => {
    const res = await handler(post({ 'x-process-secret': 'wrong-secret' }));
    assertEquals(res.status, 403, 'status');
    assertEquals(await res.json(), { error: 'Forbidden' }, 'body');
    assertEquals(
      calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
      [`POST ${RPC_PATH}`],
      'requests made',
    );
    assertEquals(JSON.parse(calls[0].body), { p_secret: 'wrong-secret' }, 'RPC arguments');
  });
});

Deno.test('an RPC error is 403, not a forward', async () => {
  const rpcError = () =>
    jsonResponse({ code: '42501', message: 'permission denied', details: null, hint: null }, 401);
  await withRuntime(LEGACY_ENV, { [RPC_PATH]: rpcError }, async (calls) => {
    const res = await handler(post({ 'x-process-secret': 's' }));
    assertEquals(res.status, 403, 'status');
    assertEquals(calls.length, 1, 'requests made');
  });
});

Deno.test('an RPC answer that is truthy but not `true` is still 403', async () => {
  await withRuntime(LEGACY_ENV, { [RPC_PATH]: () => jsonResponse('true') }, async (calls) => {
    const res = await handler(post({ 'x-process-secret': 's' }));
    assertEquals(res.status, 403, 'status');
    assertEquals(calls.length, 1, 'requests made');
  });
});

Deno.test(
  'an accepted secret forwards to the processor with the legacy key, and relays its answer',
  async () => {
    await withRuntime(
      LEGACY_ENV,
      {
        [RPC_PATH]: () => jsonResponse(true),
        [PROCESS_PATH]: () =>
          new Response('{"processed":2}', {
            status: 207,
            headers: { 'Content-Type': 'application/json; charset=x' },
          }),
      },
      async (calls) => {
        const res = await handler(post({ 'x-process-secret': 'right-secret' }));
        assertEquals(res.status, 207, 'relayed status');
        assertEquals(await res.text(), '{"processed":2}', 'relayed body');
        assertEquals(res.headers.get('Content-Type'), 'application/json; charset=x', 'relayed content type');
        assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*', 'CORS header');

        assertEquals(calls.length, 2, 'requests made');
        const [rpc, forward] = calls;
        assertEquals(rpc.headers.get('Authorization'), `Bearer ${LEGACY_KEY}`, 'RPC bearer (legacy)');
        assertEquals(forward.url, `${URL_}${PROCESS_PATH}`, 'processor URL');
        assertEquals(forward.method, 'POST', 'processor method');
        assertEquals(forward.headers.get('apikey'), LEGACY_KEY, 'processor apikey');
        assertEquals(
          forward.headers.get('Authorization'),
          `Bearer ${LEGACY_KEY}`,
          'processor bearer (legacy)',
        );
        assertEquals(forward.headers.get('x-process-secret'), null, 'the Vault secret is not passed on');
        assertEquals(JSON.parse(forward.body), { source: 'account-delete-scheduler' }, 'processor body');
      },
    );
  },
);

Deno.test('with an opaque secret key, neither request carries it as a bearer', async () => {
  await withRuntime(
    { SUPABASE_URL: URL_, SUPABASE_SECRET_KEYS: JSON.stringify({ default: OPAQUE_KEY }) },
    {
      [RPC_PATH]: () => jsonResponse(true),
      // Bytes, not a string: a string body would get text/plain by default.
      [PROCESS_PATH]: () => new Response(new TextEncoder().encode('done'), { status: 200 }),
    },
    async (calls) => {
      const res = await handler(post({ 'x-process-secret': 'right-secret' }));
      assertEquals(res.status, 200, 'status');
      assertEquals(
        res.headers.get('Content-Type'),
        'application/json',
        'default content type when upstream sets none',
      );
      assertEquals(calls.length, 2, 'requests made');
      for (const call of calls) {
        assertEquals(call.headers.get('apikey'), OPAQUE_KEY, `${new URL(call.url).pathname} apikey`);
        assert(
          !(call.headers.get('Authorization') ?? '').includes(OPAQUE_KEY),
          `${new URL(call.url).pathname} sent the opaque key as a bearer`,
        );
      }
    },
  );
});

Deno.test('an unreachable processor is 502', async () => {
  await withRuntime(
    LEGACY_ENV,
    {
      [RPC_PATH]: () => jsonResponse(true),
      [PROCESS_PATH]: () => {
        throw new TypeError('connection refused');
      },
    },
    async (calls) => {
      const res = await handler(post({ 'x-process-secret': 'right-secret' }));
      assertEquals(res.status, 502, 'status');
      assertEquals(await res.json(), { error: 'processor_unreachable' }, 'body');
      assertEquals(calls.length, 2, 'requests made');
    },
  );
});
