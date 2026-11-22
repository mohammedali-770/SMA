import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentDb, freshDb, loadHandler, type FakeDb, type Row } from './__fixtures__/handlerFakes.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * lazywait-sync needs NO change for a cancelled order to stop at the gate
 * (docs/MIGRATIONS.md §67, 20261015120000_cancelled_order_followups).
 *
 * That migration makes `begin_lazywait_create_attempt` answer a cancelled
 * order with a new status, 'order_cancelled', and park it in the same locked
 * statement (blocked / order_cancelled). The worker acts on five gate answers
 * and treats any other as "not ready". This file drives the REAL handler, over
 * handlerFakes.ts, to prove that path does the right thing with the new answer:
 *
 *   * the Create Order POST never leaves;
 *   * the worker writes nothing (no record_lazywait_sync, no table write), so
 *     it cannot overwrite the gate's park, and queues no customer message;
 *   * it leaves one JSON line naming the order and the answer.
 *
 * The control case is what makes the negative mean something: the same fixture
 * answered 'ready_to_send' does POST and does record. Passes before and after
 * the migration, on purpose: the worker is unchanged, and this pins that it
 * may stay so. A worker change that started acting on unknown gate answers
 * (resending, or writing a state over the gate's) fails here.
 */

const TRIGGER = 'sync-trigger-fixture';
const ORDER_ID = '11111111-2222-4333-8444-555555555555';

let db: FakeDb;
let posCreates: number;
let warn: ReturnType<typeof vi.spyOn>;

function order(): Row {
  return {
    id: ORDER_ID,
    order_number: 'SM-2026-000999',
    branch_id: 'branch-1',
    order_type: 'pickup',
    status: 'cancelled',
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
  };
}

function runWith(gateAnswer: string) {
  db.rpcs.begin_lazywait_create_attempt = () => gateAnswer;
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
  db.rpcs.claim_lazywait_sync_batch = () => [order()];
  db.rpcs.record_lazywait_sync = () => null;

  posCreates = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/pos/orders/create')) {
        posCreates += 1;
        return new Response(
          JSON.stringify({ success: true, order: { order_ref: 'REF_1', order_number: 'LW-1' } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

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

/**
 * 20261022120000_pos_resend_refund_guards adds two more refusals at the same
 * place in the gate, parked the same way: 'refund_started' (the order's money
 * is going, or has gone, back) and 'order_progressed' (the branch already has
 * it ready, out for delivery or delivered). The worker needs no change for
 * them either, and the same three properties must hold for each.
 */
describe.each(['order_cancelled', 'refund_started', 'order_progressed'])('lazywait-sync, told %s by the gate', (answer) => {
  it('sends nothing, writes nothing, and says why', async () => {
    runWith(answer);
    const res = await tick();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      claimed: 1,
      skipped: 1,
      synced: 0,
      blocked: 0,
      dead_letter: 0,
      retrying: 0,
    });
    expect(posCreates).toBe(0);
    // The gate already parked the row; the worker must not write over it.
    expect(db.rpcLog.map((c) => c.name)).not.toContain('record_lazywait_sync');
    expect(db.writes).toEqual([]);
    // The gate was asked exactly once, for this order.
    expect(
      db.rpcLog.filter((c) => c.name === 'begin_lazywait_create_attempt').map((c) => c.args.p_order_id),
    ).toEqual([ORDER_ID]);

    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.map((l) => JSON.parse(l))).toContainEqual({
      at: 'lazywait-sync.gate',
      order_id: ORDER_ID,
      outcome: 'not_ready',
      sent: false,
      gate_status: answer,
    });
  });
});

describe('the control: the same fixture, answered ready_to_send', () => {
  it('does POST and does record, so the case above is not vacuous', async () => {
    runWith('ready_to_send');
    const res = await tick();

    expect(res.status).toBe(200);
    expect(posCreates).toBe(1);
    expect(res.body).toMatchObject({ claimed: 1, synced: 1, skipped: 0 });
    const recorded = db.rpcLog.filter((c) => c.name === 'record_lazywait_sync');
    expect(recorded).toHaveLength(1);
    expect((recorded[0].args.p_patch as Row).lazywait_sync_state).toBe('synced');
  });
});
