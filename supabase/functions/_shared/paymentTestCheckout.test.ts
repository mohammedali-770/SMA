import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { call, currentDb, freshRuntime, setEnv } from './__fixtures__/paymentRuntime.ts';
import { PAYMENT_ALLOW_TEST_CHECKOUT_ENV, allowTestModeCheckout } from './paymentTestCheckout.ts';

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
 * customer pays a real order with the TEST key, and it confirms as a live
 * payment does.
 */

const TEST_PUBLIC = { ...LIVE_PUBLIC, mode: 'test' };
const NOT_ON = [undefined, 'TRUE', '1', '', ' true', 'yes'] as const;
const TEST_MODE_REFUSAL = { status: 'disabled', reason: 'test_mode' };

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

const switchTo = (value: string | undefined) => setEnv(PAYMENT_ALLOW_TEST_CHECKOUT_ENV, value);

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
    expect(allowTestModeCheckout()).toBe(true);
    for (const v of NOT_ON) {
      switchTo(v);
      expect(allowTestModeCheckout(), JSON.stringify(v)).toBe(false);
    }
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
      expect(allowTestModeCheckout()).toBe(false);
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

  it('switch unset at confirmation: payment-verify refuses it too', async () => {
    const { session } = await paidTestSession();
    switchTo(undefined);
    expect((await call('payment-verify', { checkoutSessionId: session.id })).body.status).toBe('failed');
    expect(db.rows('orders')).toHaveLength(0);
  });
});
