import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { call, currentDb, freshRuntime, setEnv, webhook } from './__fixtures__/paymentRuntime.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * WHEN the branch POS is told about a card payment. Gap PG-09 in
 * `docs/readiness/20261113-card-payments-gaps.md`.
 *
 * Since 2026-11-19 the answer is: only on the ticket itself. lazywait-sync
 * creates it paid, with one `order_payments` line (posPaidFlag.ts,
 * lazywaitOrderPayments.test.ts). The confirmation used to follow up with a
 * separate update-online-payment call, sent on every confirmation while the
 * POS held the order; Lazywait accepted it and recorded nothing, and it would
 * have counted the payment twice had it ever started to, so the owner had it
 * removed ("remove it"). `docs/RECORD_OF_PROCESSING.md` activities 3 and 15
 * say the same.
 *
 * This drives the REAL payment-initiate and payment-webhook handlers over the
 * in-memory fakes (paymentFakes.ts) and counts the requests to the POS, so the
 * record and the code cannot drift apart unnoticed. (A staff re-check,
 * `payment-test-config`'s `verify_order`, reaches the same confirmation
 * through `verifyMoyasarAttempt`; it is not driven here.)
 */

let db: FakePaymentDb;
let moyasar: FakeMoyasar;
let posPosts: { path: string; body: Record<string, unknown> }[];

beforeEach(() => {
  ({ db, moyasar } = freshRuntime());
  db.paymentRow(LIVE_PUBLIC, SECRETS);
  // The POS integration, configured. No sync trigger secret, so the only POS
  // request a confirmation can make is the online-payment update.
  db.insertRow('integration_settings', {
    provider_type: 'lazywait',
    provider_name: 'lazywait',
    enabled: true,
    public_config: { client_id: 'CID_TEST' },
    secret_config: { api_token: 'TOKEN_TEST' },
  });
  db.tables.branches = [{ id: 'br000000-0000-4000-8000-000000000001', lazywait_branch_id: 'LWB_1' }];
  posPosts = [];
  const moyasarFetch = moyasar.fetch;
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'api.moyasar.com') return moyasarFetch(input, init);
    posPosts.push({ path: url.pathname, body: JSON.parse(String(init.body ?? '{}')) });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** A checkout paid by card, confirmed once by Moyasar's webhook. */
async function paidSession() {
  const session = db.session({ total: 64 });
  const init = await call('payment-initiate', { checkoutSessionId: session.id, language: 'en' });
  expect(init.status).toBe(200);
  const payment = moyasar.pay(String(init.body.invoiceId), 'pay_pos_1', 'paid');
  expect((await webhook(payment)).body.status).toBe('paid');
  const order = db.rows('orders')[0];
  return { session, payment, order };
}

const updates = () => posPosts.filter((p) => p.path.endsWith('/pos/orders/update-online-payment'));

describe('a confirmation never posts the payment to the POS', () => {
  it('nothing is sent while the POS does not hold the order, however often it is confirmed', async () => {
    const { payment, order } = await paidSession();
    order.branch_id = 'br000000-0000-4000-8000-000000000001';
    await webhook(payment);
    expect(updates()).toHaveLength(0);
    expect(posPosts).toHaveLength(0);
  });

  it('nothing is sent once the POS holds the order either (removed 2026-11-19)', async () => {
    const { payment, order } = await paidSession();
    // lazywait-sync has since created the order in the POS.
    order.lazywait_ref = 'LW-ORDER-1';
    order.branch_id = 'br000000-0000-4000-8000-000000000001';
    await webhook(payment); // Moyasar repeats its notification
    await webhook(payment); // and again
    expect(updates()).toHaveLength(0);
    // No sync trigger secret is configured here, so no POS request of any kind.
    expect(posPosts).toHaveLength(0);
  });
});

// 2026-11-18, order SM-2026-000099: the order existed at 13:23:20.5 but the app
// saw the receipt only at 13:23:35.6, because the confirmation waited for the
// POS before answering. The POS handoff now runs after the response.
describe('the confirmation answers before the POS handoff', () => {
  const rt = globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } };
  let deferred: Promise<unknown>[];
  let releasePos: () => void;

  beforeEach(() => {
    deferred = [];
    rt.EdgeRuntime = {
      waitUntil: (p) => {
        deferred.push(p);
      },
    };
    // The POS kick is configured, so the handoff starts with a request to
    // lazywait-sync, which the gate below holds open, as a slow POS would.
    setEnv('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: 'sb_publishable_fixture' }));
    const lw = db.rows('integration_settings').find((r) => r.provider_type === 'lazywait');
    (lw!.secret_config as Record<string, unknown>).sync_trigger_secret = 'sync_fixture';
    // Hold every POS request open until the test releases it.
    const gate = new Promise<void>((r) => {
      releasePos = r;
    });
    const inner = (globalThis as { fetch: typeof fetch }).fetch;
    (globalThis as Record<string, unknown>).fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname !== 'api.moyasar.com') await gate;
      return inner(input, init);
    };
  });
  afterEach(() => {
    delete rt.EdgeRuntime;
  });

  it('returns paid while the POS kick is still open, then sends it in the background', async () => {
    const session = db.session({ total: 64 });
    const init = await call('payment-initiate', { checkoutSessionId: session.id, language: 'en' });
    const payment = moyasar.pay(String(init.body.invoiceId), 'pay_pos_bg', 'paid');
    const order0 = () => db.rows('orders')[0];

    // The order is created and the answer is 'paid' with the POS still blocked.
    const res = await webhook(payment);
    expect(res.body.status).toBe('paid');
    expect(order0()).toBeTruthy();
    expect(deferred).toHaveLength(1);
    expect(posPosts).toHaveLength(0); // the kick itself is still held
    expect(updates()).toHaveLength(0);

    // The POS holds the order by the time the background work reads it.
    order0().lazywait_ref = 'LW-ORDER-BG';
    order0().branch_id = 'br000000-0000-4000-8000-000000000001';
    releasePos();
    await Promise.all(deferred);
    // The background work is the kick of lazywait-sync, and only that.
    expect(posPosts.map((p) => p.path)).toEqual(['/functions/v1/lazywait-sync']);
    expect(updates()).toHaveLength(0);
  });
});
