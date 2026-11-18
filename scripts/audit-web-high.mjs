#!/usr/bin/env node
/**
 * Fail-closed web/admin npm audit gate with a tiny, time-bounded exception list.
 *
 * Until 2026-11-18 the web tree had NO exception mechanism: any high or
 * critical failed, and this file said "no web exceptions are allowed". That held
 * until an advisory arrived with no patched release on a package every Vite
 * version depends on — picomatch, GHSA-fc5q-39xc-vjpf, affected `<=4.0.7` while
 * 4.0.7 is the latest published. The only remedy `npm audit` offers is
 * downgrading Vite to 6.2.7. So the web tree now takes the mobile gate's
 * exception machinery, shared in scripts/audit-gate.mjs, with exactly one entry
 * (docs/DEPENDENCY_ADVISORIES.md §3.3).
 *
 * picomatch is reached only through Vite (the console's build tool and dev
 * server), Vitest (the test runner) and the two globbing libraries between them.
 * Every pattern any of them compiles is written in this repository's config or
 * source. The proof that none of it ships is the bundle scan inside
 * `npm run build`, kept alive by src/lib/picomatchReachability.test.ts.
 */
import { readFileSync } from 'node:fs';

import { bundleScanCovers, readFileOrNull, runAuditGate, sourceFiles } from './audit-gate.mjs';

// Shared with the mobile gate: one review clears or extends both. Extending it is
// a judgement that the evidence still holds, NOT a way to make CI green
// (docs/DEPENDENCY_ADVISORIES.md §5).
const EXCEPTION_EXPIRES = '2027-01-31';

// GHSA id -> { package, reason }, reviewed in docs/DEPENDENCY_ADVISORIES.md §3.
const ALLOWED = new Map([
  [
    'GHSA-fc5q-39xc-vjpf',
    {
      package: 'picomatch',
      reason:
        'ReDoS on attacker-supplied extglob patterns; no patched release (<=4.0.7, latest 4.0.7). Build/test-time only: Vite and Vitest; patterns come from the repository',
    },
  ],
]);

// The test that proves the exception's precondition against the installed tree,
// run by the unit-test job. The gate checks that it exists and names the advisory.
const PROOFS = new Map([['GHSA-fc5q-39xc-vjpf', 'src/lib/picomatchReachability.test.ts']]);

// The ONLY immediate parents each package may have: its real parents in
// package-lock.json, measured 2026-11-18 (npm's `effects` list is never larger).
// `fdir` and `tinyglobby` are general-purpose globbing libraries, so they are
// bounded too: a runtime package that started using either would otherwise join
// the approved closure unseen (#416).
const REACHABILITY_BOUNDS = new Map([
  ['picomatch', new Set(['fdir', 'tinyglobby', 'vite', 'vitest'])],
  ['fdir', new Set(['tinyglobby', 'vite'])],
  ['tinyglobby', new Set(['vite', 'vitest'])],
]);

// The tools themselves: direct devDependencies by design, and imported by the
// build config and by test files. Exempt from the directness and import checks;
// picomatch, fdir and tinyglobby are not.
const TOOL_ROOTS = new Set(['vite', 'vitest']);

let rootPackage;
try {
  rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
} catch {
  console.error('::error::could not parse package.json while validating advisory reachability');
  process.exit(1);
}

runAuditGate(['audit', '--audit-level=high', '--json'], {
  tree: 'web',
  expires: EXCEPTION_EXPIRES,
  allowed: ALLOWED,
  proofs: PROOFS,
  bounds: REACHABILITY_BOUNDS,
  roots: TOOL_ROOTS,
  packageJson: rootPackage,
  // The console's source. Test files are left out: Vitest runs them and they are
  // never bundled, and the build config (vite.config.ts) is outside src.
  sourceLabel: 'src',
  loadSources: () =>
    sourceFiles('src', /\.test\.[cm]?[jt]sx?$/).map((file) => ({ file, text: readFileSync(file, 'utf8') })),
  readFile: readFileOrNull,
  preconditions: [bundleScanCovers('picomatch', rootPackage)],
});
