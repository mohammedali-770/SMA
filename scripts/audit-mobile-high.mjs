#!/usr/bin/env node
/**
 * Fail-closed mobile npm audit gate with a tiny, time-bounded exception list.
 *
 * The only accepted HIGH advisories are two reviewed `image-size` infinite-loop
 * DoS findings that currently have no patched release. `image-size` reaches SMA
 * through Metro/Expo's Node build toolchain and is not executable code shipped
 * in the customer application bundle.
 *
 * npm audit v2 models a direct advisory in `via` and propagates its severity up
 * the reverse dependency graph in `effects`. We validate three independent
 * boundaries before accepting the temporary exception:
 *   1. every direct HIGH advisory object is one of the exact allowlisted GHSAs;
 *   2. `image-size` is not a direct mobile dependency and every immediate npm
 *      reverse-dependency parent is an explicitly approved Metro/Expo build tool;
 *   3. every HIGH vulnerability record belongs to image-size's recursive
 *      `effects` closure.
 *
 * Any critical, another direct high advisory, a new immediate runtime parent,
 * any high record outside that closure, malformed output, or expiry fails CI.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const EXCEPTION_EXPIRES = '2026-09-10';
const ALLOWED = new Map([
  ['GHSA-w3rx-r6r6-pgpr', {
    package: 'image-size',
    reason: 'ICNS parser infinite-loop DoS; no patched release as of 2026-08-10',
  }],
  ['GHSA-5p2g-fcmc-qvqq', {
    package: 'image-size',
    reason: 'JXL/HEIF parser infinite-loop DoS; no patched release as of 2026-08-10',
  }],
]);

// These packages are build/bundling tools. The exception must fail if a future
// customer-runtime package starts depending on image-size directly.
const ALLOWED_IMMEDIATE_PARENTS = new Set([
  'metro',
  '@expo/image-utils',
  '@expo/metro-config',
  '@expo/cli',
]);

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (new Date(`${EXCEPTION_EXPIRES}T23:59:59Z`) < new Date()) {
  fail(`mobile audit exception expired on ${EXCEPTION_EXPIRES}; re-review image-size advisories before extending it`);
}

let mobilePackage;
try {
  mobilePackage = JSON.parse(readFileSync('apps/mobile/package.json', 'utf8'));
} catch {
  fail('could not parse apps/mobile/package.json while validating advisory reachability');
}
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  if (mobilePackage?.[field]?.['image-size']) {
    fail(`image-size became a direct mobile ${field} entry; the Metro/Expo-only exception no longer applies`);
  }
}

const run = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['--prefix', 'apps/mobile', 'audit', '--audit-level=high', '--json'],
  { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
);

let report;
try {
  report = JSON.parse(run.stdout || '{}');
} catch {
  fail('npm audit did not return valid JSON');
}

if (run.error) fail(`npm audit could not run: ${run.error.message}`);
if (!report || typeof report !== 'object' || !report.vulnerabilities || !report.metadata) {
  fail('npm audit JSON is missing expected vulnerabilities/metadata fields');
}

const vulnerabilities = report.vulnerabilities;
const counts = report.metadata?.vulnerabilities ?? {};
const critical = Number(counts.critical ?? 0);
const high = Number(counts.high ?? 0);
if (critical > 0) fail(`mobile dependency audit contains ${critical} CRITICAL vulnerability record(s)`);
if (high === 0) {
  console.log('mobile dependency audit: no high/critical vulnerabilities');
  process.exit(0);
}

function ghsaFromUrl(url) {
  const match = String(url ?? '').match(/GHSA-[0-9a-z-]+/i);
  return match?.[0] ?? null;
}

// Direct advisory identity: a different HIGH on image-size itself must not
// inherit this exception simply because the package name is unchanged.
const observed = new Set();
const unapprovedDirect = [];
for (const [name, v] of Object.entries(vulnerabilities)) {
  for (const cause of Array.isArray(v?.via) ? v.via : []) {
    if (typeof cause !== 'object' || cause === null) continue;
    const severity = String(cause.severity ?? '').toLowerCase();
    if (!['high', 'critical'].includes(severity)) continue;
    if (severity === 'critical') {
      unapprovedDirect.push(`${name}:critical`);
      continue;
    }
    const ghsa = ghsaFromUrl(cause.url);
    const exception = ghsa ? ALLOWED.get(ghsa) : null;
    if (!exception || exception.package !== name) {
      unapprovedDirect.push(`${name}:${ghsa ?? cause.source ?? 'unknown-advisory'}`);
      continue;
    }
    observed.add(ghsa);
  }
}
if (unapprovedDirect.length > 0) {
  fail(`unapproved direct high/critical mobile advisories remain: ${unapprovedDirect.join(', ')}`);
}
for (const ghsa of ALLOWED.keys()) {
  if (!observed.has(ghsa)) fail(`allowlisted advisory ${ghsa} is no longer represented as expected; review the exception`);
}

// Reachability boundary: npm's immediate `effects` entries are the packages
// directly affected by image-size. A new runtime parent changes this set and
// must fail until the exception justification is reviewed again.
const imageSize = vulnerabilities['image-size'];
if (!imageSize || String(imageSize.severity) !== 'high') {
  fail('expected high image-size audit record is missing or changed shape');
}
const immediateParents = Array.isArray(imageSize.effects) ? imageSize.effects : [];
if (immediateParents.length === 0) {
  fail('image-size audit record has no immediate reverse-dependency parents; cannot prove build-tool ancestry');
}
const unapprovedParents = immediateParents.filter((name) => !ALLOWED_IMMEDIATE_PARENTS.has(name));
if (unapprovedParents.length > 0) {
  fail(`image-size is now reachable through an unapproved immediate dependency path: ${unapprovedParents.join(', ')}`);
}

// npm audit's `effects` field is a reverse dependency graph. Start at the one
// accepted vulnerable package and collect every package whose HIGH severity is
// derived from it.
const affected = new Set(['image-size']);
const queue = ['image-size'];
while (queue.length > 0) {
  const current = queue.shift();
  const v = vulnerabilities[current];
  if (!v || !Array.isArray(v.effects)) {
    fail(`audit effects graph is incomplete at ${current}`);
  }
  for (const parent of v.effects) {
    if (typeof parent !== 'string' || !parent) fail(`audit effects graph contains a malformed parent at ${current}`);
    if (!vulnerabilities[parent]) fail(`audit effects graph references unknown package ${parent} from ${current}`);
    if (affected.has(parent)) continue;
    affected.add(parent);
    queue.push(parent);
  }
}

const highNames = Object.entries(vulnerabilities)
  .filter(([, v]) => String(v?.severity) === 'high')
  .map(([name]) => name);
const outsideClosure = highNames.filter((name) => !affected.has(name));
if (outsideClosure.length > 0) {
  fail(`high mobile vulnerability records exist outside the approved image-size dependency closure: ${outsideClosure.join(', ')}`);
}

console.log(`mobile dependency audit: ${high} high vulnerability record(s) are entirely attributable to the two reviewed image-size build-tool advisories`);
console.log(`  immediate image-size parents: ${immediateParents.join(', ')}`);
for (const [ghsa, meta] of ALLOWED) console.log(`  accepted until ${EXCEPTION_EXPIRES}: ${ghsa} — ${meta.reason}`);
console.log('any other high/critical advisory or runtime ancestry change still fails this gate');
