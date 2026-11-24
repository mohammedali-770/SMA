import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyConnectFailure,
  classifyCreateOrderResult,
  lazywaitFetch,
  type LazywaitConfig,
} from './lazywait';

/**
 * F-X09-003. A POS outage used to send EVERY order to confirmation_required,
 * because every thrown fetch error became `status: 0` and `status: 0` is
 * ambiguous. A connection that was never established wrote nothing, so the POS
 * cannot hold the order; that subset is a safe retry. Everything the runtime
 * error does not PROVE stays ambiguous, because a wrong "safe" is a duplicate
 * kitchen ticket.
 */

const err = (message: string, extra: Record<string, unknown> = {}, name = 'TypeError') =>
  Object.assign(new Error(message), { name, ...extra });

const withCause = (message: string, cause: unknown) => Object.assign(new Error(message), { cause });

// Shapes taken from the two runtimes. Node/undici: `fetch failed` with the OS
// error on `cause`. Deno/hyper: the connector failure is named in the message.
const PROVEN: Array<[string, unknown, string]> = [
  [
    'node: ECONNREFUSED',
    withCause('fetch failed', err('connect ECONNREFUSED 127.0.0.1:59999', { code: 'ECONNREFUSED' }, 'Error')),
    'refused',
  ],
  [
    'node: ENOTFOUND',
    withCause('fetch failed', err('getaddrinfo ENOTFOUND pos.invalid', { code: 'ENOTFOUND' }, 'Error')),
    'dns',
  ],
  [
    'node: EAI_AGAIN',
    withCause('fetch failed', err('getaddrinfo EAI_AGAIN pos.invalid', { code: 'EAI_AGAIN' }, 'Error')),
    'dns',
  ],
  [
    'node: cert expired',
    withCause('fetch failed', err('certificate has expired', { code: 'CERT_HAS_EXPIRED' }, 'Error')),
    'tls',
  ],
  [
    'node: aggregate of refusals (dual stack)',
    withCause(
      'fetch failed',
      Object.assign(new Error(''), {
        code: 'ECONNREFUSED',
        errors: [
          err('connect ECONNREFUSED ::1:443', { code: 'ECONNREFUSED' }),
          err('connect ECONNREFUSED 127.0.0.1:443', { code: 'ECONNREFUSED' }),
        ],
      }),
    ),
    'refused',
  ],
  [
    'deno: refused',
    err(
      'error sending request for url (https://pos.example/v1/pos/orders/create?client_id=C): client error (Connect): tcp connect error: Connection refused (os error 111)',
    ),
    'refused',
  ],
  [
    'deno: dns',
    err(
      'error sending request for url (https://pos.example/v1/x): client error (Connect): dns error: failed to lookup address information: Name or service not known',
    ),
    'dns',
  ],
  [
    'deno: tls',
    err(
      'error sending request for url (https://pos.example/v1/x): client error (Connect): invalid peer certificate: UnknownIssuer',
    ),
    'tls',
  ],
  [
    'deno: older hyper wording',
    err(
      'error sending request for url (https://pos.example/v1/x): error trying to connect: tcp connect error: Connection refused (os error 111)',
    ),
    'refused',
  ],
  [
    'deno 2: marker on the cause',
    withCause(
      'error sending request for url (https://pos.example/v1/x)',
      err('client error (Connect)', { cause: err('dns error: failed to lookup address information') }),
    ),
    'dns',
  ],
  [
    'deno: connect failure of an unnamed kind',
    err('error sending request for url (https://pos.example/v1/x): client error (Connect)'),
    'connect',
  ],
];

const STAYS_AMBIGUOUS: Array<[string, unknown]> = [
  ['timeout', err('The signal has been aborted', {}, 'AbortError')],
  [
    'reset after send (node)',
    withCause('fetch failed', err('read ECONNRESET', { code: 'ECONNRESET' }, 'Error')),
  ],
  [
    'socket closed mid-flight (undici)',
    withCause('fetch failed', err('other side closed', { code: 'UND_ERR_SOCKET' }, 'Error')),
  ],
  ['broken pipe', withCause('fetch failed', err('write EPIPE', { code: 'EPIPE' }, 'Error'))],
  [
    'ETIMEDOUT (cannot tell connect from read)',
    withCause('fetch failed', err('connect ETIMEDOUT 10.0.0.1:443', { code: 'ETIMEDOUT' }, 'Error')),
  ],
  [
    'EHOSTUNREACH (may be reported mid-stream)',
    withCause('fetch failed', err('connect EHOSTUNREACH', { code: 'EHOSTUNREACH' }, 'Error')),
  ],
  [
    'deno: send on an established connection',
    err(
      'error sending request for url (https://pos.example/v1/x): client error (SendRequest): connection error: Connection reset by peer (os error 104)',
    ),
  ],
  [
    'deno: body read failure',
    err(
      'error sending request for url (https://pos.example/v1/x): error reading a body from connection: connection closed before message completed',
    ),
  ],
  [
    'deno: connect marker WITH a timeout',
    err(
      'error sending request for url (https://pos.example/v1/x): client error (Connect): connection timed out',
    ),
  ],
  [
    'connect marker mixed with a send-side error',
    err('client error (Connect) ... client error (SendRequest): broken pipe'),
  ],
  [
    'one refusal beside one reset (aggregate)',
    withCause(
      'fetch failed',
      Object.assign(new Error(''), {
        code: 'ECONNREFUSED',
        errors: [
          err('connect ECONNREFUSED ::1:443', { code: 'ECONNREFUSED' }),
          err('read ECONNRESET', { code: 'ECONNRESET' }),
        ],
      }),
    ),
  ],
  ['an unrecognised failure', err('boom')],
  ['bare fetch failed, no cause', err('fetch failed')],
  ['a non-Error throw', 'network down'],
  ['null', null],
  ['undefined', undefined],
];

describe('classifyConnectFailure — only a PROVEN never-connected failure is reported', () => {
  it.each(PROVEN)('%s -> proven', (_n, e, kind) => {
    expect(classifyConnectFailure(e)).toBe(kind);
  });

  it.each(STAYS_AMBIGUOUS)('%s -> null (stays ambiguous)', (_n, e) => {
    expect(classifyConnectFailure(e)).toBeNull();
  });

  it('survives a cyclic cause chain', () => {
    const a: Record<string, unknown> = { message: 'fetch failed' };
    a.cause = a;
    expect(classifyConnectFailure(a)).toBeNull();
  });
});

describe('classifyCreateOrderResult — never-connected is a safe retry, nothing else changes', () => {
  it('a proven never-connected failure is safe_retry', () => {
    expect(
      classifyCreateOrderResult({ status: 0, error: 'connect_failed:refused', neverConnected: true }),
    ).toEqual({ kind: 'safe_retry', reason: 'connect_failed', orderRef: null });
  });

  it('status 0 WITHOUT the proof is still ambiguous, exactly as before', () => {
    expect(classifyCreateOrderResult({ status: 0, error: 'boom' })).toEqual({
      kind: 'ambiguous',
      reason: 'network_error',
      orderRef: null,
      confirmationReason: 'connection',
    });
    expect(classifyCreateOrderResult({ status: 0, error: 'boom', neverConnected: false }).kind).toBe(
      'ambiguous',
    );
  });

  it('a timeout is never read as never-connected, even if the flag were set', () => {
    expect(classifyCreateOrderResult({ status: 0, error: 'timeout', neverConnected: true })).toEqual({
      kind: 'ambiguous',
      reason: 'timeout',
      orderRef: null,
      confirmationReason: 'timeout',
    });
  });

  it('the flag cannot turn a received response into a retry', () => {
    for (const status of [200, 500, 502, 400, 401]) {
      expect(classifyCreateOrderResult({ status, neverConnected: true }).kind).toBe(
        classifyCreateOrderResult({ status }).kind,
      );
    }
  });
});

describe('lazywaitFetch — reports the proof, and only when there is one', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const cfg: LazywaitConfig = {
    baseUrl: 'https://apiv2-dev.lazywait.com/v1',
    clientId: 'CID_1',
    apiToken: 'lw_live_T',
  };

  it('flags a refused connection and drops the URL-bearing runtime message', async () => {
    fetchMock.mockRejectedValueOnce(
      err(
        'error sending request for url (https://apiv2-dev.lazywait.com/v1/pos/orders/create?client_id=CID_1): client error (Connect): tcp connect error: Connection refused (os error 111)',
      ),
    );
    const res = await lazywaitFetch(cfg, { method: 'POST', path: '/pos/orders/create', body: {} });
    expect(res).toMatchObject({
      ok: false,
      status: 0,
      neverConnected: true,
      error: 'connect_failed:refused',
    });
    expect(JSON.stringify(res)).not.toContain('client_id');
    expect(
      classifyCreateOrderResult({
        status: res.status,
        data: res.data,
        error: res.error,
        neverConnected: res.neverConnected,
      }).kind,
    ).toBe('safe_retry');
  });

  it('flags a DNS failure (node shape)', async () => {
    fetchMock.mockRejectedValueOnce(
      withCause('fetch failed', err('getaddrinfo ENOTFOUND x', { code: 'ENOTFOUND' }, 'Error')),
    );
    const res = await lazywaitFetch(cfg, { method: 'POST', path: '/pos/orders/create', body: {} });
    expect(res).toMatchObject({ status: 0, neverConnected: true, error: 'connect_failed:dns' });
  });

  it('does NOT flag a reset after send: no flag, the runtime message is kept', async () => {
    fetchMock.mockRejectedValueOnce(
      withCause('fetch failed', err('read ECONNRESET', { code: 'ECONNRESET' }, 'Error')),
    );
    const res = await lazywaitFetch(cfg, { method: 'POST', path: '/pos/orders/create', body: {} });
    expect(res.status).toBe(0);
    expect(res).not.toHaveProperty('neverConnected');
    expect(res.error).toBe('fetch failed');
    expect(
      classifyCreateOrderResult({
        status: res.status,
        data: res.data,
        error: res.error,
        neverConnected: res.neverConnected,
      }).kind,
    ).toBe('ambiguous');
  });

  it('does NOT flag an AbortError (the timeout may land after the request left)', async () => {
    fetchMock.mockRejectedValueOnce(err('aborted', {}, 'AbortError'));
    const res = await lazywaitFetch(cfg, { method: 'POST', path: '/pos/orders/create', body: {} });
    expect(res).toMatchObject({ status: 0, error: 'timeout' });
    expect(res).not.toHaveProperty('neverConnected');
  });

  it('an AbortError is a timeout even if its text names a connect failure', async () => {
    // The abort timer can fire at any stage; only the AbortError name decides.
    fetchMock.mockRejectedValueOnce(
      err(
        'error sending request: client error (Connect): tcp connect error: Connection refused',
        {},
        'AbortError',
      ),
    );
    const res = await lazywaitFetch(cfg, { method: 'POST', path: '/pos/orders/create', body: {} });
    expect(res).toMatchObject({ status: 0, error: 'timeout' });
    expect(res).not.toHaveProperty('neverConnected');
  });

  it('leaves a successful response untouched', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const res = await lazywaitFetch(cfg, { method: 'GET', path: '/platform/branches' });
    expect(res.ok).toBe(true);
    expect(res).not.toHaveProperty('neverConnected');
  });
});

describe('lazywait-sync hands the proof to the classifier', () => {
  const src = readFileSync(new URL('../lazywait-sync/index.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

  it('passes res.neverConnected into classifyCreateOrderResult', () => {
    expect(src).toMatch(
      /classifyCreateOrderResult\(\{\s*status: res\.status, data: res\.data, error: res\.error, neverConnected: res\.neverConnected,\s*\}\)/,
    );
  });

  it('still routes a safe_retry through the existing branch (no new state invented)', () => {
    expect(src).toContain("if (outcome.kind === 'safe_retry')");
    expect(src).toContain("lazywait_sync_state: 'confirmation_required'");
  });
});
