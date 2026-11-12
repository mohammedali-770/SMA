import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sourceToRegExp } from '../../e2e/serve-dist.mjs';

/**
 * The e2e server replays vercel.json. It must read every rule the real file
 * uses — including #451's guarded wildcard, which keeps a missing hashed asset
 * from being answered with the HTML shell — and refuse anything else rather
 * than silently misread it.
 */
describe('e2e/serve-dist.mjs source patterns', () => {
  const matches = (source: string, path: string): boolean => (sourceToRegExp(source) as RegExp).test(path);

  it.each([
    ['/app/(.*)', '/app/x', true],
    ['/app/(.*)', '/appx', false],
    ['/app/((?!_expo/|assets/).*)', '/app/select', true],
    ['/app/((?!_expo/|assets/).*)', '/app/assets/a.png', false],
    ['/app/((?!_expo/|assets/).*)', '/app/_expo/static/x.js', false],
    ['/((?!assets/|app/_expo/|app/assets/).*)', '/legal', true],
    ['/((?!assets/|app/_expo/|app/assets/).*)', '/app/select', true],
    ['/((?!assets/|app/_expo/|app/assets/).*)', '/assets/a.js', false],
    ['/((?!assets/|app/_expo/|app/assets/).*)', '/app/assets/a.js', false],
    ['/legal', '/legal', true],
    ['/legal', '/legalx', false],
    ['/a.b', '/aXb', false],
  ])('%s against %s is %s', (source, path, want) => {
    expect(matches(source, path)).toBe(want);
  });

  it.each(['/(.+)', '/:path*', '/((?!a).+)', '/((?!).*)', '/a|b', '/((?!a(b)).*)'])(
    'refuses %s',
    (source) => {
      expect(() => sourceToRegExp(source)).toThrow(/does not model/);
    },
  );

  it('reads every source in the committed vercel.json', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      rewrites?: { source: string }[];
      headers?: { source: string }[];
    };
    const sources = [...(cfg.rewrites ?? []), ...(cfg.headers ?? [])].map((r) => r.source);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(() => sourceToRegExp(source)).not.toThrow();
  });
});
