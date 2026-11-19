import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentDb, freshDb, loadHandler, type FakeDb, type Row } from './__fixtures__/handlerFakes.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * The payment line on a ticket created paid (`order_payments`, Create Order),
 * driven through the REAL lazywait-sync handler over handlerFakes.ts.
 *
 * 2026-11-19: `is_paid` made the receipt print "Paid", yet the POS order list
 * showed paid 0.00 and no payment type, even once update-online-payment was
 * accepted (SM-2026-000110). The list reads the order's own payment lines,
 * which were always sent empty. Owner: "just fill it with Online Credit Card
 * for now". Lazywait does not document the entry, so the worker retries a 400
 * ONCE without it: the order must reach the kitchen whatever the POS thinks
 * of the guess.
 *
 * Also pinned here: Create Order's `warnings` (e.g. ORDER_TOTAL_MISMATCH) are
 * kept in the sync log instead of being dropped.
 */

const TRIGGER = 'sync-trigger-fixture';
const ORDER_ID = '11111111-2222-4333-8444-555555555555';

let db: FakeDb;
let creates: Array<Record<string, unknown>>;
let replies: Array<{ status: number; body: unknown }>;

function order(over: Row = {}): Row {
  return {
    id: ORDER_ID,
    order_number: 'SM-2026-000999',
    branch_id: 'branch-1',
    order_type: 'pickup',
    status: 'received',
    payment_method: 'online',
    payment_status: 'paid',
    customer_id: null,
    customer_name: 'Guest',
    customer_phone: null,
    notes: null,
    is_comped: false,
    address_snapshot: null,
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

const OK = { status: 200, body: { success: true, order: { order_ref: 'REF_1', order_number: 'LW-1' } } };

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
  db.rows('payment_records').push({
    id: 'pr-1',
    order_id: ORDER_ID,
    status: 'paid',
    provider_ref: 'pay_fixture_1',
    card_scheme: 'mada',
    card_last_four: '1010',
    confirmed_at: new Date().toISOString(),
  });
  db.rpcs.reap_stale_lazywait_syncs = () => ({});
  db.rpcs.claim_lazywait_sync_batch = () => [order()];
  db.rpcs.record_lazywait_sync = () => null;
  db.rpcs.begin_lazywait_create_attempt = () => 'ready_to_send';

  creates = [];
  replies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (String(url).includes('/pos/orders/create')) {
        creates.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        const r = replies.shift() ?? OK;
        return new Response(JSON.stringify(r.body), { status: r.status });
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

const recorded = () => db.rpcLog.filter((c) => c.name === 'record_lazywait_sync').map((c) => c.args);

describe('a card order certain to be paid', () => {
  it('is created paid WITH an Online Credit Card payment line for the total', async () => {
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, synced: 1 });
    expect(creates).toHaveLength(1);
    expect(creates[0].is_paid).toBe(true);
    expect(creates[0].order_payments).toEqual([
      {
        names: { en: 'ONLINE CREDIT CARD', ar: 'بطاقة ائتمانية' },
        amount: 25,
        Card_Type: 'MADA',
        Card_Number: '****1010',
        status: 'approved',
        Approval_No: 'pay_fixture_1',
        transaction_uuid: 'pay_fixture_1',
      },
    ]);
    expect(recorded()[0].p_response).toMatchObject({ order_payments: 'sent', warnings: null });
  });

  it('a 400 with the payment line is retried ONCE without it, and the order still reaches the POS', async () => {
    replies.push({ status: 400, body: { message: 'Invalid order_payments' } });
    const res = await tick();
    expect(res.body).toMatchObject({ claimed: 1, synced: 1 });
    expect(creates).toHaveLength(2);
    expect(creates[0].order_payments).toBeDefined();
    expect(creates[1].order_payments).toBeUndefined();
    expect(creates[1].is_paid).toBe(true);
    const log = recorded();
    expect(log).toHaveLength(1);
    expect((log[0].p_patch as Row).lazywait_sync_state).toBe('synced');
    expect(String((log[0].p_response as Row).order_payments)).toMatch(
      /^dropped_after_400: .*Invalid order_payments/,
    );
  });

  it('a second 400 is not retried again: two POSTs at most', async () => {
    replies.push({ status: 400, body: { message: 'bad' } }, { status: 400, body: { message: 'still bad' } });
    await tick();
    expect(creates).toHaveLength(2);
    const log = recorded()[0];
    expect((log.p_patch as Row).lazywait_sync_state).toBe('blocked');
    // The log still says the payment line was dropped, and why.
    expect(String((log.p_response as Row).order_payments)).toMatch(/^dropped_after_400: bad/);
  });

  it('a non-400 refusal is NOT retried (a 5xx may have created the ticket)', async () => {
    replies.push({ status: 500, body: { message: 'boom' } });
    await tick();
    expect(creates).toHaveLength(1);
  });
});

describe('anything not certain to be paid gets no payment line', () => {
  it('a cash order: no line, and a 400 is not retried', async () => {
    db.rpcs.claim_lazywait_sync_batch = () => [order({ payment_method: 'cash', payment_status: 'pending' })];
    replies.push({ status: 400, body: { message: 'bad' } });
    await tick();
    expect(creates).toHaveLength(1);
    expect(creates[0].order_payments).toBeUndefined();
    expect(creates[0].is_paid).toBeUndefined();
    expect((recorded()[0].p_response as Row).order_payments).toBeNull();
  });

  it('an online order with no paid payment record: no line, no is_paid', async () => {
    db.tables.payment_records = [];
    await tick();
    expect(creates[0].order_payments).toBeUndefined();
    expect(creates[0].is_paid).toBeUndefined();
  });
});

describe('Create Order warnings are kept in the sync log', () => {
  it('an ORDER_TOTAL_MISMATCH warning is recorded', async () => {
    const warning = { code: 'ORDER_TOTAL_MISMATCH', sent_total: 25, vat_rate: 15, till: { total: 28.75 } };
    replies.push({ status: 200, body: { ...OK.body, warnings: [warning] } });
    await tick();
    expect((recorded()[0].p_response as Row).warnings).toEqual([warning]);
  });
});
