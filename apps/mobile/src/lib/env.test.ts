import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The public Supabase key the app ships: publishable once configured, legacy
 * anon until then (docs/SUPABASE_API_KEYS.md). env.ts reads `process.env` at
 * module load, so each case sets the environment and re-imports the module.
 */

const LEGACY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig';
const PUBLISHABLE = 'sb_publishable_abc123def456';

/** `undefined` removes the variable, which is today's state in eas.json. */
async function load(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.resetModules();
  return import('./env');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('SUPABASE_PUBLIC_KEY', () => {
  it('is the legacy anon key, unchanged, while no publishable key is set', async () => {
    const env = await load({
      EXPO_PUBLIC_SUPABASE_ANON_KEY: LEGACY,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    });
    expect(process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.SUPABASE_PUBLIC_KEY).toBe(LEGACY);
  });

  it('is empty, and the app reports itself unconfigured, when neither key is set', async () => {
    const env = await load({
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    });
    expect(env.SUPABASE_PUBLIC_KEY).toBe('');
    expect(env.isSupabaseConfigured).toBe(false);
  });

  it('is the publishable key once it is set', async () => {
    const env = await load({
      EXPO_PUBLIC_SUPABASE_ANON_KEY: LEGACY,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    });
    expect(env.SUPABASE_PUBLIC_KEY).toBe(PUBLISHABLE);
  });

  it('falls back on an EMPTY publishable value rather than shipping no key', async () => {
    const env = await load({
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: LEGACY,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
    });
    expect(env.SUPABASE_PUBLIC_KEY).toBe(LEGACY);
    expect(env.isSupabaseConfigured).toBe(true);
  });
});

describe('the key is read in the shape Expo inlines', () => {
  it('uses direct process.env.EXPO_PUBLIC_* member expressions for both variables', () => {
    const src = readFileSync(resolve(__dirname, 'env.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).toMatch(
      /process\.env\.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*\|\|\s*process\.env\.EXPO_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });
});
