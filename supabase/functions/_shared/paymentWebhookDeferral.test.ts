import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { call, currentDb, freshRuntime, webhook } from './__fixtures__/paymentRuntime.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * Audit F-X09-001: payment-webhook answered 200, which stops Moyasar retrying,
 * for states the owner can correct. Moyasar redelivers on a fixed ladder
 * (immediate, +1m, +10m, +30m, +1h, +2h) and then drops the event, so a 200 for
 * a switched-off provider, a missing webhook secret or a missing secret key
 * threw away the one nudge that would have confirmed a captured payment.
 *
 * Driven through the REAL payment-initiate and payment-webhook handlers over
 * the in-memory fakes. Two things are asserted together, because either alone
 * is a defect: the three correctable states answer 503 and leave one log row,
 * and everything redelivery cannot help (an ignored event type, an event for
 * the mode the gateway does not run, a foreign provider, an unknown payment, an
 * event nobody can prove is ours) stays 200 so Moyasar's ladder is not spent on
 * noise.
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

async function paidPayment(paymentId = 'pay_def_1') {
  const session = db.session({ total: 64 });
  const init = await call('payment-initiate', { checkoutSessionId: session.id, language: 'en' });
  expect(init.status).toBe(200);
  const payment = moyasar.pay(String(init.body.invoiceId), paymentId, 'paid');
  return { session, payment };
}

const deferralRows = () =>
  db.rows('integration_sync_logs').filter((r) => String(r.error ?? '').startsWith('webhook_deferred_'));
const orderCount = () => db.rows('orders').length;

/** A webhook envelope as Moyasar sends it, with the knobs these tests turn. */
function envelope(
  payment: Record<string, unknown>,
  opts: { type?: string; live?: boolean; token?: string } = {},
) {
  return call('payment-webhook', {
    id: `evt_${String(payment.id)}`,
    type: opts.type ?? 'payment_paid',
    live: opts.live ?? true,
    secret_token: opts.token ?? 'whsec_live_fixture',
    data: payment,
  });
}

describe('a switched-off provider asks for the event to come back', () => {
  it('answers 503, logs one row, and confirms the payment when the event is redelivered after re-enabling', async () => {
    const { payment } = await paidPayment();
    db.paymentRow(LIVE_PUBLIC, SECRETS, { enabled: false });

    const first = await webhook(payment);
    expect(first.status).toBe(503);
    expect(first.body).toEqual({ status: 'retry', reason: 'provider_disabled' });
    expect(orderCount()).toBe(0);
    const rows = deferralRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'moyasar',
      direction: 'webhook',
      status: 'failed',
      order_id: null,
      error: 'webhook_deferred_provider_disabled',
      request: { type: 'payment_paid', payment_id: 'pay_def_1', mode: 'live' },
    });

    // The owner switches the provider back on; Moyasar's next delivery lands.
    db.paymentRow(LIVE_PUBLIC, SECRETS, { enabled: true });
    const second = await webhook(payment);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('paid');
    expect(orderCount()).toBe(1);
  });

  it('writes no token, no body and no key into the row, and slices an oversized payment id', async () => {
    const { payment } = await paidPayment();
    db.paymentRow(LIVE_PUBLIC, SECRETS, { enabled: false });
    await envelope({ ...payment, id: 'p'.repeat(200) });
    const [row] = deferralRows();
    const text = JSON.stringify(row);
    expect(text).not.toContain('whsec_');
    expect(text).not.toContain('sk_live');
    expect(text).not.toContain('"source"');
    expect((row.request as { payment_id: string }).payment_id).toHaveLength(64);
  });

  it('is not a retry when the token matches nothing we hold: not provably ours', async () => {
    const { payment } = await paidPayment();
    db.paymentRow(LIVE_PUBLIC, SECRETS, { enabled: false });
    const res = await envelope(payment, { token: 'whsec_somebody_else' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
    expect(deferralRows()).toHaveLength(0);
  });

  it('is not a retry for an event type we ignore', async () => {
    const { payment } = await paidPayment();
    db.paymentRow(LIVE_PUBLIC, SECRETS, { enabled: false });
    const res = await envelope(payment, { type: 'payment_something_new' });
    expect(res.status).toBe(200);
    expect(deferralRows()).toHaveLength(0);
  });

  it('is not a retry for a TEST event reaching a LIVE gateway', async () => {
    const { payment } = await paidPayment();
    db.paymentRow(LIVE_PUBLIC, SECRETS, { enabled: false });
    const res = await envelope(payment, { live: false, token: 'whsec_test_fixture' });
    expect(res.status).toBe(200);
    expect(deferralRows()).toHaveLength(0);
  });
});

describe('a missing webhook secret asks for the event to come back, for the mode the gateway runs', () => {
  const withoutWebhookSecrets = {
    moyasar_live_secret_key: SECRETS.moyasar_live_secret_key,
    moyasar_test_secret_key: SECRETS.moyasar_test_secret_key,
  };

  it('a LIVE event on a LIVE gateway with no live secret: 503 and one row', async () => {
    const { payment } = await paidPayment();
    db.paymentRow(LIVE_PUBLIC, withoutWebhookSecrets);
    const res = await webhook(payment);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'retry', reason: 'webhook_secret_missing' });
    expect(orderCount()).toBe(0);
    expect(deferralRows()).toHaveLength(1);
    expect(deferralRows()[0].error).toBe('webhook_deferred_webhook_secret_missing');
  });

  it('a TEST event on a LIVE gateway with no test secret is ignored, never retried', async () => {
    const { payment } = await paidPayment();
    db.paymentRow(LIVE_PUBLIC, withoutWebhookSecrets);
    const res = await envelope(payment, { live: false, token: 'anything' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
    expect(deferralRows()).toHaveLength(0);
  });

  it('an ignored event type is not a retry even when the secret is missing', async () => {
    const { payment } = await paidPayment();
    db.paymentRow(LIVE_PUBLIC, withoutWebhookSecrets);
    const res = await envelope(payment, { type: 'webhook_verification_probe' });
    expect(res.status).toBe(200);
    expect(deferralRows()).toHaveLength(0);
  });

  it('redelivery after the secret is saved confirms the payment', async () => {
    const { payment } = await paidPayment();
    db.paymentRow(LIVE_PUBLIC, withoutWebhookSecrets);
    expect((await webhook(payment)).status).toBe(503);
    db.paymentRow(LIVE_PUBLIC, SECRETS);
    const again = await webhook(payment);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('paid');
  });
});

describe('a missing secret key for the attempt asks for the event to come back', () => {
  it('503 and one row while the key is absent; paid once it is configured', async () => {
    const { payment } = await paidPayment();
    const { moyasar_live_secret_key: _removed, ...noLiveKey } = SECRETS;
    db.paymentRow(LIVE_PUBLIC, noLiveKey);

    const first = await webhook(payment);
    expect(first.status).toBe(503);
    expect(first.body).toEqual({ status: 'retry', reason: 'secret_key_missing' });
    expect(orderCount()).toBe(0);
    expect(deferralRows()).toHaveLength(1);
    expect(deferralRows()[0].error).toBe('webhook_deferred_secret_key_missing');

    db.paymentRow(LIVE_PUBLIC, SECRETS);
    const second = await webhook(payment);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('paid');
    expect(orderCount()).toBe(1);
  });

  it('a payment with no id cannot be helped by redelivery: 200 and a skipped row', async () => {
    const { payment } = await paidPayment();
    const { id: _id, ...noId } = payment;
    const res = await webhook(noId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'acknowledged', reason: 'cannot verify' });
    expect(deferralRows()).toHaveLength(0);
    expect(db.rows('integration_sync_logs').some((r) => r.error === 'webhook without a payment id')).toBe(
      true,
    );
    expect(orderCount()).toBe(0);
  });
});

describe('what stays a 200, so Moyasar does not retry noise', () => {
  it('a payment that matches no attempt (another system on the same account, an admin sandbox invoice)', async () => {
    const res = await webhook({ id: 'pay_elsewhere', invoice_id: 'inv_elsewhere', status: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'acknowledged', reason: 'unknown payment' });
    expect(deferralRows()).toHaveLength(0);
  });

  it('a gateway whose provider is not Moyasar', async () => {
    const { payment } = await paidPayment();
    db.paymentRow(LIVE_PUBLIC, SECRETS, { provider: 'tap' });
    const res = await webhook(payment);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
    expect(deferralRows()).toHaveLength(0);
  });

  it('a gateway with no payment row at all', async () => {
    const { payment } = await paidPayment();
    db.tables.integration_settings = db.tables.integration_settings.filter(
      (r) => r.provider_type !== 'payment',
    );
    const res = await webhook(payment);
    expect(res.status).toBe(200);
    expect(deferralRows()).toHaveLength(0);
  });

  it('an ordinary paid event still confirms', async () => {
    const { payment } = await paidPayment();
    const res = await webhook(payment);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(deferralRows()).toHaveLength(0);
  });
});
