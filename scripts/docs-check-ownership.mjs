#!/usr/bin/env node
/**
 * Enforces the documentation ownership map in docs/ownership.json.
 *
 *   node scripts/docs-check-ownership.mjs                  # compare against the default branch
 *   node scripts/docs-check-ownership.mjs --base <ref>     # compare against an explicit ref
 *
 * THE PROBLEM THIS SOLVES. Generated reference stays true because a generator
 * rewrites it. Prose cannot be generated — a runbook, a freeze decision, an
 * integration contract — and prose is exactly what people rely on during an
 * incident. It goes stale silently, and the staleness is only discovered at the
 * worst possible moment.
 *
 * So: for a small, deliberately chosen set of areas, changing the code without
 * touching the owning document fails the build. The map is narrow on purpose. A
 * rule that fires on everything gets bypassed on everything.
 *
 * THE ESCAPE HATCH IS REAL AND IT IS SUPPOSED TO BE USED. A rename, a
 * test-only change or a dependency bump genuinely does not change documented
 * behaviour. Put this in a commit message in the range:
 *
 *     docs-exempt: payments — renamed a local variable, no behaviour change
 *
 * The reason is required and ends up in history where a reviewer can see it.
 * What it must not become is a way to defer documentation you intend to write
 * later; that is how the map stops meaning anything.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BRANCH = 'claude/project-build-ie4b56';

const argBase = process.argv.indexOf('--base');
const BASE = argBase >= 0 ? process.argv[argBase + 1] : process.env.DOCS_BASE_REF || '';

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Resolve something to diff against, preferring an explicit base. */
function resolveBase() {
  const candidates = [
    BASE,
    `origin/${DEFAULT_BRANCH}`,
    DEFAULT_BRANCH,
  ].filter(Boolean);

  for (const ref of candidates) {
    try {
      git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
      return ref;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Glob subset used by the map: `*` matches within a path segment, `**` crosses
 * segments. Deliberately small — a full glob engine would be a dependency, and
 * the patterns in ownership.json are simple by design.
 */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` may also match zero directories, so `a/**/b.ts` matches `a/b.ts`.
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    out += /[.+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${out}$`);
}

const config = JSON.parse(readFileSync(join(ROOT, 'docs', 'ownership.json'), 'utf8'));

const base = resolveBase();
if (!base) {
  console.log(
    'Documentation ownership: no base ref available to diff against, so nothing to check.\n' +
      `Fetch \`${DEFAULT_BRANCH}\` or pass --base <ref> to run this check.`,
  );
  process.exit(0);
}

const mergeBase = (() => {
  try {
    return git('merge-base', base, 'HEAD');
  } catch {
    return base;
  }
})();

const changed = git('diff', '--name-only', `${mergeBase}...HEAD`).split('\n').filter(Boolean);

if (!changed.length) {
  console.log(`Documentation ownership: no changes against ${base}.`);
  process.exit(0);
}

// Exemptions are read from commit messages in the range, not from a file, so
// that granting one is part of the reviewable history rather than a state that
// can be left switched on.
const messages = (() => {
  try {
    return git('log', '--format=%B', `${mergeBase}...HEAD`);
  } catch {
    return '';
  }
})();
const exempt = new Map();
for (const m of messages.matchAll(/docs-exempt:\s*([a-z0-9-]+)\s*[—–-]\s*(.+)/gi)) {
  exempt.set(m[1].toLowerCase(), m[2].trim());
}

const changedSet = new Set(changed);
const failures = [];
const honoured = [];

for (const rule of config.rules) {
  const patterns = rule.sources.map(globToRegExp);
  const hits = changed.filter((f) => patterns.some((re) => re.test(f)));
  if (!hits.length) continue;

  if (exempt.has(rule.id)) {
    honoured.push(`${rule.id} — exempted: ${exempt.get(rule.id)}`);
    continue;
  }

  const touchedDoc = rule.docs.some((d) => changedSet.has(d));
  if (touchedDoc) {
    honoured.push(`${rule.id} — documentation updated`);
    continue;
  }
  failures.push({ rule, hits });
}

for (const line of honoured) console.log(`  ok   ${line}`);

if (!failures.length) {
  console.log(`Documentation ownership: satisfied (${changed.length} changed file(s) against ${base}).`);
  process.exit(0);
}

console.error('\nDocumentation ownership check failed.\n');
for (const { rule, hits } of failures) {
  console.error(`  Rule: ${rule.id}`);
  console.error(`  Why:  ${rule.why}`);
  console.error('  You changed:');
  for (const h of hits.slice(0, 8)) console.error(`      ${h}`);
  if (hits.length > 8) console.error(`      ...and ${hits.length - 8} more`);
  console.error('  So this change must also update one of:');
  for (const d of rule.docs) console.error(`      ${d}`);
  console.error(
    `\n  If it genuinely does not affect documented behaviour, say so in a commit message:\n` +
      `      docs-exempt: ${rule.id} — <reason>\n`,
  );
}
console.error(`${failures.length} rule(s) unsatisfied. See docs/ownership.json.`);
process.exit(1);
