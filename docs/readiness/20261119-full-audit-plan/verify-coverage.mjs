#!/usr/bin/env node
/**
 * Proves the audit left nothing out.
 *
 *   node docs/readiness/20261119-full-audit-plan/verify-coverage.mjs            # full check
 *   node docs/readiness/20261119-full-audit-plan/verify-coverage.mjs DBM-03     # one package
 *
 * Reads ledger.tsv and units.tsv, then the auditor's records under results/:
 *   results/coverage/<PKG>.tsv   path, blob, ranges, verdict, findings, note
 *   results/units/<PKG>.tsv      path, line, verdict, findings
 *   results/findings/<PKG>.md    one "### F-<PKG>-<nnn>" heading per finding
 *
 * It fails when a file has no row, a row names a different blob, the line ranges do not
 * cover the whole file, a unit has no verdict, a note is missing, or a cited finding
 * does not exist. It also fails when the tree no longer matches the pinned ledger.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const only = process.argv[2];
const VERDICTS = new Set(['clean', 'findings']);
const MIN_NOTE = 40;

const rows = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .slice(1)
    .map((line) => line.split('\t'));

const problems = [];
const fail = (pkg, message) => problems.push(`${pkg}\t${message}`);

const ledger = rows(join(HERE, 'ledger.tsv')).map(([pkg, kind, lines, bytes, blob, path]) => ({
  pkg,
  kind,
  lines: Number(lines),
  blob,
  path,
}));
const units = rows(join(HERE, 'units.tsv')).map(([pkg, path, line]) => ({ pkg, path, line }));

// 1. The tree must still be the one the ledger describes.
const tree = new Map(
  execFileSync('git', ['ls-files', '-s', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const [meta, path] = row.split('\t');
      return [path, meta.split(' ')[1]];
    }),
);
const inLedger = new Set(ledger.map((f) => f.path));
const self = 'docs/readiness/20261119-full-audit-plan/';
if (!only) {
  for (const f of ledger) {
    if (!tree.has(f.path)) fail(f.pkg, `removed since the ledger was pinned: ${f.path}`);
    else if (tree.get(f.path) !== f.blob) fail(f.pkg, `changed since the ledger was pinned: ${f.path}`);
  }
  for (const path of tree.keys()) {
    if (!inLedger.has(path) && !path.startsWith(self)) fail('NEW', `tracked file not in the ledger: ${path}`);
  }
}

// 2. Every file fully read, every unit judged, every cited finding real.
const packages = [...new Set(ledger.map((f) => f.pkg))].filter((p) => !only || p === only);
if (only && !packages.length) fail(only, 'no such package');
let filesDone = 0;
let unitsDone = 0;

for (const pkg of packages) {
  const findingsFile = join(HERE, 'results', 'findings', `${pkg}.md`);
  const known = new Set();
  if (existsSync(findingsFile)) {
    for (const m of readFileSync(findingsFile, 'utf8').matchAll(/^### (F-[A-Z]{3}-\d{2}-\d{3})\b/gm))
      known.add(m[1]);
  } else {
    fail(pkg, 'results/findings file missing (write it even when there are no findings)');
  }
  const cite = (list, where) => {
    for (const id of list.split(/[,\s]+/).filter(Boolean)) {
      if (!known.has(id)) fail(pkg, `${where} cites ${id}, which is not in the findings file`);
    }
  };

  const coverageFile = join(HERE, 'results', 'coverage', `${pkg}.tsv`);
  const coverage = new Map();
  if (existsSync(coverageFile)) for (const r of rows(coverageFile)) coverage.set(r[0], r);
  else fail(pkg, 'results/coverage file missing');

  for (const f of ledger.filter((x) => x.pkg === pkg)) {
    const r = coverage.get(f.path);
    if (!r) {
      fail(pkg, `no coverage row: ${f.path}`);
      continue;
    }
    const [, blob, ranges = '', verdict = '', findings = '', note = ''] = r;
    let ok = true;
    const bad = (message) => {
      ok = false;
      fail(pkg, `${f.path}: ${message}`);
    };
    if (blob !== f.blob) bad('blob differs from the ledger');
    if (!VERDICTS.has(verdict)) bad(`verdict must be clean or findings, got "${verdict}"`);
    if (verdict === 'findings' && !findings.trim()) bad('verdict is findings but none are cited');
    if (note.trim().length < MIN_NOTE) bad(`note shorter than ${MIN_NOTE} characters`);
    cite(findings, f.path);
    if (f.kind === 'text' && f.lines > 0) {
      const seen = new Uint8Array(f.lines + 1);
      for (const part of ranges.split(',').filter(Boolean)) {
        const m = /^(\d+)-(\d+)$/.exec(part.trim());
        if (!m) {
          bad(`unreadable range "${part}"`);
          continue;
        }
        for (let i = Number(m[1]); i <= Math.min(Number(m[2]), f.lines); i += 1) seen[i] = 1;
      }
      let gap = 0;
      for (let i = 1; i <= f.lines; i += 1) if (!seen[i]) gap += 1;
      if (gap) bad(`${gap} of ${f.lines} lines not covered by the recorded ranges`);
    } else if (ranges.trim() !== 'inspected') {
      bad('binary, link or empty file: ranges must be the word "inspected"');
    }
    if (ok) filesDone += 1;
  }

  const unitsFile = join(HERE, 'results', 'units', `${pkg}.tsv`);
  const judged = new Map();
  if (existsSync(unitsFile)) for (const r of rows(unitsFile)) judged.set(`${r[0]}\t${r[1]}`, r);
  const wanted = units.filter((u) => u.pkg === pkg);
  if (wanted.length && !existsSync(unitsFile)) fail(pkg, 'results/units file missing');
  for (const u of wanted) {
    const r = judged.get(`${u.path}\t${u.line}`);
    if (!r) {
      fail(pkg, `no unit verdict: ${u.path}:${u.line}`);
      continue;
    }
    if (!VERDICTS.has(r[2] || '')) fail(pkg, `${u.path}:${u.line}: unit verdict must be clean or findings`);
    else if (r[2] === 'findings' && !(r[3] || '').trim()) fail(pkg, `${u.path}:${u.line}: no finding cited`);
    else unitsDone += 1;
    cite(r[3] || '', `${u.path}:${u.line}`);
  }
}

const totalFiles = ledger.filter((f) => !only || f.pkg === only).length;
const totalUnits = units.filter((u) => !only || u.pkg === only).length;
console.log(
  `files ${filesDone}/${totalFiles}, units ${unitsDone}/${totalUnits}, packages ${packages.length}`,
);
if (problems.length) {
  const shown = problems.slice(0, 200);
  console.error(shown.join('\n'));
  if (problems.length > shown.length) console.error(`... and ${problems.length - shown.length} more`);
  console.error(`\nINCOMPLETE: ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('COMPLETE: every file, line range and unit is accounted for.');
