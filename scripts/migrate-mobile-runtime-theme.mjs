#!/usr/bin/env node
/**
 * Conservative one-shot codemod for the retained System/Light/Dark feature.
 *
 * Default mode is DRY RUN. Pass --write to edit files.
 *
 * It does only two mechanical transformations:
 *  1. top-level `const styles = StyleSheet.create({...})` becomes a
 *     `makeStyles((colors) => ({...}))` hook and every React component that
 *     reads that style object calls the hook;
 *  2. `color.*` reads inside React components become `colors.*` reads backed by
 *     `useThemeColors()`.
 *
 * It does not touch business logic, navigation, API calls, payment behavior,
 * data models or generated design-system files. The palette-binding test and
 * TypeScript are the authority after it runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve('apps/mobile/src');
const WRITE = process.argv.includes('--write');
const SKIP = new Set([
  path.normalize('apps/mobile/src/components/ObservabilityErrorBoundary.tsx'),
  path.normalize('apps/mobile/src/design-system/ui/ContentColumn.tsx'),
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function relImport(fromFile, targetWithoutExt) {
  let rel = path.relative(path.dirname(fromFile), targetWithoutExt).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function isStyleSheetCreate(expr) {
  return ts.isCallExpression(expr)
    && ts.isPropertyAccessExpression(expr.expression)
    && ts.isIdentifier(expr.expression.expression)
    && expr.expression.expression.text === 'StyleSheet'
    && expr.expression.name.text === 'create'
    && expr.arguments.length === 1
    && ts.isObjectLiteralExpression(expr.arguments[0]);
}

function functionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
    if (node.name) return node.name.text;
    const p = node.parent;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isCallExpression(p)) {
      const gp = p.parent;
      if (ts.isVariableDeclaration(gp) && ts.isIdentifier(gp.name)) return gp.name.text;
    }
  }
  return null;
}

function isReactSurfaceFunction(node) {
  const name = functionName(node);
  return !!name && /^[A-Z]/.test(name) && !!node.body && ts.isBlock(node.body);
}

function lineIndent(src, pos) {
  const lineStart = src.lastIndexOf('\n', pos - 1) + 1;
  const m = src.slice(lineStart, pos).match(/^\s*/);
  return m?.[0] ?? '';
}

function addEdit(edits, start, end, text, label) {
  edits.push({ start, end, text, label });
}

function applyEdits(src, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = src;
  let lastStart = Infinity;
  for (const e of sorted) {
    if (e.end > lastStart) {
      throw new Error(`Overlapping codemod edits near ${e.label}`);
    }
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  return out;
}

function importInsertPosition(sf, src) {
  let end = 0;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) end = st.end;
    else if (end > 0) break;
  }
  if (end === 0) {
    const shebang = src.startsWith('#!') ? src.indexOf('\n') + 1 : 0;
    return shebang;
  }
  return end;
}

function componentBodyRanges(sf) {
  const out = [];
  function visit(node) {
    if (isReactSurfaceFunction(node)) {
      out.push({
        name: functionName(node),
        body: node.body,
        start: node.body.getStart(sf),
        end: node.body.end,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

function migrate(file) {
  const repoPath = path.relative(process.cwd(), file).split(path.sep).join('/');
  if (SKIP.has(path.normalize(repoPath))) return null;

  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const styleDefs = [];

  // Only top-level StyleSheet.create declarations. Nested/dynamic cases are left
  // for manual review rather than guessed at.
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const decl of st.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer || !isStyleSheetCreate(decl.initializer)) continue;
      const name = decl.name.text;
      const hookName = name === 'styles' ? 'useStyles' : `use${cap(name)}Styles`;
      const obj = decl.initializer.arguments[0];
      const objText = src.slice(obj.getStart(sf), obj.end).replace(/\bcolor\./g, 'colors.');
      styleDefs.push({ name, hookName });
      addEdit(edits, decl.name.getStart(sf), decl.name.end, hookName, `${repoPath}:${name}:declaration`);
      addEdit(
        edits,
        decl.initializer.getStart(sf),
        decl.initializer.end,
        `makeStyles((colors) => (${objText}))`,
        `${repoPath}:${name}:factory`,
      );
    }
  }

  const components = componentBodyRanges(sf);
  let needsThemeImport = false;
  const styleHookUsers = new Set();

  for (const comp of components) {
    const bodyText = src.slice(comp.start, comp.end);
    const inserts = [];

    for (const def of styleDefs) {
      const uses = new RegExp(`\\b${def.name}\\.`).test(bodyText);
      if (!uses) continue;
      // A previous migration may already have inserted the hook.
      if (!new RegExp(`\\bconst\\s+${def.name}\\s*=\\s*${def.hookName}\\s*\\(`).test(bodyText)) {
        inserts.push(`const ${def.name} = ${def.hookName}();`);
      }
      styleHookUsers.add(def.hookName);
    }

    // Replace direct light-palette reads throughout this component body. Style
    // factories are top-level, so there is no overlap with the edits above.
    let foundInlineColor = false;
    const re = /\bcolor\./g;
    let m;
    while ((m = re.exec(bodyText)) !== null) {
      const absolute = comp.start + m.index;
      // Do not rewrite a nested component twice. The duplicate edit would
      // overlap. The outer component may contain nested callback arrows; those
      // SHOULD capture its colors binding, so only nested React surface blocks
      // are excluded.
      const nested = components.some((other) => other !== comp && other.start > comp.start && other.end < comp.end && absolute >= other.start && absolute < other.end);
      if (nested) continue;
      addEdit(edits, absolute, absolute + 'color.'.length, 'colors.', `${repoPath}:${comp.name}:inline-color`);
      foundInlineColor = true;
    }
    if (foundInlineColor && !/\bconst\s+colors\s*=\s*useThemeColors\s*\(/.test(bodyText)) {
      inserts.push('const colors = useThemeColors();');
      needsThemeImport = true;
    } else if (/\buseThemeColors\s*\(/.test(bodyText)) {
      needsThemeImport = true;
    }

    if (inserts.length > 0) {
      const baseIndent = lineIndent(src, comp.start);
      const inner = `${baseIndent}  `;
      addEdit(
        edits,
        comp.start + 1,
        comp.start + 1,
        `\n${inner}${inserts.join(`\n${inner}`)}`,
        `${repoPath}:${comp.name}:hooks`,
      );
    }
  }

  // If there are top-level style factories, import makeStyles.
  const imports = [];
  if (styleDefs.length > 0 && !/from\s+['"][^'"]*theme\/makeStyles['"]/.test(src)) {
    imports.push(`import { makeStyles } from '${relImport(file, path.join(ROOT, 'theme/makeStyles'))}';`);
  }
  if (needsThemeImport && !/from\s+['"][^'"]*theme\/ThemeProvider['"]/.test(src)) {
    imports.push(`import { useThemeColors } from '${relImport(file, path.join(ROOT, 'theme/ThemeProvider'))}';`);
  }
  if (imports.length > 0) {
    const p = importInsertPosition(sf, src);
    addEdit(edits, p, p, `\n${imports.join('\n')}`, `${repoPath}:imports`);
  }

  if (edits.length === 0) return null;
  const out = applyEdits(src, edits);
  if (out === src) return null;
  return { repoPath, out, styleDefs: styleDefs.map((d) => d.name), components: components.map((c) => c.name) };
}

const changed = [];
for (const file of walk(ROOT)) {
  const result = migrate(file);
  if (!result) continue;
  changed.push(result.repoPath);
  if (WRITE) fs.writeFileSync(file, result.out);
}

console.log(`${WRITE ? 'Updated' : 'Would update'} ${changed.length} file(s).`);
for (const f of changed) console.log(`  ${f}`);
if (!WRITE) {
  console.log('\nDry run only. Re-run with --write after reviewing this file list.');
}
