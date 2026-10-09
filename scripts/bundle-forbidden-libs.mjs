#!/usr/bin/env node
/**
 * Fail if code from an EXCEPTED vulnerable library reaches a shipped bundle.
 *
 *   node scripts/bundle-forbidden-libs.mjs [dir]      (default: dist)
 *
 * WHY THIS EXISTS, AND WHY THE AUDIT GATE COULD NOT DO IT.
 * `scripts/audit-mobile-high.mjs` accepts two advisories that have no patched
 * release — `braces` and `node-forge` — on the argument that they are reached
 * only through build/CLI tooling and never ship to a customer. That gate reasons
 * over npm's reverse-dependency graph, and the graph cannot tell build-time from
 * runtime use: `node-forge ← @expo/cli ← expo ← @sentry/react-native` runs
 * through packages that DO ship in the app. So a new runtime dependency that
 * pulled one of these libraries into the bundle would have passed it. Review
 * reached that limit on #416 and the owner accepted it on the condition that it
 * be closed here — by checking the bundle, which is the only artifact that
 * answers "does this code reach a customer?".
 *
 * HOW. Minifiers rename identifiers but keep string literals, so each library is
 * recognised by error messages from its OWN source that survive minification.
 * Every signature was proven against a real minified bundle of its library and
 * against the shipped bundle before being trusted, and that proof is kept
 * running by `src/lib/bundleForbiddenLibs.test.ts`: if a future release rewords
 * a message, the signature would silently stop matching and this check could
 * never fail again, so the test re-bundles each library and fails first.
 *
 * Generic phrases were rejected on purpose ("Expected a string", "No matches
 * found for"): any library may say them, and a false positive here turns CI red
 * for no reason.
 *
 * Signatures are chosen per vulnerable MODULE, not per package: a package
 * without an `exports` map can be imported piecemeal, so a dependency may bundle
 * one vulnerable module and none of the others. Each vulnerable module is
 * recognised by a literal from its OWN source — never from a dependency it
 * loads, since that dependency can ship without it (see `braces` below).
 *
 * IT RUNS INSIDE `npm run build`, NOT BESIDE IT, so it checks the artifact that is
 * actually deployed. `npm run build` is Vercel's `buildCommand`, which makes it
 * the build in all three places one happens: the CI build job, Vercel's
 * Git-integration deploys, and the gated `vercel build --prod`. A separate CI
 * step would have scanned only CI's own temporary `dist` while production was
 * rebuilt elsewhere with production settings and shipped unscanned — review
 * caught that on #417. A failing scan fails the build, so a deploy that would
 * ship one of these libraries does not happen and the previous deploy keeps
 * serving.
 *
 * WHAT IT DOES NOT SEE, stated rather than implied. It scans what those builds
 * emit: the admin console and the Expo WEB export. Native iOS/Android
 * JavaScript is built by EAS, not here. The web export is produced from the same source and the same
 * Metro configuration, so it is a strong proxy — but a library imported only
 * from a platform-specific file (`*.native.ts`, `*.ios.ts`, `*.android.ts`)
 * would not appear in it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * library -> message literals from that library's own source. Each survives
 * minification and is absent from the bundles this project ships today.
 * `braces`' signature also matches when `micromatch` is bundled, because
 * micromatch depends on braces: that is a true positive, not an overlap.
 */
export const FORBIDDEN_LIBS = Object.freeze({
  'node-forge': Object.freeze([
    // rsa.js — the vulnerable PKCS#1 v1.5 verifier itself. Present in every
    // bundle that can reach the flaw, including `node-forge/lib/rsa` imported
    // on its own. Unique to node-forge across both installed trees.
    'Unknown RSASSA-PKCS1-v1_5 DigestAlgorithm identifier.',
    'ASN.1 parsing error: Max depth exceeded.', // asn1.js, required by rsa.js
    'Cannot encrypt private key. Unknown encryption algorithm.',
    'Authentication tag does not match tag length.',
  ]),
  // micromatch/index.js; also in prettier and resolve-workspace-root, which
  // vendor micromatch along with braces. Measured: nowhere else.
  micromatch: Object.freeze(['Expected the first argument to be an object']),
  braces: Object.freeze([
    // ONE SIGNATURE PER VULNERABLE MODULE, each from that module's OWN source.
    // `braces` has no `exports` map, so a dependency may import one module on
    // its own; the package-entry signature lives only in lib/expand.js, and
    // review caught on #417 that a compile-only bundle would have passed.
    'Use options.rangeLimit to increase or disable the limit', // lib/expand.js
    '), exceeds max characters (', // lib/parse.js (static text of a template literal)
    // lib/compile.js — the advisory's named sink. Its one literal of its own is
    // a debug line upstream left in, `console.log('node.isClose', …)`, which
    // survives minification (Metro keeps the single quotes, esbuild emits
    // double). It is matched as a WHOLE string literal: bare, `node.isClose` is
    // ordinary code in xmlbuilder and plist.
    //
    // The first fix matched fill-range's `Invalid range arguments: ` here
    // instead, since compile.js always loads it. But fill-range is a separate
    // package with no advisory of its own, so an app using it WITHOUT braces
    // would have failed the build as though braces had shipped. Review caught
    // that on #417. Nothing here may come from a library that is not itself
    // excepted.
    Object.freeze({ literal: 'node.isClose' }),
    // Measured across all 19 284 installed JS files in both trees: each of these
    // three occurs in exactly six — the braces module it names, and five
    // build/dev tools that VENDOR a full copy of braces: vite, rollup (two
    // bundles), prettier, and resolve-workspace-root (under @expo/config). No
    // unrelated library says any of them, so a match is always braces' code —
    // including a vendored copy, which carries the same flaw and which npm audit
    // cannot see at all.
  ]),
});

const QUOTES = ["'", '"', '`'];

/**
 * A signature is a substring of the library's own source text, or
 * `{ literal }`: one whole string literal, matched in whichever quote style the
 * minifier chose — quotes included, so the same characters written as code do
 * not match.
 */
export function matchesSignature(text, signature) {
  if (typeof signature === 'string') return text.includes(signature);
  return QUOTES.some((q) => text.includes(q + signature.literal + q));
}

function describeSignature(signature) {
  return typeof signature === 'string' ? signature : `'${signature.literal}'`;
}

/** Libraries whose code appears in `text`, with the signature that matched. */
export function findForbiddenLibs(text, table = FORBIDDEN_LIBS) {
  const found = [];
  for (const [lib, signatures] of Object.entries(table)) {
    const hit = signatures.find((sig) => matchesSignature(text, sig));
    if (hit) found.push({ lib, signature: describeSignature(hit) });
  }
  return found;
}

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (/\.(?:c|m)?js$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Scan every shipped JS file under `dir`. Throws on a missing or empty tree:
 * a scan over nothing would pass for ever, and must not be counted as evidence.
 */
export function scanDirectory(dir, table = FORBIDDEN_LIBS) {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist; build before scanning`);
  const files = jsFiles(dir);
  if (files.length === 0) throw new Error(`no JavaScript files under ${dir}; the scan would prove nothing`);
  const findings = [];
  for (const file of files) {
    for (const hit of findForbiddenLibs(readFileSync(file, 'utf8'), table)) {
      findings.push({ ...hit, file });
    }
  }
  return { files: files.length, findings };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dir = process.argv[2] ?? 'dist';
  let result;
  try {
    result = scanDirectory(dir);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
  if (result.findings.length > 0) {
    for (const f of result.findings) {
      console.error(
        `::error file=${relative(process.cwd(), f.file)},title=excepted vulnerable library shipped: ${f.lib}::` +
          `"${f.signature}" from ${f.lib} is in a shipped bundle. The audit exception for it assumes build/CLI-only ` +
          `use; see docs/DEPENDENCY_ADVISORIES.md §3.`,
      );
    }
    process.exit(1);
  }
  console.log(
    `bundle scan: ${result.files} shipped JS file(s), none contain ${Object.keys(FORBIDDEN_LIBS).join(', ')}`,
  );
}
