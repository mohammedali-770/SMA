/**
 * F-X14-004: the console draws status TEXT in the status inks.
 *
 * `contrastContract.test.ts` proves the ink tokens clear WCAG AA; it cannot
 * prove a component uses them. Until 2026-11-24 `StatusPill` and the `Text`
 * success / info / danger tones drew the HUES (`text-mint`, `text-sky`,
 * `text-danger-ds`), which measure 3.01 / 3.63 / 4.23:1 on their own tints at
 * 11.5px, while the contrast test's comment said the opposite. The customer app
 * pins the same thing in `apps/mobile/.../statusInkWiring.test.ts`.
 *
 * Source-level on purpose, comments stripped so prose cannot satisfy a check.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => strip(readFileSync(join(SRC, rel), 'utf8'));

describe('Text tones resolve to the inks', () => {
  const text = read('design-system/ui/Text.tsx');

  it.each([
    ['success', 'text-mint-ink'],
    ['danger', 'text-danger-ink'],
    ['info', 'text-sky-ink'],
  ])("tone '%s' is %s", (tone, cls) => {
    expect(text).toMatch(new RegExp(`${tone}: '${cls}'`));
  });

  it('no tone is a bare hue', () => {
    expect(text).not.toMatch(/'text-(mint|sky|danger-ds)'/);
  });
});

describe('StatusPill draws its label through the Text tones', () => {
  it('has no colour class of its own on the label', () => {
    const pill = read('design-system/ui/StatusPill.tsx');
    expect(pill).toMatch(/<Text variant="caption" tone=\{t\.text\}/);
    expect(pill).not.toMatch(/text-(mint|sky|danger-ds)/);
  });
});

describe('the ink variables exist in both themes', () => {
  it.each([
    ['index.css', ['mint-ink', 'sky-ink', 'danger-ink']],
    ['theme-dark.css', ['mint-ink', 'sky-ink', 'danger-ink']],
  ] as const)('%s defines every ink', (file, names) => {
    const css = readFileSync(join(SRC, file), 'utf8');
    for (const n of names)
      expect(css, `${file} --color-${n}`).toMatch(new RegExp(`--color-${n}:\\s*#[0-9A-Fa-f]{6}`));
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('no TEXT element draws a bare status hue', () => {
  // An ICON may keep the hue: non-text contrast needs 3:1, which the hues meet.
  // So the enclosing tag decides — an upper-case component other than `Text`
  // is an icon in this codebase (lucide), anything else carries words.
  it('every text-mint / text-sky / text-danger-ds sits on an icon', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = strip(readFileSync(file, 'utf8'));
      const re = /(?<![\w-])text-(mint|sky|danger-ds)(?![\w-])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const tag = /<([A-Za-z][A-Za-z0-9]*)[^<]*$/.exec(src.slice(0, m.index))?.[1] ?? '';
        const isIcon = /^[A-Z]/.test(tag) && tag !== 'Text';
        if (!isIcon) offenders.push(`${file.replace(SRC, 'src')}: <${tag}> ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
