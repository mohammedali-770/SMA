#!/usr/bin/env node
/**
 * Guards the NEW design-system code against re-introducing raw values.
 *
 * Deliberately SCOPED, not repo-wide. The existing screens legitimately carry
 * hundreds of literal colours and sizes and will be migrated in a later PR;
 * failing the whole repo today would either block every unrelated change or
 * force a risky mass rewrite. This checks only the directories that are
 * supposed to be token-pure, so the new surface cannot rot while the old one
 * is being migrated.
 *
 *   node scripts/check-design-system-hygiene.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Only these trees must be token-pure. */
const SCOPED_DIRS = [
  join(ROOT, 'design-system'),
  join(ROOT, 'src', 'design-system'),
  join(ROOT, 'apps', 'mobile', 'src', 'design-system'),
];

/** The canonical token/money modules are where literals are *supposed* to live. */
const LITERAL_ALLOWLIST = new Set(['tokens.ts', 'money.ts']);

const RULES = [
  {
    id: 'hardcoded-colour',
    // #abc, #aabbcc, #aabbccdd, rgb(), rgba(), hsl()
    re: /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/,
    message: 'hardcoded colour — import from the design-system tokens instead',
    skipInAllowlisted: true,
  },
  {
    id: 'currency-string',
    // The visible mark is the official SAMA SVG. Never letters, never U+20C0.
    re: /(['"`])\s*(SAR|ر\.س|﷼)\s*\1|⃀/,
    message: 'currency string — render <SaudiRiyalSymbol /> via <Price>, never a text code',
    skipInAllowlisted: false,
  },
  {
    id: 'font-family-literal',
    re: /fontFamily\s*:\s*['"`](?!.*\$)/,
    message: 'font-family literal — use tokens.fontFamily',
    skipInAllowlisted: true,
  },
  {
    id: 'raw-shadow',
    re: /shadowColor\s*:\s*['"`]#/,
    message: 'raw shadow colour — use the elevation tokens',
    skipInAllowlisted: true,
  },
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(full))) out.push(full);
  }
  return out;
}

const violations = [];

for (const dir of SCOPED_DIRS) {
  for (const file of walk(dir)) {
    const base = file.split(/[\\/]/).pop();
    const allowlisted = LITERAL_ALLOWLIST.has(base);
    const raw = readFileSync(file, 'utf8');
    // Comments may discuss values freely (the docblocks explain exactly which
    // literals are banned). Blank out block comments while PRESERVING newlines
    // so reported line numbers still point at real code.
    const withoutBlocks = raw.replace(/\/\*[\s\S]*?\*\//g, (m) =>
      m.replace(/[^\n]/g, ' '),
    );
    const lines = raw.split(/\r?\n/);
    const codeLines = withoutBlocks.split(/\r?\n/);

    codeLines.forEach((codeLine, i) => {
      const line = lines[i] ?? codeLine;
      const code = codeLine.replace(/\/\/.*$/, '');
      if (!code.trim()) return;
      if (/eslint-disable|design-system-allow/.test(line)) return;

      for (const rule of RULES) {
        if (allowlisted && rule.skipInAllowlisted) continue;
        if (rule.re.test(code)) {
          violations.push({
            file: relative(ROOT, file),
            line: i + 1,
            rule: rule.id,
            message: rule.message,
            snippet: line.trim().slice(0, 100),
          });
        }
      }
    });
  }
}

if (violations.length) {
  console.error(`Design-system hygiene: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
    console.error(`    ${v.message}`);
    console.error(`    > ${v.snippet}\n`);
  }
  console.error('Add `// design-system-allow` on the line if it is a justified exception.');
  process.exit(1);
}

console.log('Design-system hygiene: clean.');
