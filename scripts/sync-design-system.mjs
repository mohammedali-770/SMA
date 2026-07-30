#!/usr/bin/env node
/**
 * Mirrors the canonical design-system modules into each app.
 *
 * WHY a generator instead of a shared package: this repo is not an npm
 * workspace. `apps/mobile` has its own node_modules and lockfile, Metro has no
 * watchFolders, and the mobile build runs `npm --prefix apps/mobile ci`
 * independently. A real workspace package would need Metro resolver + EAS build
 * changes; that infra work does not belong in the same PR as the design port.
 *
 *   node scripts/sync-design-system.mjs           # write mirrors
 *   node scripts/sync-design-system.mjs --check   # fail if a mirror drifted
 *
 * The --check mode runs in CI so a hand-edited mirror cannot reach the default
 * branch.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Canonical modules, in the order they should be listed in reviews. */
const MODULES = ['tokens.ts', 'money.ts', 'buttonState.ts', 'fieldState.ts'];

/** Every app that consumes the design system. */
const TARGETS = [
  { name: 'web', dir: join(ROOT, 'src', 'design-system', 'generated') },
  { name: 'mobile', dir: join(ROOT, 'apps', 'mobile', 'src', 'design-system', 'generated') },
];

const SOURCE_DIR = join(ROOT, 'design-system');

function banner(moduleName) {
  const from = `design-system/${moduleName}`;
  return [
    '/* eslint-disable */',
    '// ---------------------------------------------------------------------------',
    '// GENERATED FILE — DO NOT EDIT.',
    `// Source of truth: ${from}`,
    '// Regenerate with: npm run design-system:sync',
    '// CI fails if this file drifts from its source (design-system:check).',
    '// ---------------------------------------------------------------------------',
    '',
  ].join('\n');
}

function render(moduleName) {
  const src = readFileSync(join(SOURCE_DIR, moduleName), 'utf8');
  return banner(moduleName) + src;
}

const check = process.argv.includes('--check');
const problems = [];
let written = 0;

for (const moduleName of MODULES) {
  const sourcePath = join(SOURCE_DIR, moduleName);
  if (!existsSync(sourcePath)) {
    problems.push(`missing canonical module: ${relative(ROOT, sourcePath)}`);
    continue;
  }
  const expected = render(moduleName);

  for (const target of TARGETS) {
    const outPath = join(target.dir, moduleName);
    if (check) {
      if (!existsSync(outPath)) {
        problems.push(`missing mirror: ${relative(ROOT, outPath)}`);
        continue;
      }
      const actual = readFileSync(outPath, 'utf8');
      // Normalise line endings so a Windows checkout does not report drift.
      if (actual.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
        problems.push(`drifted: ${relative(ROOT, outPath)}`);
      }
    } else {
      mkdirSync(target.dir, { recursive: true });
      writeFileSync(outPath, expected, 'utf8');
      written += 1;
    }
  }
}

if (check) {
  if (problems.length) {
    console.error('Design-system mirrors are out of sync:\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\nRun: npm run design-system:sync');
    process.exit(1);
  }
  console.log(`design-system: ${MODULES.length} module(s) in sync across ${TARGETS.length} app(s).`);
} else {
  if (problems.length) {
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`design-system: wrote ${written} mirrored file(s).`);
}
