import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { APP_SETTINGS_NEVER_SELECTED, CATALOG_SELECTS } from './catalogSelect';

/**
 * THE CONTRACT: every column the app reads from a catalog row is in that
 * table's select list.
 *
 * PostgREST returns only what is listed, so a column a mapper reads but the
 * list omits is `undefined` at run time — a branch whose delivery pause is never
 * seen, a support channel that never appears. The compiler does not catch it:
 * supabase-js infers the row from the literal, but `ok<DbBranch[]>` casts it
 * back to the full row type, and every column added after launch is OPTIONAL in
 * `types/db.ts`, so omitting one type-checks.
 *
 * So this asks the TypeScript CHECKER, not a regex, which property names are
 * read on a value of each catalog row type, anywhere in the app's source —
 * including untyped callback parameters such as `modifiers.filter((m) =>
 * m.group_id …)`, whose type is only known by inference.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = join(HERE, '..', '..');
const SRC = join(MOBILE, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|d)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const ROW_TYPES = Object.values(CATALOG_SELECTS).map((s) => s.rowType as string);

/** Row type name → property names read on it, with one example site each. */
function readsByRowType(): Map<string, Map<string, string>> {
  const files = walk(SRC).filter((f) => {
    const text = readFileSync(f, 'utf8');
    return ROW_TYPES.some((t) => text.includes(t));
  });
  const configPath = join(MOBILE, 'tsconfig.json');
  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    MOBILE,
  );
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const reads = new Map<string, Map<string, string>>(ROW_TYPES.map((t) => [t, new Map()]));

  const rowTypeOf = (node: ts.Node): string | null => {
    const type = checker.getNonNullableType(checker.getTypeAtLocation(node));
    const name = (type.aliasSymbol ?? type.getSymbol())?.getName();
    return name && reads.has(name) ? name : null;
  };
  const record = (row: string, prop: string, node: ts.Node) => {
    const sf = node.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    const m = reads.get(row)!;
    if (!m.has(prop)) m.set(prop, `${sf.fileName.slice(MOBILE.length + 1)}:${line + 1}`);
  };

  for (const sf of program.getSourceFiles()) {
    if (!files.includes(sf.fileName)) continue;
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node)) {
        const row = rowTypeOf(node.expression);
        if (row) record(row, node.name.text, node);
      } else if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
        const row = rowTypeOf(node.expression);
        if (row) record(row, node.argumentExpression.text, node);
      } else if (ts.isObjectBindingPattern(node)) {
        const row = rowTypeOf(node);
        if (row) {
          for (const el of node.elements) {
            const key = el.propertyName ?? el.name;
            if (ts.isIdentifier(key)) record(row, key.text, el);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return reads;
}

describe('catalog select lists', () => {
  const reads = readsByRowType();

  it('found the mappers it is meant to check (a checker that sees nothing proves nothing)', () => {
    // A known read per row type, so a broken type lookup fails here rather than
    // passing every other assertion vacuously.
    expect(reads.get('DbBranch')!.has('delivery_temporarily_closed')).toBe(true);
    expect(reads.get('DbCategory')!.has('sort_order')).toBe(true);
    expect(reads.get('DbProduct')!.has('image_url')).toBe(true);
    expect(reads.get('DbProductVariant')!.has('product_id')).toBe(true);
    expect(reads.get('DbModifierGroup')!.has('max_select')).toBe(true);
    expect(reads.get('DbModifier')!.has('group_id')).toBe(true);
    expect(reads.get('DbAppSettings')!.has('support_email_enabled')).toBe(true);
  });

  for (const [table, spec] of Object.entries(CATALOG_SELECTS)) {
    it(`${table}: every column read on a ${spec.rowType} is selected`, () => {
      const listed = new Set<string>(spec.columns);
      const missing = [...reads.get(spec.rowType)!.entries()]
        .filter(([col]) => !listed.has(col))
        .map(([col, site]) => `${col} (read at ${site})`);
      expect(missing, `read but not selected from ${table}`).toEqual([]);
    });

    it(`${table}: the select literal is exactly its column list`, () => {
      expect(spec.select).toBe(spec.columns.join(', '));
      expect(spec.select).not.toContain('*');
      expect(new Set(spec.columns).size).toBe(spec.columns.length);
    });
  }

  it('never selects an administrator id from app_settings', () => {
    for (const col of APP_SETTINGS_NEVER_SELECTED) {
      expect(CATALOG_SELECTS.app_settings.columns as readonly string[]).not.toContain(col);
    }
  });

  it('services/api.ts reads each of these tables through its literal, never select(*)', () => {
    const api = readFileSync(join(SRC, 'services', 'api.ts'), 'utf8');
    const constName: Record<string, string> = {
      branches: 'BRANCH_SELECT',
      categories: 'CATEGORY_SELECT',
      products: 'PRODUCT_SELECT',
      product_variants: 'PRODUCT_VARIANT_SELECT',
      modifier_groups: 'MODIFIER_GROUP_SELECT',
      modifiers: 'MODIFIER_SELECT',
      app_settings: 'APP_SETTINGS_SELECT',
    };
    for (const table of Object.keys(CATALOG_SELECTS)) {
      expect(api, `${table} still read with select('*')`).not.toMatch(
        new RegExp(`from\\('${table}'\\)\\s*\\.select\\('\\*'\\)`),
      );
      expect(api, `${table} not read through ${constName[table]}`).toMatch(
        new RegExp(`from\\('${table}'\\)\\s*\\.select\\(${constName[table]}\\)`),
      );
    }
  });
});
