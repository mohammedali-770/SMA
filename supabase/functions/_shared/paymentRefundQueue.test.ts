import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { currentDb, freshRuntime, refundRun } from './__fixtures__/paymentRuntime.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * Gap PG-01 (docs/readiness/20261113-card-payments-gaps.md): one refund the
 * worker cannot finish used every claim of every run.
 *
 * A refund that Moyasar cannot be asked about (a proxy or network error, a
 * 5xx, Allowed IPs) is released as 'pending'. claim_order_refund used to take
 * the OLDEST pending refund, which was the one just released, so the next
 * claim of the same run took it straight back: five claims a run, every five
 * minutes, and every newer refund waiting behind it.
 *
 * Driven through the REAL payment-refund handler over paymentFakes.ts, whose
 * claim_order_refund models 20261013120000 (least recently touched first, ids
 * passed in p_exclude_refund_ids skipped). The worker's half of the fix is that
 * it passes the ids it has claimed in the run.
 */

const TRIGGER = 'refund-trigger-fixture';
let db: FakePaymentDb;
let moyasar: FakeMoyasar;

beforeEach(() => {
  ({ db, moyasar } = freshRuntime());
  db.paymentRow(LIVE_PUBLIC, { ...SECRETS, refund_trigger_secret: TRIGGER });
});

/** A paid live Moyasar payment that a refund is owed on. */
function owed(amount = 64): { refundId: string; paymentId: string } {
  const refund = db.refund({ order: { total: amount } });
  const paymentId = String(refund.charge_ref);
  moyasar.payments.set(paymentId, {
    id: paymentId,
    status: 'paid',
    amount: amount * 100,
    currency: 'SAR',
    invoice_id: `inv_${paymentId}`,
    created_at: new Date().toISOString(),
  });
  return { refundId: String(refund.id), paymentId };
}

function refundRow(id: string) {
  return db.rows('order_refunds').find((r) => r.id === id)!;
}

describe('one stuck refund no longer takes every claim of a run', () => {
  it('is tried once per run, not five times', async () => {
    const stuck = owed();
    moyasar.unreachable = true;

    const res = await refundRun(TRIGGER);

    expect(res.status).toBe(200);
    expect(db.claims()).toEqual([stuck.refundId]);
    // First attempt: the refund POST, then the lookup that asks whether it
    // landed. Before the fix, four more claims each made one more lookup.
    expect(moyasar.requests).toEqual([
      `POST /v1/payments/${stuck.paymentId}/refund`,
      `GET /v1/payments/${stuck.paymentId}`,
    ]);
    expect(refundRow(stuck.refundId)).toMatchObject({ status: 'pending', attempt_count: 1 });
  });

  it('passes the ids it has claimed to every later claim of the run', async () => {
    const stuck = owed();
    moyasar.unreachable = true;

    await refundRun(TRIGGER);

    const claimCalls = db.rpcLog.filter((c) => c.name === 'claim_order_refund');
    expect(claimCalls.map((c) => c.args.p_exclude_refund_ids)).toEqual([[], [stuck.refundId]]);
  });

  it('lets a newer refund through in the same run', async () => {
    const stuck = owed(64);
    const fine = owed(30);
    // Only the older refund's payment is unreachable.
    const real = moyasar.fetch;
    moyasar.fetch = async (input, init) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.includes(stuck.paymentId)) {
        moyasar.requests.push(`${String(init?.method ?? 'GET')} ${new URL(url).pathname}`);
        throw new TypeError('error sending request: connection reset');
      }
      return real(input, init);
    };
    (globalThis as Record<string, unknown>).fetch = moyasar.fetch;

    await refundRun(TRIGGER);

    expect(db.claims()).toEqual([stuck.refundId, fine.refundId]);
    expect(refundRow(fine.refundId)).toMatchObject({ status: 'succeeded' });
    expect(refundRow(stuck.refundId)).toMatchObject({ status: 'pending', attempt_count: 1 });
  });

  it('serves two stuck refunds in turn across runs, the one released longest ago first', async () => {
    const a = owed(64);
    const b = owed(30);
    moyasar.unreachable = true;

    await refundRun(TRIGGER);
    await refundRun(TRIGGER);

    expect(db.claims()).toEqual([a.refundId, b.refundId, a.refundId, b.refundId]);
    expect(refundRow(a.refundId).attempt_count).toBe(2);
    expect(refundRow(b.refundId).attempt_count).toBe(2);
  });
});

describe('a refund released as pending records why', () => {
  it('no answer from Moyasar', async () => {
    const stuck = owed();
    moyasar.unreachable = true;
    await refundRun(TRIGGER);
    expect(refundRow(stuck.refundId)).toMatchObject({
      status: 'pending',
      failure_code: 'provider_no_answer',
    });
    expect(String(refundRow(stuck.refundId).last_error_safe)).toMatch(/No answer from Moyasar/);
  });

  it('the next run could not ask Moyasar what the first attempt did', async () => {
    const stuck = owed();
    moyasar.unreachable = true;
    await refundRun(TRIGGER);
    await refundRun(TRIGGER);
    // The second run reconciles before posting; the lookup fails, so it
    // releases without sending anything.
    expect(refundRow(stuck.refundId)).toMatchObject({
      status: 'pending',
      attempt_count: 2,
      failure_code: 'reconcile_unavailable',
    });
    expect(moyasar.requests.filter((r) => r.startsWith('POST'))).toHaveLength(1);
  });

  it("no usable key for the payment's mode", async () => {
    const stuck = owed();
    db.paymentRow(LIVE_PUBLIC, {
      moyasar_test_secret_key: 'sk_test_fixture',
      refund_trigger_secret: TRIGGER,
      moyasar_live_webhook_secret_token: 'whsec_live_fixture',
    });
    await refundRun(TRIGGER);
    expect(refundRow(stuck.refundId)).toMatchObject({ status: 'pending', failure_code: 'key_unavailable' });
    expect(moyasar.requests).toEqual([]);
  });

  it('a refund that succeeds records no error, and the healthy path is unchanged', async () => {
    const ok = owed();
    await refundRun(TRIGGER);
    expect(refundRow(ok.refundId)).toMatchObject({
      status: 'succeeded',
      failure_code: null,
      last_error_safe: null,
      attempt_count: 1,
    });
    expect(moyasar.requests).toEqual([`POST /v1/payments/${ok.paymentId}/refund`]);
    expect(db.rows('orders').find((o) => o.id === refundRow(ok.refundId).order_id)?.refund_state).toBe(
      'refunded',
    );
  });
});
