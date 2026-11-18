import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isOpaqueKey,
  isServiceCall,
  MISSING_PUBLISHABLE_KEY,
  MISSING_SECRET_KEY,
  publishableKey,
  secretKey,
  serviceCallHeaders,
  withoutOpaqueBearer,
} from './apiKeys.ts';

/**
 * EXECUTABLE tests for the Supabase API-key helper. apiKeys.ts is
 * Web-standard-only and reads the environment through `globalThis.Deno`, so the
 * real code runs here against a stubbed environment.
 *
 * Step 9 of docs/SUPABASE_API_KEYS.md §3 removed the legacy fallback. These
 * cases used to assert that a legacy key was used "unchanged" while no new key
 * existed; they now assert the opposite — a legacy key in the environment is
 * never selected and never accepted, and a missing new key yields null so every
 * caller fails closed.
 */

const LEGACY_SERVICE = 'eyJhbGciOiJIUzI1NiJ9.legacy-service.sig';
const LEGACY_ANON = 'eyJhbGciOiJIUzI1NiJ9.legacy-anon.sig';
const SECRET = 'sb_secret_default0000000000000000';
const SECRET_ROTATED = 'sb_secret_rotated1111111111111111';
const PUBLISHABLE = 'sb_publishable_default000000000000';

function stubEnv(vars: Record<string, string | undefined>) {
  vi.stubGlobal('Deno', { env: { get: (k: string) => vars[k] } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const req = (headers: Record<string, string>) =>
  new Request('https://proj.supabase.co/functions/v1/x', { method: 'POST', headers });

describe('key selection', () => {
  it('uses the `default` new key', () => {
    stubEnv({
      SUPABASE_SECRET_KEYS: JSON.stringify({ rotated: SECRET_ROTATED, default: SECRET }),
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
    });
    expect(secretKey()).toEqual({ value: SECRET });
    expect(publishableKey()).toEqual({ value: PUBLISHABLE });
  });

  it('NEVER falls back to a legacy key, even when one is still in the environment', () => {
    stubEnv({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE, SUPABASE_ANON_KEY: LEGACY_ANON });
    expect(secretKey()).toBeNull();
    expect(publishableKey()).toBeNull();
  });

  it('yields null on an empty, malformed or non-object new variable', () => {
    for (const bad of ['', '{}', 'not json', '[]', '"sb_secret_x"', JSON.stringify({ default: 42 })]) {
      stubEnv({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE, SUPABASE_SECRET_KEYS: bad });
      expect(secretKey(), `SUPABASE_SECRET_KEYS=${bad}`).toBeNull();
    }
  });

  it('ignores an entry of the wrong kind — a legacy JWT, or the other key type', () => {
    stubEnv({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: LEGACY_SERVICE }),
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: SECRET }),
    });
    expect(secretKey()).toBeNull();
    // A secret key in the publishable map must never become the public identity.
    expect(publishableKey()).toBeNull();
  });

  it('takes a valid non-default entry when `default` is of the wrong kind', () => {
    stubEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: LEGACY_SERVICE, rotated: SECRET_ROTATED }) });
    expect(secretKey()).toEqual({ value: SECRET_ROTATED });
  });

  it('returns null when nothing is configured, so callers raise their missing-key error', () => {
    stubEnv({});
    expect(secretKey()).toBeNull();
    expect(publishableKey()).toBeNull();
  });

  it('names the new variables in the missing-key errors, never the legacy ones', () => {
    expect(MISSING_SECRET_KEY).toContain('SUPABASE_SECRET_KEYS');
    expect(MISSING_PUBLISHABLE_KEY).toContain('SUPABASE_PUBLISHABLE_KEYS');
    for (const m of [MISSING_SECRET_KEY, MISSING_PUBLISHABLE_KEY]) {
      expect(m).not.toMatch(/SERVICE_ROLE|ANON/);
    }
  });

  it('recognises only the two opaque prefixes as opaque', () => {
    expect(isOpaqueKey(SECRET)).toBe(true);
    expect(isOpaqueKey(PUBLISHABLE)).toBe(true);
    expect(isOpaqueKey(LEGACY_SERVICE)).toBe(false);
    expect(isOpaqueKey('sb_other_x')).toBe(false);
    expect(isOpaqueKey(null)).toBe(false);
  });
});

describe('outbound service-call headers', () => {
  it('put the secret key on `apikey` ONLY', () => {
    const h = serviceCallHeaders({ value: SECRET });
    expect(h).toEqual({ apikey: SECRET });
    expect(Object.keys(h)).not.toContain('Authorization');
  });
});

describe('isServiceCall — the receiver side', () => {
  it('accepts a secret key on `apikey`, including a non-default (rotated) one', () => {
    stubEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET, rotated: SECRET_ROTATED }) });
    expect(isServiceCall(req({ apikey: SECRET }))).toBe(true);
    expect(isServiceCall(req({ apikey: SECRET_ROTATED }))).toBe(true);
  });

  it('REFUSES the legacy Bearer service_role form, even while the legacy key is in the environment', () => {
    stubEnv({
      SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
    });
    expect(isServiceCall(req({ Authorization: `Bearer ${LEGACY_SERVICE}` }))).toBe(false);
    expect(isServiceCall(req({ Authorization: `Bearer ${LEGACY_SERVICE}`, apikey: LEGACY_SERVICE }))).toBe(false);
    expect(isServiceCall(req({ apikey: LEGACY_SERVICE }))).toBe(false);
  });

  it('refuses the publishable key, the anon key, a wrong secret, and nothing at all', () => {
    stubEnv({
      SUPABASE_ANON_KEY: LEGACY_ANON,
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
    });
    expect(isServiceCall(req({ apikey: PUBLISHABLE }))).toBe(false);
    expect(isServiceCall(req({ Authorization: `Bearer ${LEGACY_ANON}`, apikey: LEGACY_ANON }))).toBe(false);
    expect(isServiceCall(req({ apikey: 'sb_secret_wrong00000000000000000' }))).toBe(false);
    expect(isServiceCall(req({ apikey: `${SECRET}x` }))).toBe(false);
    expect(isServiceCall(req({ Authorization: `Bearer ${SECRET}` }))).toBe(false);
    expect(isServiceCall(req({}))).toBe(false);
  });

  it('refuses a legacy JWT stored in the secret map, so it can never be matched', () => {
    stubEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: LEGACY_SERVICE }) });
    expect(isServiceCall(req({ apikey: LEGACY_SERVICE }))).toBe(false);
  });

  it('refuses everything when no key is configured at all', () => {
    stubEnv({});
    expect(isServiceCall(req({ Authorization: 'Bearer undefined' }))).toBe(false);
    expect(isServiceCall(req({ apikey: SECRET }))).toBe(false);
  });
});

describe('withoutOpaqueBearer — the supabase-js wrapper', () => {
  async function sent(init: RequestInit): Promise<Headers> {
    let seen: Headers | undefined;
    const base = vi.fn(async (_input: RequestInfo | URL, i?: RequestInit) => {
      seen = new Headers(i?.headers);
      return new Response('{}');
    }) as unknown as typeof fetch;
    await withoutOpaqueBearer(base)('https://proj.supabase.co/rest/v1/x', init);
    return seen!;
  }

  it('drops `Authorization: Bearer sb_…` and keeps `apikey`', async () => {
    const h = await sent({ headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } });
    expect(h.get('Authorization')).toBeNull();
    expect(h.get('apikey')).toBe(SECRET);
  });

  it('leaves a real user JWT untouched, so a user client still acts as the user', async () => {
    const userJwt = 'Bearer eyJhbGciOiJFUzI1NiJ9.user.sig';
    const h = await sent({ headers: { apikey: PUBLISHABLE, Authorization: userJwt } });
    expect(h.get('Authorization')).toBe(userJwt);
  });
});
