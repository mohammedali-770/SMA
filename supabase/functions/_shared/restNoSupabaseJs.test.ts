import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * order-intake's import graph must not reach `npm:@supabase/supabase-js`.
 *
 * WHY A GRAPH WALK AND NOT A grep OF ONE FILE. The cost being avoided is paid at
 * ISOLATE BOOT: every module in the graph is resolved and evaluated before
 * `Deno.serve` registers the handler, so a package pulled in two files away
 * costs exactly as much as one imported directly, and nothing inside the handler
 * can see it. A single-file check would pass while the dependency came back
 * through `_shared/secrets.ts`.
 *
 * WHY TYPE-ONLY IMPORTS COUNT TOO. A type-only import of `SupabaseClient` is
 * erased by the TypeScript compiler and, in all likelihood, by the deploy
 * bundler as well — which is exactly the problem.
 * "In all likelihood" is a belief about somebody else's build step, held about
 * the one code path where being wrong costs a cold start on every customer's
 * checkout. The import graph is a fact this repository controls. So the rule is
 * the blunt one: no file order-intake can reach may mention the package at all.
 *
 * WHAT IT DOES NOT CHECK. Comments are stripped first, so a file may still
 * NAME the package in prose — `order-intake/index.ts` has to, to explain why it
 * does not import it. The rule is about code.
 *
 * The graph this walks is also the DEPLOY BUNDLE. Supabase Edge Function deploys
 * send an explicit file list, and sending an incomplete one produces a function
 * that fails at boot. The assertion below is therefore doing double duty: it is
 * the manifest, and it fails if a new import is added without the deployer being
 * told.
 */

const FUNCTIONS = new URL('../', import.meta.url);

/**
 * Comments stripped, in the same style as the wiring tripwires. The assertions
 * below are about CODE: the file that explains why the dependency was removed
 * has to name it, and prose naming a package does not import it. Without this
 * the documentation would fail its own rule — it did, first run.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

/**
 * EVERY module specifier in a file, not only the `from` ones. Review found the
 * first version followed `from` alone, which misses three shapes that all pull a
 * module in for real:
 *
 *   import './side-effect.ts';        // no `from` at all
 *   await import('./lazy.ts');        // dynamic
 *   export { x } from './re.ts';      // re-export
 *
 * A relative one missed by the walker drops a file out of the graph — and the
 * graph is the deploy bundle, so the manifest below would still read three
 * files while the deployed function failed at boot on a missing import. An npm
 * one missed by the walker defeats the whole point of the file.
 */
function specifiers(src: string): string[] {
  const out: string[] = [];
  // `import ... from 'x'` and `export ... from 'x'`
  for (const m of src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  // bare side-effect `import 'x'`
  for (const m of src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  // dynamic `import('x')`
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

function resolveImports(fileUrl: URL, src: string): URL[] {
  // Relative specifiers only — a bare or npm: specifier is not a repository
  // file and is handled by the assertions below, not by recursion.
  return specifiers(src).filter((sp) => sp.startsWith('.')).map((sp) => new URL(sp, fileUrl));
}

function importGraph(entry: URL): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length) {
    const url = queue.shift() as URL;
    const key = fileURLToPath(url).slice(fileURLToPath(FUNCTIONS).length);
    if (seen.has(key)) continue;
    const src = stripComments(readFileSync(url, 'utf8'));
    seen.set(key, src);
    queue.push(...resolveImports(url, src));
  }
  return seen;
}

describe('order-intake carries no npm dependency', () => {
  const graph = importGraph(new URL('../order-intake/index.ts', import.meta.url));

  it('mentions @supabase/supabase-js nowhere in the graph', () => {
    for (const [file, src] of graph) {
      expect(src, `${file} reaches @supabase/supabase-js`).not.toContain('@supabase/supabase-js');
    }
  });

  it('has no npm: or bare specifier at all', () => {
    for (const [file, src] of graph) {
      const external = specifiers(src).filter((sp) => !sp.startsWith('.'));
      expect(external, `${file} imports ${external.join(', ')}`).toEqual([]);
    }
  });

  it('reaches every specifier shape, not only `import … from`', () => {
    // Guards the walker itself. If `specifiers()` is narrowed back to `from`,
    // these stop being seen and both assertions above go quiet while the
    // dependency is back.
    const sample = [
      "import './a.ts';",
      "import x from './b.ts';",
      "export { y } from './c.ts';",
      "const z = await import('./d.ts');",
      "import 'npm:heavy@1';",
    ].join('\n');
    expect(specifiers(sample).sort()).toEqual(
      ['./a.ts', './b.ts', './c.ts', './d.ts', 'npm:heavy@1'].sort(),
    );
  });

  it('is exactly the three files the deploy must send', () => {
    // Sending an incomplete bundle produces a function that fails at boot, and
    // the deploy list is written by hand. If this changes, the deploy changes.
    expect([...graph.keys()].sort()).toEqual([
      '_shared/cors.ts',
      '_shared/rest.ts',
      'order-intake/index.ts',
    ]);
  });

  it('leaves the supabase-js clients in place for every other function', () => {
    // The point was to take the dependency off ONE hot path, not to start a
    // migration. `supabaseClient.ts` and `secrets.ts` are untouched and are
    // still what the other functions use; a change that empties them would mean
    // this removal had quietly grown into something else.
    const clients = readFileSync(new URL('./supabaseClient.ts', import.meta.url), 'utf8');
    const secrets = readFileSync(new URL('./secrets.ts', import.meta.url), 'utf8');
    expect(clients).toContain('@supabase/supabase-js');
    expect(clients).toContain('export function adminClient');
    expect(clients).toContain('export function userClient');
    expect(secrets).toContain('export async function getProviderConfig');
  });
});
