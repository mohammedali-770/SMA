#!/usr/bin/env node
/**
 * Builds the coverage ledger for the full audit.
 *
 *   node docs/readiness/20261119-full-audit-plan/build-ledger.mjs
 *
 * Reads the tracked tree at HEAD and writes, next to this file:
 *   ledger.tsv    one row per tracked file: package, kind, lines, bytes, blob sha, path
 *   units.tsv     one row per named unit (SQL object, TS declaration, workflow job, doc heading)
 *   PACKAGES.md   the work packages, each with its files
 *
 * Every tracked file lands in exactly one package. The script fails if one does not.
 * Files in this directory are the audit's own tooling and are left out.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const SELF = relative(ROOT, HERE).split('\\').join('/') + '/';
const BUDGET = 180_000; // bytes of text per package, about 50k tokens

// Ordered: the first rule that matches wins.
const RULES = [
  ['BIN', 'Binary assets', (p, f) => f.binary],
  ['LNK', 'Symbolic links', (p, f) => f.mode === '120000'],
  ['DEP', 'Lockfiles', (p) => /(^|\/)package-lock\.json$/.test(p) || p === 'skills-lock.json'],
  ['GOV', 'Agent rules and guard hook', (p) => /^(CLAUDE\.md|AGENTS\.md|SECURITY\.md|\.claude\/)/.test(p)],
  ['SKL', 'Vendored agent skills', (p) => p.startsWith('.agents/')],
  ['CIW', 'CI workflows', (p) => p.startsWith('.github/workflows/')],
  [
    'SQH',
    'SQL CI harness, seed and Supabase config',
    (p) => /^(\.github\/sql-ci\/|supabase\/(seed\.sql|config\.toml|README\.md)$)/.test(p),
  ],
  ['SCR', 'Repository scripts', (p) => p.startsWith('scripts/')],
  ['DBM', 'Database migrations, in apply order', (p) => p.startsWith('supabase/migrations/')],
  ['DBT', 'SQL test suites', (p) => p.startsWith('supabase/tests/')],
  [
    'EFP',
    'Edge Functions: payments',
    (p) =>
      /^supabase\/functions\/(payment-[^/]+\/|_shared\/(__fixtures__\/|moyasar|payment|posPaid))/.test(p),
  ],
  [
    'EFL',
    'Edge Functions: POS (Lazywait) and order intake',
    (p) =>
      /^supabase\/functions\/(lazywait-[^/]+\/|order-intake\/|_shared\/(lazywait|syncLog|orderIntake))/.test(
        p,
      ),
  ],
  [
    'EFN',
    'Edge Functions: push and alert dispatch',
    (p) =>
      /^supabase\/functions\/(push-dispatch\/|admin-push-dispatch\/|operations-alert-dispatch\/|_shared\/(push|adminPush|webPush|alertDispatch|smtpTarget|emailTestConfig)|email-test-config\/)/.test(
        p,
      ),
  ],
  [
    'EFA',
    'Edge Functions: auth, OTP, WhatsApp, account deletion, staff, shared core',
    (p) => p.startsWith('supabase/functions/'),
  ],
  ['MCO', 'Mobile: checkout', (p) => p.startsWith('apps/mobile/src/features/checkout/')],
  [
    'MCA',
    'Mobile: cart, menu, product',
    (p) => /^apps\/mobile\/src\/features\/(cart|menu|product)\//.test(p),
  ],
  ['MOR', 'Mobile: order and orders', (p) => /^apps\/mobile\/src\/features\/(order|orders)\//.test(p)],
  [
    'MAU',
    'Mobile: auth, OTP, onboarding, account, notifications, profile, legal',
    (p) => p.startsWith('apps/mobile/src/features/'),
  ],
  ['MLB', 'Mobile: lib, services, store', (p) => /^apps\/mobile\/src\/(lib|services|store)\//.test(p)],
  [
    'MUI',
    'Mobile: routes, components, design system, theme, i18n, types, utils, dev',
    (p) => p.startsWith('apps/mobile/src/'),
  ],
  ['MCF', 'Mobile: project config, plugins, scripts, locales', (p) => p.startsWith('apps/mobile/')],
  ['WLB', 'Console: lib', (p) => p.startsWith('src/lib/')],
  ['WAV', 'Console: admin views', (p) => p.startsWith('src/components/admin/view/')],
  ['WAD', 'Console: admin panels', (p) => p.startsWith('src/components/admin/')],
  ['WOP', 'Console: branch operations', (p) => p.startsWith('src/components/ops/')],
  [
    'WCO',
    'Console: shell, context, shared components, design system, legal, utils',
    (p) => p.startsWith('src/'),
  ],
  ['VND', 'Vendored third-party bundle', (p) => p.startsWith('public/vendor/')],
  [
    'E2E',
    'End-to-end tests, design-system source, public and static assets',
    (p) => /^(e2e|design-system|public|assets)\//.test(p),
  ],
  ['DMG', 'Docs: migration ledger and records', (p) => /^docs\/MIGRATION/.test(p)],
  ['DOW', 'Docs: owner actions', (p) => p === 'docs/OWNER_ACTIONS.md'],
  ['DLG', 'Docs: legal, store, integrations', (p) => /^docs\/(legal|store|integrations)\//.test(p)],
  [
    'DRF',
    'Docs: generated reference, decisions, readiness records',
    (p) => /^docs\/(reference|decisions|readiness)\//.test(p),
  ],
  ['DOC', 'Docs: runbooks, manuals, explanations', (p) => p.startsWith('docs/')],
  ['CFG', 'Root config, entry pages and top-level readmes', () => true],
];

const files = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((row) => {
    const [meta, path] = row.split('\t');
    const [mode, sha] = meta.split(' ');
    return { mode, sha, path };
  })
  .filter((f) => !f.path.startsWith(SELF))
  .sort((a, b) => (a.path < b.path ? -1 : 1));

for (const f of files) {
  f.binary = false;
  f.lines = 0;
  f.bytes = 0;
  const buf = f.mode === '120000' ? Buffer.alloc(0) : readFileSync(join(ROOT, f.path));
  f.bytes = buf.length;
  f.binary = buf.subarray(0, 8000).includes(0);
  if (!f.binary && f.mode !== '120000') {
    f.text = buf.toString('utf8');
    const n = f.text.split('\n').length;
    f.lines = f.text.endsWith('\n') || f.text === '' ? n - 1 : n;
  }
  const rule = RULES.find(([, , test]) => test(f.path, f));
  f.family = rule[0];
}

// Greedy chunking inside each family, in path order, so a source file stays next to its test.
const packages = [];
for (const [id, title] of RULES) {
  const members = files.filter((f) => f.family === id);
  if (!members.length) continue;
  let current = null;
  let n = 0;
  for (const f of members) {
    const size = f.binary ? 0 : f.bytes;
    if (!current || (current.bytes + size > BUDGET && current.files.length > 0)) {
      n += 1;
      current = { id: `${id}-${String(n).padStart(2, '0')}`, title, files: [], bytes: 0, lines: 0 };
      packages.push(current);
    }
    current.files.push(f);
    current.bytes += size;
    current.lines += f.lines;
    f.pkg = current.id;
  }
}

const missing = files.filter((f) => !f.pkg);
if (missing.length) {
  console.error(`${missing.length} file(s) in no package`);
  process.exit(1);
}

const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const kind = (f) => (f.mode === '120000' ? 'link' : f.binary ? 'binary' : 'text');

writeFileSync(
  join(HERE, 'ledger.tsv'),
  [`# pinned commit ${head}`, 'package\tkind\tlines\tbytes\tblob\tpath']
    .concat(files.map((f) => [f.pkg, kind(f), f.lines, f.bytes, f.sha, f.path].join('\t')))
    .join('\n') + '\n',
);

// Named units. A floor for the per-unit verdicts, never a substitute for reading every line.
const UNIT_PATTERNS = [
  [
    /\.sql$/,
    /^\s*(create\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:materialized\s+)?(?:function|procedure|table|view|policy|trigger|index|type|extension|sequence|schema|role|publication))\s+(?:if\s+not\s+exists\s+)?(?:concurrently\s+)?("?[\w.]+"?)/i,
  ],
  [
    /\.sql$/,
    /^\s*(alter\s+table|drop\s+\w+|grant|revoke|alter\s+default\s+privileges|alter\s+function|alter\s+policy|insert\s+into|update|delete\s+from|truncate|select\s+cron\.(?:schedule|unschedule)|do)\b\s*("?[\w.$]*"?)/i,
  ],
  [
    /\.(ts|tsx|mjs|js)$/,
    /^(export\s+default\s+(?:async\s+)?function|export\s+(?:async\s+)?function|export\s+const|export\s+class|export\s+type|export\s+interface|export\s+enum|(?:async\s+)?function|const|class)\s+\*?\s*([A-Za-z_$][\w$]*)/,
  ],
  [/\.(ts|tsx)$/, /^(Deno\.serve|serve)\(()/],
  [/\.(ts|tsx|mjs|js)$/, /^\s*(describe|it|test)(?:\.\w+)?\(\s*(['"`].{0,80})/],
  [/\.ya?ml$/, /^(\s{0,4})([\w-]+):\s*$/],
  [/\.sh$/, /^(function\s+)?([A-Za-z_][\w]*)\s*\(\)\s*\{/],
  [/\.md$/, /^(#{1,4})\s+(.{1,100})/],
];
const units = ['package\tpath\tline\tkind\tname'];
for (const f of files) {
  if (!f.text) continue;
  const patterns = UNIT_PATTERNS.filter(([ext]) => ext.test(f.path));
  if (!patterns.length) continue;
  f.text.split('\n').forEach((line, i) => {
    for (const [, re] of patterns) {
      const m = re.exec(line);
      if (!m) continue;
      const name = (m[2] || '').trim().replace(/\t/g, ' ');
      const what = (m[1] || '').trim().replace(/\s+/g, ' ').toLowerCase() || 'block';
      units.push([f.pkg, f.path, i + 1, what, name].join('\t'));
      break;
    }
  });
}
writeFileSync(join(HERE, 'units.tsv'), units.join('\n') + '\n');

const md = [
  '# Work packages',
  '',
  `Generated by \`build-ledger.mjs\` from commit \`${head}\`. Do not edit by hand.`,
  '',
  `${packages.length} packages, ${files.length} files, ${files.reduce((s, f) => s + f.lines, 0)} lines of text.`,
  '',
  '| Package | Scope | Files | Lines | Bytes |',
  '| --- | --- | ---: | ---: | ---: |',
  ...packages.map((p) => `| ${p.id} | ${p.title} | ${p.files.length} | ${p.lines} | ${p.bytes} |`),
  '',
];
for (const p of packages) {
  md.push(`## ${p.id}: ${p.title}`, '');
  for (const f of p.files) md.push(`- \`${f.path}\` (${kind(f) === 'text' ? `${f.lines} lines` : kind(f)})`);
  md.push('');
}
writeFileSync(join(HERE, 'PACKAGES.md'), md.join('\n'));

console.log(`${packages.length} packages, ${files.length} files, ${units.length - 1} units, pinned ${head}`);
