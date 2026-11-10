import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isOpaqueKey,
  isServiceCall,
  publishableKey,
  secretKey,
  serviceCallHeaders,
  withoutOpaqueBearer,
} from './apiKeys.ts';

/**
 * EXECUTABLE tests for the Supabase API-key cut-over helper. apiKeys.ts is
 * Web-standard-only and reads the environment through `globalThis.Deno`, so the
 * real code runs here against a stubbed environment — the four states that
 * matter (legacy only, new only, both, neither) and the malformed ones.
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
  it('uses the legacy keys, unchanged, while no new keys exist', () => {
    stubEnv({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE, SUPABASE_ANON_KEY: LEGACY_ANON });
    expect(secretKey()).toEqual({ value: LEGACY_SERVICE, kind: 'legacy' });
    expect(publishableKey()).toEqual({ value: LEGACY_ANON, kind: 'legacy' });
  });

  it('prefers the `default` new key once the project has one', () => {
    stubEnv({
      SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
      SUPABASE_ANON_KEY: LEGACY_ANON,
      SUPABASE_SECRET_KEYS: JSON.stringify({ rotated: SECRET_ROTATED, default: SECRET }),
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
    });
    expect(secretKey()).toEqual({ value: SECRET, kind: 'opaque' });
    expect(publishableKey()).toEqual({ value: PUBLISHABLE, kind: 'opaque' });
  });

  it('falls back to legacy on an empty, malformed or non-object new variable', () => {
    for (const bad of ['', '{}', 'not json', '[]', '"sb_secret_x"', JSON.stringify({ default: 42 })]) {
      stubEnv({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE, SUPABASE_SECRET_KEYS: bad });
      expect(secretKey(), `SUPABASE_SECRET_KEYS=${bad}`).toEqual({ value: LEGACY_SERVICE, kind: 'legacy' });
    }
  });

  it('returns null when neither exists, so callers keep their own missing-key error', () => {
    stubEnv({});
    expect(secretKey()).toBeNull();
    expect(publishableKey()).toBeNull();
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
  it('are byte-for-byte the old headers for a legacy key', () => {
    expect(serviceCallHeaders({ value: LEGACY_SERVICE, kind: 'legacy' })).toEqual({
      apikey: LEGACY_SERVICE,
      Authorization: `Bearer ${LEGACY_SERVICE}`,
    });
  });

  it('put an opaque key on `apikey` ONLY', () => {
    const h = serviceCallHeaders({ value: SECRET, kind: 'opaque' });
    expect(h).toEqual({ apikey: SECRET });
    expect(Object.keys(h)).not.toContain('Authorization');
  });
});

describe('isServiceCall — the receiver side', () => {
  it('accepts the legacy Bearer service_role form', () => {
    stubEnv({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE });
    expect(isServiceCall(req({ Authorization: `Bearer ${LEGACY_SERVICE}` }))).toBe(true);
  });

  it('accepts an opaque secret on `apikey`, including a non-default (rotated) one', () => {
    stubEnv({
      SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET, rotated: SECRET_ROTATED }),
    });
    expect(isServiceCall(req({ apikey: SECRET }))).toBe(true);
    expect(isServiceCall(req({ apikey: SECRET_ROTATED }))).toBe(true);
  });

  it('accepts BOTH forms during the cut-over, so deploys need not be atomic', () => {
    stubEnv({
      SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
    });
    expect(isServiceCall(req({ Authorization: `Bearer ${LEGACY_SERVICE}` }))).toBe(true);
    expect(isServiceCall(req({ apikey: SECRET }))).toBe(true);
  });

  it('refuses the publishable key, the anon key, a wrong secret, and nothing at all', () => {
    stubEnv({
      SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
      SUPABASE_ANON_KEY: LEGACY_ANON,
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
    });
    expect(isServiceCall(req({ apikey: PUBLISHABLE }))).toBe(false);
    expect(isServiceCall(req({ Authorization: `Bearer ${LEGACY_ANON}`, apikey: LEGACY_ANON }))).toBe(false);
    expect(isServiceCall(req({ apikey: 'sb_secret_wrong00000000000000000' }))).toBe(false);
    expect(isServiceCall(req({ apikey: `${SECRET}x` }))).toBe(false);
    expect(isServiceCall(req({}))).toBe(false);
  });

  it('refuses a legacy key presented on `apikey` alone — the legacy form is the Bearer', () => {
    stubEnv({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE });
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

  it('leaves the legacy Bearer untouched', async () => {
    const h = await sent({ headers: { apikey: LEGACY_SERVICE, Authorization: `Bearer ${LEGACY_SERVICE}` } });
    expect(h.get('Authorization')).toBe(`Bearer ${LEGACY_SERVICE}`);
  });
});
