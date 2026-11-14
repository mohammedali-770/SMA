import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { call, currentDb, freshRuntime, webhook } from './__fixtures__/paymentRuntime.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * WHEN the branch POS is told about a card payment. Gap PG-09 in
 * `docs/readiness/20261113-card-payments-gaps.md`.
 *
 * `docs/RECORD_OF_PROCESSING.md` activity 15 says what Lazywait receives for a
 * card order (the total, Moyasar's payment id, the word "card") and when: each
 * time our server confirms the payment while the POS holds the order, so more
 * than once, and possibly after the POS gains the order. The first version of
 * that sentence said "once, and nothing sends it later", which review showed
 * false on 2026-11-14. This drives the REAL payment-initiate and payment-webhook
 * handlers over the in-memory fakes (paymentFakes.ts) and counts the requests
 * to the POS, so the record and the code cannot drift apart unnoticed. (A staff
 * re-check, `payment-test-config`'s `verify_order`, reaches the same
 * confirmation through `verifyMoyasarAttempt`; it is not driven here.)
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

describe('when the POS receives a card payment', () => {
  it('sends nothing while the POS does not hold the order', async () => {
    const { payment, order } = await paidSession();
    expect(updates()).toHaveLength(0);
    // Everything else is in place (the branch is mapped); only the POS
    // reference is missing, and a repeated confirmation still sends nothing.
    order.branch_id = 'br000000-0000-4000-8000-000000000001';
    await webhook(payment);
    expect(updates()).toHaveLength(0);
  });

  it('sends it again on every later confirmation, once the POS holds the order', async () => {
    const { payment, order } = await paidSession();
    // lazywait-sync has since created the order in the POS.
    order.lazywait_ref = 'LW-ORDER-1';
    order.branch_id = 'br000000-0000-4000-8000-000000000001';

    await webhook(payment); // Moyasar repeats its notification
    expect(updates()).toHaveLength(1);
    await webhook(payment); // and again
    expect(updates()).toHaveLength(2);

    // Every one carries the same three customer facts the records name.
    for (const u of updates()) {
      expect(u.body).toMatchObject({
        order_ref: 'LW-ORDER-1',
        Trans_Amount: 64,
        Approval_No: 'pay_pos_1',
        Card_Type: 'card',
      });
    }
  });
});
