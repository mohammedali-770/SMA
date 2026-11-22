import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { call, currentDb, freshRuntime, setEnv } from './__fixtures__/paymentRuntime.ts';
import {
  PAYMENT_ALLOW_TEST_CHECKOUT_ENV,
  PAYMENT_TEST_CHECKOUT_CUSTOMER_IDS_ENV,
  allowTestModeCheckout,
  testCheckoutCustomerIds,
} from './paymentTestCheckout.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * The testing-phase switch PAYMENT_ALLOW_TEST_CHECKOUT (owner request,
 * 2026-11-18), driven through the REAL payment-initiate, payment-verify and
 * payment-webhook handlers over the fakes in paymentFakes.ts.
 *
 * Unset, or any value but the exact string 'true', both refusals stand exactly
 * as before: payment-initiate answers {status:'disabled', reason:'test_mode'}
 * and opens nothing, and a TEST attempt is never confirmed. Exactly 'true', a
 * customer LISTED in PAYMENT_TEST_CHECKOUT_CUSTOMER_IDS pays a real order with
 * the TEST key, and it confirms as a live payment does. Any other customer is
 * refused exactly as with the switch off (F-EFP-05-001: until 2026-11-22 the
 * switch admitted every signed-in customer).
 *
 * The customer is the one who owns the session or order (the fixtures' default
 * `customer_id`, OWNER below), never anything in the request.
 */

const TEST_PUBLIC = { ...LIVE_PUBLIC, mode: 'test' };
const NOT_ON = [undefined, 'TRUE', '1', '', ' true', 'yes'] as const;
const TEST_MODE_REFUSAL = { status: 'disabled', reason: 'test_mode' };
/** The fixtures' default customer, who owns every session and order below unless stated. */
const OWNER = 'c0000000-0000-4000-8000-000000000001';
const STRANGER = 'c0000000-0000-4000-8000-0000000000ff';

let db: FakePaymentDb;
let moyasar: FakeMoyasar;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ({ db, moyasar } = freshRuntime());
  db.paymentRow(TEST_PUBLIC, SECRETS);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Set the switch; the list names OWNER unless a list is given (null: the list is unset). */
const switchTo = (value: string | undefined, list: string | null = OWNER) => {
  setEnv(PAYMENT_ALLOW_TEST_CHECKOUT_ENV, value);
  setEnv(PAYMENT_TEST_CHECKOUT_CUSTOMER_IDS_ENV, list ?? undefined);
};

/** The structured log lines written, parsed, with the given event name. */
function logged(event: string): Record<string, unknown>[] {
  return warn.mock.calls
    .map((c) => {
      try {
        return JSON.parse(String(c[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l): l is Record<string, unknown> => l?.event === event);
}

/** A Moyasar TEST-mode webhook, as the sandbox sends it. */
function testWebhook(payment: Record<string, unknown>) {
  return call('payment-webhook', {
    id: `evt_${String(payment.id)}_payment_paid`,
    type: 'payment_paid',
    live: false,
    secret_token: 'whsec_test_fixture',
    data: payment,
  });
}

describe('allowTestModeCheckout()', () => {
  it("is true only for the exact string 'true'", () => {
    switchTo('true');
    expect(allowTestModeCheckout(OWNER)).toBe(true);
    for (const v of NOT_ON) {
      switchTo(v);
      expect(allowTestModeCheckout(OWNER), JSON.stringify(v)).toBe(false);
    }
  });

  it('is true only for a listed customer', () => {
    switchTo('true', `${OWNER}`);
    expect(allowTestModeCheckout(STRANGER)).toBe(false);
    for (const nobody of [null, '', ' , ']) {
      switchTo('true', nobody);
      expect(allowTestModeCheckout(OWNER), JSON.stringify(nobody)).toBe(false);
    }
    switchTo('true', ` ${STRANGER} ,${OWNER.toUpperCase()} `);
    expect(allowTestModeCheckout(OWNER)).toBe(true);
    expect(allowTestModeCheckout(STRANGER)).toBe(true);
  });

  it('never matches a missing or malformed customer id, or a malformed entry', () => {
    switchTo('true', `${OWNER},*,not-a-uuid,`);
    for (const id of [undefined, null, '', '*', 'not-a-uuid', 42, { id: OWNER }, [OWNER]]) {
      expect(allowTestModeCheckout(id), JSON.stringify(id)).toBe(false);
    }
    expect([...testCheckoutCustomerIds(`${OWNER},*,not-a-uuid,`)]).toEqual([OWNER]);
  });

  it('fails closed when the environment cannot be read', () => {
    const g = globalThis as Record<string, unknown>;
    const deno = g.Deno;
    g.Deno = {
      env: {
        get: () => {
          throw new Error('no env permission');
        },
      },
    };
    try {
      expect(allowTestModeCheckout(OWNER)).toBe(false);
    } finally {
      g.Deno = deno;
    }
  });
});

describe('payment-initiate in TEST mode', () => {
  it.each(NOT_ON)('switch %j: both flows are refused and nothing is opened', async (value) => {
    switchTo(value);
    const session = db.session();
    expect((await call('payment-initiate', { checkoutSessionId: session.id })).body).toEqual(
      TEST_MODE_REFUSAL,
    );
    const order = db.order();
    expect((await call('payment-initiate', { orderId: order.id })).body).toEqual(TEST_MODE_REFUSAL);
    expect(db.rows('payment_records')).toHaveLength(0);
    expect(moyasar.posts).toHaveLength(0);
    expect(logged('payment_test_mode_allowed')).toHaveLength(0);
  });

  it("switch 'true': a session checkout opens a TEST invoice and logs it", async () => {
    switchTo('true');
    const session = db.session();
    const res = await call('payment-initiate', { checkoutSessionId: session.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'moyasar', mode: 'test', checkoutSessionId: session.id });
    expect(String(res.body.checkoutUrl)).toMatch(/^https:\/\/checkout\.moyasar\.com\//);
    expect(db.attempts({ checkout_session_id: session.id }).map((a) => a.mode)).toEqual(['test']);
    expect(moyasar.posts).toHaveLength(1);
    expect(logged('payment_test_mode_allowed')).toEqual([
      expect.objectContaining({ fn: 'payment-initiate', flow: 'session' }),
    ]);
  });

  it("switch 'true': an order checkout opens a TEST invoice too", async () => {
    switchTo('true');
    const order = db.order();
    const res = await call('payment-initiate', { orderId: order.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'moyasar', mode: 'test' });
    expect(db.attempts({ order_id: order.id }).map((a) => a.mode)).toEqual(['test']);
    expect(logged('payment_test_mode_allowed')).toEqual([
      expect.objectContaining({ fn: 'payment-initiate', flow: 'order' }),
    ]);
  });

  it("switch 'true': a customer who is not listed is refused in both flows, nothing opened", async () => {
    switchTo('true', STRANGER);
    const session = db.session();
    expect((await call('payment-initiate', { checkoutSessionId: session.id })).body).toEqual(
      TEST_MODE_REFUSAL,
    );
    const order = db.order();
    expect((await call('payment-initiate', { orderId: order.id })).body).toEqual(TEST_MODE_REFUSAL);
    expect(db.rows('payment_records')).toHaveLength(0);
    expect(moyasar.posts).toHaveLength(0);
    expect(logged('payment_test_mode_allowed')).toHaveLength(0);
  });

  it("switch 'true' with no list: nobody is admitted", async () => {
    switchTo('true', null);
    const session = db.session();
    expect((await call('payment-initiate', { checkoutSessionId: session.id })).body).toEqual(
      TEST_MODE_REFUSAL,
    );
    expect(moyasar.posts).toHaveLength(0);
  });

  it('the customer is the owner of the row, whatever the request says', async () => {
    switchTo('true', OWNER);
    const session = db.session({ customer_id: STRANGER });
    const res = await call('payment-initiate', {
      checkoutSessionId: session.id, customerId: OWNER, customer_id: OWNER,
    });
    expect(res.body).toEqual(TEST_MODE_REFUSAL);
    expect(moyasar.posts).toHaveLength(0);
  });

  it("switch 'true': the minimum still applies", async () => {
    switchTo('true');
    const session = db.session({ total: 0.5 });
    expect((await call('payment-initiate', { checkoutSessionId: session.id })).body).toEqual({
      status: 'disabled',
      reason: 'amount_below_minimum',
    });
    expect(moyasar.posts).toHaveLength(0);
  });

  // A TEST attempt reused after the gateway was switched to live must not be
  // handed out, even with the switch left on: a test card would then pay a real
  // order on a live gateway.
  it("switch 'true': a reused TEST attempt is refused once the gateway is live", async () => {
    switchTo('true');
    const session = db.session();
    expect((await call('payment-initiate', { checkoutSessionId: session.id })).status).toBe(200);
    db.paymentRow(LIVE_PUBLIC, SECRETS);
    expect((await call('payment-initiate', { checkoutSessionId: session.id })).body).toEqual(
      TEST_MODE_REFUSAL,
    );
    expect(moyasar.posts).toHaveLength(1);
  });

  it('a live gateway is unaffected by the switch', async () => {
    db.paymentRow(LIVE_PUBLIC, SECRETS);
    for (const value of ['true', undefined]) {
      switchTo(value);
      const session = db.session();
      const res = await call('payment-initiate', { checkoutSessionId: session.id });
      expect(res.body).toMatchObject({ provider: 'moyasar', mode: 'live' });
    }
    expect(logged('payment_test_mode_allowed')).toHaveLength(0);
  });
});

describe('confirming a TEST attempt', () => {
  /** Open a TEST attempt with the switch on, and pay its invoice with a test card. */
  async function paidTestSession() {
    switchTo('true');
    const session = db.session({ total: 64 });
    const init = await call('payment-initiate', { checkoutSessionId: session.id });
    expect(init.status).toBe(200);
    const payment = moyasar.pay(String(init.body.invoiceId), 'pay_test_1', 'paid');
    return { session, payment };
  }

  it("switch 'true': the webhook confirms it and the order is created paid", async () => {
    const { session, payment } = await paidTestSession();
    expect((await testWebhook(payment)).body.status).toBe('paid');
    const [order] = db.rows('orders');
    expect(order).toMatchObject({ payment_status: 'paid', payment_provider: 'moyasar', total: 64 });
    expect(db.attempts({ checkout_session_id: session.id })[0]).toMatchObject({
      status: 'paid',
      provider_ref: 'pay_test_1',
      mode: 'test',
    });
    expect(logged('payment_test_mode_allowed')).toContainEqual(expect.objectContaining({ fn: 'confirm' }));
  });

  it("switch 'true': payment-verify confirms it the same way", async () => {
    const { session } = await paidTestSession();
    const res = await call('payment-verify', { checkoutSessionId: session.id });
    expect(res.body).toMatchObject({ status: 'paid' });
    expect(db.rows('orders')).toHaveLength(1);
    expect(db.rows('orders')[0].payment_status).toBe('paid');
  });

  it.each(NOT_ON)('switch %j at confirmation: refused as test_mode_attempt, no order', async (value) => {
    const { session, payment } = await paidTestSession();
    switchTo(value);
    expect((await testWebhook(payment)).body).toMatchObject({ status: 'acknowledged', outcome: 'failed' });
    expect(db.rows('orders')).toHaveLength(0);
    expect(db.attempts({ checkout_session_id: session.id })[0]).toMatchObject({
      status: 'failed',
      failure_code: 'test_mode_attempt',
    });
    expect(logged('moyasar_confirm_refused')).toEqual([
      expect.objectContaining({ reason: 'test_mode_attempt' }),
    ]);
  });

  // F-EFP-05-001: the list is consulted again at confirmation, for the owner of
  // the attempt's session, so an attempt opened while a customer was listed is
  // not confirmable once they are not.
  it('a customer taken off the list before confirmation: refused, no order', async () => {
    const { session, payment } = await paidTestSession();
    switchTo('true', STRANGER);
    expect((await testWebhook(payment)).body).toMatchObject({ status: 'acknowledged', outcome: 'failed' });
    expect((await call('payment-verify', { checkoutSessionId: session.id })).body.status).toBe('failed');
    expect(db.rows('orders')).toHaveLength(0);
    expect(db.attempts({ checkout_session_id: session.id })[0]).toMatchObject({
      status: 'failed',
      failure_code: 'test_mode_attempt',
    });
  });

  it("a TEST attempt on another customer's session is not confirmable for them", async () => {
    // An allowed customer's attempt opened normally, then a TEST attempt that
    // belongs to a stranger's session (however it came to exist): only the
    // first may confirm.
    const { payment } = await paidTestSession();
    const theirs = db.session({ customer_id: STRANGER });
    setEnv(PAYMENT_TEST_CHECKOUT_CUSTOMER_IDS_ENV, `${OWNER},${STRANGER}`);
    const init = await call('payment-initiate', { checkoutSessionId: theirs.id });
    expect(init.status).toBe(200);
    const theirPayment = moyasar.pay(String(init.body.invoiceId), 'pay_test_theirs', 'paid');
    switchTo('true', OWNER);
    expect((await testWebhook(theirPayment)).body).toMatchObject({ status: 'acknowledged', outcome: 'failed' });
    expect(db.rows('checkout_sessions').find((r) => r.id === theirs.id)!.order_id).toBeNull();
    expect((await testWebhook(payment)).body.status).toBe('paid');
    expect(db.rows('orders').map((o) => o.customer_id)).toEqual([OWNER]);
  });

  it("an order-first TEST attempt is decided by the order's owner too", async () => {
    switchTo('true', OWNER);
    const order = db.order();
    const init = await call('payment-initiate', { orderId: order.id });
    expect(init.status).toBe(200);
    const payment = moyasar.pay(String(init.body.invoiceId), 'pay_test_order', 'paid');
    switchTo('true', STRANGER);
    expect((await testWebhook(payment)).body).toMatchObject({ status: 'acknowledged', outcome: 'failed' });
    expect(db.rows('orders')[0].payment_status).toBe('pending');
    switchTo('true', OWNER);
    const order2 = db.order();
    const init2 = await call('payment-initiate', { orderId: order2.id });
    const payment2 = moyasar.pay(String(init2.body.invoiceId), 'pay_test_order2', 'paid');
    expect((await testWebhook(payment2)).body.status).toBe('paid');
    expect(db.rows('orders').find((o) => o.id === order2.id)!.payment_status).toBe('paid');
  });

  it('switch unset at confirmation: payment-verify refuses it too', async () => {
    const { session } = await paidTestSession();
    switchTo(undefined);
    expect((await call('payment-verify', { checkoutSessionId: session.id })).body.status).toBe('failed');
    expect(db.rows('orders')).toHaveLength(0);
  });
});
