#!/usr/bin/env node
/**
 * Every sha256 recorded in prose must still describe a file in the tree.
 *
 * CLAUDE.md and docs/MIGRATIONS.md record file fingerprints so that a migration
 * can be re-hashed before it is applied to Production — §15's "verify the
 * artifact, not your picture of it". That control only works while the recorded
 * value is current.
 *
 * It silently stopped working once. `20260910120000_loyalty_multipliers.sql` had
 * its hash recorded from a pre-review draft; review then found a
 * campaign-enumeration oracle, the 16-line fix changed the file, and the record
 * was never recomputed. A squash merge puts the file change and the stale record
 * in the SAME commit, so no diff looks wrong and no reviewer sees a mismatch.
 *
 * What that costs is specific: at apply time the re-hash mismatches, and a stale
 * record cannot be told apart from a tampered file — which is the single
 * distinction the fingerprint exists to make. So the failure mode is not "a doc
 * is out of date", it is "a safety check on a money-path migration now reports
 * an alarm it cannot explain".
 *
 * The check is deliberately format-agnostic. The prose records hashes in several
 * shapes (table cells, inline spans, parenthesised byte counts), and a parser
 * that tried to bind each hash to a filename would be brittle in exactly the
 * places it matters. Instead: every 64-hex string found in the docs must match
 * SOME file currently in the tree. That is weaker than a per-file binding and
 * strong enough to catch staleness, because a stale hash matches nothing.
 *
 * Only sha256 (64 hex) is considered. The money-path function fingerprints are
 * md5 of `pg_get_functiondef(oid)` — 32 hex, live-database values with no file
 * to compare against — and are correctly ignored here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

// A hash deliberately recorded as historical ("before the change it was X").
// None today. Adding one is a claim that the value is meant to match nothing in
// the tree — not a way to silence a stale record.
const HISTORICAL = new Map([]);

const DOC_FILES = ['CLAUDE.md'];
const DOC_DIRS = ['docs'];
const HASHED_DIRS = ['supabase', 'scripts', '.github'];
const SHA256 = /\b[0-9a-f]{64}\b/g;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Index every file that a recorded hash could plausibly describe.
const index = new Map();
for (const dir of HASHED_DIRS) {
  for (const file of walk(dir)) {
    let content;
    try {
      content = readFileSync(file);
    } catch {
      continue;
    }
    const digest = createHash('sha256').update(content).digest('hex');
    if (!index.has(digest)) index.set(digest, []);
    index.get(digest).push(relative('.', file));
  }
}

// Collect every hash the docs record, with where it was written.
const docs = [...DOC_FILES];
for (const dir of DOC_DIRS) {
  for (const file of walk(dir)) if (file.endsWith('.md')) docs.push(file);
}

const stale = [];
let checked = 0;
for (const doc of docs) {
  let text;
  try {
    text = readFileSync(doc, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const hash of lines[i].match(SHA256) ?? []) {
      checked += 1;
      if (index.has(hash) || HISTORICAL.has(hash)) continue;
      stale.push({ doc, line: i + 1, hash });
    }
  }
}

if (stale.length > 0) {
  for (const { doc, line, hash } of stale) {
    console.error(
      `::error file=${doc},line=${line}::recorded sha256 ${hash} matches no file in the tree. ` +
        'Either the file changed and this record is stale (recompute it), or the record is wrong. ' +
        'If it is deliberately a historical value, add it to HISTORICAL in scripts/check-recorded-hashes.mjs with a reason.',
    );
  }
  console.error(
    `\n${stale.length} recorded sha256 value(s) match nothing in the tree; ${checked} checked across ${docs.length} document(s).`,
  );
  process.exit(1);
}

console.log(
  `recorded hashes: ${checked} sha256 value(s) across ${docs.length} document(s) all match a file in the tree`,
);
