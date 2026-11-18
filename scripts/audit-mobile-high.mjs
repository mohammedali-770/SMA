#!/usr/bin/env node
/**
 * Fail-closed mobile npm audit gate with a tiny, time-bounded exception list.
 *
 * The only accepted HIGH advisories are the reviewed findings below. See
 * docs/DEPENDENCY_ADVISORIES.md §3 for the review behind every entry.
 *
 * THE VERDICT LOGIC LIVES IN scripts/audit-gate.mjs since 2026-11-18, shared with
 * the web gate, and is unchanged by the move. This file holds the mobile tree's
 * tables and nothing else. The four boundaries it enforces are described there.
 *
 * TWO KINDS OF EXCEPTION HAVE EXISTED, and the difference is the whole argument.
 * Until 2026-11-09 the list held BUILD-TOOL exceptions (`braces`, `node-forge`):
 * reached only through Expo/Metro's CLI toolchain, never shipped, so the proof
 * was "nothing in the app reaches it". Both cleared — node-forge 1.4.3 fixed six
 * highs, and npm stopped reporting the braces advisory for 3.0.3 — and were
 * retired. The next was a RUNTIME exception: `decode-uri-component` shipped,
 * inside expo-router 57 -> query-string 7, so "never shipped" was not available
 * as an argument, and what was proven instead was that the vulnerable function
 * was never CALLED. The Expo SDK 58 upgrade (2026-11-10) retired it.
 *
 * THE CURRENT ENTRY (2026-11-18) IS A BUILD-TOOL EXCEPTION AGAIN: `picomatch`,
 * GHSA-fc5q-39xc-vjpf, which has no patched release. It is reached through
 * Metro, the Expo CLI, Expo's config plugins and React Native's codegen scripts,
 * and the proof that it never ships is the bundle scan inside `npm run build`
 * (scripts/bundle-forbidden-libs.mjs), kept alive by
 * src/lib/picomatchReachability.test.ts. The same advisory is excepted in the web
 * gate under the same expiry. docs/DEPENDENCY_ADVISORIES.md §3.3.
 */
import { readFileSync } from 'node:fs';

import { bundleScanCovers, readFileOrNull, runAuditGate, sourceFiles } from './audit-gate.mjs';

// The expiry applies only while ALLOWED holds an entry. Set it with the entry,
// short on purpose: extending it is a judgement that the evidence still holds,
// NOT a way to make CI green, the distinction docs/DEPENDENCY_ADVISORIES.md §5
// insists on. 2027-01-31 belongs to the picomatch exception and is shared with
// the web gate, so one review clears or extends both (§3.3 gives the reasoning).
// The value before it, 2026-12-31, belonged to the retired decode-uri-component
// exception.
const EXCEPTION_EXPIRES = '2027-01-31';

// An entry is a GHSA id mapped to { package, reason }, reviewed in
// docs/DEPENDENCY_ADVISORIES.md §3.
const ALLOWED = new Map([
  [
    'GHSA-fc5q-39xc-vjpf',
    {
      package: 'picomatch',
      reason:
        'ReDoS on attacker-supplied extglob patterns; no patched release (<=4.0.7, latest 4.0.7). Build-time only: Metro, Expo CLI, config plugins, codegen; patterns come from the repository',
    },
  ],
]);

// Boundary 4's evidence: for each excepted advisory, the test that proves the
// reachability argument against the INSTALLED tree. The audit job installs
// nothing, so it cannot run the proof; the unit-test job does, on every PR. This
// gate checks only that the proof still exists and still names the advisory, so
// the exception cannot outlive the evidence it rests on.
const PROOFS = new Map([['GHSA-fc5q-39xc-vjpf', 'src/lib/picomatchReachability.test.ts']]);

// Reachability bounds: for each listed package, the ONLY immediate
// reverse-dependency parents it may have. A new parent changes the reachability
// argument and must fail until it is re-reviewed.
//
// A BOUND MUST REACH A BUILD TOOL, NOT STOP AT A GENERIC LIBRARY (#416, where
// bounding `braces` only at `micromatch` proved nothing). So the general-purpose
// globbing libraries between picomatch and the tools are bounded too. Each set is
// the package's real parents in apps/mobile/package-lock.json, measured
// 2026-11-18; npm's `effects` list is never larger.
//
// `fdir` is deliberately NOT bounded here: npm reports no `effects` for it in
// this tree, and a bound on a package with none fails by design ("cannot prove
// the approved ancestry"). Its only lockfile parent is `tinyglobby`, which is
// bounded, and it stays on the approved path, so it may not be declared or
// imported by the app.
const REACHABILITY_BOUNDS = new Map([
  [
    'picomatch',
    new Set(['@expo/cli', '@expo/metro-config', 'fdir', 'jest-util', 'micromatch', 'tinyglobby']),
  ],
  ['micromatch', new Set(['metro-file-map'])],
  ['jest-util', new Set(['jest-worker'])],
  ['tinyglobby', new Set(['@expo/config-plugins', '@expo/metro-config', '@react-native/codegen', 'react-native'])],
]);

// The top of an approved chain that is a DIRECT dependency by design, exempt from
// the directness and import checks; nothing else is. `react-native` is the app's
// runtime and legitimately lists tinyglobby — for its codegen script
// (scripts/codegen/generate-artifacts-executor/generateSchemaInfos.js), not for
// anything the app loads. The dependency graph cannot tell those apart, which is
// exactly why the bundle scan is this exception's real proof.
const RUNTIME_ROOTS = new Set(['react-native']);

let mobilePackage;
try {
  mobilePackage = JSON.parse(readFileSync('apps/mobile/package.json', 'utf8'));
} catch {
  console.error('::error::could not parse apps/mobile/package.json while validating advisory reachability');
  process.exit(1);
}
let rootPackage;
try {
  rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
} catch {
  console.error('::error::could not parse package.json while checking the bundle-scan precondition');
  process.exit(1);
}

runAuditGate(['--prefix', 'apps/mobile', 'audit', '--audit-level=high', '--json'], {
  tree: 'mobile',
  expires: EXCEPTION_EXPIRES,
  allowed: ALLOWED,
  proofs: PROOFS,
  bounds: REACHABILITY_BOUNDS,
  roots: RUNTIME_ROOTS,
  packageJson: mobilePackage,
  // Build configuration (metro.config.js and friends) is outside apps/mobile/src
  // and legitimately loads Metro packages, so it is not scanned.
  sourceLabel: 'apps/mobile/src',
  loadSources: () => sourceFiles('apps/mobile/src').map((file) => ({ file, text: readFileSync(file, 'utf8') })),
  readFile: readFileOrNull,
  preconditions: [bundleScanCovers('picomatch', rootPackage)],
});
