import { afterEach, describe, expect, it, vi } from 'vitest';

import { triggerLazywaitSyncOnce } from './paymentSync.ts';

/**
 * EXECUTABLE tests for the post-payment POS kick, `triggerLazywaitSyncOnce`.
 *
 * Until 2026-11-18 it read `SUPABASE_ANON_KEY` directly and sent it as `apikey`
 * — a key the gateway refuses once the legacy keys are deactivated
 * (docs/SUPABASE_API_KEYS.md §5). It now sends `publishableKey()`, exactly as
 * order-intake's kick does, and skips the kick when there is none: the kick is
 * best-effort and the once-a-minute cron picks the paid order up.
 */

const URL_ = 'https://proj.supabase.co';
const PUBLISHABLE = 'sb_publishable_kick0000';
const LEGACY_ANON = 'eyJhbGciOiJIUzI1NiJ9.legacy-anon.sig';
const SYNC_SECRET = 'sync-secret-fixture';

function stubEnv(vars: Record<string, string | undefined>) {
  vi.stubGlobal('Deno', { env: { get: (k: string) => vars[k] } });
}

/** The one read the kick makes: integration_settings for provider_type = lazywait. */
function adminWith(row: Record<string, unknown> | null) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => query } as unknown as Parameters<typeof triggerLazywaitSyncOnce>[0];
}

const LAZYWAIT_ON = {
  enabled: true,
  provider_name: 'lazywait',
  public_config: {},
  secret_config: { sync_trigger_secret: SYNC_SECRET },
};

function recordFetch(impl?: () => Promise<Response>) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: new Headers(init?.headers) });
      return impl ? impl() : new Response('{}');
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('triggerLazywaitSyncOnce — the post-payment POS kick', () => {
  it('sends the publishable key on `apikey` and the sync secret, and nothing else', async () => {
    stubEnv({ SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }) });
    const calls = recordFetch();
    await triggerLazywaitSyncOnce(adminWith(LAZYWAIT_ON));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${URL_}/functions/v1/lazywait-sync`);
    expect(calls[0].headers.get('apikey')).toBe(PUBLISHABLE);
    expect(calls[0].headers.get('x-sync-secret')).toBe(SYNC_SECRET);
    expect(calls[0].headers.get('Authorization')).toBeNull();
  });

  it('NEVER sends the legacy anon key: with only that set, the kick is skipped', async () => {
    stubEnv({ SUPABASE_URL: URL_, SUPABASE_ANON_KEY: LEGACY_ANON });
    const calls = recordFetch();
    await expect(triggerLazywaitSyncOnce(adminWith(LAZYWAIT_ON))).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('is skipped when Lazywait is off or has no sync secret', async () => {
    stubEnv({ SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }) });
    const calls = recordFetch();
    await triggerLazywaitSyncOnce(adminWith({ ...LAZYWAIT_ON, enabled: false }));
    await triggerLazywaitSyncOnce(adminWith({ ...LAZYWAIT_ON, secret_config: {} }));
    await triggerLazywaitSyncOnce(adminWith(null));
    expect(calls).toHaveLength(0);
  });

  it('never throws, even when the kick itself fails', async () => {
    stubEnv({ SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }) });
    recordFetch(() => Promise.reject(new TypeError('connection refused')));
    await expect(triggerLazywaitSyncOnce(adminWith(LAZYWAIT_ON))).resolves.toBeUndefined();
  });
});
