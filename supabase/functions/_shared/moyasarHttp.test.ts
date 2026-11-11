import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOYASAR_IP_NOT_ALLOWED } from './moyasar.ts';
import { MoyasarProxyError, moyasarFetch, moyasarProxyMode, parseMoyasarProxyUrl } from './moyasarHttp.ts';

/**
 * moyasarHttp.ts reads Deno.env and calls Deno.createHttpClient and fetch, all
 * at call time, so each case stubs exactly those globals and runs the real
 * module. The proxy client is cached per secret value, so every case that
 * counts client creations uses a URL no other case uses.
 */
const INVOICES = 'https://api.moyasar.com/v1/invoices';
const IP_REFUSAL = {
  type: 'authentication_error',
  message: 'This IP Address is not whitelisted to do this operation',
  errors: null,
};

let unique = 0;
function proxyUrl(credentials = 'user:p%40ss'): string {
  unique += 1;
  return `http://${credentials}@proxy-${unique}.example:3128`;
}

function stubRuntime(opts: { proxy?: string; response?: Response; createHttpClient?: unknown }) {
  const client = { close: vi.fn() };
  const createHttpClient = vi.fn(() => client);
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => (key === 'MOYASAR_PROXY_URL' ? opts.proxy : undefined) },
    createHttpClient: 'createHttpClient' in opts ? opts.createHttpClient : createHttpClient,
  });
  const fetchMock = vi.fn(async () => opts.response ?? new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { client, createHttpClient, fetchMock, log };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseMoyasarProxyUrl', () => {
  it('means no proxy when the secret is unset or blank', () => {
    for (const raw of [undefined, null, '', '   '])
      expect(parseMoyasarProxyUrl(raw)).toEqual({ kind: 'direct' });
  });

  it('accepts http and https, and keeps the credentials out of the URL', () => {
    expect(parseMoyasarProxyUrl('http://user:p%40ss@proxy.example:3128')).toEqual({
      kind: 'proxy',
      url: 'http://proxy.example:3128',
      username: 'user',
      password: 'p@ss',
    });
    expect(parseMoyasarProxyUrl(' https://proxy.example ')).toEqual({
      kind: 'proxy',
      url: 'https://proxy.example',
      username: '',
      password: '',
    });
  });

  it('refuses every other value instead of guessing', () => {
    for (const raw of [
      'socks5://proxy.example:1080',
      'ftp://proxy.example',
      'proxy.example:3128',
      'not a url',
      'http://u%zz:p@proxy.example:3128',
    ]) {
      expect(parseMoyasarProxyUrl(raw), raw).toEqual({ kind: 'invalid' });
    }
  });
});

describe('moyasarFetch', () => {
  it('sends a plain request when MOYASAR_PROXY_URL is unset', async () => {
    const { createHttpClient, fetchMock } = stubRuntime({});
    const init = { method: 'GET' };
    await moyasarFetch(INVOICES, init);
    expect(fetchMock).toHaveBeenCalledWith(INVOICES, init);
    expect(createHttpClient).not.toHaveBeenCalled();
    expect(moyasarProxyMode()).toBe('direct');
  });

  it('routes every request through one proxy client, created on first use', async () => {
    const { client, createHttpClient, fetchMock } = stubRuntime({ proxy: proxyUrl() });
    await moyasarFetch(INVOICES, { method: 'POST' });
    await moyasarFetch(INVOICES, { method: 'GET' });
    expect(createHttpClient).toHaveBeenCalledTimes(1);
    const options = createHttpClient.mock.calls[0][0] as { proxy: { url: string; basicAuth: unknown } };
    expect(options.proxy.url).toMatch(/^http:\/\/proxy-\d+\.example:3128$/);
    expect(options.proxy.basicAuth).toEqual({ username: 'user', password: 'p@ss' });
    for (const call of fetchMock.mock.calls) expect((call as unknown[])[1]).toMatchObject({ client });
    expect(moyasarProxyMode()).toBe('proxy');
  });

  it('refuses, sending nothing, when the secret is not an http(s) URL', async () => {
    const secret = 'socks5://user:s3cret@proxy.example:1080';
    const { fetchMock, log } = stubRuntime({ proxy: secret });
    const error = await moyasarFetch(INVOICES).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MoyasarProxyError);
    expect((error as MoyasarProxyError).reason).toBe('moyasar_proxy_invalid');
    expect(fetchMock).not.toHaveBeenCalled();
    const said = `${(error as Error).message} ${JSON.stringify(log.mock.calls)}`;
    expect(said).not.toContain('s3cret');
    expect(said).not.toContain('proxy.example');
    expect(moyasarProxyMode()).toBe('invalid');
  });

  it('refuses, sending nothing, when the runtime cannot build a proxy client', async () => {
    const { fetchMock } = stubRuntime({ proxy: proxyUrl(), createHttpClient: undefined });
    const error = await moyasarFetch(INVOICES).catch((e: unknown) => e);
    expect((error as MoyasarProxyError).reason).toBe('moyasar_proxy_unsupported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never lets the proxy credentials out in an error', async () => {
    const secret = proxyUrl('user:s3cret');
    const { fetchMock } = stubRuntime({ proxy: secret });
    fetchMock.mockRejectedValueOnce(
      new TypeError(`error sending request via ${secret}: user:s3cret refused`),
    );
    const error = (await moyasarFetch(INVOICES).catch((e: unknown) => e)) as Error;
    expect(error.name).toBe('TypeError');
    expect(error.message).not.toContain('s3cret');
    expect(error.message).not.toContain(secret);
    expect(error.message).toContain('refused');
  });

  it('logs an Allowed IPs refusal by name, and hands the response back unread', async () => {
    const { log } = stubRuntime({ response: new Response(JSON.stringify(IP_REFUSAL), { status: 401 }) });
    const res = await moyasarFetch(INVOICES, { method: 'POST' });
    expect(await res.json()).toEqual(IP_REFUSAL);
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0][0]));
    expect(line).toMatchObject({
      event: 'moyasar_request_refused',
      reason: MOYASAR_IP_NOT_ALLOWED,
      via_proxy: false,
      endpoint: 'invoices',
    });
    expect(line.remedy).toContain('MOYASAR_PROXY_URL');
  });

  it('does not mistake a rejected key for a refused address', async () => {
    const badKey = { type: 'authentication_error', message: 'Invalid authorization credentials' };
    const { log } = stubRuntime({ response: new Response(JSON.stringify(badKey), { status: 401 }) });
    const res = await moyasarFetch(INVOICES);
    expect(res.status).toBe(401);
    expect(log).not.toHaveBeenCalled();
  });
});
