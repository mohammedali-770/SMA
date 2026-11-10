import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * REACHABILITY PROOF for the one advisory scripts/audit-mobile-high.mjs accepts:
 * GHSA-qr28-fpjm-wq7f, a quadratic denial of service in decode-uri-component.
 *
 * Unlike the build-tool exceptions it replaced, this package SHIPS: it reaches
 * the customer app as expo-router 57 -> query-string 7 -> decode-uri-component.
 * Its fix (0.5.x) is ESM-only and cannot stand in for the CommonJS require() in
 * query-string 7 — under Metro that require() returns `{ default: fn }` and the
 * call throws — so an override would break the app instead of fixing it. The
 * real fix is the Expo SDK 58 upgrade: expo-router 58 drops query-string.
 *
 * Until then the exception rests on one claim, which this file checks against
 * the INSTALLED tree on every run: nothing calls a query-string function that
 * decodes. Concretely —
 *   1. query-string's decoding entry points are parse, parseUrl, stringifyUrl,
 *      pick and exclude (stringify and extract never decode). That list was read
 *      from query-string 7.1.3, so the version is pinned here;
 *   2. inside expo-router, exactly one of them is called: queryString.parse() in
 *      the VENDORED react-navigation default parser;
 *   3. that default is only ever a fallback parameter, and expo-router's linking
 *      config always supplies its own getStateFromPath, the fork, which does not
 *      import query-string at all;
 *   4. nothing else in the installed mobile tree, and nothing in the app's own
 *      source, imports query-string or decode-uri-component.
 *
 * If any of these stops being true, this fails and the exception must be
 * re-reviewed (docs/DEPENDENCY_ADVISORIES.md §3) — the gate refuses the
 * exception if this file is deleted or stops naming the advisory.
 */

const MOBILE_MODULES = resolve(__dirname, '../../apps/mobile/node_modules');
const ROUTER_BUILD = join(MOBILE_MODULES, 'expo-router', 'build');
const APP_SOURCE = resolve(__dirname, '../../apps/mobile/src');
const INSTALLED = existsSync(ROUTER_BUILD);

/** The unit-test job installs the mobile tree; a skip there would be a proof that never ran. */
function requireInstalled(ctx: { skip: (reason: string) => void }): void {
  if (INSTALLED) return;
  if (process.env.CI) throw new Error(`${ROUTER_BUILD} is missing in CI; the reachability proof cannot run`);
  ctx.skip('apps/mobile is not installed, so expo-router cannot ship from this checkout');
}

function filesUnder(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, ext));
    else if (ext.test(name)) out.push(full);
  }
  return out;
}
const jsFiles = (dir: string) => filesUnder(dir, /\.(?:c|m)?js$/);

const QS_IMPORT =
  /\brequire\(\s*['"]query-string['"]\s*\)|\bfrom\s*['"]query-string['"]|\bimport\(\s*['"]query-string['"]\s*\)/;
const DECODER_IMPORT =
  /\brequire\(\s*['"]decode-uri-component['"]\s*\)|\bfrom\s*['"]decode-uri-component['"]/;
/** query-string 7.1.3 entry points that reach decode() — read from its index.js. */
const DECODING = new Set(['parse', 'parseUrl', 'stringifyUrl', 'pick', 'exclude']);

/** Every `<binding>.<member>(` call on the query-string module in `text`. */
function queryStringCalls(text: string): string[] {
  const bindings = [
    ...text.matchAll(
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:__import(?:Star|Default)\(\s*)?require\(\s*['"]query-string['"]\s*\)/g,
    ),
  ].map((m) => m[1]);
  // A destructured or re-exported import would hide its calls from the binding
  // scan below, so it is refused rather than half-checked.
  if (/\{[^}]*\}\s*=\s*(?:__import(?:Star|Default)\(\s*)?require\(\s*['"]query-string['"]/.test(text)) {
    throw new Error('destructured query-string import: extend this proof before trusting it');
  }
  const calls: string[] = [];
  for (const b of bindings) {
    const esc = b.replace(/[$]/g, '\\$');
    for (const m of text.matchAll(new RegExp(`\\b${esc}(?:\\.default)?\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g')))
      calls.push(m[1]);
  }
  return calls;
}

const rel = (p: string) => relative(ROUTER_BUILD, p).split('\\').join('/');

describe('decode-uri-component (GHSA-qr28-fpjm-wq7f) is shipped but never called', () => {
  it('query-string and decode-uri-component are the versions this proof was derived from', (ctx) => {
    requireInstalled(ctx);
    const qs = JSON.parse(readFileSync(join(MOBILE_MODULES, 'query-string', 'package.json'), 'utf8')) as {
      version: string;
    };
    const duc = JSON.parse(
      readFileSync(join(MOBILE_MODULES, 'decode-uri-component', 'package.json'), 'utf8'),
    ) as { version: string };
    // A different query-string may decode through other entry points; a fixed
    // decode-uri-component means the exception should be retired, not kept.
    expect(qs.version, 're-derive DECODING from the new query-string before trusting this proof').toBe(
      '7.1.3',
    );
    expect(duc.version, 'decode-uri-component changed: retire or re-review the exception').toBe('0.2.2');
  });

  it('every expo-router file importing query-string is one of the four reviewed', (ctx) => {
    requireInstalled(ctx);
    const importers = jsFiles(ROUTER_BUILD)
      .filter((f) => QS_IMPORT.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(importers).toEqual([
      'fork/getPathFromState-forks.js',
      'fork/getPathFromState.js',
      'react-navigation/core/getPathFromState.js',
      'react-navigation/core/getStateFromPath.js',
    ]);
  });

  it('the only decoding call is the vendored default parser', (ctx) => {
    requireInstalled(ctx);
    const decodingCalls: string[] = [];
    let anyCall = 0;
    for (const f of jsFiles(ROUTER_BUILD)) {
      const text = readFileSync(f, 'utf8');
      if (!QS_IMPORT.test(text)) continue;
      for (const member of queryStringCalls(text)) {
        anyCall += 1;
        if (DECODING.has(member)) decodingCalls.push(`${rel(f)}:${member}`);
      }
    }
    // The scan must be seeing calls at all, or "no decoding call" proves nothing.
    expect(anyCall, 'no query-string calls found: the scan is blind').toBeGreaterThan(0);
    expect(decodingCalls).toEqual(['react-navigation/core/getStateFromPath.js:parse']);
  });

  it("expo-router's linking config always supplies the fork, which never imports query-string", (ctx) => {
    requireInstalled(ctx);
    const linkingConfig = readFileSync(join(ROUTER_BUILD, 'getLinkingConfig.js'), 'utf8');
    const linking = readFileSync(join(ROUTER_BUILD, 'link', 'linking.js'), 'utf8');
    // The vendored default is a fallback parameter (`linking?.getStateFromPath ??
    // core.getStateFromPath`); expo-router fills `linking.getStateFromPath` here.
    expect(linkingConfig).toMatch(
      /getStateFromPath:\s*\(path, options\)\s*=>\s*\{\s*return \(0, linking_1\.getStateFromPath\)\(/,
    );
    expect(linking).toMatch(/require\("\.\.\/fork\/getStateFromPath"\)/);
    for (const fork of ['getStateFromPath.js', 'getStateFromPath-forks.js']) {
      const text = readFileSync(join(ROUTER_BUILD, 'fork', fork), 'utf8');
      expect(QS_IMPORT.test(text), `fork/${fork} imports query-string`).toBe(false);
      // …and never delegates to the vendored default.
      expect(text).not.toMatch(/(?:native_1|core_1)\.getStateFromPath\s*\(/);
    }
    // Nothing anywhere in expo-router calls the vendored default directly.
    const direct = jsFiles(ROUTER_BUILD).filter((f) =>
      /(?:native_1|core_1)\.getStateFromPath\s*\(/.test(readFileSync(f, 'utf8')),
    );
    expect(direct.map(rel)).toEqual([]);
  });

  it('nothing else installed, and no app source, imports query-string or decode-uri-component', (ctx) => {
    requireInstalled(ctx);
    // Known positive first: query-string itself must match, or a clean result
    // below would only mean the pattern is blind.
    expect(DECODER_IMPORT.test(readFileSync(join(MOBILE_MODULES, 'query-string', 'index.js'), 'utf8'))).toBe(
      true,
    );
    const offenders: string[] = [];
    let scanned = 0;
    for (const name of readdirSync(MOBILE_MODULES)) {
      const pkgs = name.startsWith('@')
        ? readdirSync(join(MOBILE_MODULES, name)).map((n) => join(name, n))
        : [name];
      for (const pkg of pkgs) {
        if (['expo-router', 'query-string', 'decode-uri-component', '.bin'].includes(pkg)) continue;
        const dir = join(MOBILE_MODULES, pkg);
        if (!statSync(dir).isDirectory()) continue;
        for (const f of jsFiles(dir)) {
          scanned += 1;
          const text = readFileSync(f, 'utf8');
          if (QS_IMPORT.test(text) || DECODER_IMPORT.test(text)) offenders.push(relative(MOBILE_MODULES, f));
        }
      }
    }
    const appFiles = filesUnder(APP_SOURCE, /\.(?:[cm]?[jt]sx?)$/);
    for (const f of appFiles) {
      const text = readFileSync(f, 'utf8');
      if (QS_IMPORT.test(text) || DECODER_IMPORT.test(text)) offenders.push(relative(APP_SOURCE, f));
    }
    // Scans over nothing would pass for ever.
    expect(scanned, 'no installed JavaScript was scanned').toBeGreaterThan(1000);
    expect(appFiles.length, 'no app source was scanned').toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  }, 60_000);
});
