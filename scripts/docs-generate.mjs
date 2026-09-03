#!/usr/bin/env node
/**
 * Generates the machine-derived half of the documentation set.
 *
 *   node scripts/docs-generate.mjs           # write docs/reference/*.md
 *   node scripts/docs-generate.mjs --check   # fail if any generated file drifted
 *
 * WHY generate instead of hand-writing: an inventory is the part of
 * documentation that rots fastest and matters most during an incident. Nobody
 * remembers to add a row to a table of Edge Functions when they add the
 * twenty-third one. A generator plus the --check mode in CI means the inventory
 * is either correct or the build is red — the same posture as
 * scripts/sync-design-system.mjs, which this deliberately mirrors.
 *
 * SCOPE BOUNDARY, and it is the important one: everything here describes THE
 * REPOSITORY, never Production. The Supabase CLI exposes no content hash and
 * this script makes no network call, so a table listed here is a table some
 * migration declares — not proof of what the live database holds. Live state is
 * verified read-only and recorded with a date in docs/OWNER_ACTIONS.md.
 * Do not let these files grow a claim they cannot support.
 *
 * Output is deterministic: everything is sorted, and nothing stamps a date or a
 * commit. A timestamp would make --check fail on every run, which would train
 * people to bypass it.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'reference');
const CHECK = process.argv.includes('--check');

/* ------------------------------------------------------------------ utils */

const read = (p) => readFileSync(p, 'utf8');
const posix = (p) => p.split(sep).join('/');

/** Recursively list files under `dir`, skipping node_modules and build output. */
function walk(dir, filter = () => true, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.expo') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, filter, acc);
    else if (filter(full)) acc.push(full);
  }
  return acc;
}

function banner(title, sources, intro) {
  return [
    '<!-- ------------------------------------------------------------------',
    '     GENERATED FILE — DO NOT EDIT.',
    '     Regenerate with: npm run docs:generate',
    '     CI fails if this file drifts from its source (npm run docs:check).',
    `     Derived from: ${sources}`,
    '     Describes the REPOSITORY, not live Production.',
    '     ------------------------------------------------------------------ -->',
    '',
    `# ${title}`,
    '',
    intro,
    '',
    '',
  ].join('\n');
}

/** Escape a value for use inside a Markdown table cell. */
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

/**
 * The comment at the TOP of a source file, whichever style it uses. Both
 * conventions appear in this repository: Edge Functions tend to open with a
 * run of `//` lines, app modules with a JSDoc block.
 *
 * Only the leading comment counts. An earlier version took the first block
 * comment anywhere in the file, which happily described an unrelated helper
 * halfway down and presented it as the module's purpose.
 */
function leadingComment(source) {
  const lines = source.split(/\r?\n/);
  const out = [];
  let inBlock = false;
  let inImport = false;

  for (const raw of lines.slice(0, 80)) {
    const line = raw.trim();

    if (inBlock) {
      out.push(line.replace(/^\/\*\*?/, '').replace(/\*\/\s*$/, '').replace(/^\*\s?/, ''));
      if (line.includes('*/')) break;
      continue;
    }
    if (out.length) {
      // Already collecting `//` lines: stop at the first line that is not one.
      if (line.startsWith('//')) { out.push(line.replace(/^\/\/\s?/, '')); continue; }
      break;
    }
    if (line.startsWith('/*')) {
      inBlock = true;
      out.push(line.replace(/^\/\*\*?/, '').replace(/\*\/\s*$/, ''));
      if (line.includes('*/')) break;
      continue;
    }
    if (line.startsWith('//')) { out.push(line.replace(/^\/\/\s?/, '')); continue; }

    // Imports sit above the header in this repository, and many of them span
    // several lines. Track the import block explicitly: a specifier line such
    // as `type CatalogEntityType,` must not be mistaken for the start of real
    // code, or the header below it is never reached.
    if (/^import\b/.test(line)) { inImport = !/\bfrom\b|;\s*$/.test(line); continue; }
    if (inImport) { if (/\bfrom\b|^\}/.test(line)) inImport = false; continue; }

    // Real code has started and there was no header comment.
    if (/^(export|const|let|var|function|class|async|serve|Deno\.serve)\b/.test(line)) break;
  }
  return out.map((l) => l.trim()).filter(Boolean);
}

/** Trim to a whole word near `max` characters rather than mid-word. */
function clamp(text, max = 150) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:—-]$/, '') + '…';
}

/**
 * One-line summary of a module. Prefers this repository's own convention —
 * a header opening `<name> — what it is` — and falls back to the first
 * sentence of the leading comment. Returns '' rather than inventing a summary.
 */
function headerSummary(source, name) {
  const lines = leadingComment(source);
  if (!lines.length) return '';

  let start = 0;
  if (name) {
    const idx = lines.findIndex((l) => new RegExp(`^${name}\\b\\s*[—–-]`).test(l));
    if (idx >= 0) {
      start = idx;
      lines[idx] = lines[idx].replace(new RegExp(`^${name}\\b\\s*[—–-]\\s*`), '');
    }
  }

  let text = '';
  for (const line of lines.slice(start)) {
    if (/^(?:[-*\u2022]\s|\d+[.)]\s)/.test(line) && text) break; // a list has started; the prose is over
    text = text ? `${text} ${line}` : line;
    if (/[.:]$/.test(line)) break;
    if (text.length > 150) break;
  }
  return clamp(text.replace(/\s+/g, ' ').replace(/[.\s]+$/, ''));
}

/* -------------------------------------------------------- 1. app surface */

function generateAppSurface() {
  const routeDir = join(ROOT, 'apps', 'mobile', 'src', 'app');
  const routes = walk(routeDir, (f) => f.endsWith('.tsx'))
    .map((f) => posix(relative(routeDir, f)))
    .sort();

  /** expo-router: file path → URL path. */
  const toUrl = (file) => {
    const noExt = file.replace(/\.tsx$/, '');
    if (noExt.endsWith('_layout')) return null; // layouts are not routes
    const segments = noExt.split('/').filter((s) => s !== 'index' || noExt === 'index');
    const url = '/' + segments.join('/');
    return url === '/index' ? '/' : url.replace(/\/index$/, '');
  };

  const routeRows = routes
    .map((f) => ({ file: f, url: toUrl(f) }))
    .filter((r) => r.url !== null)
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((r) => {
      // `dev-*` screens exist for fixture and instrumentation review and are not
      // part of the customer journey; saying so here stops them being mistaken
      // for shipped features during a review.
      const note = /^\/dev-/.test(r.url) ? ' _(development only)_' : '';
      return `| \`${cell(r.url)}\` | \`apps/mobile/src/app/${cell(r.file)}\`${note} |`;
    });

  const layouts = routes.filter((f) => f.endsWith('_layout.tsx'));

  const panelDir = join(ROOT, 'src', 'components', 'admin');
  const panels = existsSync(panelDir)
    ? readdirSync(panelDir)
        .filter((f) => f.endsWith('Panel.tsx') && !f.includes('.test.'))
        .sort()
    : [];
  const panelRows = panels.map((f) => {
    const summary = headerSummary(read(join(panelDir, f)), f.replace(/\.tsx$/, ''));
    return `| ${cell(f.replace(/\.tsx$/, ''))} | ${cell(summary || '—')} |`;
  });

  const featureDir = join(ROOT, 'apps', 'mobile', 'src', 'features');
  const features = existsSync(featureDir)
    ? readdirSync(featureDir)
        .filter((f) => statSync(join(featureDir, f)).isDirectory())
        .sort()
    : [];
  const featureRows = features.map((f) => {
    const files = walk(join(featureDir, f), (x) => /\.tsx?$/.test(x) && !x.includes('.test.'));
    return `| \`${cell(f)}\` | ${files.length} |`;
  });

  return (
    banner(
      'Application surface',
      '`apps/mobile/src/app/`, `apps/mobile/src/features/`, `src/components/admin/`',
      'Every screen a customer can reach, every panel an administrator can open, and the feature modules behind them. Use this to find the code for a screen someone is describing, and to see at a glance what shipping surface exists.',
    ) +
    [
      '## Customer app routes',
      '',
      'The customer app uses expo-router, so the file path *is* the route. A path segment in square brackets is a parameter.',
      '',
      '| Route | File |',
      '| --- | --- |',
      ...routeRows,
      '',
      `Layout files (not routes of their own): ${layouts.map((l) => `\`${l}\``).join(', ') || 'none'}.`,
      '',
      '## Customer feature modules',
      '',
      'Screens are thin. Behaviour lives in feature modules, each of which keeps its pure logic in framework-free files so it can be unit-tested under Node.',
      '',
      '| Module | Source files |',
      '| --- | --- |',
      ...featureRows,
      '',
      '## Admin console panels',
      '',
      'The admin console is panel-based rather than routed: one component per operational area, summarised from each file’s header comment.',
      '',
      '| Panel | Purpose |',
      '| --- | --- |',
      ...panelRows,
      '',
    ].join('\n')
  );
}

/* ----------------------------------------------------- 2. edge functions */

function generateEdgeFunctions() {
  const fnDir = join(ROOT, 'supabase', 'functions');
  const names = readdirSync(fnDir)
    .filter((f) => statSync(join(fnDir, f)).isDirectory() && f !== '_shared')
    .sort();

  // Which functions the deploy workflow actually covers. Everything else
  // reaches production by hand, which is a real operational risk worth showing.
  const deployWorkflow = join(ROOT, '.github', 'workflows', 'deploy-functions.yml');
  const deployText = existsSync(deployWorkflow) ? read(deployWorkflow) : '';

  const rows = names.map((name) => {
    const entry = join(fnDir, name, 'index.ts');
    const src = existsSync(entry) ? read(entry) : '';
    const summary = headerSummary(src, name);
    const automated = deployText.includes(name) ? 'workflow' : 'by hand';
    // The column means the PRIVILEGE, not the helper, so match every way a
    // function can come to hold the service-role key:
    //
    //   adminClient()    the supabase-js helper, the original and still the
    //                    common case;
    //   serviceTarget()  the same on the dependency-free PostgREST path
    //                    (_shared/rest.ts), added when order-intake dropped
    //                    supabase-js — before which this heuristic relabelled a
    //                    function that still reads an integration secret as
    //                    `caller JWT`;
    //   the env var      read directly. `account-delete-scheduler` builds its
    //                    own client from SUPABASE_SERVICE_ROLE_KEY and uses
    //                    neither helper, so BOTH earlier versions of this
    //                    heuristic printed `caller JWT` for the function that
    //                    deletes accounts — the one row a security reviewer
    //                    using this column as an index could least afford to
    //                    skip.
    const usesAdmin = /\badminClient\b|\bserviceTarget\b|\bSUPABASE_SERVICE_ROLE_KEY\b/.test(src)
      ? 'service role'
      : 'caller JWT';
    return `| \`${cell(name)}\` | ${cell(summary || '—')} | ${automated} | ${usesAdmin} |`;
  });

  const shared = walk(join(fnDir, '_shared'), (f) => f.endsWith('.ts'))
    .map((f) => posix(relative(join(fnDir, '_shared'), f)))
    .sort();

  return (
    banner(
      'Edge Functions',
      '`supabase/functions/`, `.github/workflows/deploy-functions.yml`',
      'Every Deno Edge Function in the repository, what it does, how it reaches production, and whether it can act with the service role.',
    ) +
    [
      '**Read the deployment column carefully.** A function marked *by hand* has no automated deploy path, so the repository cannot tell you which commit is running in production. `.github/workflows/function-drift.yml` compares the deployed *set* of function names against this list; it cannot compare content. It runs on demand only — the schedule was removed on 2026-09-02 — and needs a `SUPABASE_ACCESS_TOKEN` that `docs/OWNER_ACTIONS.md` §15 recommends against creating.',
      '',
      '**Privilege column.** *service role* means the function can obtain the service-role key — through `adminClient()`, through `serviceTarget()` on the dependency-free PostgREST path, or by reading `SUPABASE_SERVICE_ROLE_KEY` itself — and can therefore bypass RLS. Those functions are the ones to read first in a security review: the caller’s identity is not the thing limiting what they can touch. A function may hold it for one narrow read and still use the caller’s own JWT for everything customer-facing; `order-intake` does exactly that.',
      '',
      '| Function | Purpose | Deployment | Highest privilege |',
      '| --- | --- | --- | --- |',
      ...rows,
      '',
      '## Shared modules',
      '',
      'Code under `supabase/functions/_shared/` is imported by the functions above and is not itself deployable.',
      '',
      ...shared.map((f) => `- \`_shared/${f}\``),
      '',
    ].join('\n')
  );
}

/* ----------------------------------------------------------- 3. database */

function generateDatabase() {
  const migDir = join(ROOT, 'supabase', 'migrations');
  const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

  const tables = new Map(); // name -> { created, altered:Set }
  const functions = new Map(); // name -> Set(migration)
  const policies = new Map(); // table -> count
  const triggers = new Set();

  for (const file of files) {
    const sql = read(join(migDir, file));
    const lower = sql.toLowerCase();

    for (const m of lower.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\s*\.\s*)?([a-z0-9_]+)/g)) {
      const name = m[1];
      if (name === 'public') continue; // schema qualifier, not a table
      if (!tables.has(name)) tables.set(name, { created: file, altered: new Set() });
    }
    for (const m of lower.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\s*\.\s*)?([a-z0-9_]+)/g)) {
      const name = m[1];
      if (name === 'public') continue; // schema qualifier, not a table
      if (!tables.has(name)) tables.set(name, { created: '(not created in repo)', altered: new Set() });
      if (tables.get(name).created !== file) tables.get(name).altered.add(file);
    }
    for (const m of lower.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\s*\.\s*)?([a-z0-9_]+)/g)) {
      if (!functions.has(m[1])) functions.set(m[1], new Set());
      functions.get(m[1]).add(file);
    }
    for (const m of lower.matchAll(/create\s+policy\s+[a-z0-9_"]+\s+on\s+(?:public\s*\.\s*)?([a-z0-9_]+)/g)) {
      policies.set(m[1], (policies.get(m[1]) ?? 0) + 1);
    }
    for (const m of lower.matchAll(/create\s+trigger\s+([a-z0-9_]+)/g)) triggers.add(m[1]);
  }

  const tableRows = [...tables.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, info]) => {
      const pol = policies.get(name);
      return `| \`${cell(name)}\` | \`${cell(info.created)}\` | ${info.altered.size} | ${pol ? pol : '**none declared**'} |`;
    });

  const fnRows = [...functions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, migs]) => {
      const list = [...migs].sort();
      return `| \`${cell(name)}\` | ${list.length} | \`${cell(list[list.length - 1])}\` |`;
    });

  return (
    banner(
      'Database objects',
      '`supabase/migrations/*.sql`',
      'Tables, functions, policies and triggers **as declared by the migrations in this repository**.',
    ) +
    [
      '> This is a source-derived index, not a live schema dump. It is built by reading migration text, so it shows what the repository declares. For what Production actually holds — including migration-history rows that have no file here — see the dated read-only snapshot in [`../OWNER_ACTIONS.md`](../OWNER_ACTIONS.md) and [`../MIGRATION_RECONCILIATION_20260812.md`](../MIGRATION_RECONCILIATION_20260812.md). Never reconcile the two by applying anything.',
      '',
      `Migration files in the repository: **${files.length}**. Earliest \`${files[0]}\`, latest \`${files[files.length - 1]}\`.`,
      '',
      '## Tables',
      '',
      'The *RLS policies* column counts `create policy` statements across all migrations. A table showing **none declared** either is not client-reachable or is a genuine gap — check before assuming the former.',
      '',
      '| Table | Created in | Later migrations altering it | RLS policies |',
      '| --- | --- | --- | --- |',
      ...tableRows,
      '',
      '## Functions and RPCs',
      '',
      'A function defined by more than one migration has been redefined; the last definition wins. Several of these are `security definer`, which means they run with the definer’s rights rather than the caller’s — read the migration before changing one.',
      '',
      '| Function | Definitions | Last defined in |',
      '| --- | --- | --- |',
      ...fnRows,
      '',
      '## Triggers',
      '',
      `${triggers.size} trigger names are declared across the migration set: ${[...triggers].sort().map((t) => `\`${t}\``).join(', ')}.`,
      '',
    ].join('\n')
  );
}

/* ------------------------------------------------------------ 4. testing */

function generateTesting() {
  // Derive the roots from vitest.config.ts rather than hardcoding them. An
  // earlier version listed three directories by hand, and quietly missed every
  // suite under supabase/functions/ while inventing a design-system group that
  // vitest does not collect at all.
  const config = read(join(ROOT, 'vitest.config.ts'));
  const includeBlock = (config.match(/include:\s*\[([\s\S]*?)\]/) ?? [])[1] ?? '';
  const patterns = [...includeBlock.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);

  const roots = [...new Set(patterns.map((p) => p.split('/**')[0]))].sort();

  const sections = roots.map((root) => {
    const files = walk(join(ROOT, root), (f) => /\.test\.tsx?$/.test(f));
    const rows = files
      .map((f) => {
        const src = read(f);
        const suites = [...src.matchAll(/^\s*describe(?:\.\w+)?\(\s*['"`]([^'"`]+)/gm)].map((m) => m[1]);
        // Counts DECLARED blocks. `it.each([...])` is one block that expands to
        // one case per row, so this is a floor, not the executed total.
        const blocks = (src.match(/^\s*(?:it|test)(?:\.\w+)?\s*[(`]/gm) ?? []).length;
        return { path: posix(relative(ROOT, f)), blocks, first: suites[0] ?? '' };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    return {
      root,
      count: files.length,
      blocks: rows.reduce((n, r) => n + r.blocks, 0),
      body: [
        `### \`${root}/\``,
        '',
        `${files.length} files, ${rows.reduce((n, r) => n + r.blocks, 0)} declared test blocks.`,
        '',
        '| File | Blocks | First suite |',
        '| --- | --- | --- |',
        ...rows.map((r) => `| \`${cell(r.path)}\` | ${r.blocks} | ${cell(r.first) || '—'} |`),
        '',
      ].join('\n'),
    };
  });

  const sqlDir = join(ROOT, 'supabase', 'tests');
  const sqlFiles = existsSync(sqlDir) ? readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort() : [];

  const fileTotal = sections.reduce((n, s) => n + s.count, 0);
  const blockTotal = sections.reduce((n, s) => n + s.blocks, 0);

  return (
    banner(
      'Test inventory',
      '`vitest.config.ts`, the test files it collects, `supabase/tests/*.sql`',
      'What is tested, where those tests live, and how to run them. Use it to find whether a behaviour you are about to change already has coverage.',
    ) +
    [
      `**${fileTotal} TypeScript test files declaring ${blockTotal} test blocks, plus ${sqlFiles.length} SQL suites.**`,
      '',
      '> The block count is a **floor, not the executed total**. A parameterised `it.each([...])` is one declared block that runs once per row, so vitest reports more cases than are counted here. `npm test` is the authoritative number; this table is for finding files, not for reporting coverage.',
      '',
      '## Running the tests',
      '',
      '| Command | Runs |',
      '| --- | --- |',
      '| `npm test` | Every Vitest suite once |',
      '| `npm run test:watch` | Vitest in watch mode |',
      '| `npm run lint` | TypeScript, no emit |',
      '| `npm run design-system:check` | Design-system mirrors and hygiene |',
      '| `npm run docs:check` | Documentation drift and ownership |',
      '',
      'Vitest runs under the **Node** environment, not jsdom or a device; suites that need a DOM opt in per file with a `@vitest-environment jsdom` docblock. A mobile test file therefore cannot import `react-native`. This is why feature modules keep their rules in pure, framework-free files — those are the parts under test.',
      '',
      '## SQL suites',
      '',
      'SQL suites run against a **disposable** database, never Production (CLAUDE.md §10). `.github/workflows/sql-suites.yml` gates them, and the heavier migration-chain job is path-gated so it only runs when SQL changes.',
      '',
      ...sqlFiles.map((f) => `- \`supabase/tests/${f}\``),
      '',
      '## TypeScript suites',
      '',
      `Collected from the \`include\` patterns in \`vitest.config.ts\`: ${patterns.map((p) => `\`${p}\``).join(', ')}.`,
      '',
      ...sections.map((s) => s.body),
    ].join('\n')
  );
}

/* -------------------------------------------------------- 5. environment */

function generateEnvironment() {
  const clientVars = new Set();
  const serverVars = new Set();

  for (const f of walk(join(ROOT, 'src'), (x) => /\.tsx?$/.test(x))) {
    for (const m of read(f).matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) clientVars.add(m[1]);
  }
  for (const f of walk(join(ROOT, 'apps', 'mobile', 'src'), (x) => /\.tsx?$/.test(x))) {
    for (const m of read(f).matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)) clientVars.add(m[1]);
  }
  for (const f of walk(join(ROOT, 'supabase', 'functions'), (x) => x.endsWith('.ts'))) {
    for (const m of read(f).matchAll(/Deno\.env\.get\(\s*['"]([A-Z0-9_]+)['"]/g)) serverVars.add(m[1]);
  }

  return (
    banner(
      'Environment variables',
      '`src/`, `apps/mobile/src/`, `supabase/functions/`',
      'Every environment variable the code reads, split by whether its value is visible to anyone who downloads the app. **Names only — this file must never carry a value.**',
    ) +
    [
      '## Client-visible',
      '',
      '`VITE_*` and `EXPO_PUBLIC_*` values are compiled into the shipped bundle. Anyone can read them out of the app. Only ever put credentials here that are *designed* to be public client credentials, such as a Supabase publishable key or a bundle-restricted map token (CLAUDE.md §9).',
      '',
      ...[...clientVars].sort().map((v) => `- \`${v}\``),
      '',
      '## Server-side only',
      '',
      'Read by Edge Functions from the Deno environment. These are secrets. They live in the Supabase dashboard and in EAS, never in the repository, and they must not appear in logs, tests, fixtures or pull-request descriptions.',
      '',
      ...[...serverVars].sort().map((v) => `- \`${v}\``),
      '',
      '> Presence in this list means the code *reads* the variable. It does not prove the variable is configured in any environment. A missing secret usually surfaces as a function returning a configuration error rather than a build failure.',
      '',
    ].join('\n')
  );
}

/* ------------------------------------------------------ 6. CI and scripts */

function generateCiAndScripts() {
  const wfDir = join(ROOT, '.github', 'workflows');
  const workflows = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];

  const wfRows = workflows.map((f) => {
    const text = read(join(wfDir, f));
    const name = (text.match(/^name:\s*(.+)$/m) ?? [])[1]?.trim() ?? f;
    // The status check context GitHub reports is the job's `name:` when it has
    // one, and otherwise the job ID. `design-system.yml` relies on the latter,
    // which is why CLAUDE.md §12 requires the context `design-system` rather
    // than the workflow's display name `Design system`. Getting this wrong is
    // how a required check ends up configured against a context that never
    // reports.
    const jobsBlock = text.split(/^jobs:\s*$/m)[1] ?? '';
    const jobNames = [];
    let currentJob = null;
    for (const line of jobsBlock.split(/\r?\n/)) {
      const id = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
      if (id) {
        if (currentJob) jobNames.push(currentJob.name ?? currentJob.id);
        currentJob = { id: id[1], name: null };
        continue;
      }
      const nm = line.match(/^ {4}name:\s*(.+?)\s*$/);
      if (nm && currentJob && currentJob.name === null) currentJob.name = nm[1].replace(/^['"]|['"]$/g, '');
    }
    if (currentJob) jobNames.push(currentJob.name ?? currentJob.id);
    const triggers = [];
    if (/^on:[\s\S]*?pull_request/m.test(text)) triggers.push('pull request');
    if (/^on:[\s\S]*?\bpush:/m.test(text)) triggers.push('push');
    if (/schedule:/.test(text)) triggers.push('schedule');
    if (/workflow_dispatch/.test(text)) triggers.push('manual');
    return `| \`${cell(f)}\` | ${cell(name)} | ${cell(triggers.join(', ') || '—')} | ${jobNames.length ? jobNames.map((j) => `\`${cell(j)}\``).join('<br>') : '—'} |`;
  });

  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  const scriptRows = Object.entries(pkg.scripts ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `| \`npm run ${cell(k)}\` | \`${cell(v)}\` |`);

  const localScripts = readdirSync(join(ROOT, 'scripts')).sort();

  return (
    banner(
      'CI gates, workflows and scripts',
      '`.github/workflows/`, `package.json`, `scripts/`',
      'Every automated check that can run against a change, and every command you can run locally.',
    ) +
    [
      '## Workflows',
      '',
      'The *job name* is what GitHub reports as a status check context. When configuring required checks in **Settings → Rules**, use these emitted names — not the workflow display name (CLAUDE.md §12).',
      '',
      '| File | Workflow | Triggers | Jobs (status check contexts) |',
      '| --- | --- | --- | --- |',
      ...wfRows,
      '',
      '> Which contexts are actually *required* is GitHub dashboard state that this repository cannot read. Verify it live before claiming a red merge is blocked.',
      '',
      '## npm scripts',
      '',
      '| Command | Runs |',
      '| --- | --- |',
      ...scriptRows,
      '',
      '## Repository scripts',
      '',
      ...localScripts.map((f) => {
        const summary = /\.mjs$/.test(f) ? headerSummary(read(join(ROOT, 'scripts', f))) : '';
        return `- \`scripts/${f}\`${summary ? ` — ${summary}` : ''}`;
      }),
      '',
    ].join('\n')
  );
}

/* --------------------------------------------------------------- 7. index */

function generateIndex() {
  return (
    banner(
      'Generated reference',
      '`scripts/docs-generate.mjs`',
      'Machine-derived inventories of the system. Everything in this directory is regenerated from source; editing a file here by hand will be reverted by the next run and fails CI in the meantime.',
    ) +
    [
      '| Document | Answers |',
      '| --- | --- |',
      '| [Application surface](app-surface.md) | Which screens and panels exist, and where their code lives |',
      '| [Edge Functions](edge-functions.md) | What each function does, how it deploys, whether it can bypass RLS |',
      '| [Database objects](database.md) | Which tables, RPCs, policies and triggers the migrations declare |',
      '| [Test inventory](testing.md) | What is covered, where the tests are, how to run them |',
      '| [Environment variables](environment.md) | Which variables the code reads, and which of them are public |',
      '| [CI gates and scripts](ci-and-scripts.md) | Which checks run, what they are called, what you can run locally |',
      '',
      '## Regenerating',
      '',
      '```sh',
      'npm run docs:generate   # rewrite these files',
      'npm run docs:check      # fail if they drifted, and check documentation ownership',
      '```',
      '',
      '`docs:check` runs in CI. A change that alters the shape of the system — a new route, a new Edge Function, a new table, a new environment variable — will turn CI red until the reference is regenerated and committed. That is the intended behaviour: it is how the inventory stays true without anybody having to remember.',
      '',
      '## What is deliberately *not* here',
      '',
      'These files describe the repository. They cannot describe live Production — no network call is made — and they carry no rationale. Why a thing is built the way it is belongs in an [architecture decision record](../decisions/README.md); what to do when it breaks belongs in a runbook; what Production currently holds is verified read-only and dated in [`../OWNER_ACTIONS.md`](../OWNER_ACTIONS.md).',
      '',
    ].join('\n')
  );
}

/* ----------------------------------------------------------------- main */

const OUTPUTS = [
  ['app-surface.md', generateAppSurface],
  ['edge-functions.md', generateEdgeFunctions],
  ['database.md', generateDatabase],
  ['testing.md', generateTesting],
  ['environment.md', generateEnvironment],
  ['ci-and-scripts.md', generateCiAndScripts],
];

mkdirSync(OUT_DIR, { recursive: true });

const drifted = [];
const written = [];

for (const [name, fn] of [...OUTPUTS, ['README.md', generateIndex]]) {
  const target = join(OUT_DIR, name);
  const next = fn().replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  const current = existsSync(target) ? read(target) : null;
  if (current === next) continue;
  if (CHECK) drifted.push(posix(relative(ROOT, target)));
  else {
    writeFileSync(target, next);
    written.push(posix(relative(ROOT, target)));
  }
}

if (CHECK) {
  if (drifted.length) {
    console.error('Generated documentation is out of date:\n');
    for (const f of drifted) console.error(`  ${f}`);
    console.error('\nRun `npm run docs:generate` and commit the result.');
    process.exit(1);
  }
  console.log('Generated documentation is up to date.');
} else if (written.length) {
  console.log(`Wrote ${written.length} file(s):`);
  for (const f of written) console.log(`  ${f}`);
} else {
  console.log('Generated documentation already up to date.');
}
