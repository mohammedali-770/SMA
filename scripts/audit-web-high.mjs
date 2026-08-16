#!/usr/bin/env node
/**
 * Fail-closed web/admin npm audit gate.
 *
 * Unlike the mobile audit gate, the web tree has no standing HIGH/CRITICAL
 * exceptions. This wrapper keeps that policy while emitting each direct
 * high/critical advisory as a GitHub Actions annotation so CI failures are
 * diagnosable without downloading raw job logs.
 */
import { spawnSync } from 'node:child_process';

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const run = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['audit', '--audit-level=high', '--json'],
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

const counts = report.metadata?.vulnerabilities ?? {};
const critical = Number(counts.critical ?? 0);
const high = Number(counts.high ?? 0);

if (critical === 0 && high === 0) {
  console.log('web dependency audit: no high/critical vulnerabilities');
  process.exit(0);
}

function ghsaFromUrl(url) {
  const match = String(url ?? '').match(/GHSA-[0-9a-z-]+/i);
  return match?.[0] ?? null;
}

const direct = [];
for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
  for (const cause of Array.isArray(vulnerability?.via) ? vulnerability.via : []) {
    if (typeof cause !== 'object' || cause === null) continue;
    const severity = String(cause.severity ?? '').toLowerCase();
    if (!['high', 'critical'].includes(severity)) continue;
    direct.push({
      name,
      severity,
      ghsa: ghsaFromUrl(cause.url),
      source: cause.source,
      title: String(cause.title ?? 'security advisory'),
      range: String(cause.range ?? vulnerability.range ?? ''),
      url: String(cause.url ?? ''),
    });
  }
}

if (direct.length === 0) {
  fail(`web dependency audit contains ${critical} critical and ${high} high vulnerability record(s), but no direct advisory objects could be identified`);
}

for (const advisory of direct) {
  const id = advisory.ghsa ?? advisory.source ?? 'unknown-advisory';
  const range = advisory.range ? ` affected ${advisory.range};` : '';
  const url = advisory.url ? ` ${advisory.url}` : '';
  console.error(`::error title=npm audit ${advisory.severity}: ${advisory.name} (${id})::${advisory.title};${range}${url}`);
}

fail(`web dependency audit contains ${critical} critical and ${high} high vulnerability record(s); no web exceptions are allowed`);
