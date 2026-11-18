import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The public Supabase key the app ships: the publishable key, and nothing else.
 * Step 9 of docs/SUPABASE_API_KEYS.md §3 removed the legacy anon fallback; the
 * cases that pinned it now pin its absence. env.ts reads `process.env` at module
 * load, so each case sets the environment and re-imports the module.
 */

const LEGACY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig';
const PUBLISHABLE = 'sb_publishable_abc123def456';

/** `undefined` removes the variable, which is what a build without the publishable key looks like. */
async function load(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.resetModules();
  return import('./env');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('SUPABASE_PUBLIC_KEY', () => {
  it('is the publishable key', async () => {
    const env = await load({
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    });
    expect(env.SUPABASE_PUBLIC_KEY).toBe(PUBLISHABLE);
    expect(env.isSupabaseConfigured).toBe(true);
  });

  it('NEVER falls back to the legacy anon key: the app reports itself unconfigured', async () => {
    const env = await load({
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: LEGACY,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    });
    expect(env.SUPABASE_PUBLIC_KEY).toBe('');
    expect(env.isSupabaseConfigured).toBe(false);
  });

  it('is empty, and the app reports itself unconfigured, when no key is set', async () => {
    const env = await load({
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    });
    expect(env.SUPABASE_PUBLIC_KEY).toBe('');
    expect(env.isSupabaseConfigured).toBe(false);
  });

  it('treats an empty or non-publishable value as missing rather than shipping it', async () => {
    for (const value of ['', '  ', LEGACY, 'sb_secret_abc123']) {
      const env = await load({
        EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: LEGACY,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: value,
      });
      expect(env.SUPABASE_PUBLIC_KEY, value).toBe('');
      expect(env.isSupabaseConfigured, value).toBe(false);
    }
  });
});

describe('the key is read in the shape Expo inlines', () => {
  const src = () => readFileSync(resolve(__dirname, 'env.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('uses a direct process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY member expression', () => {
    expect(src()).toMatch(/process\.env\.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY\b/);
  });

  it('does not read the legacy anon variable at all', () => {
    expect(src()).not.toMatch(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

describe('eas.json ships the publishable key in every build profile', () => {
  const eas = JSON.parse(readFileSync(resolve(__dirname, '../../eas.json'), 'utf8')) as {
    build: Record<string, { env?: Record<string, string> }>;
  };

  for (const profile of ['development', 'preview', 'production']) {
    it(`${profile}: a publishable key, never a secret key`, () => {
      const env = eas.build[profile]?.env ?? {};
      const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
      // A secret key here would ship inside every binary; refuse anything but
      // the publishable format, and refuse any sb_secret_ value in any variable.
      expect(key).toMatch(/^sb_publishable_[A-Za-z0-9_-]+$/);
      for (const value of Object.values(env)) expect(value).not.toMatch(/sb_secret_/);
    });
  }

  for (const profile of ['development', 'preview', 'production']) {
    it(`${profile}: no legacy anon key, and no JWT of any kind`, () => {
      const env = eas.build[profile]?.env ?? {};
      expect(Object.keys(env)).not.toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
      for (const value of Object.values(env)) expect(value).not.toMatch(/^eyJ/);
    });
  }

  it('uses the same publishable key in all three profiles', () => {
    const keys = ['development', 'preview', 'production'].map(
      (p) => eas.build[p]?.env?.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
    expect(new Set(keys).size).toBe(1);
  });
});

describe('the /app web export falls back to the same publishable key', () => {
  // apps/mobile/scripts/export-web.js used to fall back to the legacy anon JWT
  // when Vercel set nothing. It now falls back to the publishable key the EAS
  // profiles ship, so /app can never build with a deactivated key.
  const script = readFileSync(resolve(__dirname, '../../scripts/export-web.js'), 'utf8');
  const eas = JSON.parse(readFileSync(resolve(__dirname, '../../eas.json'), 'utf8')) as {
    build: Record<string, { env?: Record<string, string> }>;
  };

  it('defaults EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to the eas.json value', () => {
    const m = script.match(
      /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:\s*process\.env\.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*\|\|\s*'([^']+)'/,
    );
    expect(m?.[1]).toBe(eas.build.production?.env?.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  });

  it('no longer sets or reads the legacy anon variable', () => {
    expect(script).not.toMatch(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
    expect(script).not.toMatch(/eyJhbGci/);
  });
});
