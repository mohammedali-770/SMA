#!/usr/bin/env node
/**
 * Fail-closed mobile npm audit gate with a tiny, time-bounded exception list.
 *
 * The only accepted HIGH advisories are the reviewed findings below, each in a
 * package with NO patched release, each reached only through Expo/Metro's Node
 * build and CLI toolchain, and none present in the customer application bundle.
 * See docs/DEPENDENCY_ADVISORIES.md §3 for the review behind every entry.
 *
 * npm audit v2 models a direct advisory in `via` and propagates its severity up
 * the reverse dependency graph in `effects`. Before accepting the exception we
 * validate three independent boundaries:
 *   1. every direct HIGH advisory object is one of the exact allowlisted GHSAs,
 *      on the package it was reviewed for;
 *   2. no excepted package is a direct mobile dependency, and every immediate
 *      npm reverse-dependency parent of each one is an explicitly approved
 *      build/CLI tool;
 *   3. every HIGH vulnerability record belongs to the union of the excepted
 *      packages' recursive `effects` closures.
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
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Reviewed 2026-10-08. Both packages are at their LATEST published version and
// that version is itself affected, so there is no release to move to. Extending
// this date is a judgement that the reachability review in
// docs/DEPENDENCY_ADVISORIES.md §3 still holds — NOT a way to make CI green, the
// distinction §5 of that document insists on.
const EXCEPTION_EXPIRES = '2026-11-07';

const ALLOWED = new Map([
  ['GHSA-vfj7-8cjw-p6xm', {
    package: 'braces',
    reason: 'stack-exhaustion DoS on deeply nested patterns; no patched release (3.0.3 is latest and affected); build-time glob matching in metro-file-map only',
  }],
  ['GHSA-86w9-cpqp-85rv', {
    package: 'node-forge',
    reason: 'PKCS#1 v1.5 signature verification accepts extra DigestAlgorithm elements; no patched release (1.4.0 is latest and affected); Expo CLI/code-signing only, and EAS Update code signing is not configured',
  }],
]);

// Immediate reverse-dependency parents each excepted package may have. These
// are build/CLI tools. A new parent — above all a customer-runtime package —
// changes the reachability argument and must fail until it is re-reviewed.
const ALLOWED_IMMEDIATE_PARENTS = new Map([
  ['braces', new Set(['micromatch'])],
  ['node-forge', new Set(['@expo/cli', '@expo/code-signing-certificates'])],
]);

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
    console.log('  note: the exception list is now unused; retire it in the same change that confirms this');
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

for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const pkg of ALLOWED_IMMEDIATE_PARENTS.keys()) {
    if (mobilePackage?.[field]?.[pkg]) {
      failures.push(`${pkg} became a direct mobile ${field} entry; the build-tool-only exception no longer applies`);
    }
  }
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

// Boundary 2 — reachability. Each excepted package's immediate parents must be
// approved build tools.
const affected = new Set();
for (const [pkg, parents] of ALLOWED_IMMEDIATE_PARENTS) {
  const v = vulnerabilities[pkg];
  if (!v) continue; // not present: nothing to bound
  if (String(v.severity) !== 'high') {
    failures.push(`${pkg} audit record changed severity to ${v.severity}; re-review the exception`);
    continue;
  }
  const immediate = Array.isArray(v.effects) ? v.effects : [];
  if (immediate.length === 0) {
    failures.push(`${pkg} has no immediate reverse-dependency parents; cannot prove build-tool ancestry`);
    continue;
  }
  const stray = immediate.filter((name) => !parents.has(name));
  if (stray.length > 0) {
    failures.push(`${pkg} is now reachable through an unapproved immediate parent: ${stray.join(', ')}`);
  }
  // Collect this package's recursive effects closure for boundary 3.
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
// be shortened, or it quietly grows into an unrecorded blanket allowance.
for (const ghsa of ALLOWED.keys()) {
  const meta = ALLOWED.get(ghsa);
  if (vulnerabilities[meta.package] && !observed.has(ghsa)) {
    failures.push(`allowlisted advisory ${ghsa} (${meta.package}) is no longer represented as expected; review the exception`);
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`::error::${f}`);
  process.exit(1);
}

console.log(`mobile dependency audit: ${high} high record(s), all attributable to the reviewed build-tool advisories`);
for (const [ghsa, meta] of ALLOWED) console.log(`  accepted until ${EXCEPTION_EXPIRES}: ${meta.package} ${ghsa} — ${meta.reason}`);
console.log('any critical, any other high advisory, or a reachability change still fails this gate');
