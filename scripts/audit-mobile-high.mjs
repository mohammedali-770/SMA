#!/usr/bin/env node
/**
 * Fail-closed mobile npm audit gate with a tiny, time-bounded exception list.
 *
 * The only accepted HIGH advisories are the reviewed findings below. See
 * docs/DEPENDENCY_ADVISORIES.md §3 for the review behind every entry.
 *
 * TWO KINDS OF EXCEPTION HAVE EXISTED, and the difference is the whole argument.
 * Until 2026-11-09 the list held BUILD-TOOL exceptions (`braces`, `node-forge`):
 * reached only through Expo/Metro's CLI toolchain, never shipped, so the proof
 * was "nothing in the app reaches it". Both cleared — node-forge 1.4.3 fixed six
 * highs, and npm stopped reporting the braces advisory for 3.0.3 — and were
 * retired. The current entry is a RUNTIME exception: `decode-uri-component`
 * DOES ship, inside expo-router, so "never shipped" is not available as an
 * argument. What is
 * proven instead is that the vulnerable function is never CALLED, by a test that
 * reads the installed expo-router build (see PROOFS below). That is a weaker
 * guarantee, which is why its expiry is short and tied to the upgrade that
 * removes it.
 *
 * npm audit v2 models a direct advisory in `via` and propagates its severity up
 * the reverse dependency graph in `effects`. Before accepting the exception we
 * validate four independent boundaries:
 *   1. every direct HIGH advisory object is one of the exact allowlisted GHSAs,
 *      on the package it was reviewed for;
 *   2. every package on the approved chain has exactly its approved immediate
 *      parents, and none but the declared runtime root is a direct mobile
 *      dependency or imported by app source;
 *   3. every HIGH vulnerability record belongs to the union of the excepted
 *      packages' recursive `effects` closures;
 *   4. the precondition each exception rests on still holds (here: its
 *      reachability proof exists and names it).
 *
 * Any critical, another direct high advisory, a new immediate parent, any high
 * record outside that closure, malformed output, or expiry fails CI.
 *
 * EVERY DIRECT HIGH/CRITICAL ADVISORY IS ANNOTATED BEFORE ANY VERDICT. The
 * previous version checked the expiry date first and exited, so once the date
 * passed it reported ONLY "exception expired". Between 2026-10-02 and
 * 2026-10-08 that one line stood in front of five new root advisories,
 * including a CRITICAL (`shell-quote`), none of which it named. Bumping the date
 * would not have accepted them — the allowlist check would still have failed —
 * but a routine-sounding message was hiding a critical. Now the annotations come
 * first, so an expired exception can never be the only thing a reader sees.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Reviewed 2026-11-09. Short on purpose: the fix is the Expo SDK 58 upgrade
// (expo-router 58 drops query-string entirely), which is planned before this
// date. Extending it is a judgement that the reachability proof still holds and
// that the upgrade is still coming — NOT a way to make CI green, the distinction
// docs/DEPENDENCY_ADVISORIES.md §5 insists on.
const EXCEPTION_EXPIRES = '2026-12-31';

const ALLOWED = new Map([
  ['GHSA-qr28-fpjm-wq7f', {
    package: 'decode-uri-component',
    reason: 'quadratic DoS on long percent-encoded runs; fixed only in 0.5.x, which is ESM-only and cannot replace the CommonJS require() in query-string 7; ships via expo-router 57 -> query-string 7, but the only decoding call site is the vendored react-navigation fallback parser that expo-router always overrides; removed by the Expo SDK 58 upgrade',
  }],
]);

// Boundary 4's evidence: for each excepted advisory, the test that proves the
// reachability argument against the INSTALLED tree. The audit job installs
// nothing, so it cannot run the proof; the unit-test job does, on every PR. This
// gate checks only that the proof still exists and still names the advisory, so
// the exception cannot outlive the evidence it rests on.
const PROOFS = new Map([
  ['GHSA-qr28-fpjm-wq7f', 'src/lib/decodeUriComponentReachability.test.ts'],
]);

// Reachability bounds: for each listed package, the ONLY immediate
// reverse-dependency parents it may have. A new parent changes the reachability
// argument and must fail until it is re-reviewed.
//
// A BOUND MUST REACH THE PACKAGE THE PROOF IS ABOUT, NOT STOP AT A GENERIC
// LIBRARY. `query-string` is a general-purpose library any package could use,
// and the proof covers expo-router's use of it only. So `query-string`'s own
// parents are bounded too: a second consumer would call parse() with nobody
// having checked, and must fail here. (The same lesson as #416, where bounding
// `braces` only at `micromatch` proved nothing.)
const REACHABILITY_BOUNDS = new Map([
  ['decode-uri-component', new Set(['query-string'])],
  ['query-string', new Set(['expo-router'])],
]);

// The top of an approved chain that is a DIRECT dependency by design. A
// build-tool exception had none — every package on its path had to stay out of
// the app — but a runtime exception's root is the app's own router. It is
// exempt from the directness and import checks below, and nothing else is.
const RUNTIME_ROOTS = new Set(['expo-router']);

// The packages that carry an excepted advisory. Boundary 3's closure starts here.
const EXCEPTED_PACKAGES = new Set([...ALLOWED.values()].map((m) => m.package));

const failures = [];
function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

let mobilePackage;
try {
  mobilePackage = JSON.parse(readFileSync('apps/mobile/package.json', 'utf8'));
} catch {
  fail('could not parse apps/mobile/package.json while validating advisory reachability');
}

const run = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['--prefix', 'apps/mobile', 'audit', '--audit-level=high', '--json'],
  { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
);
if (run.error) fail(`npm audit could not run: ${run.error.message}`);

let report;
try {
  report = JSON.parse(run.stdout || '{}');
} catch {
  fail('npm audit did not return valid JSON');
}
if (!report || typeof report !== 'object' || !report.vulnerabilities || !report.metadata) {
  const stderr = String(run.stderr || '').trim();
  fail(`npm audit JSON is missing expected vulnerabilities/metadata fields${stderr ? `: ${stderr}` : ''}`);
}

const vulnerabilities = report.vulnerabilities;
const counts = report.metadata?.vulnerabilities ?? {};
const critical = Number(counts.critical ?? 0);
const high = Number(counts.high ?? 0);
const expired = new Date(`${EXCEPTION_EXPIRES}T23:59:59Z`) < new Date();

if (critical === 0 && high === 0) {
  // Nothing to except. An expired date is irrelevant here, and saying so would
  // only train readers to ignore the message — but flag a stale allowlist so it
  // gets retired rather than silently carried.
  console.log('mobile dependency audit: no high/critical vulnerabilities');
  if (ALLOWED.size > 0) {
    // A warning, not a failure: every advisory clearing is a good outcome and
    // must not turn CI red. But a plain log line is never read, and a stale
    // allowlist would accept its packages again if they returned before expiry.
    console.error('::warning::the mobile audit exception list is now unused; retire it so a returning advisory is reviewed rather than silently accepted');
  }
  process.exit(0);
}

function ghsaFromUrl(url) {
  const match = String(url ?? '').match(/GHSA-[0-9a-z-]+/i);
  return match?.[0] ?? null;
}

// --- Report first: annotate every direct high/critical advisory -------------
// Before any verdict, so nothing below can hide what is actually present.
const direct = [];
for (const [name, v] of Object.entries(vulnerabilities)) {
  for (const cause of Array.isArray(v?.via) ? v.via : []) {
    if (typeof cause !== 'object' || cause === null) continue;
    const severity = String(cause.severity ?? '').toLowerCase();
    if (!['high', 'critical'].includes(severity)) continue;
    const ghsa = ghsaFromUrl(cause.url);
    direct.push({ name, severity, ghsa, source: cause.source, title: String(cause.title ?? 'security advisory'), range: String(cause.range ?? v.range ?? ''), url: String(cause.url ?? '') });
  }
}
for (const a of direct) {
  const id = a.ghsa ?? a.source ?? 'unknown-advisory';
  const exception = a.ghsa ? ALLOWED.get(a.ghsa) : null;
  // An excepted advisory is a WARNING, not an error: `::error` renders red on a
  // PR even when the gate passes, and a gate that is red on every green run
  // teaches people to stop reading it. Anything not excepted stays an error.
  const excepted = Boolean(exception && exception.package === a.name && a.severity === 'high');
  const level = excepted ? 'warning' : 'error';
  const tag = excepted ? ' [excepted]' : '';
  const range = a.range ? ` affected ${a.range};` : '';
  const url = a.url ? ` ${a.url}` : '';
  console.error(`::${level} title=npm audit ${a.severity}${tag}: ${a.name} (${id})::${a.title};${range}${url}`);
}
if (direct.length === 0) {
  fail(`mobile dependency audit contains ${critical} critical and ${high} high record(s), but no direct advisory objects could be identified`);
}

// --- Then verdicts ----------------------------------------------------------
if (critical > 0) failures.push(`${critical} CRITICAL vulnerability record(s); criticals are never excepted`);
if (expired) failures.push(`the mobile audit exception expired on ${EXCEPTION_EXPIRES}; re-review the advisories annotated above before extending it`);

// Every package on an approved path — each bounded package AND every approved
// parent, except a declared RUNTIME_ROOT — must stay out of the app's own
// dependencies and its own source. Today that is `decode-uri-component` and
// `query-string`: the app reaching either directly would be a call site the
// reachability proof never looked at.
//
// THE APPROVED PARENTS ARE INCLUDED ON PURPOSE. A bound proves that the excepted
// code is reached only THROUGH a build tool; it proves nothing if the app depends
// on that build tool's library directly. `@expo/code-signing-certificates` is an
// ordinary JS library whose only dependency is `node-forge`: declared directly
// and imported, it would put the signature-verification flaw in the customer
// bundle while `node-forge`'s parent list still showed the approved name and the
// code-signing precondition still read clean. The first revision checked only
// the bounded packages. Review caught it on #416.
const ON_APPROVED_PATH = new Set(REACHABILITY_BOUNDS.keys());
for (const parents of REACHABILITY_BOUNDS.values()) for (const parent of parents) ON_APPROVED_PATH.add(parent);
for (const root of RUNTIME_ROOTS) ON_APPROVED_PATH.delete(root);

for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const pkg of ON_APPROVED_PATH) {
    if (mobilePackage?.[field]?.[pkg]) {
      failures.push(`${pkg} became a direct mobile ${field} entry; the exception assumes it is reached only through its approved parents`);
    }
  }
}

// A package need not be DECLARED to be used: npm hoists transitive packages into
// node_modules, so app code can import one nobody listed. No package.json check
// sees that. So the app's own source is scanned for any import of a package on
// an approved path. Build configuration (metro.config.js and friends) is outside
// `apps/mobile/src` and legitimately loads Metro packages, so it is not scanned.
// Fails closed if the source tree cannot be read.
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
const IMPORT_PATTERNS = [...ON_APPROVED_PATH].map((pkg) => [
  pkg,
  new RegExp(`(?:\\bfrom\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*\\(\\s*|^\\s*import\\s+)['"\`]${escapeRe(pkg)}(?:/[^'"\`]*)?['"\`]`, 'm'),
]);
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(name)) out.push(full);
  }
  return out;
}
let appSource = [];
try {
  appSource = sourceFiles('apps/mobile/src');
} catch {
  fail('could not read apps/mobile/src to check that no app code imports a package on an approved path');
}
if (appSource.length === 0) {
  // A scan over nothing would pass for ever. Fail rather than count it as evidence.
  fail('found no source files under apps/mobile/src; the import scan would prove nothing');
}
const importers = [];
for (const file of appSource) {
  const text = readFileSync(file, 'utf8');
  for (const [pkg, re] of IMPORT_PATTERNS) {
    if (re.test(text)) importers.push(`${file} imports ${pkg}`);
  }
}
if (importers.length > 0) {
  failures.push(`app source imports a package the exceptions assume is reached only through its approved parents: ${importers.join('; ')}`);
}

// Boundary 1 — exact advisory identity. A different HIGH on an excepted package
// must not inherit the exception just because the package name matches.
const observed = new Set();
const unapproved = [];
for (const a of direct) {
  if (a.severity === 'critical') continue; // already a failure above
  const exception = a.ghsa ? ALLOWED.get(a.ghsa) : null;
  if (!exception || exception.package !== a.name) {
    unapproved.push(`${a.name}:${a.ghsa ?? a.source ?? 'unknown-advisory'}`);
    continue;
  }
  observed.add(a.ghsa);
}
if (unapproved.length > 0) failures.push(`unapproved direct high advisories: ${unapproved.join(', ')}`);

// Boundary 2 — reachability. Every bounded package that is present must have
// only its approved immediate parents. This is checked for the generic
// intermediate as well as for the excepted leaf — see REACHABILITY_BOUNDS.
for (const [pkg, parents] of REACHABILITY_BOUNDS) {
  const v = vulnerabilities[pkg];
  if (!v) continue; // not in the audit: nothing to bound
  if (EXCEPTED_PACKAGES.has(pkg) && String(v.severity) !== 'high') {
    failures.push(`${pkg} audit record changed severity to ${v.severity}; re-review the exception`);
    continue;
  }
  const immediate = Array.isArray(v.effects) ? v.effects : [];
  if (immediate.length === 0) {
    failures.push(`${pkg} has no immediate reverse-dependency parents; cannot prove the approved ancestry`);
    continue;
  }
  const stray = immediate.filter((name) => !parents.has(name));
  if (stray.length > 0) {
    failures.push(`${pkg} is now reachable through an unapproved immediate parent: ${stray.join(', ')}`);
  }
}

// Collect the recursive effects closure of the EXCEPTED packages for boundary 3.
const affected = new Set();
for (const pkg of EXCEPTED_PACKAGES) {
  if (!vulnerabilities[pkg]) continue;
  const queue = [pkg];
  affected.add(pkg);
  while (queue.length > 0) {
    const current = queue.shift();
    const node = vulnerabilities[current];
    if (!node || !Array.isArray(node.effects)) {
      failures.push(`audit effects graph is incomplete at ${current}`);
      break;
    }
    for (const parent of node.effects) {
      if (typeof parent !== 'string' || !parent) { failures.push(`malformed effects parent at ${current}`); continue; }
      if (!vulnerabilities[parent]) { failures.push(`effects graph references unknown package ${parent} from ${current}`); continue; }
      if (affected.has(parent)) continue;
      affected.add(parent);
      queue.push(parent);
    }
  }
}

// Boundary 3 — every HIGH record must be explained by an excepted package.
const outside = Object.entries(vulnerabilities)
  .filter(([, v]) => String(v?.severity) === 'high')
  .map(([name]) => name)
  .filter((name) => !affected.has(name));
if (outside.length > 0) {
  failures.push(`high records exist outside the excepted packages' dependency closure: ${outside.join(', ')}`);
}

// A listed advisory that has disappeared is good news, but the list must then
// be shortened, or it quietly grows into an unrecorded blanket allowance: if the
// package came back before expiry it would be accepted with no review at all.
//
// UNCONDITIONAL, deliberately. An earlier revision of this file guarded it with
// `vulnerabilities[meta.package] &&`, which skipped exactly the case that
// matters — the package removed entirely while the other exception still
// produces highs — and so let a stale entry sit silently. The original
// `image-size` gate had this right; that revision weakened it. Review caught it
// on #416. The all-clear case never reaches here: it returns early above.
for (const ghsa of ALLOWED.keys()) {
  if (!observed.has(ghsa)) {
    const meta = ALLOWED.get(ghsa);
    failures.push(`allowlisted advisory ${ghsa} (${meta.package}) is no longer present; remove it from the allowlist rather than carrying it`);
  }
}

// Boundary 4 — the PRECONDITION an exception rests on, enforced here and not
// only in the document.
//
// The retired node-forge exception taught this: its justification (EAS Update
// code signing is off) lived only in docs/DEPENDENCY_ADVISORIES.md, so turning
// code signing on would have left every graph check above passing while the
// reason for accepting the flaw had stopped being true. Review caught it on
// #416. The current exception rests on a reachability PROOF, so the proof is the
// precondition: if it is deleted, or stops naming the advisory, the exception
// fails rather than quietly surviving its evidence. Fails closed on an
// unreadable file.
for (const ghsa of observed) {
  const proof = PROOFS.get(ghsa);
  if (!proof) {
    failures.push(`allowlisted advisory ${ghsa} has no reachability proof registered in PROOFS`);
    continue;
  }
  let text = '';
  try {
    text = readFileSync(proof, 'utf8');
  } catch {
    failures.push(`the reachability proof for ${ghsa} (${proof}) could not be read; the exception rests on it`);
    continue;
  }
  if (!text.includes(ghsa)) {
    failures.push(`the reachability proof ${proof} no longer names ${ghsa}; re-review docs/DEPENDENCY_ADVISORIES.md §3 before relying on the exception`);
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`::error::${f}`);
  process.exit(1);
}

console.log(`mobile dependency audit: ${high} high record(s), all attributable to the reviewed advisories`);
for (const [ghsa, meta] of ALLOWED) console.log(`  accepted until ${EXCEPTION_EXPIRES}: ${meta.package} ${ghsa} — ${meta.reason}`);
console.log('any critical, any other high advisory, or a reachability change still fails this gate');
