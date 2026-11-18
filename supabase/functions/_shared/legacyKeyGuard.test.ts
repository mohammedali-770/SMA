import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * GUARD: the legacy Supabase API keys stay out of the tree.
 *
 * Step 9 of docs/SUPABASE_API_KEYS.md §3 removed every fallback to the JWT-based
 * `anon` / `service_role` keys after they were deactivated (step 8). A fallback
 * that comes back is not harmless: the key it reads is refused by the gateway,
 * so whatever depends on it breaks — and a hard-coded legacy JWT in a build
 * profile or a script would ship a dead key to every customer who installs it.
 *
 * This walks the repository and fails on either of two things outside the
 * allow-list:
 *
 *   1. a legacy anon/service JWT for this project, recognised by its payload —
 *      `{"iss":"supabase","ref":"wxfmmnihidsdyemasstf","role":` base64-encoded,
 *      which every legacy API key for the project starts with, whatever its
 *      role — searched in every text file, documentation included;
 *   2. a READ of a legacy key variable — `SUPABASE_ANON_KEY`,
 *      `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY`,
 *      `EXPO_PUBLIC_SUPABASE_ANON_KEY` — in the shapes code actually uses
 *      (`Deno.env.get('X')`, `env('X')`, `process.env.X`, `import.meta.env.X`,
 *      `env['X']`, `secrets.X`, `$X`), or a definition of one in an env
 *      template. Prose that merely names a variable is not a read, so the
 *      runbooks can still explain what was removed.
 *
 * THE ALLOW-LIST is test files only, which need legacy-shaped values to prove
 * they are refused. There is no production exception: `_shared/paymentSync.ts`,
 * the last file that read `SUPABASE_ANON_KEY`, was moved to `publishableKey()`
 * in the same change, and the guard covers it like every other file. Adding an
 * exception is a decision to record, not a convenience.
 */

const ROOT = resolve(__dirname, '../../..');

const TEST_FILE = /(?:\.test\.(?:ts|tsx|js|mjs|cjs|sh)|_test\.ts|\.spec\.ts)$/;

/** Never descended into: dependencies, build output, VCS and tool caches. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.expo',
  '.next',
  '.vercel',
  '.turbo',
  'android',
  'ios',
  'test-results',
  'playwright-report',
]);

const TEXT_FILE =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|sh|sql|md|html|css|txt|example)$|(?:^|\/)\.env[^/]*$|(?:^|\/)Dockerfile$/;
/** Files whose content is code or configuration, where a read can occur. */
const CODE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|sh|sql|html)$|(?:^|\/)\.env[^/]*$/;

// Split so this file never contains the payload it hunts for in one piece.
const PROJECT_LEGACY_KEY_PAYLOAD =
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6' + 'Ind4Zm1tbmloaWRzZHllbWFzc3RmIiwicm9sZSI6';
// The exact prefix of the deactivated anon key: JWT header + payload up to the role.
const LEGACY_ANON_JWT_PREFIX =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + PROJECT_LEGACY_KEY_PAYLOAD + 'ImFub24i';

const NAME = String.raw`(?:VITE_|EXPO_PUBLIC_)?SUPABASE_(?:ANON|SERVICE_ROLE)_KEY`;
const READS: RegExp[] = [
  // process.env.X, import.meta.env.X, env.X, env?.X
  new RegExp(String.raw`\benv\s*(?:\?\.|\.)\s*${NAME}\b`),
  // env['X'], process.env["X"]
  new RegExp(String.raw`\benv\s*(?:\?\.)?\[\s*['"\`]${NAME}['"\`]\s*\]`),
  // Deno.env.get('X'), env('X'), os.getenv('X'), and the apiKeys.ts readers
  new RegExp(String.raw`\b(?:get|env|getenv|keyMap|pick)\s*\(\s*['"\`]${NAME}['"\`]`),
  // The name as a whole quoted string — how a name reaches a reader as a later
  // argument, e.g. the retired `pick('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')`.
  // Single or double quotes only: backticks are how comments and docs NAME one.
  new RegExp(String.raw`['"]${NAME}['"]`),
  // GitHub Actions: secrets.X / vars.X
  new RegExp(String.raw`\b(?:secrets|vars)\.${NAME}\b`),
  // Shell: $X, ${X}
  new RegExp(String.raw`\$\{?${NAME}\b`),
  // An env template defining one: X=... at the start of a line
  new RegExp(String.raw`^\s*(?:export\s+)?${NAME}\s*=`, 'm'),
];

const isRead = (line: string) => READS.some((p) => p.test(line));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // a dangling symlink
    }
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(relative(ROOT, full).split('\\').join('/'));
  }
  return out;
}

const FILES = walk(ROOT).filter((f) => TEXT_FILE.test(f));

function allowed(file: string): boolean {
  return TEST_FILE.test(file);
}

/** `file:line: text` for every line in `file` that matches any pattern. */
function hits(file: string, patterns: RegExp[]): string[] {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  const found: string[] = [];
  lines.forEach((line, i) => {
    if (patterns.some((p) => p.test(line))) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
  });
  return found;
}

export function legacyKeyViolations(files: string[]): string[] {
  const literal = new RegExp(PROJECT_LEGACY_KEY_PAYLOAD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const out: string[] = [];
  for (const file of files) {
    if (allowed(file)) continue;
    out.push(...hits(file, [literal]).map((h) => `legacy JWT  ${h}`));
    if (CODE_FILE.test(file)) out.push(...hits(file, READS).map((h) => `legacy read ${h}`));
  }
  return out;
}

describe('the legacy Supabase API keys stay out of the tree', () => {
  it('scans a tree that actually contains the code (the walk is not silently empty)', () => {
    for (const f of [
      'supabase/functions/_shared/apiKeys.ts',
      'src/lib/supabaseKey.ts',
      'apps/mobile/src/lib/env.ts',
      'apps/mobile/eas.json',
      'apps/mobile/scripts/export-web.js',
      '.env.example',
      'apps/mobile/.env.example',
      'supabase/functions/_shared/paymentSync.ts',
    ]) {
      expect(FILES, f).toContain(f);
    }
  });

  it('no legacy JWT literal and no read of a legacy key variable outside the allow-list', () => {
    expect(legacyKeyViolations(FILES)).toEqual([]);
  });

  it('the anon prefix is recognised by the payload pattern (the pattern is not vacuous)', () => {
    expect(LEGACY_ANON_JWT_PREFIX).toContain(PROJECT_LEGACY_KEY_PAYLOAD);
  });

  it('every read shape is caught — checked against one sample of each', () => {
    const samples = [
      "const k = Deno.env.get('SUPABASE_ANON_KEY');",
      'const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");',
      "return pick('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');",
      "const legacy = env('SUPABASE_SERVICE_ROLE_KEY');",
      'const k = import.meta.env.VITE_SUPABASE_ANON_KEY;',
      'process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ""',
      "process.env['VITE_SUPABASE_ANON_KEY']",
      'key: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}',
      'curl -H "apikey: $SUPABASE_ANON_KEY"',
      'VITE_SUPABASE_ANON_KEY="YOUR-anon-public-key"',
    ];
    for (const s of samples) expect(isRead(s), s).toBe(true);
  });

  it('prose that only NAMES a variable is not a read', () => {
    for (const s of [
      '`_shared/paymentSync.ts:25` used to read `SUPABASE_ANON_KEY` directly.',
      'After merge, remove the VITE_SUPABASE_ANON_KEY variable from Vercel.',
      'const usesAdmin = /\\bSUPABASE_SERVICE_ROLE_KEY\\b/.test(own)',
    ]) {
      expect(isRead(s), s).toBe(false);
    }
  });

  it('has no production exception — paymentSync.ts is checked like every other file', () => {
    expect(allowed('supabase/functions/_shared/paymentSync.ts')).toBe(false);
    expect(hits('supabase/functions/_shared/paymentSync.ts', READS)).toEqual([]);
  });
});
