import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FORBIDDEN_LIBS, findForbiddenLibs, scanDirectory } from '../../scripts/bundle-forbidden-libs.mjs';

/*
 * scripts/bundle-forbidden-libs.mjs recognises a library in a shipped bundle by
 * error messages from its own source. A signature that stops matching does not
 * fail anything — the check just passes for ever — so this suite is what keeps
 * the CI step able to fail. It re-bundles each excepted library exactly as it
 * would ship (minified) and requires its signature to survive. If a release
 * rewords a message, this fails before the CI step goes quietly blind.
 *
 * The libraries live in the MOBILE tree, which the unit-test job installs before
 * `npm test` (design-system.yml). A library that is not installed cannot ship,
 * so its positive control is skipped with that reason rather than passing.
 */

const MOBILE_MODULES = resolve(__dirname, '../../apps/mobile/node_modules');
const mobileRequire = createRequire(join(MOBILE_MODULES, 'noop.js'));

function installed(lib: string): boolean {
  try {
    mobileRequire.resolve(`${lib}/package.json`);
    return true;
  } catch {
    return false;
  }
}

/** Bundle `lib` minified, the way it would reach a customer, and return the text. */
async function minifiedBundleOf(lib: string): Promise<string> {
  const result = await build({
    stdin: {
      contents: `import * as m from '${lib}'; globalThis.__probe = m;`,
      resolveDir: MOBILE_MODULES,
      loader: 'js',
    },
    bundle: true,
    minify: true,
    platform: 'node',
    write: false,
    logLevel: 'silent',
    nodePaths: [MOBILE_MODULES],
  });
  return result.outputFiles.map((f) => f.text).join('\n');
}

describe('forbidden-library signatures — positive control', () => {
  const bundles = new Map<string, string>();

  beforeAll(async () => {
    for (const lib of Object.keys(FORBIDDEN_LIBS)) {
      if (installed(lib)) bundles.set(lib, await minifiedBundleOf(lib));
    }
  }, 60_000);

  for (const lib of Object.keys(FORBIDDEN_LIBS)) {
    it(`detects ${lib} in a real minified bundle of it`, (ctx) => {
      if (!installed(lib)) ctx.skip(`${lib} is not installed, so it cannot ship`);
      const text = bundles.get(lib) ?? '';
      // The bundle must be real, or this assertion would pass on nothing.
      expect(text.length).toBeGreaterThan(1000);
      expect(findForbiddenLibs(text).map((f) => f.lib)).toContain(lib);
    });

    it(`every ${lib} signature survives minification individually`, (ctx) => {
      if (!installed(lib)) ctx.skip(`${lib} is not installed, so it cannot ship`);
      // Checked one by one: a dead signature beside a live one would still let
      // the library-level test pass, while quietly shrinking what is caught.
      const text = bundles.get(lib) ?? '';
      for (const signature of FORBIDDEN_LIBS[lib as keyof typeof FORBIDDEN_LIBS]) {
        expect(text, `"${signature}" no longer appears in minified ${lib}`).toContain(signature);
      }
    });
  }

  it('reports braces when micromatch is bundled, because micromatch includes it', (ctx) => {
    if (!installed('micromatch')) ctx.skip('micromatch is not installed');
    const libs = findForbiddenLibs(bundles.get('micromatch') ?? '').map((f) => f.lib);
    expect(libs).toEqual(expect.arrayContaining(['micromatch', 'braces']));
  });
});

/*
 * The package-entry controls above cannot see a piecemeal import: an entry point
 * loads every implementation module, so a signature living in any one of them
 * passes. But `braces` and `node-forge` have no `exports` map, so a dependency
 * may import a single vulnerable module directly — and review on #417 found that
 * `braces/lib/compile` on its own produced no match at all. So each vulnerable
 * module is bundled ALONE, by its subpath, and must still be recognised.
 */
const VULNERABLE_MODULES: ReadonlyArray<readonly [lib: keyof typeof FORBIDDEN_LIBS, specifier: string]> = [
  ['node-forge', 'node-forge/lib/rsa'], // the PKCS#1 v1.5 verifier GHSA-86w9 is about
  ['braces', 'braces/lib/compile'], // the advisory's named sink; contains no literal of its own
  ['braces', 'braces/lib/expand'],
  ['braces', 'braces/lib/parse'],
];

describe('forbidden-library signatures — each vulnerable module imported alone', () => {
  const bundles = new Map<string, string>();

  beforeAll(async () => {
    for (const [lib, specifier] of VULNERABLE_MODULES) {
      if (installed(lib)) bundles.set(specifier, await minifiedBundleOf(specifier));
    }
  }, 60_000);

  for (const [lib, specifier] of VULNERABLE_MODULES) {
    it(`detects ${lib} when only ${specifier} is bundled`, (ctx) => {
      if (!installed(lib)) ctx.skip(`${lib} is not installed, so it cannot ship`);
      const text = bundles.get(specifier) ?? '';
      expect(text.length, `bundling ${specifier} produced nothing`).toBeGreaterThan(500);
      expect(findForbiddenLibs(text).map((f) => f.lib)).toContain(lib);
    });
  }
});

describe('forbidden-library signatures — negative control', () => {
  it('ignores the generic phrases that were rejected as signatures', () => {
    // Any library may say these; matching them would turn CI red for nothing.
    expect(findForbiddenLibs('throw new TypeError("Expected a string")')).toEqual([]);
    expect(findForbiddenLibs('throw new Error(`No matches found for "x"`)')).toEqual([]);
  });

  it('ignores a near-miss of a real signature', () => {
    expect(findForbiddenLibs('ASN.1 parsing error: Max depth exceed')).toEqual([]);
  });

  it('every signature is non-empty and specific enough to mean something', () => {
    // A floor, not a proof of distinctiveness — that was measured per signature
    // (see the comments in bundle-forbidden-libs.mjs). It is set from the two
    // generic phrases that were rejected, 17 and 20 characters, so both stay
    // out; 24 admits the two shorter signatures whose uniqueness across the
    // installed trees was measured rather than assumed (25 and 27 characters).
    const FLOOR = 24;
    expect('Expected a string'.length).toBeLessThan(FLOOR);
    expect('No matches found for'.length).toBeLessThan(FLOOR);
    for (const [lib, signatures] of Object.entries(FORBIDDEN_LIBS)) {
      expect(signatures.length, `${lib} has no signatures`).toBeGreaterThan(0);
      for (const s of signatures)
        expect(s.length, `${lib}: "${s}" is too short to be distinctive`).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});

describe('scanDirectory — fails closed', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bundle-scan-'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('refuses a directory that does not exist', () => {
    expect(() => scanDirectory(join(root, 'missing'))).toThrow(/does not exist/);
  });

  it('refuses a directory with no JavaScript in it, rather than passing on nothing', () => {
    const empty = join(root, 'empty');
    mkdirSync(empty);
    writeFileSync(join(empty, 'index.html'), '<html></html>');
    expect(() => scanDirectory(empty)).toThrow(/prove nothing/);
  });

  it('finds a signature in a nested shipped file and names the file', () => {
    const dist = join(root, 'dist');
    mkdirSync(join(dist, 'app', '_expo'), { recursive: true });
    writeFileSync(
      join(dist, 'app', '_expo', 'entry.js'),
      'x="Cannot encrypt private key. Unknown encryption algorithm."',
    );
    writeFileSync(join(dist, 'main.js'), 'console.log("clean")');
    const { files, findings } = scanDirectory(dist);
    expect(files).toBe(2);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ lib: 'node-forge' });
    expect(findings[0].file).toMatch(/entry\.js$/);
  });
});
