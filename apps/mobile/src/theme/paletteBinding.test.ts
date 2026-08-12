/**
 * Dark-mode retention guard.
 *
 * The generated `color` object is the canonical LIGHT palette. Any React
 * component or module-scope StyleSheet that reads it directly freezes a light
 * colour into the bundle and can become unreadable when the active palette is
 * dark. Runtime surfaces must resolve colours through `useThemeColors()` or a
 * `makeStyles((colors) => ...)` factory.
 *
 * This source scan is intentionally stricter than TypeScript: a direct token
 * read is perfectly type-safe and still visually wrong in dark mode.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'apps/mobile/src';

// A class boundary must still render if the provider tree itself failed.
const EXEMPT = new Set(['apps/mobile/src/components/ObservabilityErrorBoundary.tsx']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function balancedSpan(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return src.length - 1;
}

function factorySpans(src: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of src.matchAll(/makeStyles\(\([A-Za-z_$][\w$]*\)\s*=>\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    spans.push([m.index!, balancedSpan(src, open)]);
  }
  return spans;
}

function stylesheetSpans(src: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of src.matchAll(/StyleSheet\.create\s*\(\s*\{/g)) {
    const open = m.index! + m[0].lastIndexOf('{');
    spans.push([m.index!, balancedSpan(src, open)]);
  }
  return spans;
}

const FN = /^(?:export\s+)?(?:default\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\([\s\S]*?\)\s*(?::[^{;]+)?\{/gm;
const ARROW = /^(?:export\s+)?const\s+(\w+)\s*(?::\s*React\.FC<[^=]*>)?\s*=\s*(?:\([\s\S]*?\)|\w+)\s*=>\s*\{/gm;
const MEMO = /^(?:export\s+)?const\s+\w+\s*=\s*React\.memo\(function\s+(\w+)\s*\([\s\S]*?\)\s*\{/gm;

function offenders(file: string, src: string): string[] {
  const factories = factorySpans(src);
  const staticSheets = stylesheetSpans(src);
  const starts: number[] = [];
  for (const re of [FN, ARROW, MEMO]) {
    for (const m of src.matchAll(re)) starts.push(m.index! + m[0].length);
  }
  starts.sort((a, b) => a - b);

  const found: string[] = [];
  for (const m of src.matchAll(/\bcolor\.\w+/g)) {
    const i = m.index!;
    if (factories.some(([a, b]) => i >= a && i <= b)) continue;

    const line = src.slice(0, i).split('\n').length;
    if (staticSheets.some(([a, b]) => i >= a && i <= b)) {
      found.push(`${file}:${line} → ${m[0]} frozen in StyleSheet.create`);
      continue;
    }

    const enclosing = starts.filter((s) => s <= i).pop();
    if (enclosing === undefined) continue;
    if (src.slice(enclosing, i).includes('const colors = useThemeColors();')) continue;
    found.push(`${file}:${line} → ${m[0]} read directly inside a component`);
  }
  return found;
}

describe('runtime palette binding', () => {
  it('no React surface freezes or reads the light palette directly', () => {
    const bad = walk(ROOT)
      .filter((f) => !EXEMPT.has(f.split('\\').join('/')))
      .flatMap((f) => offenders(f, readFileSync(f, 'utf8')));

    expect(bad).toEqual([]);
  });

  it('the provider-failure exemption stays deliberate', () => {
    expect([...EXEMPT]).toEqual(['apps/mobile/src/components/ObservabilityErrorBoundary.tsx']);
  });
});
