import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { call, currentDb, freshRuntime } from './__fixtures__/paymentRuntime.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * F-X12-002 (2026-11-19 audit): `checkPaymentBinding` is tested hard in
 * isolation (moyasar.test.ts), but nothing sent a MISMATCHED payment through
 * `validateAndConfirmMoyasarPayment` and asserted it is refused. The only guard
 * on the handler's USE of the binding result was a text anchor in
 * paymentWiring.test.ts, so a change that forced `allMatch` true left every
 * behavioural payment test green.
 *
 * Driven through the real payment-webhook handler, which re-reads the payment
 * from Moyasar by id (the fake's `payments` map is what Moyasar "says") and
 * hands it to validateAndConfirmMoyasarPayment. Both confirmation shapes are
 * covered: the session-first flow (finalize_checkout_session creates the
 * order) and the order-first flow (confirm_order_payment).
 *
 * The property in every case: a payment that is PAID at Moyasar but does not
 * match the stored attempt is answered `mismatch`, no confirmation RPC is
 * called, no order is created or marked paid, and the attempt is closed with
 * `verification_mismatch` and a log row naming which fields differed. The
 * positive control at the end proves the same setup DOES confirm when nothing
 * is wrong, so the refusals are not an artefact of the fixture.
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

type Flow = 'session' | 'order';

/** An open attempt for 64.00 SAR on a fresh invoice, in either flow. */
async function openAttempt(flow: Flow) {
  if (flow === 'session') {
    const session = db.session({ total: 64 });
    const init = await call('payment-initiate', { checkoutSessionId: session.id, language: 'en' });
    expect(init.status).toBe(200);
    return { invoiceId: String(init.body.invoiceId), session, order: null };
  }
  const order = db.order({ total: 64 });
  const init = await call('payment-initiate', { orderId: order.id, language: 'en' });
  expect(init.status).toBe(200);
  return { invoiceId: String(init.body.invoiceId), session: null, order };
}

/** The webhook Moyasar would send for a payment, with the envelope fields overridable. */
function deliver(data: Record<string, unknown>, envelope: { live?: boolean; secret?: string } = {}) {
  return call('payment-webhook', {
    id: `evt_${String(data.id)}`,
    type: 'payment_paid',
    live: envelope.live ?? true,
    secret_token: envelope.secret ?? 'whsec_live_fixture',
    data,
  });
}

const confirmCalls = () =>
  db.rpcLog.filter((c) => c.name === 'confirm_order_payment' || c.name === 'finalize_checkout_session');

/** What must be true after ANY refused payment, in either flow. */
function expectNothingConfirmed(flow: Flow, ctx: Awaited<ReturnType<typeof openAttempt>>) {
  expect(confirmCalls()).toEqual([]);
  expect(db.rows('payment_records').filter((r) => r.status === 'paid')).toEqual([]);
  if (flow === 'session') {
    expect(db.rows('orders')).toHaveLength(0);
    expect(db.rows('checkout_sessions')[0]).toMatchObject({ status: 'pending_payment', order_id: null });
  } else {
    expect(db.rows('orders')[0]).toMatchObject({
      id: ctx.order!.id,
      payment_status: 'pending',
      paid_at: null,
    });
  }
  const [attempt] = db.attempts({ provider_checkout_ref: ctx.invoiceId });
  expect(attempt).toMatchObject({ status: 'failed', failure_code: 'verification_mismatch' });
}

/** The log row verification_mismatch writes, with the per-field verdicts. */
function mismatchLog() {
  const rows = db.rows('integration_sync_logs').filter((r) => r.error === 'verification_mismatch');
  expect(rows).toHaveLength(1);
  return (rows[0].request as { mismatch: Record<string, boolean> }).mismatch;
}

describe.each<Flow>(['session', 'order'])(
  'a paid Moyasar payment that does not match its attempt (%s flow)',
  (flow) => {
    it('right amount, but the payment sits on a different invoice', async () => {
      const ctx = await openAttempt(flow);
      const paid = moyasar.pay(ctx.invoiceId, 'pay_1', 'paid');
      // The envelope still names OUR invoice, which is how the handler finds the
      // attempt; what Moyasar says about the payment is that it belongs to another.
      const claimed = { ...paid };
      paid.invoice_id = 'inv_somebody_else';

      const res = await deliver(claimed);
      expect(res).toEqual({ status: 200, body: { status: 'acknowledged', outcome: 'mismatch' } });
      expectNothingConfirmed(flow, ctx);
      expect(mismatchLog()).toEqual({
        hasId: true,
        invoiceMatch: false,
        amountMatch: true,
        currencyMatch: true,
        modeMatch: true,
      });
    });

    it.each([
      ['less than the total', 6300],
      ['more than the total', 6500],
    ])('right invoice, but the amount is %s', async (_label, minor) => {
      const ctx = await openAttempt(flow);
      const paid = moyasar.pay(ctx.invoiceId, 'pay_1', 'paid');
      const claimed = { ...paid };
      paid.amount = minor;

      const res = await deliver(claimed);
      expect(res).toEqual({ status: 200, body: { status: 'acknowledged', outcome: 'mismatch' } });
      expectNothingConfirmed(flow, ctx);
      expect(mismatchLog()).toEqual({
        hasId: true,
        invoiceMatch: true,
        amountMatch: false,
        currencyMatch: true,
        modeMatch: true,
      });
    });

    it('right invoice and amount, but in another currency', async () => {
      const ctx = await openAttempt(flow);
      const paid = moyasar.pay(ctx.invoiceId, 'pay_1', 'paid');
      const claimed = { ...paid };
      paid.currency = 'USD';

      const res = await deliver(claimed);
      expect(res).toEqual({ status: 200, body: { status: 'acknowledged', outcome: 'mismatch' } });
      expectNothingConfirmed(flow, ctx);
      expect(mismatchLog()).toEqual({
        hasId: true,
        invoiceMatch: true,
        amountMatch: true,
        currencyMatch: false,
        modeMatch: true,
      });
    });

    it('everything matches, but the event says TEST for a LIVE attempt', async () => {
      const ctx = await openAttempt(flow);
      const paid = moyasar.pay(ctx.invoiceId, 'pay_1', 'paid');

      const res = await deliver({ ...paid }, { live: false, secret: 'whsec_test_fixture' });
      expect(res).toEqual({ status: 200, body: { status: 'acknowledged', outcome: 'mismatch' } });
      expectNothingConfirmed(flow, ctx);
      expect(mismatchLog()).toEqual({
        hasId: true,
        invoiceMatch: true,
        amountMatch: true,
        currencyMatch: true,
        modeMatch: false,
      });
    });

    it('control: the same payment with nothing wrong IS confirmed', async () => {
      const ctx = await openAttempt(flow);
      const paid = moyasar.pay(ctx.invoiceId, 'pay_1', 'paid');

      const res = await deliver({ ...paid });
      expect(res).toEqual({ status: 200, body: { status: 'paid', outcome: 'paid' } });
      expect(confirmCalls().map((c) => c.name)).toEqual([
        flow === 'session' ? 'finalize_checkout_session' : 'confirm_order_payment',
      ]);
      expect(db.attempts({ provider_checkout_ref: ctx.invoiceId })[0]).toMatchObject({
        status: 'paid',
        provider_ref: 'pay_1',
      });
      expect(db.rows('integration_sync_logs').filter((r) => r.error === 'verification_mismatch')).toEqual([]);
    });
  },
);
