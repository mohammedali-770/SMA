import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A tripwire over `.github/workflows/deploy-functions.yml`, the manual workflow
 * that deploys Edge Functions to Production.
 *
 * The workflow decides a function's JWT setting by NAME, in a `case` statement,
 * rather than by reading `supabase/config.toml`, so the two can drift — and they
 * had. Until 2026-11-11 the `--no-verify-jwt` arm named only payment-webhook and
 * payment-return, while config.toml marks eleven more functions
 * `verify_jwt = false`, payment-refund among them. Deployed with JWT
 * verification on, payment-refund would refuse the refund cron's
 * unauthenticated call with a 401. Whether the pinned Supabase CLI would have
 * read config.toml anyway is not relied on: the workflow states the flag, and
 * this file holds that statement to config.toml exactly.
 *
 * The `all` preset is held to the payment directories for the same reason: the
 * payment functions deploy as one set, because a new bundle beside an older one
 * can open a Moyasar invoice that nothing confirms.
 */
const FUNCTIONS_DIR = new URL('../', import.meta.url);
const workflow = readFileSync(
  new URL('../../../.github/workflows/deploy-functions.yml', import.meta.url),
  'utf8',
);
const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8');

const functionDirs = readdirSync(FUNCTIONS_DIR)
  .filter((name) => name !== '_shared' && statSync(new URL(name, FUNCTIONS_DIR)).isDirectory())
  .sort();

function functionsWithVerifyJwt(value: 'true' | 'false'): string[] {
  return [...config.matchAll(/^\[functions\.([a-z0-9-]+)\]\s*\nverify_jwt = (true|false)$/gm)]
    .filter((m) => m[2] === value)
    .map((m) => m[1])
    .sort();
}

/** The function names in the `case` arm that adds --no-verify-jwt. */
function noVerifyJwtArm(): string[] {
  const arm = workflow.match(/^\s*([a-z0-9|-]+)\) FLAGS="--no-verify-jwt" ;;$/m);
  expect(arm, 'the --no-verify-jwt case arm').not.toBeNull();
  return arm![1].split('|').sort();
}

/** The functions the `all` preset expands to. */
function allPreset(): string[] {
  // Comment lines may sit between the `then` and the assignment.
  const preset = workflow.match(/if \[ "\$FNS" = "all" \]; then(?:\s*\n\s*#[^\n]*)*\s*\n\s*FNS="([^"]+)"/);
  expect(preset, "the 'all' preset").not.toBeNull();
  return preset![1].split(/\s+/).sort();
}

describe('deploy-functions.yml', () => {
  it('deploys every function config.toml marks verify_jwt = false with --no-verify-jwt', () => {
    expect(noVerifyJwtArm()).toEqual(functionsWithVerifyJwt('false'));
  });

  it('never strips JWT verification from a function config.toml keeps it on for', () => {
    const on = new Set(functionsWithVerifyJwt('true'));
    expect(noVerifyJwtArm().filter((fn) => on.has(fn))).toEqual([]);
    expect(workflow).toMatch(/^\s*\*\) FLAGS="" ;;$/m);
  });

  it("expands 'all' to every payment function, the admin return page included", () => {
    expect(allPreset()).toEqual(functionDirs.filter((name) => name.startsWith('payment-')));
  });

  it('names only functions that exist, so a stale name cannot reach the CLI', () => {
    for (const fn of [...noVerifyJwtArm(), ...allPreset()]) expect(functionDirs).toContain(fn);
  });
});
