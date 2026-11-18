import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';

import { importPattern, sourceFiles } from '../../scripts/audit-gate.mjs';
import { FORBIDDEN_LIBS, findForbiddenLibs, matchesSignature } from '../../scripts/bundle-forbidden-libs.mjs';

/*
 * Reachability proof for GHSA-fc5q-39xc-vjpf — picomatch, ReDoS through single-branch repeated
 * extglobs, affected <=4.0.7 with no patched release. Both audit gates except it
 * (scripts/audit-web-high.mjs, scripts/audit-mobile-high.mjs) on one argument: picomatch is a
 * build/test-time library that never reaches a shipped bundle. Both gates refuse the exception if
 * this file is deleted or stops naming the advisory. docs/DEPENDENCY_ADVISORIES.md §3.3.
 *
 * The argument is enforced by the bundle scan inside `npm run build`
 * (scripts/bundle-forbidden-libs.mjs), which fails the build — and so every deploy path — if
 * picomatch's code is in any JavaScript it emitted. That scan can only fail if its signatures still
 * match picomatch as it would actually ship, so this file proves, against the INSTALLED trees:
 *
 *   1. the scan knows picomatch, and `npm run build` still runs it;
 *   2. EVERY installed copy of picomatch, in both trees, is recognised when bundled minified —
 *      through each entry point a dependency could import, since the package has no `exports` map
 *      and `lib/parse` (where the extglob analysis lives) can be imported alone;
 *   3. no app source imports picomatch or the globbing libraries that carry it, checked with the
 *      audit gates' own import pattern after a known positive.
 *
 * Installed 2026-11-18: 4.0.5 in the web tree; 4.0.7 hoisted plus two 2.3.2 copies (under
 * micromatch and jest-util) in the mobile tree.
 */

const ROOT = resolve(__dirname, '../..');
const TREES = {
  web: join(ROOT, 'node_modules'),
  mobile: join(ROOT, 'apps/mobile/node_modules'),
} as const;

/** Every directory under `modules` that is an installed picomatch package, nested copies included. */
function picomatchCopies(modules: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      if (name.startsWith('@')) {
        walk(full, depth);
        continue;
      }
      if (name === 'picomatch' && existsSync(join(full, 'package.json'))) out.push(full);
      const nested = join(full, 'node_modules');
      if (existsSync(nested)) walk(nested, depth + 1);
    }
  };
  walk(modules, 0);
  return out.sort();
}

async function minifiedBundleOf(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles.map((f) => f.text).join('\n');
}

// The modules a dependency could bundle on its own. posix.js exists from 3.x on.
const ENTRY_POINTS = ['index.js', 'posix.js', 'lib/picomatch.js', 'lib/parse.js'];

describe('GHSA-fc5q-39xc-vjpf: the bundle scan can see picomatch', () => {
  it('knows picomatch, and npm run build still runs it on dist', () => {
    expect(FORBIDDEN_LIBS.picomatch?.length ?? 0).toBeGreaterThan(0);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toContain('node scripts/bundle-forbidden-libs.mjs dist');
  });

  for (const [tree, modules] of Object.entries(TREES)) {
    describe(`${tree} tree`, () => {
      const copies = picomatchCopies(modules);
      const bundles = new Map<string, string>();

      beforeAll(async () => {
        for (const copy of copies) {
          for (const entry of ENTRY_POINTS) {
            const file = join(copy, entry);
            if (existsSync(file)) bundles.set(file, await minifiedBundleOf(file));
          }
        }
      }, 60_000);

      it('has picomatch installed, or the proof is not running', (ctx) => {
        // A tree that is not installed cannot ship anything, so a developer machine may skip it.
        // CI installs both trees before the unit suite, and there a missing tree must FAIL: a proof
        // that silently ran over nothing would be counted as evidence.
        if (copies.length === 0 && !process.env.CI) ctx.skip(`${tree} tree is not installed`);
        expect(copies.length, `no picomatch found under ${modules}`).toBeGreaterThan(0);
      });

      it('recognises every installed copy through every entry point, signature by signature', (ctx) => {
        if (copies.length === 0) ctx.skip(`${tree} tree is not installed`);
        // index.js and lib/parse.js exist in every line; checking that they were bundled stops an
        // empty map from passing this test on nothing.
        for (const copy of copies) {
          expect(bundles.has(join(copy, 'index.js')), `${copy}/index.js was not bundled`).toBe(true);
          expect(bundles.has(join(copy, 'lib/parse.js')), `${copy}/lib/parse.js was not bundled`).toBe(true);
        }
        for (const [file, text] of bundles) {
          expect(text.length, `bundling ${file} produced nothing`).toBeGreaterThan(500);
          expect(
            findForbiddenLibs(text).map((f) => f.lib),
            file,
          ).toContain('picomatch');
        }
        // Individually, per copy: a reworded message in one release must not hide behind the others.
        // Every signature is checked against the copy's index.js bundle, which loads the whole package.
        for (const copy of copies) {
          const text = bundles.get(join(copy, 'index.js')) ?? '';
          for (const signature of FORBIDDEN_LIBS.picomatch) {
            expect(
              matchesSignature(text, signature),
              `${JSON.stringify(signature)} missing from ${copy}`,
            ).toBe(true);
          }
        }
        // lib/parse.js alone must be caught by a signature from parse.js's OWN source.
        for (const copy of copies) {
          const text = bundles.get(join(copy, 'lib/parse.js')) ?? '';
          expect(text).not.toContain('Expected pattern to be a non-empty string'); // that one is picomatch.js
          expect(findForbiddenLibs(text).map((f) => f.lib)).toContain('picomatch');
        }
      });
    });
  }
});

describe('GHSA-fc5q-39xc-vjpf: no app source imports picomatch or the libraries that carry it', () => {
  // picomatch itself, and the globbing libraries the audit gates bound on its path. Importing any of
  // them from app code is how picomatch would start to ship.
  const CARRIERS = ['picomatch', 'fdir', 'tinyglobby', 'micromatch'];

  it('the import pattern sees a real import (known positive)', (ctx) => {
    const known = join(TREES.web, 'tinyglobby/dist/index.cjs');
    if (!existsSync(known)) ctx.skip('web tree is not installed');
    expect(importPattern('picomatch').test(readFileSync(known, 'utf8'))).toBe(true);
    for (const form of [
      `import pm from 'picomatch';`,
      `import { parse } from "picomatch/lib/parse";`,
      `const pm = require('picomatch');`,
      'const p = await import(`picomatch/posix`);',
      `import 'picomatch';`,
    ])
      expect(importPattern('picomatch').test(form), form).toBe(true);
    for (const lookalike of [
      `import pm from 'picomatch-browser';`,
      `const s = 'picomatch';`,
      `// picomatch is build-time only`,
    ])
      expect(importPattern('picomatch').test(lookalike), lookalike).toBe(false);
  });

  for (const [label, dir, exclude] of [
    ['console (src, excluding tests)', join(ROOT, 'src'), /\.test\.[cm]?[jt]sx?$/],
    ['mobile app (apps/mobile/src)', join(ROOT, 'apps/mobile/src'), null],
  ] as const) {
    it(`${label} imports none of ${CARRIERS.join(', ')}`, () => {
      const files: string[] = sourceFiles(dir, exclude);
      expect(files.length, `no source found under ${dir}`).toBeGreaterThan(50);
      const importers: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        for (const pkg of CARRIERS)
          if (importPattern(pkg).test(text)) importers.push(`${file} imports ${pkg}`);
      }
      expect(importers).toEqual([]);
    });
  }
});
