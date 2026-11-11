#!/usr/bin/env node
/**
 * Every GitHub Action a workflow runs is pinned to a full commit SHA, and every
 * tool a workflow downloads at run time is pinned to an exact version.
 *
 * WHY THIS EXISTS (2026-11-10). Supply-chain compromise is OWASP's A03:2025, and
 * CI is where it pays best: a job runs whatever a tag or a registry says is
 * current, with whatever credentials the job holds. This repository already
 * SHA-pinned every action, but only by convention, and three tools were still
 * fetched as "latest" at run time — two of them in jobs that hold a production
 * credential:
 *
 *   - `npx vercel@latest`, three times, in the deploy job that holds VERCEL_TOKEN;
 *   - `eas-version: latest` in both EAS workflows, which hold EXPO_TOKEN — a
 *     token that can start a store build;
 *   - the Supabase CLI `version: latest`, in the two workflows that would hold
 *     SUPABASE_ACCESS_TOKEN.
 *
 * A convention nothing checks decays, so this makes it a gate. It runs in the
 * always-reporting `Change-control guard` job.
 *
 * Rules, on every non-comment line of `.github/workflows/*.yml`:
 *   1. `uses: owner/repo[/path]@ref` — `ref` must be a 40-character commit SHA.
 *      A tag such as `@v6` can be moved to different code after review; a SHA
 *      cannot. Local actions (`./…`) and `docker://` images are out of scope;
 *      none exist today, and a new kind of reference should be a decision, so it
 *      fails here too until this script is taught about it.
 *   2. No `@latest` package spec (`npx some-tool@latest`), and no action input
 *      set to `latest` (`version: latest`, `eas-version: latest`).
 *
 * `runs-on: ubuntu-latest` is allowed: it names a GitHub-hosted runner image,
 * not something a job downloads and executes, and it cannot be pinned to a hash.
 *
 * Bumping a pinned tool is a deliberate change — say which version and why in
 * the commit. See docs/DEPENDENCY_ADVISORIES.md ("Tools CI downloads at run
 * time").
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

const SHA = /^[0-9a-f]{40}$/;

/** The line with any YAML comment removed. Workflows here put no `#` inside a value. */
function code(line) {
  return line.replace(/(^|\s)#.*$/, '').trimEnd();
}

export function findViolations(file, text) {
  const out = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = code(raw);
    if (!line.trim()) return;
    const where = `${file}:${i + 1}`;

    const uses = line.match(/^\s*(?:-\s*)?uses:\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (uses) {
      const spec = uses[1];
      const at = spec.lastIndexOf('@');
      if (spec.startsWith('./') || spec.startsWith('docker://') || at < 0) {
        out.push(
          `${where}: \`uses: ${spec}\` is not an owner/repo@sha reference — teach this check about it deliberately`,
        );
      } else if (!SHA.test(spec.slice(at + 1))) {
        out.push(
          `${where}: \`uses: ${spec}\` is pinned to a movable ref — pin the full commit SHA and keep the tag in a comment`,
        );
      }
      return;
    }

    if (/^\s*runs-on:/.test(line)) return; // a runner image label, not a downloaded tool

    if (/@latest\b/.test(line)) {
      out.push(`${where}: \`@latest\` downloads whatever is newest when the job runs — pin an exact version`);
    }
    const input = line.match(/^\s*([A-Za-z0-9_-]+):\s*['"]?latest['"]?\s*$/);
    if (input) {
      out.push(
        `${where}: \`${input[1]}: latest\` downloads whatever is newest when the job runs — pin an exact version`,
      );
    }
  });
  return out;
}

function main() {
  const files = readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
  const violations = files.flatMap((f) =>
    findViolations(`.github/workflows/${f}`, readFileSync(join(WORKFLOWS, f), 'utf8')),
  );
  if (violations.length) {
    for (const v of violations) console.error(`::error::${v}`);
    console.error(`\nworkflow pins: ${violations.length} problem(s) across ${files.length} workflow(s)`);
    process.exit(1);
  }
  console.log(
    `workflow pins: ${files.length} workflow(s), every action SHA-pinned and every downloaded tool exact`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
