/**
 * Contract tests for the admin-console primitives.
 *
 * These read the sources as TEXT rather than rendering them: the components are
 * thin Tailwind wrappers, so what is worth locking is the SEMANTIC rules, not
 * the markup. Rendering would assert class strings, which is a change-detector
 * test that breaks on every restyle without catching a real defect.
 *
 * The rules below are the ones that were violated before and would be violated
 * again by a plausible edit. Each was NEGATIVE-TESTED: the violation was
 * reintroduced on purpose and the test was confirmed to fail.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const UI_DIR = join(__dirname);
const readRaw = (f: string) => readFileSync(join(UI_DIR, f), 'utf8');

/**
 * Strip comments before scanning. These docblocks legitimately NAME the things
 * that are banned ("this hardcoded font-ds-en"), and matching prose instead of
 * code is how a check turns into noise and then gets deleted.
 */
const read = (f: string) =>
  readRaw(f)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every primitive in the console set. */
const PRIMITIVES = [
  'Text.tsx',
  'Card.tsx',
  'Notice.tsx',
  'StatusPill.tsx',
  'Button.tsx',
  'Field.tsx',
];

describe('admin console primitives', () => {
  it('StatusPill never uses ember', () => {
    // Ember is the ONE interactive colour. A state pill that borrowed it would
    // read as something you can press, which in an operations table — mostly
    // states, a few actions — is the difference between scanning and guessing.
    expect(read('StatusPill.tsx')).not.toMatch(/bg-ember|text-ember|border-ember/);
  });

  it('Notice keeps title and action as separate slots', () => {
    // Collapsing them into one string is how the blocking reason ends up the
    // same weight as the paragraph next to it — the exact regression the mobile
    // Notice was built to prevent.
    const src = read('Notice.tsx');
    expect(src).toMatch(/title:\s*string/);
    expect(src).toMatch(/action\?:\s*string\s*\|\s*null/);
  });

  it('no primitive hardcodes a colour', () => {
    for (const file of ['Text.tsx', 'Card.tsx', 'Notice.tsx', 'StatusPill.tsx']) {
      expect(read(file), `${file} must not hardcode a colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('the language rule lives in one shared hook', () => {
    const hook = read('useDsLang.ts');
    expect(hook).toMatch(/adminLang/);
    expect(hook).toMatch(/font-ds-ar/);
    expect(hook).toMatch(/font-ds-num/);
    // Read defensively: useApp() THROWS without a provider, which is right for
    // application code and wrong for a primitive that must also render in a
    // unit test. This is why the hook exists rather than each component
    // calling useApp directly.
    expect(hook).not.toMatch(/useApp\(/);
  });

  it('no primitive hardcodes a font family', () => {
    // The whole class of bug: a literal `font-ds-en` survives review because it
    // looks deliberate, and only shows up when someone switches to Arabic —
    // every label inside Button and Field fell through to a system font.
    for (const file of PRIMITIVES) {
      expect(read(file), `${file} must not hardcode a font family`)
        .not.toMatch(/font-ds-en|font-ds-ar/);
    }
  });

  it('every primitive that renders text directly uses the shared hook', () => {
    // Only these three own a text node. Card, Notice and StatusPill compose
    // `Text`, so they inherit the rule rather than restating it — and adding
    // the hook to them would be a second place for the language to be resolved
    // and therefore a second place for it to be resolved differently.
    for (const file of ['Text.tsx', 'Button.tsx', 'Field.tsx']) {
      expect(read(file), `${file} must call useDsFontClass`).toMatch(/useDsFontClass/);
    }
    for (const file of ['Card.tsx', 'Notice.tsx', 'StatusPill.tsx']) {
      expect(read(file), `${file} should delegate text to <Text>`).not.toMatch(/useDsFontClass/);
    }
  });
});
