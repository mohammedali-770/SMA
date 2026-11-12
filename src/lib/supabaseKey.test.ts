import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PUBLIC_KEY_ENV_NAMES,
  missingSupabaseBuildEnv,
  publicRestHeaders,
  publicSupabaseKey,
  supabaseBuildGuard,
} from './supabaseKey';

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

describe('missingSupabaseBuildEnv', () => {
  const URL = 'https://example.supabase.co';

  it('is empty when the URL and either public key are present', () => {
    expect(missingSupabaseBuildEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: LEGACY })).toEqual([]);
    expect(
      missingSupabaseBuildEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE }),
    ).toEqual([]);
  });

  it('names the URL, and the two keys as one entry, when they are absent or blank', () => {
    expect(missingSupabaseBuildEnv({})).toEqual(['VITE_SUPABASE_URL', PUBLIC_KEY_ENV_NAMES]);
    expect(missingSupabaseBuildEnv({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: LEGACY })).toEqual([
      'VITE_SUPABASE_URL',
    ]);
    expect(
      missingSupabaseBuildEnv({
        VITE_SUPABASE_URL: URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: '',
        VITE_SUPABASE_ANON_KEY: ' ',
      }),
    ).toEqual([PUBLIC_KEY_ENV_NAMES]);
  });
});

describe('supabaseBuildGuard', () => {
  const URL = 'https://example.supabase.co';

  it('FAILS a Vercel production build with no Supabase settings', () => {
    const g = supabaseBuildGuard('production', {});
    expect(g.action).toBe('fail');
    expect(g.action !== 'ok' && g.message).toContain('VITE_SUPABASE_URL');
  });

  it('fails a production build missing only the keys', () => {
    expect(supabaseBuildGuard('production', { VITE_SUPABASE_URL: URL }).action).toBe('fail');
  });

  it('only WARNS on a preview build', () => {
    expect(supabaseBuildGuard('preview', {}).action).toBe('warn');
  });

  it('leaves CI and local builds alone (no VERCEL_ENV), and a development deploy', () => {
    expect(supabaseBuildGuard(undefined, {}).action).toBe('ok');
    expect(supabaseBuildGuard('', {}).action).toBe('ok');
    expect(supabaseBuildGuard('development', {}).action).toBe('ok');
  });

  it('passes a production build that has the URL and either key', () => {
    expect(supabaseBuildGuard('production', { VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: LEGACY }).action).toBe(
      'ok',
    );
    expect(
      supabaseBuildGuard('production', { VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE })
        .action,
    ).toBe('ok');
  });
});

describe('vite.config.ts wires the guard into the build', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const src = strip(readFileSync(resolve(__dirname, '../..', 'vite.config.ts'), 'utf8'));

  it('runs it for builds, with VERCEL_ENV and the env Vite inlines, and throws on fail', () => {
    expect(src).toMatch(/if \(command === 'build'\)/);
    expect(src).toMatch(
      /supabaseBuildGuard\(process\.env\.VERCEL_ENV, loadEnv\(mode, process\.cwd\(\), 'VITE_'\)\)/,
    );
    expect(src).toMatch(/guard\.action === 'fail'\) throw new Error\(guard\.message\)/);
  });
});

describe('the runtime warning', () => {
  it('no longer claims a demo-data fallback, and says requests will fail', () => {
    const src = readFileSync(resolve(__dirname, 'supabase.ts'), 'utf8');
    const start = src.indexOf('console.warn(');
    const warn = src.slice(start, src.indexOf(');', start));
    expect(warn).not.toMatch(/demo data/i);
    expect(warn).toMatch(/will fail/);
  });
});
