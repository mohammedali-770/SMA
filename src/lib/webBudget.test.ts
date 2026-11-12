import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BUDGET, NON_UI_IMAGES, measure, startupFontNames } from '../../scripts/web-budget.mjs';

/*
 * scripts/web-budget.mjs fails `npm run build` when the /app entry, the first
 * load, or a UI image outgrows its threshold. These cases build small synthetic
 * `dist` trees: random bytes do not compress, so a file's brotli size is close
 * to its raw size and each threshold can be crossed deliberately.
 */

const H = 'b156facd087eb9ef4356a53939f0c1e6';
const FONTS_SRC = `export const DESIGN_SYSTEM_FONTS = {
  [fontFamily.ar.regular]: IBMPlexSansArabic_400Regular,
  [fontFamily.en.bold]: IBMPlexSans_700Bold,
};`;
const dirs: string[] = [];

function dist(files: Record<string, number>): string {
  const root = mkdtempSync(join(tmpdir(), 'web-budget-'));
  dirs.push(root);
  for (const [file, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), randomBytes(bytes));
  }
  return root;
}

const BASE = {
  [`app/_expo/static/js/web/entry-${H}.js`]: 1_000,
  [`app/assets/node_modules/@expo-google-fonts/ibm-plex-sans-arabic/400Regular/IBMPlexSansArabic_400Regular.${H}.ttf`]: 1_000,
  [`app/assets/node_modules/@expo-google-fonts/ibm-plex-sans/700Bold/IBMPlexSans_700Bold.${H}.ttf`]: 1_000,
  [`app/assets/node_modules/@expo-google-fonts/ibm-plex-sans/100Thin/IBMPlexSans_100Thin.${H}.ttf`]: 50_000, // exported, never loaded
  [`app/assets/assets/logo-mark.${H}.png`]: 1_000,
  'favicon.png': 1_000,
};
const small = { entryBrotli: 10_000, firstLoadBrotli: 20_000, uiImage: 5_000 };

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('startupFontNames', () => {
  it('reads the eight fonts the app registers from the real fonts.ts', () => {
    const src = readFileSync(
      new URL('../../apps/mobile/src/design-system/fonts.ts', import.meta.url),
      'utf8',
    );
    const names = startupFontNames(src);
    expect(names).toHaveLength(8);
    expect(names).toContain('IBMPlexSansArabic_400Regular');
    expect(names).toContain('IBMPlexMono_600SemiBold');
  });
});

describe('measure', () => {
  it('passes a tree within every threshold, counting only start-up fonts', () => {
    const { failures, rows } = measure(dist(BASE), { budget: small, fontsSource: FONTS_SRC });
    expect(failures).toEqual([]);
    const firstLoad = rows.find((r: unknown[]) => String(r[0]).startsWith('first load'));
    expect(firstLoad?.[2]).toBeLessThan(10_000); // the 50 KB unused weight is not counted
  });

  it('fails an oversized entry', () => {
    const tree = dist({ ...BASE, [`app/_expo/static/js/web/entry-${H}.js`]: 12_000 });
    expect(measure(tree, { budget: small, fontsSource: FONTS_SRC }).failures.join()).toMatch(/\/app entry/);
  });

  it('fails an oversized first load even when the entry alone fits', () => {
    const tree = dist({
      ...BASE,
      [`app/assets/node_modules/@expo-google-fonts/ibm-plex-sans/700Bold/IBMPlexSans_700Bold.${H}.ttf`]: 25_000,
    });
    const { failures } = measure(tree, { budget: small, fontsSource: FONTS_SRC });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/first load/);
  });

  it('fails an oversized UI image in either place', () => {
    const a = measure(dist({ ...BASE, [`app/assets/assets/logo-mark.${H}.png`]: 6_000 }), {
      budget: small,
      fontsSource: FONTS_SRC,
    });
    expect(a.failures.join()).toMatch(/logo-mark/);
    const b = measure(dist({ ...BASE, 'icon-512.png': 6_000 }), { budget: small, fontsSource: FONTS_SRC });
    expect(b.failures.join()).toMatch(/icon-512\.png/);
  });

  it('exempts only the named non-UI master', () => {
    expect(Object.keys(NON_UI_IMAGES)).toEqual(['logo.png']);
    const { failures } = measure(dist({ ...BASE, 'logo.png': 6_000 }), {
      budget: small,
      fontsSource: FONTS_SRC,
    });
    expect(failures).toEqual([]);
  });

  it('refuses to pass when an input is missing', () => {
    const noEntry = { ...BASE } as Record<string, number>;
    delete noEntry[`app/_expo/static/js/web/entry-${H}.js`];
    expect(() => measure(dist(noEntry), { budget: small, fontsSource: FONTS_SRC })).toThrow(/entry bundle/);
    expect(() =>
      measure(dist(BASE), {
        budget: small,
        fontsSource: FONTS_SRC.replace('IBMPlexSans_700Bold', 'IBMPlexSans_800X'),
      }),
    ).toThrow(/not in the export/);
    expect(() => measure(dist(BASE), { budget: small, fontsSource: 'nothing here' })).toThrow(
      /no start-up fonts/,
    );
  });
});

describe('the committed thresholds', () => {
  it('match docs/DEPLOY.md, so the documented targets cannot drift from the enforced ones', () => {
    const doc = readFileSync(new URL('../../docs/DEPLOY.md', import.meta.url), 'utf8');
    expect(doc).toContain(`${BUDGET.entryBrotli / 1024} KB`);
    expect(doc).toContain(`${BUDGET.firstLoadBrotli / 1024} KB`);
    expect(doc).toContain(`${BUDGET.uiImage / 1024} KB`);
  });
});
