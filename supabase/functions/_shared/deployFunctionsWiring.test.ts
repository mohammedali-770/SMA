import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * A tripwire over `.github/workflows/deploy-functions.yml`, the manual workflow
 * that deploys Edge Functions to Production.
 *
 * The workflow used to decide a function's JWT setting from a hard-coded list,
 * and the list drifted: until 2026-11-11 it named only payment-webhook and
 * payment-return, while config.toml marks eleven more functions
 * `verify_jwt = false`, payment-refund among them. Deployed with JWT
 * verification on, payment-refund would refuse the refund cron's
 * unauthenticated call with a 401. The workflow now reads each function's
 * verify_jwt from config.toml when the job runs, through its `jwt_flag` shell
 * function, and this file RUNS that function, as written in the workflow,
 * against the real config.toml.
 *
 * The `all` preset is held to the payment directories: the payment functions
 * deploy as one set, because a new bundle beside an older one can open a
 * Moyasar invoice that nothing confirms.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FUNCTIONS_DIR = new URL('../', import.meta.url);
const workflow = readFileSync(
  new URL('../../../.github/workflows/deploy-functions.yml', import.meta.url),
  'utf8',
);
const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8');

const functionDirs = readdirSync(FUNCTIONS_DIR)
  .filter((name) => name !== '_shared' && statSync(new URL(name, FUNCTIONS_DIR)).isDirectory())
  .sort();

/** verify_jwt per function, as config.toml states it. */
function verifyJwtInConfig(): Map<string, string> {
  const found = config.matchAll(/^\[functions\.([a-z0-9-]+)\]\s*\nverify_jwt = (true|false)$/gm);
  return new Map([...found].map((m) => [m[1], m[2]]));
}

/** The workflow's jwt_flag shell function, exactly as the deploy step defines it. */
function jwtFlagSource(): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => /^\s*jwt_flag\(\) \{$/.test(line));
  expect(start, 'jwt_flag() in the workflow').toBeGreaterThan(-1);
  const indent = /^\s*/.exec(lines[start])![0];
  const end = lines.findIndex((line, i) => i > start && line === `${indent}}`);
  expect(end, 'the end of jwt_flag()').toBeGreaterThan(start);
  return lines
    .slice(start, end + 1)
    .map((line) => line.slice(indent.length))
    .join('\n');
}

/** Run jwt_flag for one function, from `cwd`, the way the deploy step does. */
function jwtFlag(fn: string, cwd = REPO_ROOT): { ok: boolean; flag: string } {
  try {
    const out = execFileSync('bash', ['-c', `${jwtFlagSource()}\njwt_flag "$1"`, 'jwt_flag', fn], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { ok: true, flag: out.trim() };
  } catch {
    return { ok: false, flag: '' };
  }
}

/** The functions the `all` preset expands to. */
function allPreset(): string[] {
  // Comment lines may sit between the `then` and the assignment.
  const preset = workflow.match(/if \[ "\$FNS" = "all" \]; then(?:\s*\n\s*#[^\n]*)*\s*\n\s*FNS="([^"]+)"/);
  expect(preset, "the 'all' preset").not.toBeNull();
  return preset![1].split(/\s+/).sort();
}

describe('deploy-functions.yml', () => {
  it('deploys exactly the functions config.toml marks verify_jwt = false with --no-verify-jwt', () => {
    const inConfig = verifyJwtInConfig();
    expect([...inConfig.keys()].sort()).toEqual(functionDirs);
    for (const fn of functionDirs) {
      const expected = inConfig.get(fn) === 'false' ? '--no-verify-jwt' : '';
      expect(jwtFlag(fn), fn).toEqual({ ok: true, flag: expected });
    }
  });

  it('turns verification off for payment-refund and the admin return page, and nowhere it is on', () => {
    expect(jwtFlag('payment-refund')).toEqual({ ok: true, flag: '--no-verify-jwt' });
    expect(jwtFlag('payment-admin-test-return')).toEqual({ ok: true, flag: '--no-verify-jwt' });
    expect(jwtFlag('payment-initiate')).toEqual({ ok: true, flag: '' });
    expect(jwtFlag('payment-test-config')).toEqual({ ok: true, flag: '' });
  });

  it('stops, rather than guess, for a function config.toml does not list', () => {
    expect(jwtFlag('no-such-function').ok).toBe(false);
    expect(workflow).toContain('if ! FLAGS="$(jwt_flag "$fn")"; then');
    expect(workflow).toMatch(
      /if ! FLAGS="\$\(jwt_flag "\$fn"\)"; then\n\s*echo "::error::[^\n]*"\n\s*exit 1\n/,
    );
  });

  it('passes the flag it read to the CLI, and keeps no list of its own', () => {
    expect(workflow).toContain('supabase functions deploy "$fn" --project-ref "$PROJECT_REF" $FLAGS');
    expect(workflow).not.toMatch(/FLAGS="--no-verify-jwt"|^\s*[a-z0-9|-]+\) FLAGS=/m);
  });

  it("expands 'all' to every payment function, the admin return page included", () => {
    expect(allPreset()).toEqual(functionDirs.filter((name) => name.startsWith('payment-')));
  });

  it('names only functions that exist, so a stale name cannot reach the CLI', () => {
    for (const fn of allPreset()) expect(functionDirs).toContain(fn);
  });
});

// The parser, against a config.toml written to catch the mistakes a line-based
// reader makes: comments, indentation, a table with no verify_jwt, a quoted
// value, and a name that is a prefix of another.
describe('jwt_flag reads only the named table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jwt-flag-'));
  mkdirSync(join(dir, 'supabase'));
  writeFileSync(
    join(dir, 'supabase', 'config.toml'),
    [
      '[functions.alpha]',
      '# a comment',
      '  verify_jwt = false   # trailing comment',
      '',
      '[functions.gamma]',
      'entrypoint = "index.ts"',
      '',
      '[functions.epsilon]',
      'verify_jwt = false',
      '',
      '[functions.beta]',
      'import_map = "x"',
      'verify_jwt = true',
      '',
      '[functions.delta]',
      'verify_jwt = "false"',
      '',
    ].join('\n'),
  );
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads indented and commented lines inside the right table', () => {
    expect(jwtFlag('alpha', dir)).toEqual({ ok: true, flag: '--no-verify-jwt' });
    expect(jwtFlag('beta', dir)).toEqual({ ok: true, flag: '' });
  });

  it("never borrows the next table's value, and accepts only true or false", () => {
    expect(jwtFlag('gamma', dir).ok).toBe(false);
    expect(jwtFlag('delta', dir).ok).toBe(false);
    expect(jwtFlag('alph', dir).ok).toBe(false);
  });
});

// The payment set needs TWO migrations live first, in order, and the third only
// after it. Guidance that named the first alone shipped the session flow
// without 20261003120000's loyalty multi-spend guard and 1.00 SAR minimum: a
// customer could pay two live sessions with the same points. Each place an
// operator reads before deploying names all three, in that order.
describe('the deploy guidance names every migration the payment set needs', () => {
  const FIRST = '20260824100000_moyasar_payment_provider';
  const SECOND = '20261003120000_moyasar_only_payments';
  const AFTER = '20261004120000_drop_tap_payment_rpcs';
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  /** The header comment above `on:`, joined into one line. */
  const header = workflow
    .slice(0, workflow.indexOf('\non:'))
    .split('\n')
    .map((line) => line.replace(/^#\s?/, ''))
    .join(' ');
  /** The ::warning the `all` preset prints. */
  const warning = /echo "::warning::Deploying the whole payment set\.[^"]*"/.exec(workflow)?.[0] ?? '';
  /** The README paragraph about what these functions need. */
  const readmeNeeds = readme.split('\n').find((line) => line.startsWith('These functions need')) ?? '';

  it.each([
    ['the workflow header', header],
    ["the 'all' warning", warning],
    ['supabase/functions/README.md', readmeNeeds],
  ])('%s: both prerequisites in order, the drop only after the deploy', (_where, text) => {
    expect(text).toContain(FIRST);
    expect(text).toContain(SECOND);
    expect(text.indexOf(FIRST)).toBeLessThan(text.indexOf(SECOND));
    expect(text).toContain(AFTER);
    expect(text.indexOf(SECOND)).toBeLessThan(text.indexOf(AFTER));
    expect(text.slice(text.indexOf(AFTER))).toMatch(/only after/i);
  });
});
