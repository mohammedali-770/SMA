/**
 * Runs a REAL Edge Function handler inside Vitest, over a small in-memory
 * database, for the handlers paymentRuntime.ts does not cover.
 *
 * A handler module calls `Deno.serve` when it is imported and builds its
 * clients through `_shared/supabaseClient.ts`, which imports supabase-js from
 * an `npm:` specifier Vite cannot resolve. A test that uses this mocks that
 * module to hand out `currentDb().client()`, exactly as the payment tests do:
 *
 *   vi.mock('./supabaseClient.ts', () => ({
 *     adminClient: () => currentDb().client(),
 *     userClient: () => currentDb().client(),
 *   }));
 *
 * What the fake models, and no more: `from(t).select(cols)` with the columns
 * PROJECTED (a column the handler did not select reads as absent, so a check
 * on an unselected column fails here as it would against PostgREST),
 * `.update(patch)`, `.eq`, `.in`, `.order`, `.limit`, `.maybeSingle`, and
 * `rpc(name, args)` answered by functions the test supplies. It does not model
 * SQL: every RPC answer is whatever the test says it is.
 */

export type Row = Record<string, unknown>;
export type Handler = (req: Request) => Promise<Response>;
type Result = { data: unknown; error: { message: string } | null };
export type RpcFn = (db: FakeDb, args: Row) => unknown;

const g = globalThis as Record<string, unknown>;
let captured: Handler | null = null;
let env: Record<string, string> = {};

g.Deno = {
  env: { get: (key: string) => env[key] },
  serve: (h: Handler) => {
    captured = h;
    return { finished: Promise.resolve(), shutdown() {} };
  },
};

class Query implements PromiseLike<Result> {
  private op: 'select' | 'update' = 'select';
  private cols = '*';
  private patch: Row = {};
  private filters: Array<(r: Row) => boolean> = [];
  private sort: { col: string; asc: boolean } | null = null;
  private max: number | null = null;
  private single = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(cols = '*') {
    if (this.op === 'select') this.cols = cols;
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] != null && String(r[col]) === String(val));
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.map(String).includes(String(r[col])));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.sort = { col, asc: opts.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, fail);
  }

  private run(): Result {
    const rows = this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') {
      this.db.writes.push({ table: this.table, patch: { ...this.patch }, matched: rows.length });
      for (const r of rows) Object.assign(r, this.patch);
      return { data: null, error: null };
    }
    let out = [...rows];
    if (this.sort) {
      const { col, asc } = this.sort;
      out.sort((a, b) => (asc ? 1 : -1) * String(a[col] ?? '').localeCompare(String(b[col] ?? '')));
    }
    if (this.max != null) out = out.slice(0, this.max);
    const picked = out.map((r) => project(r, this.cols));
    if (this.single) return { data: picked[0] ?? null, error: null };
    return { data: picked, error: null };
  }
}

/**
 * A plain column list is projected; a select carrying an embed (`a(b, c)`) is
 * returned whole, because the fixture rows for it are written in the embedded
 * shape already.
 */
function project(row: Row, cols: string): Row {
  if (cols.trim() === '*' || cols.includes('(')) return structuredClone(row);
  const out: Row = {};
  for (const c of cols.split(',').map((x) => x.trim())) if (c in row) out[c] = structuredClone(row[c]);
  return out;
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  rpcs: Record<string, RpcFn> = {};
  rpcLog: { name: string; args: Row }[] = [];
  writes: { table: string; patch: Row; matched: number }[] = [];

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  client() {
    return {
      from: (table: string) => new Query(this, table),
      rpc: async (name: string, args: Row = {}): Promise<Result> => {
        this.rpcLog.push({ name, args: structuredClone(args) });
        const fn = this.rpcs[name];
        if (!fn) return { data: null, error: { message: `rpc ${name} not modelled` } };
        return { data: structuredClone(fn(this, args)), error: null };
      },
    };
  }
}

let db = new FakeDb();

/** A fresh database and environment for the next test. */
export function freshDb(nextEnv: Record<string, string> = {}): FakeDb {
  db = new FakeDb();
  env = { ...nextEnv };
  return db;
}

export function currentDb(): FakeDb {
  return db;
}

const handlers = new Map<string, Handler>();

/** Import a handler module once and return what it passed to `Deno.serve`. */
export async function loadHandler(name: string, importer: () => Promise<unknown>): Promise<Handler> {
  const have = handlers.get(name);
  if (have) return have;
  captured = null;
  await importer();
  const h = captured as Handler | null;
  if (!h) throw new Error(`${name} did not call Deno.serve`);
  handlers.set(name, h);
  return h;
}
