/**
 * Contract tests for the admin-console primitives.
 *
 * These read the sources as TEXT rather than rendering them: the components are
 * thin Tailwind wrappers, so what is worth locking is the SEMANTIC rules, not
 * the markup. Rendering would assert class strings, which is a change-detector
 * test that breaks on every restyle without catching a real defect.
 *
 * The rules below are the ones that were violated before and would be violated
 * again by a plausible edit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const UI_DIR = join(__dirname);
const read = (f: string) => readFileSync(join(UI_DIR, f), 'utf8');

describe('admin console primitives', () => {
  it('StatusPill never uses ember', () => {
    // Ember is the ONE interactive colour. A state pill that borrowed it would
    // read as something you can press, which in an operations table — mostly
    // states, a few actions — is the difference between scanning and guessing.
    const src = read('StatusPill.tsx').replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(src).not.toMatch(/bg-ember|text-ember|border-ember/);
  });

  it('Notice keeps title and action as separate slots', () => {
    // Collapsing them into one string is how the blocking reason ends up the
    // same weight as the legal paragraph next to it — the exact regression the
    // mobile Notice was built to prevent.
    const src = read('Notice.tsx');
    expect(src).toMatch(/title:\s*string/);
    expect(src).toMatch(/action\?:\s*string\s*\|\s*null/);
  });

  it('every console tone maps to a semantic token, never a raw hex', () => {
    for (const file of ['Text.tsx', 'Card.tsx', 'Notice.tsx', 'StatusPill.tsx']) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, ' ');
      expect(src, `${file} must not hardcode a colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('Text resolves its font family from the ACTIVE language', () => {
    // Not from the string's content: an Arabic console must render Arabic copy
    // in IBM Plex Sans Arabic, and hardcoding font-ds-en silently falls back to
    // a system font for every Arabic label.
    const src = read('Text.tsx');
    expect(src).toMatch(/adminLang === 'ar'/);
    expect(src).toMatch(/font-ds-ar/);
    expect(src).toMatch(/font-ds-num/);
  });
});
