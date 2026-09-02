/**
 * Two `lib/` modules are hand-maintained MIRRORS across the admin console and the
 * customer app. This test is what keeps them identical.
 *
 * WHY THIS EXISTS. `src/lib/supportContact.ts` and `apps/mobile/src/lib/supportContact.ts`
 * are the same code with a different header comment, and so are the two `geo.ts`
 * files. The only thing holding them together was a sentence in one of the
 * headers — *"WEB MIRROR … keep the two in sync (same pattern as legal.ts)"* — an
 * instruction addressed to a human, which is exactly the kind of guarantee that
 * quietly stops being true. `design-system/generated/*` is duplicated too, but
 * that copy is written by `scripts/sync-design-system.mjs` and CI fails on drift.
 * These two had nothing.
 *
 * WHY A TEST AND NOT A SHARED MODULE. Consolidating them into one folder needs
 * `metro.config.js` watch folders plus both tsconfig `include` lists — a build
 * change to the shipping app in exchange for removing ~240 lines. This gets the
 * drift protection at no build risk. If the modules are ever genuinely merged,
 * delete this file.
 *
 * IT ALSO CLOSES A COVERAGE GAP. `apps/mobile/src/lib/geo.ts` has no test of its
 * own, and it decides delivery serviceability — `pointInPolygon` is what
 * `CheckoutScreen.tsx` asks whether an address can be delivered to. Pinning it
 * to the web copy gives it `src/lib/geo.test.ts`'s coverage.
 *
 * ================================================================
 * HOW COMMENTS ARE IGNORED — the part that could make this test LIE
 * ================================================================
 * Each file is PARSED and re-printed from its AST with `removeComments: true`.
 * The comparison is over that canonical form. Nothing about it is textual, so
 * there is no stripping heuristic left to get wrong.
 *
 * It took two wrong answers to get here, and both are worth recording because
 * each looked convincing:
 *
 * 1. LINE CLASSIFICATION — dropping any line whose trimmed text began with a
 *    comment marker. Review caught the hole: `/⁎ why ⁎/ return false;` begins
 *    with `/⁎`, so the whole line went, INCLUDING the executable suffix. Two
 *    copies differing only in such a line would both lose it and the assertion
 *    would PASS over real divergence — precisely the failure this file exists to
 *    prevent, in the same file where I had written a paragraph claiming to have
 *    designed against it.
 *
 * 2. THE BARE `ts.createScanner` — tokenising and comparing token streams. It
 *    fixed case 1 and passed every synthetic probe I threw at it. On the REAL
 *    files it silently produced a FALSE PASS: a template literal with a
 *    substitution needs parser guidance (`reScanTemplateToken`) to resume
 *    correctly, and without it the scanner desynchronises after `${…}` and
 *    swallows following source into an oversized template token. Both mirrors
 *    contain such templates — `` `https://wa.me/${…}` `` — so a real code change
 *    after one of them produced 557 identical tokens on both sides. The synthetic
 *    probes missed it because a one-template snippet never desynchronises.
 *
 * THE LESSON, since it cost two revisions: a lexer alone cannot tokenise
 * TypeScript. Template continuation and regex-vs-division are both parser
 * decisions. Use the parser.
 */
import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Each pair must be code-identical; only the file headers may differ. */
const MIRRORS = [
  {
    name: 'supportContact.ts',
    web: '../lib/supportContact.ts',
    mobile: '../../apps/mobile/src/lib/supportContact.ts',
  },
  { name: 'geo.ts', web: '../lib/geo.ts', mobile: '../../apps/mobile/src/lib/geo.ts' },
] as const;

/**
 * Parse, then re-print from the AST without comments. Formatting is normalised
 * as a side effect, which is correct here — two copies that differ only in
 * indentation are still the same code.
 */
function canonical(src: string, name: string): string {
  const sourceFile = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return printer.printFile(sourceFile);
}

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

/** Exported binding names, so a divergence in the public surface is named plainly. */
function exportNames(src: string): string[] {
  const names = [
    ...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|interface|type|class)\s+([A-Za-z0-9_$]+)/gm),
  ].map((m) => m[1]);
  return [...new Set(names)].sort();
}

describe('cross-app lib mirrors stay identical', () => {
  for (const { name, web, mobile } of MIRRORS) {
    it(`${name} — the code is identical once comments are removed`, () => {
      const a = canonical(read(web), `web/${name}`);
      const b = canonical(read(mobile), `mobile/${name}`);
      // Compare line arrays rather than whole strings: vitest then points at the
      // first differing line instead of printing two 130-line blobs.
      expect(b.split('\n')).toEqual(a.split('\n'));
    });

    it(`${name} — the two copies export the same names`, () => {
      // Independent of the comparison above: this one still fails usefully if
      // somebody reorders the file wholesale, and it is the assertion a reader
      // checks first when the diff is large.
      expect(exportNames(read(mobile))).toEqual(exportNames(read(web)));
    });
  }

  it('every mirror listed here actually exists on both sides', () => {
    // A typo'd path would otherwise throw ENOENT with no explanation, and a pair
    // silently dropped from MIRRORS would leave its modules unguarded.
    for (const { web, mobile } of MIRRORS) {
      expect(read(web).length).toBeGreaterThan(0);
      expect(read(mobile).length).toBeGreaterThan(0);
    }
    expect(MIRRORS.length).toBe(2);
  });

  /**
   * The canonicaliser's contract, asserted rather than trusted. Cases 1 and 2 are
   * the two revisions this file got wrong; keeping them means a future
   * "simplification" back to text stripping or a bare scanner fails HERE, loudly,
   * rather than by silently passing over a real difference.
   */
  it('removes comments and nothing else', () => {
    const differs = (a: string, b: string) => canonical(a, 'a.ts') !== canonical(b, 'b.ts');

    // 1. Executable suffix after a closing block comment (killed line-classification).
    expect(differs('function f() { /* why */ return false; }', 'function f() { /* why */ return true; }')).toBe(true);

    // 2. A change AFTER a template substitution — the case that made the bare
    //    scanner produce a false pass on the real files. Two templates, because
    //    one is not enough to desynchronise a lexer.
    const twoTemplates = (tail: string) =>
      `function f(n: string) { const a = \`x/\${n}\`; const b = \`y/\${n}\`; return ${tail}; }`;
    expect(differs(twoTemplates('null'), twoTemplates('undefined'))).toBe(true);

    // 3. Regex bodies — regex-vs-division is a parser decision, not a lexer one.
    expect(differs('const r = /^05\\d{8}$/;', 'const r = /^06\\d{8}$/;')).toBe(true);

    // 4. Type-only divergence still counts: these modules are typed contracts.
    expect(differs('let x: string;', 'let x: number;')).toBe(true);

    // And the other direction — comments alone must never fail the mirrors.
    expect(differs('/* a */ const x = 1;', '/* b */ const x = 1;')).toBe(false);
    expect(differs('const x = 1; // a', 'const x = 1; // b')).toBe(false);
    // The canonical form must actually be comment-free, or "removeComments"
    // silently doing nothing would make every comparison above vacuous.
    expect(canonical('// gone\nconst x = 1; /* also gone */\n', 'c.ts')).not.toMatch(/gone/);
  });
});
