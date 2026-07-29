/**
 * Guards against the one dark-mode bug TypeScript cannot see.
 *
 * `colors` is exported from the theme module as the LIGHT palette, so a
 * component that writes `color={colors.ink}` compiles perfectly and renders a
 * near-black label on a near-black card in dark mode. That is exactly what
 * happened to the menu's price when this app was converted: the compiler was
 * happy, the tests were green, and the number was invisible.
 *
 * The rule this enforces: inside a component, every `colors.*` reference must
 * resolve to the ACTIVE palette — either the `colors` parameter of a
 * `makeStyles` factory, or a local `const colors = useThemeColors()`. A
 * module-scope reference is only legal outside components (constants, and the
 * error boundary, which is a class and renders when providers are broken).
 *
 * This is a source scan rather than a lint rule because the repo has no ESLint
 * config; running it in vitest means it fails in the same place everything else
 * does.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'apps/mobile/src';

// A class component cannot call a hook, and this boundary must render when the
// provider tree itself has failed — so it stays on the light palette by design.
const EXEMPT = new Set(['apps/mobile/src/components/ObservabilityErrorBoundary.tsx']);

// Signatures span lines in this codebase (multi-line destructured props), so the
// parameter list is matched lazily across newlines. Getting this wrong is not
// academic: it was a single-line `\([^)]*\)` here that attributed ProductCard's
// colour reference to the function ABOVE it, letting the invisible-price bug
// through the very check meant to catch it.
const FN = /^(?:export\s+)?(?:default\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\([\s\S]*?\)\s*(?::[^{;]+)?\{/gm;
const ARROW = /^(?:export\s+)?const\s+(\w+)\s*(?::\s*React\.FC<[^=]*>)?\s*=\s*(?:\([\s\S]*?\)|\w+)\s*=>\s*\{/gm;
const MEMO = /^(?:export\s+)?const\s+\w+\s*=\s*React\.memo\(function\s+(\w+)\s*\([\s\S]*?\)\s*\{/gm;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Character ranges covered by a `makeStyles((colors) => ({ … }))` factory. */
function factorySpans(src: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of src.matchAll(/makeStyles\(\(colors\) => \(/g)) {
    let depth = 0;
    let j = m.index! + m[0].length - 1;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (c === '(' || c === '{' || c === '[') depth += 1;
      else if (c === ')' || c === '}' || c === ']') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    spans.push([m.index!, j]);
  }
  return spans;
}

function offenders(file: string, src: string): string[] {
  const spans = factorySpans(src);
  const starts: number[] = [];
  for (const re of [FN, ARROW, MEMO]) {
    for (const m of src.matchAll(re)) starts.push(m.index! + m[0].length);
  }
  starts.sort((a, b) => a - b);

  const found: string[] = [];
  for (const m of src.matchAll(/\bcolors\.\w+/g)) {
    const i = m.index!;
    if (spans.some(([a, b]) => i >= a && i <= b)) continue; // inside a factory
    const enclosing = starts.filter((s) => s <= i).pop();
    if (enclosing === undefined) continue; // module scope, outside any component
    if (src.slice(enclosing, i).includes('const colors = useThemeColors();')) continue;
    const line = src.slice(0, i).split('\n').length;
    found.push(`${file}:${line} → ${m[0]}`);
  }
  return found;
}

describe('palette binding', () => {
  it('no component reads colours from the module-scope light palette', () => {
    const bad = walk(ROOT)
      .filter((f) => !EXEMPT.has(f.split('\\').join('/')))
      .flatMap((f) => offenders(f, readFileSync(f, 'utf8')));

    // Named rather than counted, so a failure says which line to fix.
    expect(bad).toEqual([]);
  });

  it('the exemption list stays deliberate', () => {
    // If this list grows, someone should have to justify it in review.
    expect([...EXEMPT]).toEqual(['apps/mobile/src/components/ObservabilityErrorBoundary.tsx']);
  });
});
