import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { call, currentDb, freshRuntime } from './__fixtures__/paymentRuntime.ts';
import { INVOICE_EXPIRY_MARGIN_MS } from './moyasar.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * The real payment-initiate handler, over the fakes in paymentFakes.ts.
 *
 *  - C1 part 4: no invoice may outlive its attempt.
 *  - C2: a total under Moyasar's 1.00 SAR invoice minimum is refused before any
 *    attempt is opened.
 */

let db: FakePaymentDb;
let moyasar: FakeMoyasar;

beforeEach(() => {
  ({ db, moyasar } = freshRuntime());
  db.paymentRow(LIVE_PUBLIC, SECRETS);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const initiate = (session: { id: unknown }) =>
  call('payment-initiate', { checkoutSessionId: session.id, language: 'en' });

describe('no invoice outlives its attempt (C1 part 4)', () => {
  it("a fresh attempt's invoice ends a margin before the attempt does", async () => {
    const session = db.session();
    const res = await initiate(session);
    expect(res.status).toBe(200);
    const [attempt] = db.attempts({ checkout_session_id: session.id });
    const invoiceEnds = Date.parse(String(moyasar.posts[0].expired_at));
    expect(invoiceEnds).toBe(Date.parse(String(attempt.expires_at)) - INVOICE_EXPIRY_MARGIN_MS);
  });

  // The reconcile path used to build its invoice from a fresh Date.now()
  // window: an attempt opened 25 minutes earlier, whose first create failed,
  // got an invoice payable 25 minutes past its own end.
  it('a reused attempt whose first create failed gets an invoice that ends with it, not 30 minutes from now', async () => {
    const session = db.session();
    // An attempt opened 25 minutes ago whose invoice create never answered, so
    // it holds no invoice id.
    const r = await db.rpc('begin_session_attempt', {
      p_session_id: session.id,
      p_provider: 'moyasar',
      p_mode: 'live',
      p_expiry_minutes: 30,
    });
    const attemptId = (r.data as { attempt_id: string }[])[0].attempt_id;
    const attempt = db.rows('payment_records').find((x) => x.id === attemptId)!;
    attempt.expires_at = new Date(Date.now() + 5 * 60_000).toISOString();

    const res = await initiate(session);
    expect(res.status).toBe(200);
    const invoiceEnds = Date.parse(String(moyasar.posts.at(-1)!.expired_at));
    expect(invoiceEnds).toBe(Date.parse(String(attempt.expires_at)) - INVOICE_EXPIRY_MARGIN_MS);
    expect(invoiceEnds).toBeLessThan(Date.now() + 6 * 60_000);
  });

  it('an attempt with too little time left gets no invoice: it is closed and the next start opens a fresh one', async () => {
    const session = db.session();
    const r = await db.rpc('begin_session_attempt', {
      p_session_id: session.id,
      p_provider: 'moyasar',
      p_mode: 'live',
      p_expiry_minutes: 30,
    });
    const attemptId = (r.data as { attempt_id: string }[])[0].attempt_id;
    const attempt = db.rows('payment_records').find((x) => x.id === attemptId)!;
    attempt.expires_at = new Date(Date.now() + 90_000).toISOString();

    const refused = await initiate(session);
    expect(refused).toEqual({
      status: 502,
      body: { error: 'Could not start the payment. Please try again.' },
    });
    expect(moyasar.posts).toHaveLength(0);
    expect(attempt).toMatchObject({
      status: 'failed',
      failure_code: 'attempt_expiring',
      provider_checkout_ref: null,
    });

    const retried = await initiate(session);
    expect(retried.status).toBe(200);
    const attempts = db.attempts({ checkout_session_id: session.id });
    expect(attempts).toHaveLength(2);
    expect(Date.parse(String(moyasar.posts[0].expired_at))).toBe(
      Date.parse(String(attempts[1].expires_at)) - INVOICE_EXPIRY_MARGIN_MS,
    );
  });

  it('an attempt whose expiry cannot be read gets no invoice', async () => {
    const session = db.session();
    const gate = db.hold('rpc.begin_session_attempt');
    const running = initiate(session);
    await gate.entered;
    // The next payment_records read is the expiry read in createMoyasarInvoice.
    db.failNext('payment_records.select', { message: 'read failed' });
    gate.release();
    expect((await running).status).toBe(502);
    expect(moyasar.posts).toHaveLength(0);
  });
});

describe('a total under 1.00 SAR is refused before any attempt (C2)', () => {
  it.each([0.5, 0.99, 0.01])(
    'a session of %s SAR: disabled/amount_below_minimum, nothing opened',
    async (total) => {
      const session = db.session({ total });
      const res = await initiate(session);
      expect(res).toEqual({ status: 200, body: { status: 'disabled', reason: 'amount_below_minimum' } });
      expect(db.rpcLog.filter((c) => c.name === 'begin_session_attempt')).toHaveLength(0);
      expect(db.attempts({ checkout_session_id: session.id })).toHaveLength(0);
      expect(moyasar.posts).toHaveLength(0);
    },
  );

  // Left 'pending_payment', the same cart's idempotency key hands this session
  // back, and its points stay reserved against every other session.
  it('retires the session, which nothing can ever pay', async () => {
    const session = db.session({ total: 0.5 });
    await initiate(session);
    expect(db.rows('checkout_sessions')[0]).toMatchObject({ status: 'expired', order_id: null });
  });

  it('accepts exactly 1.00 SAR, and sends Moyasar 100 halalas', async () => {
    const session = db.session({ total: 1 });
    const res = await initiate(session);
    expect(res.status).toBe(200);
    expect(res.body.checkoutUrl).toMatch(/^https:\/\/checkout\.moyasar\.com\//);
    expect(moyasar.posts[0].amount).toBe(100);
  });

  it('refuses before the gateway is consulted, so the answer is the same whatever its state', async () => {
    db.paymentRow({ ...LIVE_PUBLIC, mode: 'test' }, SECRETS);
    const session = db.session({ total: 0.5 });
    expect((await initiate(session)).body).toEqual({ status: 'disabled', reason: 'amount_below_minimum' });
  });

  it('the order-first flow refuses the same way, before begin_payment_attempt', async () => {
    const order = db.order({ total: 0.5 });
    const res = await call('payment-initiate', { orderId: order.id, language: 'en' });
    expect(res).toEqual({ status: 200, body: { status: 'disabled', reason: 'amount_below_minimum' } });
    expect(db.rpcLog.filter((c) => c.name === 'begin_payment_attempt')).toHaveLength(0);
    expect(db.attempts({ order_id: order.id })).toHaveLength(0);
    // An order is not retired: it has its own lifecycle.
    expect(db.rows('orders')[0]).toMatchObject({ payment_status: 'pending' });
  });
});
