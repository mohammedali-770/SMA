/**
 * In-memory stand-ins for what the payment Edge Functions talk to: the tables
 * and RPCs they use through supabase-js, and Moyasar's REST API behind `fetch`.
 * Test code only; nothing here is deployed (paymentWiring.test.ts skips
 * __fixtures__ when it scans deployable sources).
 *
 * WHAT IS MODELLED, AND FROM WHERE. Only what the payment paths call, and each
 * piece from the SQL that defines it, so a test reads like the database would:
 *
 *   - payment_records' constraints: the (provider, provider_ref) unique index,
 *     one 'initiated' attempt per (order, provider) and per (session, provider),
 *     the order-or-session CHECK, and the trigger stamping confirmed_at /
 *     failed_at (20260707121300, 20260712120000, 20260712160000);
 *   - begin_payment_attempt / begin_session_attempt: reuse, expiry and the
 *     1.00 SAR minimum (20261003120000). The loyalty guard is not modelled; the
 *     SQL suite proves it;
 *   - finalize_checkout_session, row picker included (20260712170000);
 *   - confirm_order_payment (20260827120000, with 20261003120000's refusal).
 *
 * Every RPC is atomic: on an error nothing it wrote survives, as in Postgres.
 * Each call yields to the event loop first, so two flows started together
 * interleave at every await, the way two requests do.
 */

type Row = Record<string, unknown>;

export interface DbError {
  message: string;
  code?: string;
}

interface Result {
  data: unknown;
  error: DbError | null;
}

const TABLES = [
  'checkout_sessions',
  'orders',
  'payment_records',
  'integration_sync_logs',
  'integration_settings',
] as const;

let uuidSeq = 0;
function uuid(): string {
  uuidSeq += 1;
  const hex = uuidSeq.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function round2(n: unknown): number {
  return Math.round(Number(n) * 100) / 100;
}

class PgError extends Error {
  constructor(
    message: string,
    public code = 'P0001',
  ) {
    super(message);
  }
}

type Filter = (row: Row) => boolean;

/** One PostgREST-style query, built by chaining and run when awaited. */
class Query implements PromiseLike<Result> {
  private op: 'select' | 'update' | 'insert' = 'select';
  private cols = '*';
  private patch: Row = {};
  private rows: Row[] = [];
  private filters: Filter[] = [];
  private sort: { col: string; asc: boolean } | null = null;
  private max: number | null = null;
  private mode: 'many' | 'maybe' | 'single' = 'many';

  constructor(
    private db: FakePaymentDb,
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
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] != null && String(r[col]) === String(val));
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] != null && String(r[col]) !== String(val));
    return this;
  }
  is(col: string, val: null | boolean) {
    this.filters.push((r) => (val === null ? r[col] == null : r[col] === val));
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => r[col] != null && vals.map(String).includes(String(r[col])));
    return this;
  }
  /** `col.op.value` terms joined by commas, any of which may match. */
  or(expr: string) {
    const terms = expr.split(',').map((t) => {
      const [col, op, ...rest] = t.split('.');
      const val = rest.join('.');
      return (r: Row) => {
        if (op === 'is') return val === 'null' ? r[col] == null : String(r[col]) === val;
        if (op === 'eq') return r[col] != null && String(r[col]) === val;
        if (op === 'neq') return r[col] != null && String(r[col]) !== val;
        throw new Error(`or(): operator ${op} not modelled`);
      };
    });
    this.filters.push((r) => terms.some((t) => t(r)));
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
    this.mode = 'maybe';
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(ok, fail);
  }

  private async run(): Promise<Result> {
    await this.db.yieldTurn(`${this.table}.${this.op}`);
    const injected = this.db.takeFailure(`${this.table}.${this.op}`);
    if (injected) return { data: null, error: injected };
    try {
      if (this.op === 'insert') {
        this.db.writeRows(this.table, () => {
          for (const r of this.rows) this.db.insertRow(this.table, r);
        });
        return { data: null, error: null };
      }
      const match = this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
      if (this.op === 'update') {
        this.db.writeRows(this.table, () => {
          for (const r of match) this.db.updateRow(this.table, r, this.patch);
        });
        return { data: null, error: null };
      }
      let out = match;
      if (this.sort) {
        const { col, asc } = this.sort;
        out = [...out].sort((a, b) => {
          const d = String(a[col] ?? '').localeCompare(String(b[col] ?? ''));
          return asc ? d : -d;
        });
      }
      if (this.max != null) out = out.slice(0, this.max);
      const picked = out.map((r) => project(r, this.cols));
      if (this.mode === 'maybe') {
        if (picked.length > 1) return { data: null, error: { message: 'multiple rows', code: 'PGRST116' } };
        return { data: picked[0] ?? null, error: null };
      }
      if (this.mode === 'single') {
        if (picked.length !== 1) return { data: null, error: { message: 'not one row', code: 'PGRST116' } };
        return { data: picked[0], error: null };
      }
      return { data: picked, error: null };
    } catch (e) {
      if (e instanceof PgError) return { data: null, error: { message: e.message, code: e.code } };
      throw e;
    }
  }
}

function project(row: Row, cols: string): Row {
  if (cols.trim() === '*') return clone(row);
  const out: Row = {};
  for (const c of cols.split(',').map((x) => x.trim())) {
    if (!(c in row)) throw new Error(`select of unknown column ${c}`);
    out[c] = clone(row[c]);
  }
  return out;
}

export class FakePaymentDb {
  tables: Record<string, Row[]> = Object.fromEntries(TABLES.map((t) => [t, [] as Row[]]));
  /** RPC calls and their outcome, in order. */
  rpcLog: { name: string; args: Row; error: string | null }[] = [];
  private failures = new Map<string, DbError[]>();
  private gates = new Map<string, () => Promise<void>>();
  private seq = 0;

  rows(table: string): Row[] {
    const t = this.tables[table];
    if (!t) throw new Error(`table ${table} not modelled`);
    return t;
  }

  /** A strictly increasing timestamp, so "newest first" is never a tie. */
  stamp(): string {
    this.seq += 1;
    return new Date(Date.now() + this.seq).toISOString();
  }

  /** Make the next `table.op` (or RPC name) answer with this error. */
  failNext(key: string, error: DbError = { message: `${key} failed` }) {
    const list = this.failures.get(key) ?? [];
    list.push(error);
    this.failures.set(key, list);
  }
  takeFailure(key: string): DbError | null {
    const list = this.failures.get(key);
    return list?.length ? (list.shift() ?? null) : null;
  }

  /**
   * Hold a `key` operation (`table.op` or `rpc.name`) until released: a race,
   * made deterministic. `skip` lets that many `key` operations through first.
   * `entered` resolves once a flow is waiting there.
   */
  hold(key: string, skip = 0): { entered: Promise<void>; release: () => void } {
    let release!: () => void;
    let entered!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const enteredP = new Promise<void>((r) => (entered = r));
    let passed = 0;
    this.gates.set(key, async () => {
      if (passed < skip) {
        passed += 1;
        return;
      }
      // One-shot: the flow held here is the only one; every later `key`
      // operation, the other flow's included, goes straight through.
      this.gates.delete(key);
      entered();
      await released;
    });
    return { entered: enteredP, release };
  }
  async yieldTurn(key: string) {
    await Promise.resolve();
    const gate = this.gates.get(key);
    if (gate) await gate();
  }

  // ---- writes, with payment_records' constraints -------------------------------

  /** Run a write; if any constraint fails, restore the table as it was. */
  writeRows(table: string, fn: () => void) {
    const before = clone(this.rows(table));
    try {
      fn();
      if (table === 'payment_records') this.checkPaymentRecords();
    } catch (e) {
      this.tables[table] = before;
      throw e;
    }
  }

  insertRow(table: string, input: Row): Row {
    const known = COLUMNS[table];
    if (known) {
      for (const k of Object.keys(input)) {
        if (!known.includes(k)) throw new Error(`insert of unknown column ${table}.${k}`);
      }
    }
    const now = this.stamp();
    const row: Row =
      table === 'payment_records'
        ? {
            id: uuid(),
            order_id: null,
            checkout_session_id: null,
            provider: null,
            provider_ref: null,
            provider_checkout_ref: null,
            status: 'initiated',
            amount: 0,
            currency: 'SAR',
            mode: null,
            raw: null,
            reference_transaction: null,
            reference_order: null,
            checkout_url: null,
            initiated_at: now,
            confirmed_at: null,
            failed_at: null,
            failure_code: null,
            failure_message_safe: null,
            last_verified_at: null,
            expires_at: null,
            card_scheme: null,
            card_last_four: null,
            created_at: now,
            updated_at: now,
            ...clone(input),
          }
        : { id: uuid(), created_at: now, updated_at: now, ...clone(input) };
    if (table === 'payment_records') stampStatusTimes(row);
    this.rows(table).push(row);
    return row;
  }

  updateRow(table: string, row: Row, patch: Row) {
    for (const [k, v] of Object.entries(clone(patch))) {
      if (table === 'payment_records' && !(k in row)) throw new Error(`update of unknown column ${k}`);
      row[k] = v;
    }
    row.updated_at = this.stamp();
    if (table === 'payment_records') stampStatusTimes(row);
  }

  private checkPaymentRecords() {
    const seen = new Set<string>();
    const active = new Set<string>();
    for (const r of this.rows('payment_records')) {
      if (!['initiated', 'authorized', 'paid', 'failed', 'refunded'].includes(String(r.status))) {
        throw new PgError('payment_records_status_check', '23514');
      }
      if (r.order_id == null && r.checkout_session_id == null) {
        throw new PgError('payment_records_order_or_session_check', '23514');
      }
      if (r.mode != null && !['test', 'live'].includes(String(r.mode))) {
        throw new PgError('payment_records_mode_check', '23514');
      }
      if (r.provider_ref != null) {
        const key = `${r.provider}|${r.provider_ref}`;
        if (seen.has(key)) throw new PgError('payment_records_provider_ref_idx', '23505');
        seen.add(key);
      }
      if (r.status === 'initiated') {
        for (const key of [
          r.order_id != null ? `o|${r.order_id}|${r.provider}` : null,
          r.checkout_session_id != null ? `s|${r.checkout_session_id}|${r.provider}` : null,
        ]) {
          if (!key) continue;
          if (active.has(key)) throw new PgError('payment_records_one_active_idx', '23505');
          active.add(key);
        }
      }
    }
  }

  // ---- RPCs ---------------------------------------------------------------------

  async rpc(name: string, args: Row): Promise<Result> {
    await this.yieldTurn(`rpc.${name}`);
    const injected = this.takeFailure(`rpc.${name}`);
    if (injected) {
      this.rpcLog.push({ name, args: clone(args), error: injected.message });
      return { data: null, error: injected };
    }
    const snapshot = clone(this.tables);
    try {
      const fn = RPCS[name];
      if (!fn) throw new Error(`rpc ${name} not modelled`);
      const data = fn(this, args);
      this.checkPaymentRecords();
      this.rpcLog.push({ name, args: clone(args), error: null });
      return { data: clone(data), error: null };
    } catch (e) {
      this.tables = snapshot;
      if (e instanceof PgError) {
        this.rpcLog.push({ name, args: clone(args), error: e.message });
        return { data: null, error: { message: e.message, code: e.code } };
      }
      throw e;
    }
  }

  /** The supabase-js surface the functions use, over this database. */
  client() {
    return {
      from: (table: string) => new Query(this, table),
      rpc: (name: string, args: Row) => this.rpc(name, args),
    };
  }

  // ---- fixtures -------------------------------------------------------------------

  paymentRow(publicConfig: Row, secretConfig: Row, opts: { enabled?: boolean; provider?: string } = {}) {
    this.tables.integration_settings = this.tables.integration_settings.filter(
      (r) => r.provider_type !== 'payment',
    );
    this.insertRow('integration_settings', {
      provider_type: 'payment',
      provider_name: opts.provider ?? 'moyasar',
      enabled: opts.enabled ?? true,
      public_config: publicConfig,
      secret_config: secretConfig,
    });
  }

  session(input: Row = {}): Row {
    return this.insertRow('checkout_sessions', {
      customer_id: 'c0000000-0000-4000-8000-000000000001',
      status: 'pending_payment',
      order_id: null,
      total: 64,
      currency: 'SAR',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      ...input,
    });
  }

  order(input: Row = {}): Row {
    return this.insertRow('orders', {
      customer_id: 'c0000000-0000-4000-8000-000000000001',
      total: 64,
      payment_method: 'online',
      payment_status: 'pending',
      payment_provider: null,
      order_type: 'pickup',
      lazywait_ref: null,
      paid_at: null,
      ...input,
    });
  }

  attempts(where: Row): Row[] {
    return this.rows('payment_records').filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
  }
}

/** The real columns of the two tables the functions write freely. */
const COLUMNS: Record<string, string[]> = {
  payment_records: [
    'id',
    'order_id',
    'checkout_session_id',
    'provider',
    'provider_ref',
    'provider_checkout_ref',
    'status',
    'amount',
    'currency',
    'mode',
    'raw',
    'reference_transaction',
    'reference_order',
    'checkout_url',
    'initiated_at',
    'confirmed_at',
    'failed_at',
    'failure_code',
    'failure_message_safe',
    'last_verified_at',
    'expires_at',
    'card_scheme',
    'card_last_four',
    'created_at',
    'updated_at',
  ],
  integration_sync_logs: [
    'id',
    'provider',
    'order_id',
    'direction',
    'status',
    'request',
    'response',
    'error',
    'created_at',
  ],
};

/** stamp_payment_record_ts (20260712120000). */
function stampStatusTimes(row: Row) {
  const now = new Date().toISOString();
  if (row.status === 'paid' && row.confirmed_at == null) row.confirmed_at = now;
  if (row.status === 'failed' && row.failed_at == null) row.failed_at = now;
}

function attemptOut(r: Row, reused: boolean): Row[] {
  return [
    {
      attempt_id: r.id,
      reference_transaction: r.reference_transaction,
      reference_order: r.reference_order,
      provider_ref: r.provider_ref,
      provider_checkout_ref: r.provider_checkout_ref,
      checkout_url: r.checkout_url,
      amount: r.amount,
      currency: r.currency,
      mode: r.mode,
      reused,
    },
  ];
}

function beginAttempt(
  db: FakePaymentDb,
  key: 'order_id' | 'checkout_session_id',
  id: unknown,
  args: Row,
): Row[] {
  const provider = String(args.p_provider ?? '')
    .trim()
    .toLowerCase();
  const minutes = Math.max(5, Math.min(60, Number(args.p_expiry_minutes ?? 30)));
  const existing = db
    .rows('payment_records')
    .filter((r) => r[key] === id && r.provider === provider && r.status === 'initiated')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (existing) {
    if (existing.expires_at != null && Date.parse(String(existing.expires_at)) <= Date.now()) {
      db.updateRow('payment_records', existing, {
        status: 'failed',
        failure_code: 'expired',
        failure_message_safe: 'Payment session expired',
      });
    } else {
      return attemptOut(existing, true);
    }
  }
  const row = db.insertRow('payment_records', {
    [key]: id,
    provider,
    status: 'initiated',
    amount: args.__total,
    currency: args.__currency ?? 'SAR',
    mode: args.p_mode === 'live' ? 'live' : 'test',
    reference_transaction: `sm_${uuid().replace(/-/g, '')}`,
    reference_order: `${key === 'order_id' ? 'ORD' : 'CS'}-${String(id).replace(/-/g, '').slice(0, 12)}`,
    expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
  });
  return attemptOut(row, false);
}

const RPCS: Record<string, (db: FakePaymentDb, a: Row) => unknown> = {
  begin_session_attempt(db, a) {
    if (!String(a.p_provider ?? '').trim()) throw new PgError('A payment provider is required');
    const s = db.rows('checkout_sessions').find((r) => r.id === a.p_session_id);
    if (!s) throw new PgError(`Checkout session ${String(a.p_session_id)} not found`, 'P0002');
    if (s.order_id != null) throw new PgError('Checkout session already completed');
    if (s.status !== 'pending_payment') throw new PgError('Checkout session is not payable');
    if (Date.parse(String(s.expires_at)) <= Date.now()) throw new PgError('Checkout session expired');
    if (!(Number(s.total) > 0)) throw new PgError('Order total must be greater than zero');
    if (Number(s.total) < 1) throw new PgError('Order total is below the online payment minimum of 1.00 SAR');
    return beginAttempt(db, 'checkout_session_id', s.id, { ...a, __total: s.total, __currency: s.currency });
  },

  begin_payment_attempt(db, a) {
    if (!String(a.p_provider ?? '').trim()) throw new PgError('A payment provider is required');
    const o = db.rows('orders').find((r) => r.id === a.p_order_id);
    if (!o) throw new PgError(`Order ${String(a.p_order_id)} not found`, 'P0002');
    if (o.payment_status === 'paid') throw new PgError('Order is already paid');
    if (o.payment_method !== 'online') throw new PgError('Order is not an online-payment order');
    if (!(Number(o.total) > 0)) throw new PgError('Order total must be greater than zero');
    if (Number(o.total) < 1) throw new PgError('Order total is below the online payment minimum of 1.00 SAR');
    return beginAttempt(db, 'order_id', o.id, { ...a, __total: o.total });
  },

  finalize_checkout_session(db, a) {
    const s = db.rows('checkout_sessions').find((r) => r.id === a.p_session_id);
    if (!s) throw new PgError(`Checkout session ${String(a.p_session_id)} not found`, 'P0002');
    if (s.order_id != null) return db.rows('orders').find((o) => o.id === s.order_id) ?? null;
    if (!['pending_payment', 'expired'].includes(String(s.status))) {
      throw new PgError(`Checkout session is not payable (status=${String(s.status)})`);
    }
    if (round2(a.p_amount) !== round2(s.total)) {
      throw new PgError(`Paid amount ${String(a.p_amount)} does not match order total ${String(s.total)}`);
    }
    const order = db.order({
      customer_id: s.customer_id,
      total: s.total,
      payment_status: 'paid',
      payment_provider: a.p_provider,
      paid_at: new Date().toISOString(),
    });
    // The row picker, verbatim: prefer the attempt carrying this payment id,
    // else the NEWEST ref-less 'initiated' attempt.
    const pick = db
      .rows('payment_records')
      .filter(
        (r) =>
          r.checkout_session_id === s.id &&
          r.provider === a.p_provider &&
          (r.provider_ref === a.p_provider_ref || (r.provider_ref == null && r.status === 'initiated')),
      )
      .sort((x, y) => {
        const byRef =
          Number(y.provider_ref === a.p_provider_ref) - Number(x.provider_ref === a.p_provider_ref);
        return byRef !== 0 ? byRef : String(y.created_at).localeCompare(String(x.created_at));
      })[0];
    if (pick) {
      db.updateRow('payment_records', pick, {
        order_id: order.id,
        status: 'paid',
        provider_ref: a.p_provider_ref,
        amount: a.p_amount,
        currency: a.p_currency ?? 'SAR',
        raw: a.p_raw ?? pick.raw,
        card_scheme: a.p_card_scheme ?? pick.card_scheme,
        card_last_four: a.p_card_last4 ?? pick.card_last_four,
        last_verified_at: new Date().toISOString(),
      });
    } else {
      const clash = db
        .rows('payment_records')
        .find((r) => r.provider === a.p_provider && r.provider_ref === a.p_provider_ref);
      if (clash) db.updateRow('payment_records', clash, { order_id: order.id, status: 'paid' });
      else {
        db.insertRow('payment_records', {
          order_id: order.id,
          checkout_session_id: s.id,
          provider: a.p_provider,
          provider_ref: a.p_provider_ref,
          status: 'paid',
          amount: a.p_amount,
          currency: a.p_currency ?? 'SAR',
          raw: a.p_raw,
          card_scheme: a.p_card_scheme,
          card_last_four: a.p_card_last4,
        });
      }
    }
    s.status = 'consumed';
    s.order_id = order.id;
    return order;
  },

  confirm_order_payment(db, a) {
    const o = db.rows('orders').find((r) => r.id === a.p_order_id);
    if (!o) throw new PgError(`Order ${String(a.p_order_id)} not found`, 'P0002');
    if (
      a.p_provider_ref != null &&
      db
        .rows('payment_records')
        .some(
          (r) => r.provider === a.p_provider && r.provider_ref === a.p_provider_ref && r.status === 'paid',
        )
    ) {
      return o;
    }
    // 20261003120000: paid by ANOTHER payment, decided under the order lock.
    if (o.payment_status === 'paid') {
      throw new PgError('order_already_paid_by_another_payment', 'P0001');
    }
    if (round2(a.p_amount) !== round2(o.total)) {
      throw new PgError(`Payment amount ${String(a.p_amount)} does not match order total ${String(o.total)}`);
    }
    const existing = db
      .rows('payment_records')
      .find((r) => r.provider === a.p_provider && r.provider_ref === a.p_provider_ref);
    if (existing)
      db.updateRow('payment_records', existing, { status: 'paid', amount: a.p_amount, raw: a.p_raw });
    else {
      db.insertRow('payment_records', {
        order_id: a.p_order_id,
        provider: a.p_provider,
        provider_ref: a.p_provider_ref,
        status: 'paid',
        amount: a.p_amount,
        raw: a.p_raw,
      });
    }
    o.payment_status = 'paid';
    o.payment_provider = a.p_provider;
    o.paid_at = new Date().toISOString();
    return o;
  },
};

// ---------------------------------------------------------------------------
// Moyasar, behind fetch.
// ---------------------------------------------------------------------------

export interface FakePayment extends Row {
  id: string;
  status: string;
  amount: number;
  currency: string;
  invoice_id: string;
  created_at: string;
}

export interface FakeInvoice extends Row {
  id: string;
  status: string;
  amount: number;
  currency: string;
  url: string;
  metadata: Row;
  payments: FakePayment[];
  expired_at?: string;
}

/** Moyasar's REST API as the payment functions use it. Nothing leaves the process. */
export class FakeMoyasar {
  invoices = new Map<string, FakeInvoice>();
  payments = new Map<string, FakePayment>();
  /** Invoice create bodies, in order. */
  posts: Row[] = [];
  private seq = 0;

  pay(invoiceId: string, paymentId: string, status: string): FakePayment {
    const inv = this.invoices.get(invoiceId);
    if (!inv) throw new Error(`no invoice ${invoiceId}`);
    this.seq += 1;
    const p: FakePayment = {
      id: paymentId,
      status,
      amount: inv.amount,
      currency: inv.currency,
      invoice_id: invoiceId,
      created_at: new Date(Date.UTC(2026, 10, 12, 10, 0, this.seq)).toISOString(),
      source: { type: 'creditcard', company: 'mada', number: '4201-32XX-XXXX-1010', message: 'fake' },
    };
    inv.payments.push(p);
    this.payments.set(paymentId, p);
    if (status === 'paid') inv.status = 'paid';
    return p;
  }

  settle(paymentId: string, status = 'paid') {
    const p = this.payments.get(paymentId);
    if (!p) throw new Error(`no payment ${paymentId}`);
    p.status = status;
    if (status === 'paid') this.invoices.get(p.invoice_id)!.status = 'paid';
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = String(init.method ?? 'GET').toUpperCase();
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.hostname !== 'api.moyasar.com') throw new TypeError(`no network in tests: ${url.hostname}`);
    const [, kind, id] = url.pathname.split('/').filter(Boolean);
    if (kind === 'invoices' && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Row;
      this.posts.push(body);
      if (Number(body.amount) < 100) {
        return reply(400, {
          type: 'invalid_request_error',
          message: 'Validation Failed',
          errors: { amount: ['must be greater than or equal to 100'] },
        });
      }
      this.seq += 1;
      const inv: FakeInvoice = {
        id: `inv_${this.seq}`,
        status: 'initiated',
        amount: Number(body.amount),
        currency: String(body.currency),
        url: `https://checkout.moyasar.com/invoices/inv_${this.seq}`,
        metadata: (body.metadata ?? {}) as Row,
        payments: [],
        expired_at: body.expired_at as string | undefined,
      };
      this.invoices.set(inv.id, inv);
      return reply(201, inv);
    }
    if (kind === 'invoices' && method === 'GET' && id) {
      const inv = this.invoices.get(decodeURIComponent(id));
      return inv ? reply(200, inv) : reply(404, { type: 'not_found', message: 'Object not found' });
    }
    if (kind === 'invoices' && method === 'GET') {
      const ref = url.searchParams.get('metadata[reference_transaction]');
      return reply(200, {
        invoices: [...this.invoices.values()].filter((i) => i.metadata.reference_transaction === ref),
      });
    }
    if (kind === 'payments' && method === 'GET' && id) {
      const p = this.payments.get(decodeURIComponent(id));
      return p ? reply(200, p) : reply(404, { type: 'not_found', message: 'Object not found' });
    }
    return reply(400, { type: 'invalid_request_error', message: `not modelled: ${method} ${url.pathname}` });
  };
}

/** A complete LIVE Moyasar payment row's configuration. */
export const LIVE_PUBLIC = { mode: 'live', currency: 'SAR', invoice_expiry_minutes: 30 };
export const SECRETS = {
  moyasar_live_secret_key: 'sk_live_fixture',
  moyasar_test_secret_key: 'sk_test_fixture',
  moyasar_live_webhook_secret_token: 'whsec_live_fixture',
  moyasar_test_webhook_secret_token: 'whsec_test_fixture',
};
