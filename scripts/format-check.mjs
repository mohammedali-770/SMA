#!/usr/bin/env node
/**
 * Two formatting rules, deliberately narrow, both scoped to this branch's diff.
 *
 *   node scripts/format-check.mjs                 # compare against the default branch
 *   node scripts/format-check.mjs --base <ref>    # compare against an explicit ref
 *   node scripts/format-check.mjs --all           # audit the whole tree (not wired into CI)
 *
 * WHAT WENT WRONG. The 2026-09-02 audit found 15 source files committed
 * machine-compressed. `AccountSettingsScreen.tsx` is ONE LINE of 1 968
 * characters; `ProfileScreen.tsx` is 20 lines holding 7 KB; `HomeMenuScreen.tsx`
 * is 102 lines holding 16 KB. A normal file here averages 30-75 characters per
 * line. Every future change to one of those diffs as a whole-file rewrite, which
 * defeats review — and CLAUDE.md §15 is built entirely on reading diffs.
 *
 * The cause was that this repository had NO formatter at all: no Prettier, no
 * ESLint, no editorconfig, and `npm run lint` is `tsc --noEmit`, which has no
 * opinion about layout. Compressed source landed across #204, #205, #214, #218,
 * #231, #261 and #280 with nothing to object.
 *
 * WHY NOT SIMPLY "PRETTIER MUST PASS ON CHANGED FILES", which was the obvious
 * design and was measured and rejected. 318 of the 400 tracked TypeScript files
 * are not currently Prettier-clean. That gate would attach a several-hundred-line
 * reformat to every one-line bugfix, on a codebase a week from launch, with NO
 * rendering tests to prove a JSX reformat changed nothing. It would tax exactly
 * the small careful changes you most want people to make.
 *
 * SO THE RULES TARGET THE DEFECT, not conformance:
 *
 *   1. A file ADDED on this branch must be Prettier-clean. New code is free to
 *      be held to the standard — nothing existing is disturbed, and this is what
 *      stops the next compressed file being written.
 *
 *   2. Any CHANGED file must not be machine-compressed: mean line length at most
 *      MAX_MEAN_LINE_LENGTH. This is the property that actually hurt, stated
 *      directly. It ignores quote style, trailing commas and print width, so a
 *      normal hand-written edit passes without touching anything else.
 *
 * `npm run format` runs Prettier for real, on the files you choose, whenever
 * somebody wants to pay down one of the 15 deliberately. It is a tool, not a gate.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BRANCH = 'claude/project-build-ie4b56';

/**
 * Chosen from the measured distribution rather than picked round. Excluding the
 * allowlist below, every compressed file sits at 122 or above and every
 * hand-written one at 99 or below, so 100 separates them with the nearest
 * legitimate file 1 under and the nearest offender 22 over.
 */
const MAX_MEAN_LINE_LENGTH = 100;

/**
 * Files whose density is inherent, not a formatting failure. SVG path data is a
 * single unbreakable token; reformatting it achieves nothing. Keep this list
 * SHORT and justify every entry — it is the escape hatch, and an unjustified
 * entry is how this check stops meaning anything.
 */
const DENSITY_ALLOWLIST = new Set([
  'apps/mobile/src/components/Icons.tsx', // inline SVG path data, one path per line
  'public/vendor/mapbox-gl-rtl-text-v0.4.0.js', // vendored third-party minified bundle
]);

/** Extensions rule 2 applies to. Rule 1 lets Prettier decide via --ignore-unknown. */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Written by generators; never hand-formatted, and covered by their own drift checks. */
const GENERATED = [
  'docs/reference/',
  'src/design-system/generated/',
  'apps/mobile/src/design-system/generated/',
];

const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const argBase = argv.indexOf('--base');
const BASE = argBase >= 0 ? argv[argBase + 1] : process.env.FORMAT_BASE_REF || '';

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Same resolution order as scripts/docs-check-ownership.mjs, for the same reasons. */
function resolveBase() {
  for (const ref of [BASE, `origin/${DEFAULT_BRANCH}`, DEFAULT_BRANCH].filter(Boolean)) {
    try {
      git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
      return ref;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** `{ added, changed }` for this branch, or null when there is nothing to diff against. */
function diffAgainstBase() {
  const base = resolveBase();
  if (!base) return null;
  let mergeBase;
  try {
    mergeBase = git('merge-base', base, 'HEAD');
  } catch {
    mergeBase = base;
  }
  const list = (filter) =>
    git('diff', '--name-only', `--diff-filter=${filter}`, `${mergeBase}...HEAD`).split('\n').filter(Boolean);
  // A: added. ACMR: added, copied, modified, renamed — a DELETED file has nothing
  // to check, and handing one to Prettier is an ENOENT rather than a finding.
  return { added: list('A'), changed: list('ACMR') };
}

function isGenerated(file) {
  return GENERATED.some((prefix) => file.startsWith(prefix));
}

function meanLineLength(file) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const lines = src.split('\n');
  // Trailing newline produces a final empty element; do not let it flatter the mean.
  const count = lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  return Math.round(statSync(join(ROOT, file)).size / Math.max(count, 1));
}

const diff = ALL ? null : diffAgainstBase();
if (!ALL && diff === null) {
  console.log('Formatting: no base ref available to diff against, so nothing to check.');
  console.log('(Pass --base <ref>, or --all to audit the whole tree.)');
  process.exit(0);
}

const present = (f) => existsSync(join(ROOT, f));
const added = ALL ? [] : diff.added.filter(present);
const changed = (ALL ? git('ls-files').split('\n').filter(Boolean) : diff.changed).filter(present);

let failed = false;

// ---- Rule 1: new files must be Prettier-clean --------------------------------
const newFiles = added.filter((f) => !isGenerated(f));
if (newFiles.length > 0) {
  const run = spawnSync('npx', ['prettier', '--check', '--ignore-unknown', ...newFiles], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (run.status !== 0) {
    failed = true;
    console.error('');
    console.error('The files above are NEW on this branch, so they are held to Prettier.');
    console.error('Fix with:  npx prettier --write <file>');
    console.error('');
  }
}

// ---- Rule 2: changed files must not be machine-compressed ---------------------
const dense = changed
  .filter((f) => CODE_EXTENSIONS.some((ext) => f.endsWith(ext)))
  .filter((f) => !isGenerated(f) && !DENSITY_ALLOWLIST.has(f))
  .map((f) => ({ file: f, mean: meanLineLength(f) }))
  .filter(({ mean }) => mean > MAX_MEAN_LINE_LENGTH)
  .sort((a, b) => b.mean - a.mean);

if (dense.length > 0) {
  failed = true;
  console.error(`Machine-compressed source (mean line length over ${MAX_MEAN_LINE_LENGTH} chars):`);
  console.error('');
  for (const { file, mean } of dense) console.error(`  ${String(mean).padStart(5)} chars/line   ${file}`);
  console.error('');
  console.error('A compressed file diffs as a whole-file rewrite, which makes it unreviewable.');
  console.error('Fix with:  npx prettier --write <file>');
  console.error('');
  console.error('That reformats the whole file, so `git blame` on it will point at your commit.');
  console.error('If that matters for the file, see docs/CONTRIBUTING.md — this repository');
  console.error('SQUASH-merges, so a blame-ignore entry takes two pull requests, not one.');
}

if (!failed) {
  console.log(
    `Formatting: ${newFiles.length} new file(s) Prettier-checked, ` +
      `${changed.length} changed file(s) checked for compression. Clean.`,
  );
}
process.exit(failed ? 1 : 0);
