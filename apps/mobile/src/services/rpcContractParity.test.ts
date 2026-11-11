import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * THE CONTRACT NOTHING CHECKED: the argument NAMES a client sends to an RPC.
 *
 * PostgREST resolves `supabase.rpc('fn', { p_order_id })` by the function name
 * AND the argument names. A migration that renames or drops a parameter, or
 * adds one with no DEFAULT, therefore breaks the call with PGRST202 ("Could not
 * find the function ... in the schema cache") — and until this file, it passed
 * every CI gate:
 *
 *   - the SQL suites call these functions POSITIONALLY
 *     (`manual_only_pos_resend_test.sql` passes a bare uuid), so a rename
 *     replays and passes;
 *   - the app tests mock supabase, so they never see a signature at all.
 *
 * Measured by the 2026-11-11 reliability assessment (R01): with
 * `request_customer_pos_resend` redefined to take `p_id` instead of
 * `p_order_id`, the SQL suite still exited 0, while the call shape the app
 * makes failed with 42883. This file fails on that migration.
 *
 * The cost lands hardest on the customer app. The console and the `/app` web
 * export deploy on merge, but an installed iOS or Android build keeps the
 * bundle it was built with: there are no over-the-air updates (no
 * `expo-updates`), so a broken call stays broken on every installed build until
 * a new store build reaches each customer. PGRST202 is also the error that took
 * the Admin Dashboard down on 2026-07-29, from a different cause: migrations
 * that had not been applied (`docs/MIGRATIONS.md` §20).
 *
 * HOW IT DECIDES, and why it replays the chain instead of reading "the last
 * `create function`". `create or replace` with a different argument list does
 * not replace anything: it adds an OVERLOAD, and both then exist. So this file
 * replays every top-level `create function`, `drop function` and
 * `alter function` in `supabase/migrations`, in filename order, keyed by
 * argument types the way Postgres keys them. A call passes only when exactly ONE
 * live definition accepts it: every key it sends is a declared parameter, and
 * every parameter without a DEFAULT is sent. None is PGRST202; more than one is
 * PGRST203, which PostgREST refuses as ambiguous.
 *
 * IT FAILS LOUDLY RATHER THAN GUESS. A call whose function name or argument
 * object is not a literal, a `.rpc` reference that is not a direct call, and
 * function DDL hidden in a DO block or dynamic SQL that mentions a called
 * function are all reported as failures, never skipped.
 *
 * WHAT IT DOES NOT PROVE, said rather than implied:
 *
 *   - It compares SOURCE to SOURCE. A change that renames a parameter on BOTH
 *     sides passes here and still breaks every installed build, which keeps
 *     sending the old name. Keep the old name working (a parameter with a
 *     DEFAULT, or a compatible definition) until no supported build sends it.
 *   - It reads argument names, not values. A key whose value is `undefined` at
 *     run time is dropped by JSON serialisation, so a required parameter fed
 *     `undefined` passes here and fails live.
 *   - It does not check grants or return shapes: EXECUTE revoked from the
 *     calling role (42501), or a changed return type, both pass.
 *   - It says nothing about Production. Whether a migration is APPLIED is
 *     `docs/MIGRATIONS.md`'s question, answered by a dated read-only check.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/* ------------------------------------------------------------ SQL reader */

interface Param {
  mode: 'in' | 'out' | 'inout' | 'variadic';
  /** Folded to lower case unless the declaration quoted it. `null` when unnamed. */
  name: string | null;
  /** Normalised the way Postgres compares argument types. */
  type: string;
  hasDefault: boolean;
}

interface Definition {
  schema: string;
  name: string;
  params: Param[];
  file: string;
  signature: string;
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const IDENT_ONLY = new RegExp(`^${IDENT}$`);
const unquote = (s: string) => (s.startsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s.toLowerCase());
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split SQL into top-level statements, with comments removed and the contents
 * of string literals and dollar-quoted bodies masked. Function bodies are
 * opaque here on purpose: a `create function` inside one does not run when the
 * migration does. What they contain is returned separately, so DDL hidden in a
 * DO block can be refused rather than ignored.
 */
function scanSql(sql: string): { statements: string[]; quoted: string[] } {
  const statements: string[] = [];
  const quoted: string[] = [];
  const identChar = /[A-Za-z0-9_$]/;
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const tag = c === '$' ? dollarTagAt(sql, i) : null;
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      current += ' ';
    } else if (c === '/' && sql[i + 1] === '*') {
      let depth = 1; // Postgres block comments nest
      i += 2;
      while (depth > 0) {
        if (i >= sql.length) throw new Error('unterminated block comment');
        if (sql.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      current += ' ';
    } else if (c === "'") {
      const backslashEscapes = /[eE]/.test(sql[i - 1] ?? '') && !identChar.test(sql[i - 2] ?? '');
      let body = '';
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new Error('unterminated string literal');
        if (backslashEscapes && sql[j] === '\\') {
          body += sql.slice(j, j + 2);
          j += 2;
        } else if (sql[j] === "'" && sql[j + 1] === "'") {
          body += "'";
          j += 2;
        } else if (sql[j] === "'") {
          break;
        } else {
          body += sql[j++];
        }
      }
      quoted.push(body);
      current += "''";
      i = j + 1;
    } else if (c === '"') {
      // A doubled "" inside a quoted identifier is an escaped quote, not its end.
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') break;
        else j++;
      }
      if (j >= sql.length) throw new Error('unterminated quoted identifier');
      current += sql.slice(i, j + 1);
      i = j + 1;
    } else if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      if (end < 0) throw new Error(`unterminated dollar quote ${tag}`);
      quoted.push(sql.slice(i + tag.length, end));
      current += '$$';
      i = end + tag.length;
    } else if (c === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i++;
    } else {
      current += c;
      i++;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return { statements, quoted };
}

/** The dollar-quote tag (`$$`, `$body$`) opening at `i`, or null. `$1` is a parameter, not a tag. */
function dollarTagAt(sql: string, i: number): string | null {
  if (/[A-Za-z0-9_$]/.test(sql[i - 1] ?? '')) return null; // `$` inside an identifier
  const tag = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
  tag.lastIndex = i;
  return tag.exec(sql)?.[0] ?? null;
}

/** Index of the `"` closing a quoted identifier opened at `open`. Input is balanced: scanSql threw otherwise. */
function closingQuote(s: string, open: number): number {
  const close = s.indexOf('"', open + 1);
  if (close < 0) throw new Error(`unterminated quoted identifier: ${s}`);
  return close; // an escaped "" reads as close-then-reopen, which consumes it correctly
}

/** Read `[schema.]name` from the start of `s`. Unqualified names resolve to `public`. */
function qualifiedName(s: string): { schema: string; name: string; rest: string } | null {
  const m = new RegExp(String.raw`^(${IDENT})(?:\s*\.\s*(${IDENT}))?`).exec(s.trimStart());
  if (!m) return null;
  const rest = s.trimStart().slice(m[0].length);
  return m[2]
    ? { schema: unquote(m[1]), name: unquote(m[2]), rest }
    : { schema: 'public', name: unquote(m[1]), rest };
}

/** The text inside the balanced parentheses `s` opens with, if it opens with one. */
function parenthesized(s: string): { inner: string; rest: string } | null {
  const t = s.trimStart();
  if (t[0] !== '(') return null;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '"') i = closingQuote(t, i);
    else if (t[i] === '(') depth++;
    else if (t[i] === ')' && --depth === 0) return { inner: t.slice(1, i), rest: t.slice(i + 1) };
  }
  return null;
}

/** Split on commas not nested in (), [] or a quoted identifier. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      const close = closingQuote(s, i);
      current += s.slice(i, close + 1);
      i = close;
      continue;
    }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Words that begin a multi-word type, so `double precision` is not a parameter named `double`. */
const MULTI_WORD_TYPE_START = new Set([
  'bit',
  'char',
  'character',
  'double',
  'interval',
  'national',
  'time',
  'timestamp',
]);
const MODES = new Set(['in', 'out', 'inout', 'variadic']);
const TYPE_ALIASES = new Map([
  ['int', 'integer'],
  ['int4', 'integer'],
  ['int8', 'bigint'],
  ['int2', 'smallint'],
  ['bool', 'boolean'],
  ['float8', 'double precision'],
  ['float4', 'real'],
  ['decimal', 'numeric'],
  ['varchar', 'character varying'],
  ['char', 'character'],
  ['bpchar', 'character'],
  ['timestamptz', 'timestamp with time zone'],
  ['timestamp', 'timestamp without time zone'],
  ['timetz', 'time with time zone'],
  ['time', 'time without time zone'],
]);

/** `text[]`, `text []`, `text[3]`, `text[][]`, `text array`: Postgres treats them all as one type. */
const ARRAY_SUFFIX = /(\s*\[\s*\d*\s*\])+$|\s+array(\s*\[\s*\d*\s*\])?$/;

/**
 * A `%TYPE` reference (`public.orders.id%type`) is kept as written: resolving
 * it needs a database. It therefore never compares equal to a concrete type,
 * so a later drop or replacement of such a function surfaces as an unmatched
 * drop or a second overload, both of which fail for a called function.
 */
function normalizeType(raw: string): string {
  let t = raw.trim().toLowerCase().replace(/"/g, '').replace(/\s+/g, ' ');
  const isArray = ARRAY_SUFFIX.test(t);
  t = t.replace(ARRAY_SUFFIX, '');
  t = t.replace(/\s*\([^)]*\)/g, ''); // type modifiers: numeric(10,2), varchar(20)
  t = t.replace(/\s*\.\s*/g, '.').replace(/^(public|pg_catalog)\./, '');
  return (TYPE_ALIASES.get(t) ?? t) + (isArray ? '[]' : '');
}

/** One parameter declaration: `[mode] [name] type [DEFAULT expr | = expr]`. */
function parseParam(text: string): Param {
  const tokens: { t: string; at: number }[] = [];
  const word = new RegExp(String.raw`\s*(${IDENT}|::|\S)`, 'y');
  let m: RegExpExecArray | null;
  while ((m = word.exec(text))) tokens.push({ t: m[1], at: word.lastIndex - m[1].length });
  let depth = 0;
  let defaultAt = tokens.length;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k].t;
    if (t === '(' || t === '[') depth++;
    else if (t === ')' || t === ']') depth--;
    else if (depth === 0 && (t.toLowerCase() === 'default' || t === '=')) {
      defaultAt = k;
      break;
    }
  }
  const head = tokens.slice(0, defaultAt);
  let k = 0;
  let mode: Param['mode'] = 'in';
  if (head.length > 1 && MODES.has(head[0].t.toLowerCase())) {
    mode = head[0].t.toLowerCase() as Param['mode'];
    k = 1;
  }
  let name: string | null = null;
  const [first, second] = [head[k], head[k + 1]];
  if (
    first &&
    second &&
    IDENT_ONLY.test(first.t) &&
    !(MULTI_WORD_TYPE_START.has(first.t.toLowerCase()) && !first.t.startsWith('"')) &&
    !['.', '(', '['].includes(second.t)
  ) {
    name = unquote(first.t);
    k++;
  }
  const type = text.slice(head[k]?.at ?? text.length, tokens[defaultAt]?.at ?? text.length).trim();
  if (!type) throw new Error(`parameter declares no type: ${text}`);
  return { mode, name, type: normalizeType(type), hasDefault: defaultAt < tokens.length };
}

const parseParams = (inner: string) => (inner.trim() ? splitTopLevel(inner).map(parseParam) : []);

/** How Postgres identifies a function: schema, name and INPUT argument types. */
const signatureOf = (schema: string, name: string, params: Param[]) =>
  `${schema}.${name}(${params
    .filter((p) => p.mode !== 'out')
    .map((p) => p.type)
    .join(', ')})`;

interface Chain {
  files: string[];
  live: Map<string, Definition>;
  /** The body of every string or dollar quote that contains function DDL. */
  quotedDdl: { file: string; text: string }[];
  /** Drops that matched no live definition, with the overloads of that name then live. */
  unmatchedDrops: { file: string; name: string; signature: string; liveThen: string[] }[];
}

function replay(files: { file: string; sql: string }[]): Chain {
  const live = new Map<string, Definition>();
  const chain: Chain = { files: files.map((f) => f.file), live, quotedDdl: [], unmatchedDrops: [] };
  const overloadsOf = (schema: string, name: string) =>
    [...live.values()].filter((d) => d.schema === schema && d.name === name);
  for (const { file, sql } of files) {
    let scan: ReturnType<typeof scanSql>;
    try {
      scan = scanSql(sql);
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`);
    }
    for (const text of scan.quoted) {
      if (/\b(create|drop|alter)\s+(or\s+replace\s+)?(function|routine)\b/i.test(text)) {
        chain.quotedDdl.push({ file, text });
      }
    }
    for (const statement of scan.statements) {
      const fail = (why: string) => new Error(`${file}: ${why}: ${statement.slice(0, 160)}`);
      let m: RegExpExecArray | null;
      if ((m = /^create\s+(?:or\s+replace\s+)?function\s+/i.exec(statement))) {
        const target = qualifiedName(statement.slice(m[0].length));
        const list = target && parenthesized(target.rest);
        if (!target || !list) throw fail('cannot read the function name and parameter list');
        const params = parseParams(list.inner);
        const signature = signatureOf(target.schema, target.name, params);
        live.set(signature, { ...target, params, file, signature });
      } else if ((m = /^drop\s+(?:function|routine)\s+(?:if\s+exists\s+)?/i.exec(statement))) {
        const items = statement.slice(m[0].length).replace(/\s+(cascade|restrict)\s*$/i, '');
        for (const item of splitTopLevel(items)) {
          const target = qualifiedName(item);
          if (!target) throw fail('cannot read the dropped function');
          const list = parenthesized(target.rest);
          const matched = list
            ? [signatureOf(target.schema, target.name, parseParams(list.inner))]
            : overloadsOf(target.schema, target.name).map((d) => d.signature);
          const liveThen = overloadsOf(target.schema, target.name).map((d) => d.signature);
          if (!matched.some((s) => live.delete(s))) {
            chain.unmatchedDrops.push({ file, name: target.name, signature: matched[0] ?? item, liveThen });
          }
        }
      } else if ((m = /^alter\s+(?:function|routine)\s+/i.exec(statement))) {
        const target = qualifiedName(statement.slice(m[0].length));
        if (!target) throw fail('cannot read the altered function');
        const list = parenthesized(target.rest);
        const action = (list ? list.rest : target.rest).trim();
        const rename = new RegExp(String.raw`^rename\s+to\s+(${IDENT})`, 'i').exec(action);
        const moveSchema = new RegExp(String.raw`^set\s+schema\s+(${IDENT})`, 'i').exec(action);
        if (!rename && !moveSchema) continue; // owner, security, search_path: no effect on a call
        const exact = list && live.get(signatureOf(target.schema, target.name, parseParams(list.inner)));
        const affected = list ? (exact ? [exact] : []) : overloadsOf(target.schema, target.name);
        for (const d of affected) {
          live.delete(d.signature);
          const schema = moveSchema ? unquote(moveSchema[1]) : d.schema;
          const name = rename ? unquote(rename[1]) : d.name;
          const signature = signatureOf(schema, name, d.params);
          live.set(signature, { ...d, schema, name, signature, file });
        }
      }
    }
  }
  return chain;
}

function replayRepository(): Chain {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return replay(files.map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') })));
}

/* ------------------------------------------------------------- TS reader */

interface RpcCall {
  where: string;
  fn: string;
  keys: string[];
}

/**
 * Every `.rpc(...)` call in one source file, read with the TypeScript parser
 * rather than a regex, so a multi-line call, a shorthand key or a quoted key
 * reads the same as any other. Anything the reader cannot pin down becomes a
 * problem, not a skipped call.
 */
function readRpcCalls(path: string, text: string): { calls: RpcCall[]; problems: string[] } {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const calls: RpcCall[] = [];
  const problems: string[] = [];
  const at = (node: ts.Node) =>
    `${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  const literal = (node: ts.Node | undefined) =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

  /** The literal name of one argument, or `null` for a spread, a computed key or a method. */
  const keyOf = (property: ts.ObjectLiteralElementLike): string | null => {
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
    if (!ts.isPropertyAssignment(property)) return null;
    return ts.isIdentifier(property.name) ? property.name.text : literal(property.name);
  };

  const readCall = (call: ts.CallExpression, receiver: ts.Expression) => {
    const where = at(call);
    const fn = literal(call.arguments[0]);
    if (fn === null) {
      problems.push(`${where}: the function name is not a string literal`);
      return;
    }
    if (/\.schema\s*\(/.test(receiver.getText(source))) {
      problems.push(
        `${where}: ${fn} is called through .schema(), outside the public schema this test models`,
      );
      return;
    }
    const args = call.arguments[1];
    if (!args) {
      calls.push({ where, fn, keys: [] });
      return;
    }
    if (!ts.isObjectLiteralExpression(args)) {
      problems.push(
        `${where}: the arguments to ${fn} are not an object literal, so their names cannot be read`,
      );
      return;
    }
    // A call with ONE unreadable argument is refused whole. Judging it on the
    // names that could be read would report a "missing" parameter that the
    // spread may well supply, which is a guess presented as a finding.
    const keys = args.properties.map(keyOf);
    if (keys.includes(null)) {
      problems.push(`${where}: an argument to ${fn} has no literal name (a spread or a computed key)`);
      return;
    }
    calls.push({ where, fn, keys: keys as string[] });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'rpc') {
      if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
        readCall(node.parent, node.expression);
      } else {
        problems.push(`${at(node)}: .rpc is used without being called directly, so the call cannot be read`);
      }
    } else if (ts.isElementAccessExpression(node) && literal(node.argumentExpression) === 'rpc') {
      problems.push(`${at(node)}: ['rpc'] hides the call from this test; call .rpc directly`);
    } else if (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText(source) === 'rpc') {
      problems.push(`${at(node)}: destructuring rpc hides the call from this test; call .rpc directly`);
    } else if (
      (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) &&
      node.text.includes('/rpc/')
    ) {
      problems.push(`${at(node)}: a raw PostgREST /rpc/ URL cannot be checked; use supabase.rpc`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { calls, problems };
}

/** Every non-test source file under `tree` that mentions `rpc` at all. */
function readTree(tree: string): { calls: RpcCall[]; problems: string[]; scanned: number } {
  const out = { calls: [] as RpcCall[], problems: [] as string[], scanned: 0 };
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === 'node_modules' || entry === '.expo' || entry === 'dist') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.(test|d)\.tsx?$/.test(entry)) {
        out.scanned++;
        const text = readFileSync(full, 'utf8');
        if (!text.includes('rpc')) continue;
        const read = readRpcCalls(relative(ROOT, full).split('\\').join('/'), text);
        out.calls.push(...read.calls);
        out.problems.push(...read.problems);
      }
    }
  };
  walk(join(ROOT, tree));
  return out;
}

/* ------------------------------------------------------------- the check */

function judge(call: Pick<RpcCall, 'fn' | 'keys'>, chain: Chain) {
  const overloads = [...chain.live.values()].filter((d) => d.schema === 'public' && d.name === call.fn);
  const inputs = (d: Definition) => d.params.filter((p) => p.mode !== 'out');
  const undeclared = call.keys.filter((k) => !overloads.some((d) => inputs(d).some((p) => p.name === k)));
  const missingRequired =
    overloads.length === 1
      ? inputs(overloads[0])
          .filter((p) => !p.hasDefault && (p.name === null || !call.keys.includes(p.name)))
          .map((p) => p.name ?? `<unnamed ${p.type}>`)
      : [];
  const accepting = overloads.filter((d) => {
    const params = inputs(d);
    return (
      call.keys.every((k) => params.some((p) => p.name === k)) &&
      params.every((p) => p.hasDefault || (p.name !== null && call.keys.includes(p.name)))
    );
  });
  return {
    overloads: overloads.map((d) => `${d.signature} from ${d.file}`),
    undeclared,
    missingRequired,
    accepting: accepting.map((d) => d.signature),
  };
}

/* ----------------------------------------------------------------- tests */

describe('the SQL reader', () => {
  const definitions = (sql: string) =>
    [...replay([{ file: 'fixture.sql', sql }]).live.values()].map((d) => ({
      signature: d.signature,
      params: d.params.map(
        (p) => `${p.mode === 'in' ? '' : `${p.mode} `}${p.name}${p.hasDefault ? '?' : ''}`,
      ),
    }));

  it('reads a multi-line signature, its types and which parameters have a DEFAULT', () => {
    const sql = `
      create or replace function public.begin_thing(
        p_branch_id   uuid,
        p_kind        public.order_type,           -- a comment, with a comma
        p_amount      numeric(10, 2) default 0,
        p_tags        text[]   default '{a,b}'::text[],
        p_at          timestamptz = now(),
        p_label       character varying(20) default 'x, y'
      ) returns jsonb language plpgsql as $$ begin return null; end $$;`;
    expect(definitions(sql)).toEqual([
      {
        signature:
          'public.begin_thing(uuid, order_type, numeric, text[], timestamp with time zone, character varying)',
        params: ['p_branch_id', 'p_kind', 'p_amount?', 'p_tags?', 'p_at?', 'p_label?'],
      },
    ]);
  });

  it('reads quoted identifiers exactly, and folds unquoted ones', () => {
    const sql = `CREATE FUNCTION "public"."Mixed_Case"("p_Order_Id" UUID, P_Plain INT DEFAULT 1) RETURNS void AS 'select 1' LANGUAGE sql;`;
    expect(definitions(sql)).toEqual([
      { signature: 'public.Mixed_Case(uuid, integer)', params: ['p_Order_Id', 'p_plain?'] },
    ]);
  });

  it('ignores DDL that is commented out or sits inside a function body', () => {
    const sql = `
      create function public.kept(p_a uuid) returns void language sql as $$ select 1 $$;
      -- drop function public.kept(uuid);
      /* drop function public.kept(uuid); /* nested */ still a comment */
      create function public.body_mentions() returns void language plpgsql as $body$
      begin
        -- this text is inside a body and never runs as DDL here:
        perform 'drop function public.kept(uuid)';
      end
      $body$;`;
    expect(definitions(sql).map((d) => d.signature)).toEqual(['public.kept(uuid)', 'public.body_mentions()']);
  });

  it('treats a different argument list as a second overload, and drops by type, aliases included', () => {
    const sql = `
      create function public.f(p_a integer) returns void language sql as $$ select 1 $$;
      create or replace function public.f(p_a int4, p_b timestamptz default null) returns void language sql as $$ select 1 $$;
      create function public.g(p_x uuid) returns void language sql as $$ select 1 $$;
      drop function if exists public.f(int), public.g(p_x uuid) cascade;`;
    expect(definitions(sql)).toEqual([
      { signature: 'public.f(integer, timestamp with time zone)', params: ['p_a', 'p_b?'] },
    ]);
  });

  it('follows a rename and a move out of the public schema', () => {
    const sql = `
      create function public.old_name(p_a uuid) returns void language sql as $$ select 1 $$;
      create function public.moved(p_a uuid) returns void language sql as $$ select 1 $$;
      alter function public.old_name(uuid) rename to new_name;
      alter function public.moved(uuid) set schema private;
      alter function public.new_name(uuid) owner to postgres;`;
    expect(definitions(sql).map((d) => d.signature)).toEqual([
      'public.new_name(uuid)',
      'private.moved(uuid)',
    ]);
  });

  it('reports DDL it cannot replay instead of silently trusting the chain', () => {
    const chain = replay([
      {
        file: 'fixture.sql',
        sql: `do $$ begin execute 'drop function public.f(uuid)'; end $$;
              drop function if exists public.h(uuid);`,
      },
    ]);
    // The DO body is opaque, so the string inside it is part of one quoted segment.
    expect(chain.quotedDdl.map((q) => q.text)).toEqual([
      " begin execute 'drop function public.f(uuid)'; end ",
    ]);
    expect(chain.unmatchedDrops).toEqual([
      { file: 'fixture.sql', name: 'h', signature: 'public.h(uuid)', liveThen: [] },
    ]);
  });

  it('refuses what it cannot resolve rather than guessing', () => {
    expect(() => replay([{ file: 'x.sql', sql: "select 'unterminated" }])).toThrow(/x\.sql: unterminated/);
    // A %TYPE argument needs a database to resolve, so a drop by the concrete
    // type it stands for is reported as unmatched, never assumed to apply.
    const chain = replay([
      {
        file: 'x.sql',
        sql: `create function public.f(p_a public.orders.id%type) returns void language sql as $$ select $$;
              drop function public.f(uuid);`,
      },
    ]);
    expect(chain.unmatchedDrops).toEqual([
      { file: 'x.sql', name: 'f', signature: 'public.f(uuid)', liveThen: ['public.f(orders.id%type)'] },
    ]);
  });
});

describe('the TypeScript reader', () => {
  const read = (text: string) => readRpcCalls('fixture.ts', text);

  it('reads literal, shorthand and quoted keys, and a call with no arguments', () => {
    const { calls, problems } = read(`
      const p_token = 't';
      supabase.rpc('a');
      await supabase.rpc<Row>('b', {
        p_one: 1,
        'p_two': 2,
        p_token,
      }, { head: false });`);
    expect(problems).toEqual([]);
    expect(calls).toEqual([
      { where: 'fixture.ts:3', fn: 'a', keys: [] },
      { where: 'fixture.ts:4', fn: 'b', keys: ['p_one', 'p_two', 'p_token'] },
    ]);
  });

  it('refuses every call shape whose function or argument names it cannot read', () => {
    const { calls, problems } = read(`
      supabase.rpc(name, { p_a: 1 });
      supabase.rpc('spread', { ...args });
      supabase.rpc('computed', { [key]: 1 });
      supabase.rpc('variable', args);
      supabase.schema('other').rpc('elsewhere', {});
      const bound = supabase.rpc.bind(supabase);
      supabase['rpc']('hidden', {});
      const { rpc } = supabase;
      fetch(url + '/rest/v1/rpc/raw');
      const rpc2 = async (rpc: () => Promise<void>) => rpc(); // a callback named rpc is not a call`);
    expect(calls).toEqual([]);
    expect(problems.map((p) => p.replace(/^fixture\.ts:\d+: /, ''))).toEqual([
      'the function name is not a string literal',
      'an argument to spread has no literal name (a spread or a computed key)',
      'an argument to computed has no literal name (a spread or a computed key)',
      'the arguments to variable are not an object literal, so their names cannot be read',
      'elsewhere is called through .schema(), outside the public schema this test models',
      '.rpc is used without being called directly, so the call cannot be read',
      "['rpc'] hides the call from this test; call .rpc directly",
      'destructuring rpc hides the call from this test; call .rpc directly',
      'a raw PostgREST /rpc/ URL cannot be checked; use supabase.rpc',
    ]);
  });
});

describe('client RPC calls ↔ the migration chain', () => {
  let chain: Chain | null = null;
  let chainError: Error | null = null;
  try {
    chain = replayRepository();
  } catch (error) {
    chainError = error as Error;
  }
  const trees = [
    {
      tree: 'apps/mobile/src',
      label: 'customer app',
      anchor: { fn: 'request_customer_pos_resend', keys: ['p_order_id'] },
    },
    {
      tree: 'src',
      label: 'staff console',
      anchor: { fn: 'admin_set_order_status', keys: ['p_order_id', 'p_status'] },
    },
  ].map((t) => ({ ...t, ...readTree(t.tree) }));

  it('replays every migration in supabase/migrations', () => {
    expect(chainError?.message ?? null).toBeNull();
    expect(chain?.files.length).toBeGreaterThan(100);
    expect(chain?.live.size).toBeGreaterThan(100);
  });

  /**
   * The replay only sees top-level statements. Function DDL inside a DO block
   * or built as dynamic SQL may or may not run, so if it mentions a function a
   * client calls, the honest answer is "cannot tell" — which is a failure.
   *
   * A drop that matches no live definition is normal when nothing of that name
   * exists yet (the defensive `drop … if exists` before a first `create`). When
   * definitions of that name ARE live, it means this reader normalised a type
   * differently from Postgres, and the replay can no longer be trusted for it.
   */
  it('meets no DDL for a called function that it cannot replay', () => {
    const called = new Set(trees.flatMap((t) => t.calls.map((c) => c.fn)));
    const problems: string[] = [];
    for (const q of chain?.quotedDdl ?? []) {
      for (const fn of called) {
        if (new RegExp(`\\b${escapeRegExp(fn)}\\b`).test(q.text)) {
          problems.push(`${q.file}: function DDL inside a DO block or dynamic SQL mentions ${fn}`);
        }
      }
    }
    for (const d of chain?.unmatchedDrops ?? []) {
      if (called.has(d.name) && d.liveThen.length > 0) {
        problems.push(`${d.file}: drops ${d.signature}, matching none of ${d.liveThen.join('; ')}`);
      }
    }
    expect(problems).toEqual([]);
  });

  describe.each(trees)('$label ($tree)', ({ calls, problems, anchor }) => {
    it('reads every call it finds, and finds the known ones', () => {
      expect(problems).toEqual([]);
      expect(calls.map(({ fn, keys }) => ({ fn, keys }))).toContainEqual(anchor);
    });

    it.each(calls.map((c) => [`${c.where} ${c.fn}(${c.keys.join(', ')})`, c] as const))('%s', (_, call) => {
      const verdict = judge(call, chain ?? { files: [], live: new Map(), quotedDdl: [], unmatchedDrops: [] });
      expect(
        verdict.overloads,
        `public.${call.fn} is not defined by supabase/migrations, or a later migration drops it (PGRST202)`,
      ).not.toEqual([]);
      // Soft, so one run reports everything wrong with a call: a rename shows
      // up as BOTH an undeclared name and a missing one.
      expect.soft(verdict.undeclared, `sends argument names public.${call.fn} does not declare`).toEqual([]);
      expect
        .soft(verdict.missingRequired, `omits parameters of public.${call.fn} that have no DEFAULT`)
        .toEqual([]);
      expect
        .soft(
          verdict.accepting,
          `exactly one live definition must accept the call; live: ${verdict.overloads.join('; ')}`,
        )
        .toHaveLength(1);
    });
  });
});
