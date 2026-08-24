import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire for the Lazywait base-URL fail-closed guard, and
 * honest about being one — same reasoning as `adminAuthWiring.test.ts`.
 *
 * The handlers import Deno-only modules, so Vitest cannot load them and no test
 * can execute their control flow; `deno check` only typechecks. The behavioural
 * coverage of the decision itself lives in `lazywait.test.ts`
 * (`resolveLazywaitBaseUrl`, `lazywaitFetch`) and `lazywaitApi.test.ts`
 * (`createLazywaitApiClient`). What those cannot pin is that each handler
 * actually CALLS the guard, and calls it in the right place.
 *
 * "The right place" is the whole safety property. A missing base URL must be
 * caught BEFORE any order is claimed and BEFORE any request is attempted,
 * because the alternative — letting it reach the transport as `status: 0` —
 * is classified as a retryable/ambiguous NETWORK fault: `classifyLazywaitError`
 * would retry a config typo forever, and `classifyCreateOrderResult` would mark
 * real customer orders `confirmation_required`. So these assertions check
 * ORDERING, not just presence.
 */

function source(fn: string): string {
  return readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
}

/**
 * The same source with comments removed. Needed because these files DOCUMENT
 * the defect they fixed by naming `DEFAULT_BASE_URL` in prose, and an assertion
 * that the fallback is gone would otherwise match the explanation of its
 * removal.
 */
function code(fn: string): string {
  return source(fn)
    .replace(/\/\*[\s\S]*?\*\//g, '')         // block comments, including /** */
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line)) // whole-line // comments
    .join('\n');
}

describe.each(['lazywait-sync', 'lazywait-catalog'])('%s base-URL guard', (fn) => {
  const src = code(fn);

  it('resolves the base URL through the fail-closed helper', () => {
    expect(src).toContain('resolveLazywaitBaseUrl(');
    expect(src).toContain('.base_url');
  });

  it('has no implicit fallback to the production host', () => {
    expect(src).not.toContain('DEFAULT_BASE_URL');
    expect(src).not.toMatch(/base_url\s*\?\?/);
    expect(src).not.toContain('apiv2.lazywait.com');
  });

  it('returns early on an unresolved base URL', () => {
    expect(src).toMatch(/if\s*\(!\w*[Bb]ase\.ok\)/);
    expect(src).toMatch(/return json\([^)]*reason/);
  });

  it('guards BEFORE any request is attempted', () => {
    const guard = src.indexOf('resolveLazywaitBaseUrl(');
    // The first CALL, not the import — `lazywaitFetch<T>(...)` / `lazywaitFetch(...)`.
    const send = src.search(/lazywaitFetch\s*[<(]/);
    expect(guard).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(send);
  });
});

describe('lazywait-sync guards before it claims any order', () => {
  const src = code('lazywait-sync');

  it('the guard precedes claim_lazywait_sync_batch, so a blank config churns no order state', () => {
    const guard = src.indexOf('resolveLazywaitBaseUrl(');
    const claim = src.indexOf('claim_lazywait_sync_batch');
    expect(claim).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(claim);
  });

  it('the guard also precedes the stale reaper — nothing runs on an unconfigured worker', () => {
    const guard = src.indexOf('resolveLazywaitBaseUrl(');
    const reap = src.indexOf('reap_stale_lazywait_syncs');
    expect(reap).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(reap);
  });

  it('the config fault is NOT written as an order-level sync outcome', () => {
    // It is a worker-level refusal. If it ever became a per-order patch it would
    // mass-mutate a queue of real customer orders over an admin typo.
    const guardBlock = src.slice(
      src.indexOf('resolveLazywaitBaseUrl('),
      src.indexOf('claim_lazywait_sync_batch'),
    );
    expect(guardBlock).not.toContain('record_lazywait_sync');
    expect(guardBlock).not.toContain('lazywait_sync_state');
  });

  it('leaves the retry/confirmation classification wiring alone', () => {
    expect(src).toContain('classifyCreateOrderResult(');
    expect(src).toContain('computePosNextAttempt(');
    expect(src).toContain("lazywait_sync_state: 'confirmation_required'");
    expect(src).toContain('begin_lazywait_create_attempt');
  });
});

describe('lazywait-webhook needs no base-URL guard', () => {
  const src = code('lazywait-webhook');

  it('makes no outbound Lazywait call, so it can never substitute the production host', () => {
    expect(src).not.toContain('lazywaitFetch');
    expect(src).not.toContain('DEFAULT_BASE_URL');
    expect(src).not.toContain('base_url');
    expect(src).not.toContain('apiv2');
  });
});

describe('the shared transport is the backstop', () => {
  const src = readFileSync(new URL('./lazywait.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

  it('lazywaitFetch no longer falls back to DEFAULT_BASE_URL', () => {
    expect(src).not.toMatch(/baseUrl\s*\|\|\s*DEFAULT_BASE_URL/);
    expect(src).toContain('throw new LazywaitConfigError(');
  });

  it('DEFAULT_BASE_URL survives as a named constant, referenced by nothing that resolves config', () => {
    expect(src).toContain("export const DEFAULT_BASE_URL = 'https://apiv2.lazywait.com/v1';");
    // The only remaining mentions in code are the declaration itself.
    const mentions = src.match(/DEFAULT_BASE_URL/g) ?? [];
    expect(mentions).toHaveLength(1);
  });
});
