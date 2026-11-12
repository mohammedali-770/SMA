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
 * find the function ... in the schema cache") — and until this file, for the
 * functions a shipped client calls, it passed every CI gate:
 *
 *   - most SQL suites call these functions POSITIONALLY
 *     (`manual_only_pos_resend_test.sql` passes a bare uuid), so a rename
 *     replays and passes. The exception is `compute_campaign_discount`:
 *     `discounts_campaigns_test.sql` and `promo_disclosure_test.sql` call it
 *     by name, so renaming one of its parameters already failed them, and its
 *     only client call, `src/lib/campaigns.ts`, is not wired into any surface;
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
 * IT FAILS LOUDLY RATHER THAN GUESS. Each of these is reported as a failure,
 * never skipped:
 *
 *   - a call whose function name or argument object is not a literal, or a
 *     `.rpc` reference that is not a direct call;
 *   - function DDL in quoted text (a DO block, a function body, or a string it
 *     may EXECUTE) that mentions a called function. Only text that can run is
 *     read: the quoted text's own comments, the message of a RAISE and the
 *     value of a top-level COMMENT ON are not. The exception is a line comment
 *     that reaches the end of the quoted text: an E'\n' escape or a format()
 *     argument can end it at run time, so that text is read whole;
 *   - a DROP ... CASCADE of a table (foreign tables included), a view
 *     (materialized ones included), a type, a domain, a schema, an extension
 *     or a language, and any DROP OWNED, at top level or in quoted text,
 *     whatever it names. Each can remove functions without naming them, and
 *     only a database can tell which: in the 2026-11-12 review a `push_devices`
 *     rebuild ending in `drop table … cascade` applied cleanly on a local PG16
 *     replay and took `register_push_device`, which returns that rowtype;
 *   - a drop that matched no live definition, when Postgres could have matched
 *     it to a live overload of a called function.
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
 *   - It follows only the dependencies listed above. A function that a CASCADE
 *     removes another way passes: through a parameter DEFAULT that calls a
 *     function dropped with CASCADE, for one. So does DDL whose words appear in
 *     no single string or statement (`format('%s function …', 'drop')`). No
 *     migration used CASCADE on a drop on 2026-11-12.
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

/** A string literal or dollar-quoted body, and the statement text that leads up to it. */
interface Quoted {
  body: string;
  /**
   * Its statement from the start up to the opening quote, comments removed and
   * earlier quotes rendered. It is what tells the message of a RAISE, or the
   * value of a COMMENT ON, from a string that can run.
   */
  before: string;
}

/** What a statement's text holds in place of a quote. */
type Render = (quote: Quoted, dollar: boolean) => string;

/** Hides a quote's contents, so a statement reads as its code alone. */
const mask: Render = (_quote, dollar) => (dollar ? '$$' : "''");

/**
 * Split SQL into top-level statements, with comments removed and each string
 * literal and dollar-quoted body replaced by what `render` returns (masked, by
 * default). Function bodies are opaque here on purpose: a `create function`
 * inside one does not run when the migration does. What they contain is
 * returned separately, so DDL hidden in a DO block can be refused rather than
 * ignored.
 */
function scanSql(sql: string, render: Render = mask): { statements: string[]; quoted: Quoted[] } {
  const statements: string[] = [];
  const quoted: Quoted[] = [];
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
      const quote = { body, before: current };
      quoted.push(quote);
      current += render(quote, false);
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
      const quote = { body: sql.slice(i + tag.length, end), before: current };
      quoted.push(quote);
      current += render(quote, true);
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

const inputCount = (params: Param[]) => params.filter((p) => p.mode !== 'out').length;

/**
 * The message of a RAISE, which is shown and never run: `raise [level] '…'`,
 * or the value of a `using message|detail|hint = '…'` option.
 */
function isRaiseMessage(before: string): boolean {
  return (
    /\braise(?:\s+(?:debug|log|info|notice|warning|exception))?\s*e?$/i.test(before) ||
    (/\b(?:message|detail|hint)\s*:?=\s*e?$/i.test(before) && /\braise\b[\s\S]*\busing\b/i.test(before))
  );
}

/** The value of a top-level `comment on … is '…'`: stored as a description, never run. */
const COMMENT_VALUE = /^\s*comment\s+on\b[\s\S]*\bis\s*e?$/i;

/**
 * The text of a quoted segment that can RUN. It is re-scanned with the same
 * reader, so its own comments drop out, and every string inside it is kept in
 * place, because a string may be EXECUTEd or fed to format(); the exception is
 * the message of a RAISE. Text that does not read as SQL (a message with an
 * apostrophe, a regular expression) is kept whole, so nothing is dropped on a
 * guess.
 *
 * A line comment that reaches the end of the text is also kept whole. Its end
 * can be supplied at run time by an E'\n' escape or a format() argument, and
 * whatever follows then runs: `execute E'-- note\n drop function …'` drops the
 * function on PG16. Reading that tail as comment text would hide the DDL.
 */
function runnableText(segment: string): string {
  if (/--[^\n]*$/.test(segment)) return segment;
  try {
    const render: Render = (q) => (isRaiseMessage(q.before) ? "''" : `'${runnableText(q.body)}'`);
    return scanSql(segment, render).statements.join(';\n');
  } catch {
    return segment;
  }
}

/** Function DDL. In quoted text it may or may not run, so for a called function it is refused. */
const FUNCTION_DDL = /\b(?:create|drop|alter)\s+(?:or\s+replace\s+)?(?:function|routine)\b/i;

/**
 * The objects whose CASCADE drop removes functions without naming them. A
 * table's or a view's rowtype, an enum or a domain can be a function's argument
 * or return type, and a schema, an extension or a language holds functions.
 * DROP OWNED removes every function a role owns, CASCADE or not.
 */
const CASCADING = String.raw`(?:foreign\s+table|table|materialized\s+view|view|type|domain|schema|extension|(?:procedural\s+)?language)`;
const IMPLICIT_DROP = new RegExp(String.raw`^drop\s+${CASCADING}\b[\s\S]*\bcascade$|^drop\s+owned\b`, 'i');
/** The same, anywhere in quoted text; `[^;]*` keeps the CASCADE inside the drop's own statement. */
const IMPLICIT_DROP_IN_TEXT = new RegExp(
  String.raw`\bdrop\s+${CASCADING}\b[^;]*\bcascade\b|\bdrop\s+owned\b`,
  'i',
);

interface Chain {
  files: string[];
  live: Map<string, Definition>;
  /** The runnable text (see `runnableText`) of every quoted segment that holds function DDL. */
  quotedDdl: { file: string; text: string }[];
  /** Statements, top-level or in quoted text, that can remove a function without naming it. */
  implicitDrops: { file: string; text: string }[];
  /**
   * Drops that matched no live definition. `liveThen` holds every overload of
   * that name then live, and `suspects` the ones Postgres could still have
   * dropped, which the replay may therefore have wrong. DROP FUNCTION matches
   * input arguments only, so only an overload with as many input arguments as
   * the drop names is a suspect. DROP ROUTINE on PG16 can also match OUT
   * arguments, so every overload is.
   */
  unmatchedDrops: { file: string; name: string; signature: string; liveThen: string[]; suspects: string[] }[];
}

const EMPTY_CHAIN: Chain = {
  files: [],
  live: new Map(),
  quotedDdl: [],
  implicitDrops: [],
  unmatchedDrops: [],
};

function replay(files: { file: string; sql: string }[]): Chain {
  const live = new Map<string, Definition>();
  const chain: Chain = {
    files: files.map((f) => f.file),
    live,
    quotedDdl: [],
    implicitDrops: [],
    unmatchedDrops: [],
  };
  const overloadsOf = (schema: string, name: string) =>
    [...live.values()].filter((d) => d.schema === schema && d.name === name);
  for (const { file, sql } of files) {
    let scan: ReturnType<typeof scanSql>;
    try {
      scan = scanSql(sql);
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`);
    }
    for (const q of scan.quoted) {
      if (COMMENT_VALUE.test(q.before)) continue;
      const text = runnableText(q.body);
      if (FUNCTION_DDL.test(text)) chain.quotedDdl.push({ file, text });
      if (IMPLICIT_DROP_IN_TEXT.test(text)) chain.implicitDrops.push({ file, text });
    }
    for (const statement of scan.statements) {
      const fail = (why: string) => new Error(`${file}: ${why}: ${statement.slice(0, 160)}`);
      let m: RegExpExecArray | null;
      if (IMPLICIT_DROP.test(statement)) {
        chain.implicitDrops.push({ file, text: statement });
      } else if ((m = /^create\s+(?:or\s+replace\s+)?function\s+/i.exec(statement))) {
        const target = qualifiedName(statement.slice(m[0].length));
        const list = target && parenthesized(target.rest);
        if (!target || !list) throw fail('cannot read the function name and parameter list');
        const params = parseParams(list.inner);
        const signature = signatureOf(target.schema, target.name, params);
        live.set(signature, { ...target, params, file, signature });
      } else if ((m = /^drop\s+(function|routine)\s+(?:if\s+exists\s+)?/i.exec(statement))) {
        const kind = m[1].toLowerCase();
        const items = statement.slice(m[0].length).replace(/\s+(cascade|restrict)\s*$/i, '');
        for (const item of splitTopLevel(items)) {
          const target = qualifiedName(item);
          if (!target) throw fail('cannot read the dropped function');
          const list = parenthesized(target.rest);
          const named = list ? parseParams(list.inner) : null;
          const overloads = overloadsOf(target.schema, target.name);
          const matched = named
            ? [signatureOf(target.schema, target.name, named)]
            : overloads.map((d) => d.signature);
          if (matched.some((s) => live.delete(s))) continue;
          const suspects = overloads.filter(
            (d) => kind === 'routine' || named === null || inputCount(d.params) === inputCount(named),
          );
          chain.unmatchedDrops.push({
            file,
            name: target.name,
            signature: matched[0] ?? item,
            liveThen: overloads.map((d) => d.signature),
            suspects: suspects.map((d) => d.signature),
          });
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

/** One line of at most 120 characters, for a failure message. */
const brief = (sql: string) => {
  const line = sql.replace(/\s+/g, ' ').trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
};

/**
 * Everything the replay could not follow that could change a function a
 * client calls, as failure messages. None of them is a skip:
 *
 *   - a statement that can remove functions without naming them. Postgres
 *     picks what it takes from dependencies this reader cannot see, so it
 *     fails whichever functions are called. Name what goes, and leave CASCADE
 *     out, so that Postgres refuses rather than removes;
 *   - function DDL in quoted text that mentions a called function. The replay
 *     runs only top-level statements, and whether a DO block, a function body
 *     or an EXECUTEd string runs its DDL cannot be told from source;
 *   - a drop that matched no live definition while a live overload of a called
 *     function is a suspect (see `Chain`): this reader may have normalised a
 *     type differently from Postgres, or DROP ROUTINE matched an OUT argument.
 *
 * Any other unmatched drop changes nothing a client calls. With IF EXISTS it is
 * the defensive `drop … if exists` before a first `create`, or a drop of a
 * signature that never existed, which Postgres skips with a NOTICE. Without IF
 * EXISTS Postgres raises an error and the migration does not apply at all.
 */
function cannotReplay(chain: Chain, called: ReadonlySet<string>): string[] {
  const problems = chain.implicitDrops.map(
    (d) =>
      `${d.file}: "${brief(d.text)}" can remove functions it does not name, through a rowtype, a type, a schema or an owner, so the replay cannot tell which are left`,
  );
  for (const q of chain.quotedDdl) {
    for (const fn of called) {
      if (new RegExp(`\\b${escapeRegExp(fn)}\\b`).test(q.text)) {
        problems.push(
          `${q.file}: function DDL in quoted text (a DO block, a function body or a string) mentions ${fn}, and the replay runs only top-level statements`,
        );
      }
    }
  }
  for (const d of chain.unmatchedDrops) {
    if (called.has(d.name) && d.suspects.length > 0) {
      problems.push(
        `${d.file}: drops ${d.signature}, which matches no live definition, but Postgres may have dropped ${d.suspects.join(' or ')}`,
      );
    }
  }
  return problems;
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
        sql: `do $$ begin execute 'drop function public.f(uuid)'; -- a comment
              end $$;
              drop function if exists public.h(uuid);
              drop table public.t cascade;`,
      },
    ]);
    // A quoted segment is kept as the text that could run: re-scanned, so its
    // comment is gone, with the string it EXECUTEs left in place.
    expect(chain.quotedDdl.map((q) => q.text)).toEqual([
      "begin execute 'drop function public.f(uuid)';\nend",
    ]);
    expect(chain.implicitDrops.map((d) => d.text)).toEqual(['drop table public.t cascade']);
    expect(chain.unmatchedDrops).toEqual([
      { file: 'fixture.sql', name: 'h', signature: 'public.h(uuid)', liveThen: [], suspects: [] },
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
      {
        file: 'x.sql',
        name: 'f',
        signature: 'public.f(uuid)',
        liveThen: ['public.f(orders.id%type)'],
        suspects: ['public.f(orders.id%type)'],
      },
    ]);
  });
});

describe('DDL the replay cannot follow', () => {
  /** `base` then `fixture`, replayed in that order and checked for the functions in `called`. */
  const check = (base: string, fixture: string, called: string[]) => {
    const chain = replay([
      { file: 'base.sql', sql: base },
      { file: 'fixture.sql', sql: fixture },
    ]);
    return { live: [...chain.live.keys()], problems: cannotReplay(chain, new Set(called)) };
  };
  const VALIDATE_COUPON = `create function public.validate_coupon(p_code text, p_subtotal numeric)
    returns jsonb language sql as $$ select null::jsonb $$;`;

  it('refuses the push_devices rebuild, whose CASCADE takes the function returning that rowtype', () => {
    // Verbatim from the 2026-11-12 review. On PG16 it applies with rc 0 and
    // prints "NOTICE: drop cascades to function
    // register_push_device(text,text,text,boolean,boolean)"; the customer app
    // calls that function on every permission grant and sign-in claim.
    const { live, problems } = check(
      `create table public.push_devices (id bigserial primary key, expo_push_token text unique not null);
       create function public.register_push_device(p_token text, p_platform text, p_lang text,
         p_order_updates boolean, p_promos boolean)
         returns public.push_devices language plpgsql as $$ declare v public.push_devices; begin return v; end $$;`,
      `create table public.push_devices_new (like public.push_devices including all);
       insert into public.push_devices_new select * from public.push_devices;
       drop table public.push_devices cascade;
       alter table public.push_devices_new rename to push_devices;`,
      ['register_push_device'],
    );
    // The replay alone still counts the function live: only this refusal
    // stands between the rebuild and a green run.
    expect(live).toEqual(['public.register_push_device(text, text, text, boolean, boolean)']);
    expect(problems).toEqual([
      'fixture.sql: "drop table public.push_devices cascade" can remove functions it does not name, through a rowtype, a type, a schema or an owner, so the replay cannot tell which are left',
    ]);
  });

  it.each([
    'drop type public.order_type cascade',
    'drop domain if exists public.phone_e164 cascade',
    'drop view public.v, public.w cascade',
    'DROP MATERIALIZED VIEW public.m CASCADE',
    'drop schema private cascade',
    'drop extension if exists pg_net cascade',
    'drop owned by legacy_owner',
    "do $$ begin execute format('drop table %I cascade', 'push_devices'); end $$",
    "do $$ begin execute 'drop type public.' || 'order_type' || ' cascade'; end $$",
  ])('refuses %s, whatever a client calls', (sql) => {
    expect(check('', `${sql};`, []).problems).toHaveLength(1);
  });

  it('lets through a drop that cannot cascade into a function', () => {
    const { problems } = check(
      '',
      `drop table if exists public.tmp_import;
       drop view public.v restrict;
       do $$ begin execute 'alter publication supabase_realtime drop table public.orders'; end $$;`,
      [],
    );
    expect(problems).toEqual([]);
  });

  // The next three applied on PG16 with rc 0 and left the function's
  // definition unchanged, yet each used to fail this check.

  it('does not read the wording of a verification block: its comments and RAISE messages never run', () => {
    const { problems } = check(
      VALIDATE_COUPON,
      `do $$ begin if to_regprocedure('public.validate_coupon(text, numeric)') is null then raise exception 'validate_coupon(text, numeric) is missing: the create function above did not land'; end if; end $$;
       do $verify$
       begin
         -- A create or replace function validate_coupon that parses is not one that works.
         perform public.validate_coupon('SAVE10', 100);
       end
       $verify$;`,
      ['validate_coupon'],
    );
    expect(problems).toEqual([]);
  });

  it('does not read the value of a COMMENT ON, which is stored and never run', () => {
    const { problems } = check(
      'create function public.export_my_data() returns jsonb language sql as $$ select null::jsonb $$;',
      "comment on function public.export_my_data() is 'PDPL access export. Never alter function export_my_data to take an argument: zero arguments is the security model.';",
      ['export_my_data'],
    );
    expect(problems).toEqual([]);
  });

  it('lets through a defensive DROP FUNCTION IF EXISTS of a signature that never existed', () => {
    // DROP FUNCTION matches input arguments only, so a one-argument drop cannot
    // take the two-argument function: Postgres prints "function
    // public.validate_coupon(text) does not exist, skipping".
    const { live, problems } = check(
      VALIDATE_COUPON,
      'drop function if exists public.validate_coupon(text);',
      ['validate_coupon'],
    );
    expect(problems).toEqual([]);
    expect(live).toEqual(['public.validate_coupon(text, numeric)']);
  });

  it('still refuses function DDL that a DO block runs for a called function', () => {
    const { problems } = check(
      VALIDATE_COUPON,
      `do $$ begin
         if to_regprocedure('public.validate_coupon_v1(text, numeric)') is null then
           alter function public.validate_coupon(text, numeric) rename to validate_coupon_v1;
         end if;
       end $$;
       do $$ begin execute format('drop function public.%I(text, numeric)', 'validate_coupon'); end $$;`,
      ['validate_coupon'],
    );
    const refusal =
      'fixture.sql: function DDL in quoted text (a DO block, a function body or a string) mentions validate_coupon, and the replay runs only top-level statements';
    expect(problems).toEqual([refusal, refusal]);
  });

  // From the 2026-11-12 re-verification. In each, a line comment's end is
  // supplied at run time, by an E'\n' escape or a format() argument, and the
  // DDL after it runs: on PG16 the first two really rename and drop
  // validate_coupon. Read as comment text, the DDL used to vanish.
  it.each([
    `do $$ begin execute E'-- rename the old overload first\\n  alter function public.validate_coupon(text, numeric) rename to validate_coupon_v1'; end $$;`,
    `do $$ begin execute format('-- the old overload goes first %s drop function public.validate_coupon(text, numeric)', E'\\n'); end $$;`,
    `select cron.schedule('nightly-cleanup', '0 3 * * *', E'-- nightly\\n  drop function if exists public.validate_coupon(text, numeric)');`,
  ])('still refuses function DDL that follows a line comment ended at run time: %s', (sql) => {
    expect(check(VALIDATE_COUPON, sql, ['validate_coupon']).problems).toEqual([
      'fixture.sql: function DDL in quoted text (a DO block, a function body or a string) mentions validate_coupon, and the replay runs only top-level statements',
    ]);
  });

  it('still refuses a CASCADE drop that follows a line comment ended at run time', () => {
    const { problems } = check(
      '',
      `do $$ begin execute E'-- rebuild\\n  drop table public.push_devices cascade'; end $$;`,
      [],
    );
    expect(problems).toHaveLength(1);
  });

  it('still refuses an unmatched drop that Postgres could have matched to a live overload', () => {
    // f: the same number of input arguments, and this reader cannot resolve
    // %TYPE. g: on PG16, DROP ROUTINE also matches OUT arguments, so this drop
    // removes g(a text, out b integer), while the same DROP FUNCTION leaves it.
    const { live, problems } = check(
      `create function public.f(p_a public.orders.id%type) returns void language sql as $$ select $$;
       create function public.g(a text, out b integer) language sql as $$ select 1 $$;
       create function public.h(a text, out b integer) language sql as $$ select 1 $$;`,
      `drop function public.f(uuid);
       drop routine if exists public.g(text, integer);
       drop function if exists public.h(text, integer);`,
      ['f', 'g', 'h'],
    );
    expect(problems).toEqual([
      'fixture.sql: drops public.f(uuid), which matches no live definition, but Postgres may have dropped public.f(orders.id%type)',
      'fixture.sql: drops public.g(text, integer), which matches no live definition, but Postgres may have dropped public.g(text)',
    ]);
    expect(live).toEqual(['public.f(orders.id%type)', 'public.g(text)', 'public.h(text)']);
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

  // What the replay cannot follow is "cannot tell", which is a failure; see cannotReplay.
  it('meets no DDL it cannot replay that could reach a called function', () => {
    const called = new Set(trees.flatMap((t) => t.calls.map((c) => c.fn)));
    expect(cannotReplay(chain ?? EMPTY_CHAIN, called)).toEqual([]);
  });

  describe.each(trees)('$label ($tree)', ({ calls, problems, anchor }) => {
    it('reads every call it finds, and finds the known ones', () => {
      expect(problems).toEqual([]);
      expect(calls.map(({ fn, keys }) => ({ fn, keys }))).toContainEqual(anchor);
    });

    it.each(calls.map((c) => [`${c.where} ${c.fn}(${c.keys.join(', ')})`, c] as const))('%s', (_, call) => {
      const verdict = judge(call, chain ?? EMPTY_CHAIN);
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
