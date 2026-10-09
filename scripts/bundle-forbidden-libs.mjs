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
 * for no reason. Metro bundles whole modules, so one distinctive message is
 * enough to see a library that is present.
 *
 * WHAT IT DOES NOT SEE, stated rather than implied. It scans what CI builds: the
 * admin console and the Expo WEB export. Native iOS/Android JavaScript is built
 * by EAS, not here. The web export is produced from the same source and the same
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
    'ASN.1 parsing error: Max depth exceeded.',
    'Cannot encrypt private key. Unknown encryption algorithm.',
    'Authentication tag does not match tag length.',
  ]),
  micromatch: Object.freeze(['Expected the first argument to be an object']),
  braces: Object.freeze(['Use options.rangeLimit to increase or disable the limit']),
});

/** Libraries whose code appears in `text`, with the signature that matched. */
export function findForbiddenLibs(text, table = FORBIDDEN_LIBS) {
  const found = [];
  for (const [lib, signatures] of Object.entries(table)) {
    const hit = signatures.find((sig) => text.includes(sig));
    if (hit) found.push({ lib, signature: hit });
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
