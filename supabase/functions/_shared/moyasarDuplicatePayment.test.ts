import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { call, currentDb, freshRuntime, webhook } from './__fixtures__/paymentRuntime.ts';
import { DUPLICATE_PAYMENT, DUPLICATE_PAYMENT_MESSAGE } from './moyasar.ts';
import { validateAndConfirmMoyasarPayment, type MoyasarAttempt } from './moyasarVerify.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * C1 of the 2026-11-12 review: a SECOND paid payment on one checkout session
 * was reported paid and recorded nowhere, and the first was attached to the
 * wrong attempt. Driven through the real payment-initiate, payment-verify and
 * payment-webhook handlers and moyasarVerify.ts, over in-memory fakes of the
 * payment tables, the confirmation RPCs and Moyasar (paymentFakes.ts).
 *
 * The CRITICAL property runs through every case: a GENUINE payment, its
 * replayed webhook, and a webhook racing payment-verify for it, must all still
 * come back paid. A false duplicate is money taken and an order refused.
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

async function openSession(total = 64) {
  const session = db.session({ total });
  const init = await call('payment-initiate', { checkoutSessionId: session.id, language: 'en' });
  expect(init.status).toBe(200);
  return { session, invoiceId: String(init.body.invoiceId) };
}

const attemptsOf = (sessionId: unknown) => db.attempts({ checkout_session_id: sessionId });
const paidRowsOf = (orderId: unknown) => db.attempts({ order_id: orderId, status: 'paid' });
const duplicateLogs = () => db.rows('integration_sync_logs').filter((r) => r.error === DUPLICATE_PAYMENT);

describe('a declined payment no longer closes its attempt (C1 part 1)', () => {
  it.each(['failed', 'voided'])(
    'a %s payment records when it was checked and nothing else',
    async (status) => {
      const { session, invoiceId } = await openSession();
      const p0 = moyasar.pay(invoiceId, 'pay_0', status);
      const res = await webhook(p0, status === 'failed' ? 'payment_failed' : 'payment_voided');
      expect(res.status).toBe(200);

      const [a1] = attemptsOf(session.id);
      expect(a1).toMatchObject({
        status: 'initiated',
        failure_code: null,
        failure_message_safe: null,
        provider_ref: null,
      });
      expect(a1.last_verified_at).not.toBeNull();
      expect((a1.raw as { id?: string }).id).toBe('pay_0');
    },
  );

  it('still answers a lone declined payment "failed", and the app restarts on the SAME invoice', async () => {
    const { session, invoiceId } = await openSession();
    moyasar.pay(invoiceId, 'pay_0', 'failed');
    const verify = await call('payment-verify', { checkoutSessionId: session.id });
    expect(verify.body).toMatchObject({ status: 'failed', messageKey: 'payDeclined' });

    const again = await call('payment-initiate', { checkoutSessionId: session.id, language: 'en' });
    expect(again.body.invoiceId).toBe(invoiceId);
    expect(moyasar.posts).toHaveLength(1);
    expect(attemptsOf(session.id)).toHaveLength(1);
  });

  // The review's scenario, end to end: decline, a second try still in flight
  // when the page is closed, a resume, then the second try settles.
  it('a resume after a decline reuses the invoice, so the settling payment pays the session once', async () => {
    const { session, invoiceId } = await openSession();
    await webhook(moyasar.pay(invoiceId, 'pay_0', 'failed'), 'payment_failed');
    moyasar.pay(invoiceId, 'pay_1', 'initiated');
    expect((await call('payment-verify', { checkoutSessionId: session.id })).body.status).toBe('pending');

    const resumed = await call('payment-initiate', { checkoutSessionId: session.id, language: 'en' });
    expect(resumed.body.invoiceId).toBe(invoiceId);
    expect(moyasar.posts).toHaveLength(1);

    moyasar.settle('pay_1');
    expect((await webhook(moyasar.payments.get('pay_1')!)).body.status).toBe('paid');
    const [a1] = attemptsOf(session.id);
    expect(a1).toMatchObject({ status: 'paid', provider_ref: 'pay_1' });
    expect(db.rows('checkout_sessions')[0]).toMatchObject({ status: 'consumed', order_id: a1.order_id });
  });
});

/** A session whose first attempt expired after its payment, and a second attempt opened beside it. */
async function sessionWithTwoAttempts() {
  const { session, invoiceId: inv1 } = await openSession();
  moyasar.pay(inv1, 'pay_1', 'initiated'); // made in time, settles late
  const [a1] = attemptsOf(session.id);
  a1.expires_at = new Date(Date.now() - 1000).toISOString();
  const reopened = await call('payment-initiate', { checkoutSessionId: session.id, language: 'en' });
  const inv2 = String(reopened.body.invoiceId);
  expect(inv2).not.toBe(inv1);
  return { session, inv1, inv2 };
}

describe('the payment lands on the attempt that owns its invoice (C1 part 2)', () => {
  it('stamps the payment id before finalize, so finalize does not pick the newest attempt', async () => {
    const { session, inv1, inv2 } = await sessionWithTwoAttempts();
    moyasar.settle('pay_1');
    expect((await webhook(moyasar.payments.get('pay_1')!)).body.status).toBe('paid');

    const a1 = db.attempts({ checkout_session_id: session.id, provider_checkout_ref: inv1 })[0];
    const a2 = db.attempts({ checkout_session_id: session.id, provider_checkout_ref: inv2 })[0];
    expect(a1).toMatchObject({ status: 'paid', provider_ref: 'pay_1' });
    expect(a1.order_id).toBe(db.rows('checkout_sessions')[0].order_id);
    expect(a2).toMatchObject({ status: 'initiated', provider_ref: null, order_id: null });
  });
});

describe('a second payment is a DUPLICATE: recorded for a refund, never paid (C1 part 3)', () => {
  it('D1: a second invoice paid after the session was consumed', async () => {
    const { session, inv2 } = await sessionWithTwoAttempts();
    moyasar.settle('pay_1');
    await webhook(moyasar.payments.get('pay_1')!);
    const orderId = db.rows('checkout_sessions')[0].order_id;

    const res = await webhook(moyasar.pay(inv2, 'pay_2', 'paid'));
    expect(res).toEqual({ status: 200, body: { status: 'acknowledged', outcome: 'failed' } });

    const a2 = db.attempts({ checkout_session_id: session.id, provider_checkout_ref: inv2 })[0];
    expect(a2).toMatchObject({
      status: 'failed',
      failure_code: DUPLICATE_PAYMENT,
      failure_message_safe: DUPLICATE_PAYMENT_MESSAGE,
      provider_ref: 'pay_2',
      order_id: orderId,
      amount: 64,
      currency: 'SAR',
      mode: 'live',
    });
    expect(paidRowsOf(orderId)).toHaveLength(1);
    expect(duplicateLogs()).toEqual([
      expect.objectContaining({
        provider: 'moyasar',
        direction: 'webhook',
        status: 'failed',
        order_id: orderId,
        request: { payment_id: 'pay_2', session: session.id, order: orderId },
      }),
    ]);

    // The session itself IS paid, and payment-verify says so.
    expect((await call('payment-verify', { checkoutSessionId: session.id })).body).toEqual({
      status: 'paid',
      orderId,
    });
    // A replay records nothing twice.
    await webhook(moyasar.payments.get('pay_2')!);
    expect(duplicateLogs()).toHaveLength(1);
    expect(db.rows('orders')).toHaveLength(1);
  });

  it('D2: the attempt already carries another payment, so finalize is never called with this one', async () => {
    const { session, invoiceId } = await openSession();
    moyasar.pay(invoiceId, 'pay_2', 'paid');
    moyasar.pay(invoiceId, 'pay_1', 'paid');
    // pay_1 was stamped by a run that did not get to finalize.
    attemptsOf(session.id)[0].provider_ref = 'pay_1';

    const res = await webhook(moyasar.payments.get('pay_2')!);
    expect(res.body).toEqual({ status: 'acknowledged', outcome: 'failed' });
    expect(db.rpcLog.filter((c) => c.name === 'finalize_checkout_session')).toHaveLength(0);
    const recorded = db.attempts({ provider_ref: 'pay_2' });
    expect(recorded).toEqual([
      expect.objectContaining({
        status: 'failed',
        failure_code: DUPLICATE_PAYMENT,
        checkout_session_id: session.id,
        provider_checkout_ref: null,
        amount: 64,
        mode: 'live',
      }),
    ]);
    expect(duplicateLogs()).toHaveLength(1);

    // payment-verify still finds THE attempt, not the duplicate row, and
    // confirms the payment that owns it, though the duplicate settled first.
    const verify = await call('payment-verify', { checkoutSessionId: session.id });
    expect(verify.body.status).toBe('paid');
    expect(attemptsOf(session.id).find((r) => r.provider_ref === 'pay_1')).toMatchObject({ status: 'paid' });

    // A replay hits the unique index: already recorded, not recorded twice.
    await webhook(moyasar.payments.get('pay_2')!);
    expect(db.attempts({ provider_ref: 'pay_2' })).toHaveLength(1);
    expect(duplicateLogs()).toHaveLength(1);
  });

  it('a duplicate whose row cannot be written is still recorded, in the sync log', async () => {
    const { session, invoiceId } = await openSession();
    moyasar.pay(invoiceId, 'pay_2', 'paid');
    moyasar.pay(invoiceId, 'pay_1', 'paid');
    attemptsOf(session.id)[0].provider_ref = 'pay_1';
    db.failNext('payment_records.insert', { message: 'disk full', code: '53100' });
    expect((await webhook(moyasar.payments.get('pay_2')!)).body).toEqual({
      status: 'acknowledged',
      outcome: 'failed',
    });
    expect(db.attempts({ provider_ref: 'pay_2' })).toHaveLength(0);
    expect(duplicateLogs()).toEqual([
      expect.objectContaining({ request: { payment_id: 'pay_2', session: session.id } }),
    ]);
  });

  it('D3: an order already paid by another payment is not paid again', async () => {
    const order = db.order({ total: 64 });
    const init = await call('payment-initiate', { orderId: order.id, language: 'en' });
    const inv1 = String(init.body.invoiceId);
    await webhook(moyasar.pay(inv1, 'pay_1', 'paid'));
    const paidAt = db.rows('orders')[0].paid_at;
    expect(paidAt).not.toBeNull();

    // A second attempt and invoice for the same order, opened before the first
    // payment was confirmed.
    db.insertRow('payment_records', {
      order_id: order.id,
      provider: 'moyasar',
      status: 'initiated',
      amount: 64,
      mode: 'live',
      provider_checkout_ref: 'inv_x',
      reference_transaction: 'sm_x',
    });
    moyasar.invoices.set('inv_x', {
      id: 'inv_x',
      status: 'initiated',
      amount: 6400,
      currency: 'SAR',
      url: 'https://checkout.moyasar.com/invoices/inv_x',
      metadata: {},
      payments: [],
    });
    const res = await webhook(moyasar.pay('inv_x', 'pay_2', 'paid'));
    expect(res.body).toEqual({ status: 'acknowledged', outcome: 'failed' });

    expect(
      db.rpcLog.filter((c) => c.name === 'confirm_order_payment' && c.args.p_provider_ref === 'pay_2'),
    ).toHaveLength(0);
    expect(db.rows('orders')[0].paid_at).toBe(paidAt);
    expect(paidRowsOf(order.id)).toEqual([expect.objectContaining({ provider_ref: 'pay_1' })]);
    expect(db.attempts({ provider_ref: 'pay_2' })).toEqual([
      expect.objectContaining({ status: 'failed', failure_code: DUPLICATE_PAYMENT, order_id: order.id }),
    ]);
    expect(db.attempts({ provider_checkout_ref: 'inv_x' })[0]).toMatchObject({
      status: 'initiated',
      provider_ref: null,
    });
    expect(duplicateLogs()).toEqual([
      expect.objectContaining({ order_id: order.id, request: { payment_id: 'pay_2', order: order.id } }),
    ]);
    expect((await call('payment-verify', { orderId: order.id })).body).toEqual({
      status: 'paid',
      orderId: order.id,
    });

    // The genuine one, replayed, is still paid.
    expect((await webhook(moyasar.payments.get('pay_1')!)).body.status).toBe('paid');
    expect(duplicateLogs()).toHaveLength(1);
  });
});

/**
 * An order-first order with two invoices: the first attempt expired (it keeps
 * its invoice, which can still settle late), the second is open.
 */
async function orderWithTwoInvoices() {
  const order = db.order({ total: 64 });
  const init = await call('payment-initiate', { orderId: order.id, language: 'en' });
  const inv1 = String(init.body.invoiceId);
  const [a1] = db.attempts({ provider_checkout_ref: inv1 });
  db.updateRow('payment_records', a1, { status: 'failed', failure_code: 'expired' });
  db.insertRow('payment_records', {
    order_id: order.id,
    provider: 'moyasar',
    status: 'initiated',
    amount: 64,
    mode: 'live',
    provider_checkout_ref: 'inv_2',
    reference_transaction: 'sm_2',
  });
  moyasar.invoices.set('inv_2', {
    id: 'inv_2',
    status: 'initiated',
    amount: 6400,
    currency: 'SAR',
    url: 'https://checkout.moyasar.com/invoices/inv_2',
    metadata: {},
    payments: [],
  });
  return { order, inv1 };
}

describe('two order payments confirmed AT ONCE: decided under the order lock (C1 part 3, D3)', () => {
  // The verifier's order_race_repro: pay_1's webhook passes its "already paid?"
  // read and is held at its stamp; pay_2's webhook runs to the end; pay_1 then
  // continues. The read alone cannot see pay_2, so confirm_order_payment must.
  it('the second to confirm is a duplicate, the order is paid once and paid_at stands', async () => {
    const { order, inv1 } = await orderWithTwoInvoices();
    const p1 = moyasar.pay(inv1, 'pay_1', 'paid');
    const p2 = moyasar.pay('inv_2', 'pay_2', 'paid');

    const gate = db.hold('payment_records.update'); // pay_1's stamp, after its D3 read
    const first = webhook(p1);
    await gate.entered;
    expect((await webhook(p2)).body).toEqual({ status: 'paid', outcome: 'paid' });
    const paidAt = db.rows('orders')[0].paid_at;
    gate.release();

    expect((await first).body).toEqual({ status: 'acknowledged', outcome: 'failed' });
    expect(db.rows('orders')[0].paid_at).toBe(paidAt);
    expect(paidRowsOf(order.id)).toEqual([expect.objectContaining({ provider_ref: 'pay_2' })]);
    // pay_1 was stamped on its own attempt before confirm refused it, so that
    // row is the record: the invoice it paid, its id, the order, refundable.
    expect(db.attempts({ provider_ref: 'pay_1' })).toEqual([
      expect.objectContaining({
        status: 'failed',
        failure_code: DUPLICATE_PAYMENT,
        failure_message_safe: DUPLICATE_PAYMENT_MESSAGE,
        provider_checkout_ref: inv1,
        order_id: order.id,
      }),
    ]);
    expect(duplicateLogs()).toEqual([
      expect.objectContaining({ order_id: order.id, request: { payment_id: 'pay_1', order: order.id } }),
    ]);
    expect(db.rows('integration_sync_logs').filter((r) => r.error === 'confirm_failed')).toHaveLength(0);

    // Both replayed: the winner still paid, the loser still not, one log each.
    expect((await webhook(moyasar.payments.get('pay_2')!)).body.status).toBe('paid');
    expect((await webhook(moyasar.payments.get('pay_1')!)).body.status).not.toBe('paid');
    expect(paidRowsOf(order.id)).toHaveLength(1);
    expect(duplicateLogs()).toHaveLength(1);
    expect((await call('payment-verify', { orderId: order.id })).body).toEqual({
      status: 'paid',
      orderId: order.id,
    });
  });

  it('the result itself, from the lock path: paid false, reason duplicate_payment, the order named', async () => {
    const { order, inv1 } = await orderWithTwoInvoices();
    const p1 = moyasar.pay(inv1, 'pay_1', 'paid');
    const p2 = moyasar.pay('inv_2', 'pay_2', 'paid');
    const [a1] = db.attempts({ provider_checkout_ref: inv1 });
    const gate = db.hold('payment_records.update'); // after the D3 read, at the stamp
    const run = validateAndConfirmMoyasarPayment(db.client() as never, a1 as unknown as MoyasarAttempt, p1, {
      liveMode: true,
    });
    await gate.entered;
    await webhook(p2);
    gate.release();
    expect(await run).toEqual({
      outcome: 'failed',
      paid: false,
      reason: DUPLICATE_PAYMENT,
      orderId: order.id,
    });
    // Refused inside confirm_order_payment, which is what reached the lock.
    expect(
      db.rpcLog.filter((c) => c.name === 'confirm_order_payment' && c.args.p_provider_ref === 'pay_1'),
    ).toHaveLength(1);
  });

  it('CRITICAL: the SAME payment confirmed twice at once is paid both times, never a duplicate', async () => {
    const { order, inv1 } = await orderWithTwoInvoices();
    const p1 = moyasar.pay(inv1, 'pay_1', 'paid');
    const gate = db.hold('payment_records.update'); // the first webhook, at its stamp
    const first = webhook(p1);
    await gate.entered;
    const second = await webhook(p1); // the second runs to the end: stamps, confirms
    gate.release();
    expect(second.body).toEqual({ status: 'paid', outcome: 'paid' });
    expect((await first).body).toEqual({ status: 'paid', outcome: 'paid' });
    expect((await call('payment-verify', { orderId: order.id })).body.status).toBe('paid');
    expect(paidRowsOf(order.id)).toEqual([expect.objectContaining({ provider_ref: 'pay_1' })]);
    expect(duplicateLogs()).toHaveLength(0);
    expect(db.rows('payment_records').filter((r) => r.failure_code === DUPLICATE_PAYMENT)).toHaveLength(0);
  });
});

describe('payment-verify answers the checkout, not the duplicate it happened to find', () => {
  // verify read the session while it was still unpaid; another payment
  // consumed it before verify's own finalize ran.
  it('session flow: a race that makes the payment verify found a duplicate still answers paid', async () => {
    const { session, inv2 } = await sessionWithTwoAttempts();
    moyasar.pay(inv2, 'pay_2', 'paid');
    moyasar.settle('pay_1');
    const gate = db.hold('rpc.finalize_checkout_session');
    const verifying = call('payment-verify', { checkoutSessionId: session.id }); // finds A2 / pay_2
    await gate.entered;
    expect((await webhook(moyasar.payments.get('pay_1')!)).body.status).toBe('paid');
    gate.release();
    const orderId = db.rows('checkout_sessions')[0].order_id;
    expect((await verifying).body).toEqual({ status: 'paid', orderId });
    expect(db.attempts({ provider_ref: 'pay_2' })[0]).toMatchObject({ failure_code: DUPLICATE_PAYMENT });
  });

  it('order flow: the same race answers paid', async () => {
    const order = db.order({ total: 64 });
    const init = await call('payment-initiate', { orderId: order.id, language: 'en' });
    moyasar.pay(String(init.body.invoiceId), 'pay_1', 'paid');
    // A newer attempt with its own invoice, paid too. 'failed' only because an
    // order holds one 'initiated' attempt at a time; it still has its invoice,
    // so it is the attempt payment-verify reads.
    db.insertRow('payment_records', {
      order_id: order.id,
      provider: 'moyasar',
      status: 'failed',
      amount: 64,
      mode: 'live',
      provider_checkout_ref: 'inv_y',
      reference_transaction: 'sm_y',
    });
    moyasar.invoices.set('inv_y', {
      id: 'inv_y',
      status: 'initiated',
      amount: 6400,
      currency: 'SAR',
      url: 'https://checkout.moyasar.com/invoices/inv_y',
      metadata: {},
      payments: [],
    });
    moyasar.pay('inv_y', 'pay_2', 'paid');
    // Held at its already-paid check: its second payment_records read.
    const gate = db.hold('payment_records.select', 1);
    const verifying = call('payment-verify', { orderId: order.id });
    await gate.entered;
    expect((await webhook(moyasar.payments.get('pay_1')!)).body.status).toBe('paid');
    gate.release();
    expect((await verifying).body).toEqual({ status: 'paid', orderId: order.id });
    expect(paidRowsOf(order.id)).toEqual([expect.objectContaining({ provider_ref: 'pay_1' })]);
    expect(db.attempts({ provider_ref: 'pay_2' })[0]).toMatchObject({ failure_code: DUPLICATE_PAYMENT });
  });
});

describe('CRITICAL: a genuine payment is never taken for a duplicate', () => {
  it('the first payment is paid', async () => {
    const { session, invoiceId } = await openSession();
    expect((await webhook(moyasar.pay(invoiceId, 'pay_1', 'paid'))).body).toEqual({
      status: 'paid',
      outcome: 'paid',
    });
    const orderId = db.rows('checkout_sessions')[0].order_id;
    expect(orderId).toBeTruthy();
    expect(paidRowsOf(orderId)).toEqual([
      expect.objectContaining({ provider_ref: 'pay_1', checkout_session_id: session.id }),
    ]);
    expect(duplicateLogs()).toHaveLength(0);
  });

  it('its replayed webhook is paid, every time, with nothing recorded as a duplicate', async () => {
    const { invoiceId } = await openSession();
    const p1 = moyasar.pay(invoiceId, 'pay_1', 'paid');
    for (let i = 0; i < 3; i++) expect((await webhook(p1)).body).toEqual({ status: 'paid', outcome: 'paid' });
    expect(db.rows('orders')).toHaveLength(1);
    expect(db.attempts({ failure_code: DUPLICATE_PAYMENT })).toHaveLength(0);
    expect(duplicateLogs()).toHaveLength(0);
  });

  it('a webhook racing payment-verify for it: both paid, started together', async () => {
    const { session, invoiceId } = await openSession();
    const p1 = moyasar.pay(invoiceId, 'pay_1', 'paid');
    const [hook, verify] = await Promise.all([
      webhook(p1),
      call('payment-verify', { checkoutSessionId: session.id }),
    ]);
    expect(hook.body.status).toBe('paid');
    expect(verify.body.status).toBe('paid');
    expect(db.rows('orders')).toHaveLength(1);
    expect(duplicateLogs()).toHaveLength(0);
  });

  // Each step two concurrent runs could interleave at, held while the other
  // run goes all the way through, whichever of the two goes first.
  it.each([
    ['the stamp', 'payment_records.update', 0],
    ['the stamp read-back', 'payment_records.select', 1],
    ['finalize_checkout_session', 'rpc.finalize_checkout_session', 0],
    ['the read-back after finalize', 'payment_records.select', 2],
  ] as const)('a webhook racing payment-verify, one held at %s: both paid', async (_step, key, skip) => {
    for (const first of ['webhook', 'verify'] as const) {
      ({ db, moyasar } = freshRuntime());
      db.paymentRow(LIVE_PUBLIC, SECRETS);
      const { session, invoiceId } = await openSession();
      const p1 = moyasar.pay(invoiceId, 'pay_1', 'paid');
      const run = (who: 'webhook' | 'verify') =>
        who === 'webhook' ? webhook(p1) : call('payment-verify', { checkoutSessionId: session.id });

      const gate = db.hold(key, skip);
      const held = run(first);
      await gate.entered;
      const other = await run(first === 'webhook' ? 'verify' : 'webhook');
      gate.release();
      const late = await held;
      expect([first, late.body.status, other.body.status]).toEqual([first, 'paid', 'paid']);
      expect(db.rows('orders')).toHaveLength(1);
      expect(db.attempts({ failure_code: DUPLICATE_PAYMENT })).toHaveLength(0);
      expect(duplicateLogs()).toHaveLength(0);
    }
  });

  it('the order-first flow: first payment, replay and race all paid', async () => {
    const order = db.order({ total: 64 });
    const init = await call('payment-initiate', { orderId: order.id, language: 'en' });
    const p1 = moyasar.pay(String(init.body.invoiceId), 'pay_1', 'paid');
    const [a, b] = await Promise.all([webhook(p1), call('payment-verify', { orderId: order.id })]);
    expect(a.body.status).toBe('paid');
    expect(b.body.status).toBe('paid');
    expect((await webhook(p1)).body.status).toBe('paid');
    expect(paidRowsOf(order.id)).toHaveLength(1);
    expect(duplicateLogs()).toHaveLength(0);
  });
});

describe('an unknown outcome is never reported paid or failed', () => {
  it('a stamp that cannot be read back answers pending, and the webhook asks Moyasar to retry', async () => {
    const { invoiceId } = await openSession();
    const p1 = moyasar.pay(invoiceId, 'pay_1', 'paid');
    const gate = db.hold('payment_records.update'); // the stamp
    const hook = webhook(p1);
    await gate.entered;
    db.failNext('payment_records.select', { message: 'read-back failed' });
    gate.release();
    expect(await hook).toEqual({ status: 503, body: { status: 'retry', reason: 'stamp_failed' } });
    expect(db.rpcLog.filter((c) => c.name === 'finalize_checkout_session')).toHaveLength(0);
    // Moyasar's retry confirms it.
    expect((await webhook(p1)).body.status).toBe('paid');
    expect(db.rows('checkout_sessions')[0]).toMatchObject({ status: 'consumed' });
  });

  it('order flow: a stamp that cannot be read back answers pending to payment-verify, not failed', async () => {
    const order = db.order({ total: 64 });
    const init = await call('payment-initiate', { orderId: order.id, language: 'en' });
    const p1 = moyasar.pay(String(init.body.invoiceId), 'pay_1', 'paid');
    const gate = db.hold('payment_records.update'); // the stamp
    const verifying = call('payment-verify', { orderId: order.id });
    await gate.entered;
    db.failNext('payment_records.select', { message: 'read-back failed' });
    gate.release();
    // Terminal 'failed' here made the app give up on a payment a retry confirms.
    expect((await verifying).body).toEqual({
      status: 'pending',
      messageKey: 'payUnknown',
      orderId: order.id,
    });
    expect(db.rpcLog.filter((c) => c.name === 'confirm_order_payment')).toHaveLength(0);
    expect((await webhook(p1)).body.status).toBe('paid');
    expect(paidRowsOf(order.id)).toEqual([expect.objectContaining({ provider_ref: 'pay_1' })]);
  });

  it('a read-back that fails after finalize answers pending; the order stands and verify reports it', async () => {
    const { session, invoiceId } = await openSession();
    const p1 = moyasar.pay(invoiceId, 'pay_1', 'paid');
    const attempt = attemptsOf(session.id)[0] as unknown as MoyasarAttempt;
    const gate = db.hold('rpc.finalize_checkout_session');
    const running = validateAndConfirmMoyasarPayment(db.client() as never, attempt, p1);
    await gate.entered;
    db.failNext('payment_records.select', { message: 'read-back failed' });
    gate.release();
    expect(await running).toEqual({ outcome: 'pending', paid: false, reason: 'readback_failed' });
    expect(duplicateLogs()).toHaveLength(0);
    const verify = await call('payment-verify', { checkoutSessionId: session.id });
    expect(verify.body).toEqual({ status: 'paid', orderId: db.rows('checkout_sessions')[0].order_id });
  });
});
