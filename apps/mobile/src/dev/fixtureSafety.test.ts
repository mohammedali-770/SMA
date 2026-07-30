/**
 * Static safety assertions for the dev fixture mechanism.
 *
 * These read the fixture source files as TEXT rather than importing them, so
 * they hold even for modules that pull in React Native (which the mobile test
 * environment forbids). The point is to make "the fixture cannot reach a real
 * API, Supabase, Lazywait, a payment SDK or order creation" a checked property
 * instead of a claim in a code comment.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DEV_DIR = join(__dirname);
const readRaw = (f: string) => readFileSync(join(DEV_DIR, f), 'utf8');

/**
 * Strip comments before scanning. The docblocks in these files legitimately
 * NAME the things that are forbidden ("no Supabase", "never Math.random") —
 * matching prose instead of code is how a safety check turns into noise and
 * then gets deleted.
 */
const read = (f: string) =>
  readRaw(f)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const FIXTURE_FILES = [
  'FixtureProvider.tsx',
  'fixtureData.ts',
  'fixtureGate.ts',
];

/** Anything that could reach the network, the database or money. */
const FORBIDDEN = [
  { pattern: /from\s+['"][^'"]*services\/api['"]/, label: 'services/api' },
  { pattern: /supabase/i, label: 'supabase' },
  { pattern: /lazywait/i, label: 'lazywait' },
  { pattern: /\bfetch\s*\(/, label: 'fetch(' },
  { pattern: /\btap\b(?!e)/i, label: 'Tap payment provider' },
  { pattern: /placeOrder|createOrder|payment-initiate|checkout-session/i, label: 'order/payment creation' },
];

describe('fixture mechanism cannot reach production systems', () => {
  it.each(FIXTURE_FILES)('%s imports nothing dangerous', (file) => {
    const src = read(file);
    for (const { pattern, label } of FORBIDDEN) {
      expect(pattern.test(src), `${file} must not reference ${label}`).toBe(false);
    }
  });

  it('every fixture mutator is a no-op', () => {
    const src = read('FixtureProvider.tsx');
    // The provider supplies handlers to the real contexts; each must be inert.
    expect(src).toMatch(/const noop = \(\) => \{\};/);
    // No handler may be anything other than `noop` or a pure lookup.
    const handlerAssignments = src.match(/^\s+(addItem|removeLine|incrementLine|decrementLine|clear|setContext|refresh|selectBranch|reload|setNotes):\s*(.+),$/gm) ?? [];
    expect(handlerAssignments.length).toBeGreaterThan(0);
    for (const line of handlerAssignments) {
      expect(line.trim()).toMatch(/:\s*noop,$/);
    }
  });

  it('the provider is itself gated on __DEV__', () => {
    // Read RAW here: the gate is code, and stripping comments would not hide it,
    // but being explicit avoids a future refactor moving it into a comment.
    expect(readRaw('FixtureProvider.tsx')).toMatch(/if \(!__DEV__\)/);
  });

  it('fixture data is deterministic — no clocks, no randomness', () => {
    const src = read('fixtureData.ts');
    expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random/);
  });
});
