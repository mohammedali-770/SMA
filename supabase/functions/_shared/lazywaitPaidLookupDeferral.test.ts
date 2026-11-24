import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentDb, freshDb, loadHandler, type FakeDb, type Row } from './__fixtures__/handlerFakes.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * Audit F-D2-001: a card-paid order was sent to the POS as UNPAID when the
 * captured-payment lookup returned an error. Create Order has no idempotency
 * key and the separate update-online-payment call is gone, so nothing ever
 * corrected the ticket: the branch saw the full total owing for a customer who
 * had paid.
 *
 * The fix defers the hand-off instead: the claim is released to `pending` with a
 * short delay, no ticket is created and no customer message is queued. This
 * drives the REAL lazywait-sync handler over handlerFakes.ts.
 *
 * The control cases are what make the deferral mean something: the same order
 * with a working lookup goes out PAID, and every order the lookup never applies
 * to (cash) or that has no paid record without an error still goes out exactly
 * as before. A fix that deferred too much would strand orders, which is worse
 * than the defect.
 */

const TRIGGER = 'sync-trigger-fixture';
const ORDER_ID = '11111111-2222-4333-8444-555555555555';

let db: FakeDb;
let posBodies: Row[];

function order(over: Row = {}): Row {
  return {
    id: ORDER_ID,
    order_number: 'SM-2026-000998',
    branch_id: 'branch-1',
    order_type: 'pickup',
    status: 'preparing',
    customer_id: null,
    customer_name: 'Guest',
    customer_phone: null,
    notes: null,
    is_comped: false,
    address_snapshot: null,
    payment_method: 'online',
    payment_status: 'paid',
    subtotal: 25,
    discount_amount: 0,
    loyalty_discount_amount: 0,
    comp_discount_amount: 0,
    vat_amount: 3.26,
    total: 25,
    delivery_fee: 0,
    lazywait_sync_state: 'syncing',
    lazywait_ref: null,
    sync_attempt_count: 0,
    first_pos_sync_failure_at: null,
    pos_sync_started_at: new Date(Date.now() - 60_000).toISOString(),
    pos_sync_deadline_at: new Date(Date.now() + 9 * 60_000).toISOString(),
    ...over,
  };
}

/** payment_records answers every read with an error, as a failed PostgREST call does. */
function failPaymentRecordReads() {
  const real = db.client.bind(db);
  db.client = () => {
    const c = real();
    const failing: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'maybeSingle']) failing[m] = () => failing;
    failing.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { message: 'connection reset' } }).then(ok, fail);
    return { ...c, from: (t: string) => (t === 'payment_records' ? failing : c.from(t)) } as ReturnType<
      typeof real
    >;
  };
}

function useOrder(o: Row) {
  db.rpcs.claim_lazywait_sync_batch = () => [o];
}

beforeEach(() => {
  db = freshDb({ SUPABASE_URL: 'https://project.example' });
  db.rows('integration_settings').push({
    provider_type: 'lazywait',
    enabled: true,
    provider_name: 'lazywait',
    public_config: { base_url: 'https://apiv2-dev.lazywait.com/v1', client_id: 'client-fixture' },
    secret_config: { sync_trigger_secret: TRIGGER, api_token: 'token-fixture' },
  });
  db.rows('branches').push({ id: 'branch-1', lazywait_branch_id: 'lw-branch-1' });
  db.rows('order_items').push({
    order_id: ORDER_ID,
    id: 'item-1',
    name_en: 'Wrap',
    name_ar: 'لفافة',
    note: null,
    quantity: 1,
    unit_price: 25,
    product_id: 'p-1',
    variant_id: null,
    variant_name_en: null,
    variant_name_ar: null,
    products: {
      lazywait_item_id: 'lw-item-1',
      lazywait_price_id: 'lw-price-1',
      categories: { lazywait_category_id: 'lw-cat-1' },
    },
    product_variants: null,
    order_item_modifiers: [],
  });
  db.rpcs.reap_stale_lazywait_syncs = () => ({});
  db.rpcs.record_lazywait_sync = () => null;
  db.rpcs.begin_lazywait_create_attempt = () => 'ready_to_send';
  useOrder(order());

  posBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (String(url).includes('/pos/orders/create')) {
        posBodies.push(JSON.parse(String(init.body ?? '{}')) as Row);
        return new Response(
          JSON.stringify({ success: true, order: { order_ref: 'REF_1', order_number: 'LW-1' } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

async function tick() {
  const h = await loadHandler('lazywait-sync', () => import('../lazywait-sync/index.ts'));
  const res = await h(
    new Request('https://project.example/functions/v1/lazywait-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': TRIGGER },
      body: JSON.stringify({ limit: 5 }),
    }),
  );
  return { status: res.status, body: await res.json() };
}

const recorded = () => db.rpcLog.filter((c) => c.name === 'record_lazywait_sync');

describe('a card-paid order whose payment lookup fails is deferred, never sent unpaid', () => {
  it('sends nothing, releases the claim to pending a moment ahead, and tells nobody', async () => {
    failPaymentRecordReads();
    const before = Date.now();
    const res = await tick();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      claimed: 1,
      skipped: 1,
      synced: 0,
      blocked: 0,
      retrying: 0,
      dead_letter: 0,
    });
    expect(posBodies).toHaveLength(0);
    // Before the fenced gate: no send-phase marker was ever written.
    expect(db.rpcLog.map((c) => c.name)).not.toContain('begin_lazywait_create_attempt');

    expect(recorded()).toHaveLength(1);
    const call = recorded()[0].args;
    expect(call.p_order_id).toBe(ORDER_ID);
    const patch = call.p_patch as Row;
    expect(patch.lazywait_sync_state).toBe('pending');
    expect(patch.sync_last_error).toBe('payment_lookup_failed');
    // Due on a later tick, inside the deadline, and not counted as an attempt.
    const due = Date.parse(String(patch.sync_next_attempt_at));
    expect(due).toBeGreaterThanOrEqual(before + 25_000);
    expect(due).toBeLessThan(Date.parse(String(order().pos_sync_deadline_at)));
    expect('sync_attempt_count' in patch).toBe(false);
    expect(call.p_log_status).toBe('skipped');
    expect(call.p_error).toBe('payment_lookup_deferred');
    // No customer message: nothing has gone wrong that they need to hear about.
    expect(call.p_notify_status).toBeUndefined();
  });

  it('leaves one JSON line naming the order and the deferral', async () => {
    failPaymentRecordReads();
    await tick();
    const lines = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('lazywait-sync.payment_lookup'))
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      order_id: ORDER_ID,
      outcome: 'deferred',
      sent: false,
      release_failed: false,
    });
  });

  it('is claimed again on a later tick and then goes out PAID, so deferral is not a strand', async () => {
    failPaymentRecordReads();
    await tick();
    expect(posBodies).toHaveLength(0);

    // The read recovers and the minute cron claims the released row again.
    db.client = Object.getPrototypeOf(db).client;
    db.rows('payment_records').push({
      id: 'pr-1',
      order_id: ORDER_ID,
      status: 'paid',
      provider_ref: 'pay_1',
      card_scheme: 'mada',
      card_last_four: '1010',
      raw: {},
      mode: 'live',
      confirmed_at: '2026-11-24T10:00:00Z',
    });
    const again = await tick();
    expect(again.body).toMatchObject({ claimed: 1, synced: 1, skipped: 0 });
    expect(posBodies).toHaveLength(1);
    expect(posBodies[0].is_paid).toBe(true);
  });
});

describe('what the deferral must not touch', () => {
  it('control: the same order with a working lookup is sent PAID', async () => {
    db.rows('payment_records').push({
      id: 'pr-1',
      order_id: ORDER_ID,
      status: 'paid',
      provider_ref: 'pay_1',
      card_scheme: 'visa',
      card_last_four: '4242',
      raw: {},
      mode: 'live',
      confirmed_at: '2026-11-24T10:00:00Z',
    });
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, synced: 1, skipped: 0 });
    expect(posBodies).toHaveLength(1);
    expect(posBodies[0].is_paid).toBe(true);
    expect(recorded().map((c) => (c.args.p_patch as Row).lazywait_sync_state)).toEqual(['synced']);
  });

  it('a lookup that succeeds and finds no paid record is NOT deferred: it goes out unpaid, as before', async () => {
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, synced: 1, skipped: 0 });
    expect(posBodies).toHaveLength(1);
    expect(posBodies[0].is_paid).toBeUndefined();
  });

  it('a cash order never looks the payment up, so a broken payment table cannot hold it back', async () => {
    failPaymentRecordReads();
    useOrder(order({ payment_method: 'cash', payment_status: 'pending' }));
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, synced: 1, skipped: 0 });
    expect(posBodies).toHaveLength(1);
    expect(posBodies[0].is_paid).toBeUndefined();
  });

  it('an online order the row does not call paid is not deferred either', async () => {
    failPaymentRecordReads();
    useOrder(order({ payment_status: 'pending' }));
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, skipped: 0 });
    expect(recorded().map((c) => (c.args.p_patch as Row).lazywait_sync_state)).not.toContain('pending');
  });
});
