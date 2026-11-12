import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PostgrestClient } from '@supabase/postgrest-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { READ_TIMEOUT_MS, createReadTimeoutFetch, isTimedRead } from './readTimeoutFetch';

const REST = 'https://example.supabase.co/rest/v1/products?select=*';
const RPC = 'https://example.supabase.co/rest/v1/rpc/place_order';
const FN = 'https://example.supabase.co/functions/v1/order-intake';
const AUTH = 'https://example.supabase.co/auth/v1/user';

type Call = { input: RequestInfo | URL; init?: RequestInit };

/** A fetch that never answers, and rejects as a real one does when aborted. */
function stalledFetch() {
  const calls: Call[] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      const fail = () => {
        const reason = signal.reason;
        reject(reason ?? new DOMException('The operation was aborted.', 'AbortError'));
      };
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail);
    });
  };
  return { impl, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('isTimedRead — the boundary', () => {
  it('times GET and HEAD reads from PostgREST', () => {
    expect(isTimedRead(REST)).toBe(true);
    expect(isTimedRead(REST, { method: 'GET' })).toBe(true);
    expect(isTimedRead(REST, { method: 'head' })).toBe(true);
  });

  it('leaves every write alone, which covers every RPC and order placement', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(isTimedRead(RPC, { method })).toBe(false);
      expect(isTimedRead(REST, { method })).toBe(false);
    }
  });

  it('leaves Edge Functions alone even on GET, so payment and order intake are untouched', () => {
    expect(isTimedRead(FN, { method: 'GET' })).toBe(false);
    expect(isTimedRead(FN, { method: 'POST' })).toBe(false);
  });

  it('leaves auth reads alone', () => {
    expect(isTimedRead(AUTH, { method: 'GET' })).toBe(false);
  });
});

describe('createReadTimeoutFetch', () => {
  it('rejects a stalled read with an AbortError at the timeout, and not before', async () => {
    const { impl } = stalledFetch();
    const f = createReadTimeoutFetch(impl);
    const outcome = f(REST, { method: 'GET' }).then(
      () => 'resolved',
      (e: { name?: string }) => e.name,
    );
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1);
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // AbortError specifically: postgrest-js never retries it, and the app's
    // failure classifier reads it as a timeout.
    expect(await outcome).toBe('AbortError');
  });

  it('uses about twenty seconds', () => {
    expect(READ_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(READ_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('passes a POST through with its arguments untouched and no timer', async () => {
    const { impl, calls } = stalledFetch();
    const f = createReadTimeoutFetch(impl);
    const init = { method: 'POST', body: '{}' };
    void f(RPC, init);
    expect(calls[0].input).toBe(RPC);
    expect(calls[0].init).toBe(init);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes an Edge Function call through untouched', async () => {
    const { impl, calls } = stalledFetch();
    const f = createReadTimeoutFetch(impl);
    const init = { method: 'POST' };
    void f(FN, init);
    expect(calls[0].init).toBe(init);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the read answers', async () => {
    const res = { ok: true } as Response;
    const f = createReadTimeoutFetch(async () => res);
    await expect(f(REST, { method: 'GET' })).resolves.toBe(res);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the read fails for its own reason', async () => {
    const f = createReadTimeoutFetch(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(f(REST, { method: 'GET' })).rejects.toThrow('Network request failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the caller’s other init fields', async () => {
    const { impl, calls } = stalledFetch();
    const f = createReadTimeoutFetch(impl);
    const headers = { apikey: 'k' };
    void f(REST, { method: 'GET', headers });
    expect(calls[0].init?.headers).toBe(headers);
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('still honours a caller’s signal', async () => {
    const { impl } = stalledFetch();
    const f = createReadTimeoutFetch(impl);
    const caller = new AbortController();
    const outcome = f(REST, { method: 'GET', signal: caller.signal }).catch((e: unknown) => e);
    caller.abort(new Error('caller cancelled'));
    expect(await outcome).toEqual(new Error('caller cancelled'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts at once when the caller’s signal is already aborted', async () => {
    const { impl, calls } = stalledFetch();
    const f = createReadTimeoutFetch(impl);
    const caller = new AbortController();
    caller.abort();
    await expect(f(REST, { method: 'GET', signal: caller.signal })).rejects.toBeDefined();
    expect(calls[0].init?.signal?.aborted).toBe(true);
  });
});

// postgrest-js is imported here, against the usual "framework-free imports
// only" rule for mobile tests, because the wrapper's whole value rests on a
// contract of that library: an AbortError is surfaced as `{ error }` and never
// retried. It is plain JavaScript with no React Native import and no network
// access of its own (the fetch is injected), and it resolves to the copy the
// app ships, under apps/mobile/node_modules.
describe('a timed-out catalogue read becomes an error, not a hang', () => {
  it('postgrest-js answers { error } after the timeout and does not retry', async () => {
    const { impl, calls } = stalledFetch();
    const client = new PostgrestClient('https://example.supabase.co/rest/v1', {
      fetch: createReadTimeoutFetch(impl),
    });
    const pending = client.from('products').select('*');
    const result = pending.then((r) => r);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1);
    const { data, error } = await result;
    expect(data).toBeNull();
    // `ok()` in services/api.ts throws on any `error`, which rejects
    // `catalog.all()` and puts CatalogProvider on its error + Retry path.
    expect(error?.message).toMatch(/AbortError/);
    expect(calls).toHaveLength(1);
  });

  it('without the wrapper the same read is still pending well past the timeout', async () => {
    // The measured defect, kept as a control: nothing underneath times out.
    const { impl } = stalledFetch();
    const client = new PostgrestClient('https://example.supabase.co/rest/v1', { fetch: impl });
    let settled = false;
    void client
      .from('products')
      .select('*')
      .then(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS * 5);
    expect(settled).toBe(false);
  });
});

describe('wiring', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = (rel: string) => strip(readFileSync(resolve(__dirname, '..', rel), 'utf8'));

  it('the app’s Supabase client is built with the read timeout as its fetch', () => {
    const src = code('lib/supabase.ts');
    expect(src).toContain("import { readTimeoutFetch } from './readTimeoutFetch';");
    expect(src).toMatch(/global:\s*\{\s*fetch:\s*readTimeoutFetch\s*\}/);
  });

  it('a catalogue failure still reaches the error state CatalogProvider shows with Retry', () => {
    const provider = code('store/CatalogProvider.tsx');
    expect(provider).toMatch(/const raw = await catalog\.all\(\);/);
    expect(provider).toMatch(
      /setErrorKey\(reportFailure\(e, \{ subsystem: 'menu', op: 'load_catalog' \}\)\.messageKey\)/,
    );
    expect(provider).toMatch(/finally \{\s*if \(isCurrent\(\)\) setLoading\(false\);/);
    const select = code('features/order/OrderTypeSelectScreen.tsx');
    expect(select).toMatch(
      /\) : error \? \(\s*<View style=\{styles\.center\}>[\s\S]*?<Button label=\{t\('retry'\)\} onPress=\{reload\}/,
    );
  });
});
