import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { FunctionsClient } from '@supabase/functions-js';
import { describe, expect, it } from 'vitest';

import { FUNCTION_REGION, regionalFunction } from './functionRegion';

describe('regionalFunction', () => {
  it('pins the call to the database region with the query parameter', () => {
    expect(FUNCTION_REGION).toBe('eu-central-1');
    expect(regionalFunction('payment-initiate')).toBe('payment-initiate?forceFunctionRegion=eu-central-1');
  });

  it('refuses anything that is not a plain function name', () => {
    for (const bad of ['', 'a/b', 'x?y=1', 'Payment', '../evil']) {
      expect(() => regionalFunction(bad)).toThrow();
    }
  });

  // The real client, so a change in how supabase-js builds the URL is caught.
  it('reaches the gateway as ?forceFunctionRegion=… with NO x-region header (web CORS)', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const client = new FunctionsClient('https://project.example/functions/v1', {
      customFetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const h = new Headers(init?.headers);
        const headers: Record<string, string> = {};
        h.forEach((v, k) => { headers[k] = v; });
        seen.push({ url: String(input), headers });
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch,
    });
    const { error } = await client.invoke(regionalFunction('payment-verify'), { body: { a: 1 } });
    expect(error).toBeNull();
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0].url);
    expect(url.pathname).toBe('/functions/v1/payment-verify');
    expect(url.searchParams.get('forceFunctionRegion')).toBe('eu-central-1');
    expect(Object.keys(seen[0].headers)).not.toContain('x-region');
  });
});

describe('every Edge Function call in the app is pinned', () => {
  const root = join(__dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(root);

  it('passes every functions.invoke name through regionalFunction', () => {
    const offenders: string[] = [];
    let calls = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/functions\.invoke\(\s*([^,)]*)/g)) {
        calls += 1;
        if (!m[1].startsWith('regionalFunction(')) offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(calls).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });
});
