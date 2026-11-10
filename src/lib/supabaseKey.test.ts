import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PUBLIC_KEY_ENV_NAMES, publicRestHeaders, publicSupabaseKey } from './supabaseKey';

const LEGACY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig';
const PUBLISHABLE = 'sb_publishable_abc123def456';

describe('publicSupabaseKey', () => {
  it('uses the legacy anon key, unchanged, while no publishable key is configured', () => {
    expect(publicSupabaseKey({ VITE_SUPABASE_ANON_KEY: LEGACY })).toBe(LEGACY);
  });

  it('prefers the publishable key once it is set', () => {
    expect(
      publicSupabaseKey({ VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, VITE_SUPABASE_ANON_KEY: LEGACY }),
    ).toBe(PUBLISHABLE);
  });

  it('treats an empty or whitespace publishable value as unset, not as a key', () => {
    expect(publicSupabaseKey({ VITE_SUPABASE_PUBLISHABLE_KEY: '  ', VITE_SUPABASE_ANON_KEY: LEGACY })).toBe(
      LEGACY,
    );
  });

  it('returns undefined when neither is configured', () => {
    expect(publicSupabaseKey({})).toBeUndefined();
    expect(publicSupabaseKey({ VITE_SUPABASE_ANON_KEY: '' })).toBeUndefined();
  });

  it('names both variables in configuration messages', () => {
    expect(PUBLIC_KEY_ENV_NAMES).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(PUBLIC_KEY_ENV_NAMES).toContain('VITE_SUPABASE_ANON_KEY');
  });
});

describe('publicRestHeaders', () => {
  it('sends the key on apikey only — never as a Bearer token', () => {
    for (const key of [LEGACY, PUBLISHABLE]) {
      const h = publicRestHeaders(key);
      expect(h).toEqual({ apikey: key });
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('authorization');
    }
  });
});

describe('every console key reader goes through the helper', () => {
  // Source-shape checks, because these files are entry points (a Vite config
  // and a page script) that cannot be imported under Vitest. Comments are
  // stripped first so a sentence ABOUT the old header cannot satisfy them.
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const read = (p: string) => strip(readFileSync(resolve(__dirname, '../..', p), 'utf8'));

  for (const file of ['src/lib/supabase.ts', 'src/legal/main.ts', 'vite.config.ts']) {
    it(`${file} resolves the key through publicSupabaseKey`, () => {
      const src = read(file);
      expect(src).toMatch(/publicSupabaseKey\(/);
      // Both variables are read as direct member expressions, which is the only
      // shape Vite replaces at build time.
      expect(src).toMatch(/(?:import\.meta|process)\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/);
      expect(src).toMatch(/(?:import\.meta|process)\.env\.VITE_SUPABASE_ANON_KEY/);
    });
  }

  for (const file of ['src/legal/main.ts', 'vite.config.ts']) {
    it(`${file} sends no Bearer header on its raw PostgREST fetch`, () => {
      const src = read(file);
      expect(src).toMatch(/publicRestHeaders\(/);
      expect(src).not.toMatch(/Authorization:\s*`Bearer/);
    });
  }
});
