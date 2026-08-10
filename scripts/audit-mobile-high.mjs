#!/usr/bin/env node
/**
 * Fail-closed mobile npm audit gate with a tiny, time-bounded exception list.
 *
 * Why this exists:
 * - npm audit currently reports two HIGH image-size infinite-loop advisories.
 * - GitHub's reviewed advisory records say both affect <=2.0.2 and currently
 *   have no patched release (first_patched_version = null).
 * - image-size reaches this project through Metro/Expo's Node build toolchain;
 *   it is not executable code shipped in the customer application bundle.
 *
 * This script does NOT lower the audit level or ignore all transitive findings.
 * A high/critical vulnerability passes only when every high-severity path
 * recursively terminates in an explicitly allowlisted advisory. Any new direct
 * advisory, any critical advisory, an unknown path, malformed audit output, or
 * expiry of the exception fails the job.
 */
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

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (new Date(`${EXCEPTION_EXPIRES}T23:59:59Z`) < new Date()) {
  fail(`mobile audit exception expired on ${EXCEPTION_EXPIRES}; re-review image-size advisories before extending it`);
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

const counts = report.metadata?.vulnerabilities ?? {};
const critical = Number(counts.critical ?? 0);
const high = Number(counts.high ?? 0);
if (critical > 0) fail(`mobile dependency audit contains ${critical} CRITICAL vulnerability record(s)`);
if (high === 0) {
  console.log('mobile dependency audit: no high/critical vulnerabilities');
  process.exit(0);
}

const vulnerabilities = report.vulnerabilities;
const memo = new Map();

function ghsaFromUrl(url) {
  const match = String(url ?? '').match(/GHSA-[0-9a-z-]+/i);
  return match?.[0] ?? null;
}

function pathIsAllowed(name, visiting = new Set()) {
  if (memo.has(name)) return memo.get(name);
  if (visiting.has(name)) return false;
  visiting.add(name);

  const v = vulnerabilities[name];
  if (!v || !['high', 'critical'].includes(String(v.severity))) {
    visiting.delete(name);
    memo.set(name, true);
    return true;
  }
  if (String(v.severity) === 'critical') return false;

  const via = Array.isArray(v.via) ? v.via : [];
  if (via.length === 0) return false;

  let sawHighCause = false;
  for (const cause of via) {
    if (typeof cause === 'string') {
      const child = vulnerabilities[cause];
      if (child && ['high', 'critical'].includes(String(child.severity))) {
        sawHighCause = true;
        if (!pathIsAllowed(cause, new Set(visiting))) return false;
      }
      continue;
    }

    const severity = String(cause?.severity ?? '').toLowerCase();
    if (!['high', 'critical'].includes(severity)) continue;
    sawHighCause = true;
    if (severity === 'critical') return false;

    const ghsa = ghsaFromUrl(cause?.url);
    const exception = ghsa ? ALLOWED.get(ghsa) : null;
    if (!exception || exception.package !== name) return false;
  }

  visiting.delete(name);
  memo.set(name, sawHighCause);
  return sawHighCause;
}

const highNames = Object.entries(vulnerabilities)
  .filter(([, v]) => ['high', 'critical'].includes(String(v?.severity)))
  .map(([name]) => name);

const unapproved = highNames.filter((name) => !pathIsAllowed(name));
if (unapproved.length > 0) {
  fail(`unapproved high/critical mobile advisories remain: ${unapproved.join(', ')}`);
}

// Prove both explicit exceptions are still actually present. If npm's advisory
// graph changes shape, fail rather than silently treating a stale exception as
// authority.
const observed = new Set();
for (const [name, v] of Object.entries(vulnerabilities)) {
  for (const cause of Array.isArray(v?.via) ? v.via : []) {
    if (typeof cause !== 'object' || cause === null) continue;
    const ghsa = ghsaFromUrl(cause.url);
    if (ghsa && ALLOWED.has(ghsa) && ALLOWED.get(ghsa).package === name) observed.add(ghsa);
  }
}
for (const ghsa of ALLOWED.keys()) {
  if (!observed.has(ghsa)) fail(`allowlisted advisory ${ghsa} is no longer represented as expected; review the exception`);
}

console.log(`mobile dependency audit: ${high} high vulnerability record(s) are entirely attributable to the two reviewed image-size build-tool advisories`);
for (const [ghsa, meta] of ALLOWED) console.log(`  accepted until ${EXCEPTION_EXPIRES}: ${ghsa} — ${meta.reason}`);
console.log('any other high/critical advisory still fails this gate');
