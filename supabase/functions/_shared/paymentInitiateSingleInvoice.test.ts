import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { call, currentDb, freshRuntime, webhook, type Reply } from './__fixtures__/paymentRuntime.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * F-EFP-07-001: one attempt, one payable invoice.
 *
 * begin_*_attempt commits the attempt before its invoice exists and hands it to
 * a second concurrent caller as reused with no invoice id. That caller's
 * reconcile cannot see an invoice whose create is still in transit, so it
 * creates a second one. Both then persisted unconditionally, the row kept the
 * later id, and the other invoice, whose URL had already been handed out,
 * belonged to nothing: paying it was acknowledged by the webhook as an
 * "unknown payment" and no order was ever created.
 *
 * Now the persist only lands on an attempt with no invoice yet. The loser
 * cancels the invoice it created, whose URL never left the server, and answers
 * with the stored one, so both callers open the same page. And the webhook can
 * still find the attempt for a payment on a sibling invoice (one carrying the
 * attempt's own reference_transaction in its metadata), so an orphan made
 * before this fix, or one whose cancel did not land, is not money lost.
 *
 * Driven through the REAL payment-initiate and payment-webhook handlers over
 * the fakes in paymentFakes.ts; the race is made deterministic by holding the
 * first invoice POST in transit, before it reaches Moyasar.
 */

let db: FakePaymentDb;
let moyasar: FakeMoyasar;
let err: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ({ db, moyasar } = freshRuntime());
  db.paymentRow(LIVE_PUBLIC, SECRETS);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  err = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Structured log lines with this event name, from console.error and console.warn. */
function logged(event: string): Record<string, unknown>[] {
  return [...err.mock.calls, ...warn.mock.calls]
    .map((c) => {
      try {
        return JSON.parse(String(c[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l): l is Record<string, unknown> => l?.event === event);
}

/**
 * Hold the FIRST `POST /v1/invoices` before it reaches Moyasar, as a slow
 * create (or a slow outbound proxy) does. Every later request goes straight
 * through.
 */
function holdFirstInvoicePost(): { entered: Promise<void>; release: (answer?: Response) => void } {
  let release!: () => void;
  let heldAnswer: Response | undefined;
  let entered!: () => void;
  const released = new Promise<void>((r) => (release = r));
  const enteredP = new Promise<void>((r) => (entered = r));
  const inner = moyasar.fetch;
  let held = false;
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!held && String(init.method ?? 'GET').toUpperCase() === 'POST' && url.pathname === '/v1/invoices') {
      held = true;
      entered();
      await released;
      if (heldAnswer) return heldAnswer;
    }
    return inner(input, init);
  };
  return {
    entered: enteredP,
    release: (answer?: Response) => {
      heldAnswer = answer;
      release();
    },
  };
}

type Flow = 'session' | 'order';

function subject(flow: Flow): { body: Record<string, unknown>; attempt: () => Record<string, unknown>[] } {
  if (flow === 'session') {
    const s = db.session();
    return {
      body: { checkoutSessionId: s.id, language: 'en' },
      attempt: () => db.attempts({ checkout_session_id: s.id }),
    };
  }
  const o = db.order();
  return { body: { orderId: o.id, language: 'en' }, attempt: () => db.attempts({ order_id: o.id }) };
}

/** A starts, its invoice create is held in transit; B runs to completion; then A is released. */
async function race(flow: Flow): Promise<{ a: Reply; b: Reply; attempts: () => Record<string, unknown>[] }> {
  const s = subject(flow);
  const gate = holdFirstInvoicePost();
  const aP = call('payment-initiate', s.body);
  await gate.entered;
  const b = await call('payment-initiate', s.body);
  gate.release();
  const a = await aP;
  return { a, b, attempts: s.attempt };
}

describe.each<Flow>(['session', 'order'])('two concurrent initiates, %s flow', (flow) => {
  it('open the same invoice: the loser cancels its own and answers with the stored one', async () => {
    const { a, b, attempts } = await race(flow);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Two creates did reach Moyasar: the window is real, and the fix closes it
    // after the fact rather than pretending it away.
    expect(moyasar.posts).toHaveLength(2);

    const rows = attempts();
    expect(rows).toHaveLength(1);
    const stored = String(rows[0].provider_checkout_ref);
    expect(a.body.invoiceId).toBe(stored);
    expect(b.body.invoiceId).toBe(stored);
    expect(a.body.checkoutUrl).toBe(b.body.checkoutUrl);

    const other = [...moyasar.invoices.keys()].find((id) => id !== stored)!;
    expect(moyasar.invoices.get(other)!.status).toBe('canceled');
    expect(moyasar.invoices.get(stored)!.status).toBe('initiated');
    expect(moyasar.requests).toContain(`PUT /v1/invoices/${other}/cancel`);
    expect(logged('moyasar_duplicate_invoice_cancelled')).toHaveLength(1);
  });

  it('paying the page both callers were handed creates the paid order', async () => {
    const { b } = await race(flow);
    const payment = moyasar.pay(String(b.body.invoiceId), 'pay_race_1', 'paid');
    const res = await webhook(payment);
    expect(res.body.status).toBe('paid');
    const paidOrders = db.rows('orders').filter((o) => o.payment_status === 'paid');
    expect(paidOrders).toHaveLength(1);
    expect(logged('moyasar_unknown_payment')).toHaveLength(0);
  });

  it('a third start reuses the stored invoice and creates nothing', async () => {
    const { a } = await race(flow);
    const body =
      flow === 'session'
        ? { checkoutSessionId: a.body.checkoutSessionId, language: 'en' }
        : { orderId: db.rows('orders')[0].id, language: 'en' };
    const c = await call('payment-initiate', body);
    expect(c.body.invoiceId).toBe(a.body.invoiceId);
    expect(moyasar.posts).toHaveLength(2);
  });
});

describe('the loser cannot close the winner’s attempt', () => {
  it('a racing create that fails leaves the stored invoice’s attempt open', async () => {
    const s = subject('session');
    const gate = holdFirstInvoicePost();
    const aP = call('payment-initiate', s.body);
    await gate.entered;
    const b = await call('payment-initiate', s.body);
    // A's create now comes back refused (a 4xx), after B stored its invoice.
    gate.release(
      new Response(JSON.stringify({ type: 'invalid_request_error', message: 'no' }), { status: 422 }),
    );
    expect((await aP).status).toBe(502);
    const [row] = s.attempt();
    expect(row).toMatchObject({
      status: 'initiated',
      provider_checkout_ref: b.body.invoiceId,
      failure_code: null,
    });
  });
});

describe('when the loser cannot cancel its invoice', () => {
  it('both callers still get the stored invoice, and the failure is logged loudly', async () => {
    moyasar.cancelFails = true;
    const { a, b, attempts } = await race('session');
    const stored = String(attempts()[0].provider_checkout_ref);
    expect(a.body.invoiceId).toBe(stored);
    expect(b.body.invoiceId).toBe(stored);
    expect(logged('moyasar_duplicate_invoice_not_cancelled')).toHaveLength(1);
  });
});

/**
 * An invoice that carries an attempt's reference_transaction but is not the
 * one stored on it: made before this fix, or left payable by a cancel that did
 * not land. Created here the way payment-initiate creates one, so its metadata
 * is exactly what Moyasar would hold.
 */
async function siblingInvoice(): Promise<{
  session: Record<string, unknown>;
  stored: string;
  sibling: string;
}> {
  const session = db.session();
  const init = await call('payment-initiate', { checkoutSessionId: session.id, language: 'en' });
  expect(init.status).toBe(200);
  const created = await moyasar.fetch('https://api.moyasar.com/v1/invoices', {
    method: 'POST',
    body: JSON.stringify(moyasar.posts[0]),
  });
  const sibling = String(((await created.json()) as { id: string }).id);
  return { session, stored: String(init.body.invoiceId), sibling };
}

describe('the webhook finds the attempt for a payment on a sibling invoice', () => {
  it('confirms it, and the session gets its paid order', async () => {
    const { session, sibling } = await siblingInvoice();
    const payment = moyasar.pay(sibling, 'pay_sibling_1', 'paid');
    const res = await webhook(payment);
    expect(res.body).toMatchObject({ status: 'paid' });
    const s = db.rows('checkout_sessions').find((r) => r.id === session.id)!;
    expect(s.order_id).not.toBeNull();
    const [attempt] = db.attempts({ checkout_session_id: session.id });
    expect(attempt).toMatchObject({ status: 'paid', provider_ref: 'pay_sibling_1' });
    expect(logged('moyasar_sibling_invoice_payment')).toHaveLength(1);
    expect(db.rows('integration_sync_logs').filter((l) => l.error === 'unknown payment')).toHaveLength(0);
  });

  it('a replayed webhook for it answers paid again and records no mismatch', async () => {
    const { sibling } = await siblingInvoice();
    const payment = moyasar.pay(sibling, 'pay_sibling_1', 'paid');
    await webhook(payment);
    const again = await webhook(payment);
    expect(again.body).toMatchObject({ status: 'paid' });
    expect(db.rows('integration_sync_logs').filter((l) => l.error === 'verification_mismatch')).toHaveLength(
      0,
    );
    expect(db.rows('orders')).toHaveLength(1);
  });

  it('a second payment on the stored invoice afterwards is recorded as a duplicate to refund', async () => {
    const { stored, sibling } = await siblingInvoice();
    await webhook(moyasar.pay(sibling, 'pay_sibling_1', 'paid'));
    const res = await webhook(moyasar.pay(stored, 'pay_stored_2', 'paid'));
    expect(res.body).toMatchObject({ status: 'acknowledged', outcome: 'failed' });
    expect(db.rows('orders')).toHaveLength(1);
    expect(
      db
        .rows('payment_records')
        .filter((r) => r.provider_ref === 'pay_stored_2' && r.failure_code === 'duplicate_payment'),
    ).toHaveLength(1);
  });

  it('a payment on a sibling that did not settle touches nothing', async () => {
    const { session, sibling } = await siblingInvoice();
    const before = JSON.stringify(db.attempts({ checkout_session_id: session.id })[0]);
    const res = await webhook(moyasar.pay(sibling, 'pay_sibling_failed', 'failed'), 'payment_failed');
    expect(res.body).toMatchObject({ status: 'acknowledged', reason: 'sibling invoice payment not settled' });
    const [attempt] = db.attempts({ checkout_session_id: session.id });
    expect(attempt).toMatchObject({ status: 'initiated', provider_ref: null });
    expect(JSON.stringify(attempt)).toBe(before);
  });

  it('a sibling whose amount differs from the attempt is not adopted', async () => {
    const { sibling } = await siblingInvoice();
    moyasar.invoices.get(sibling)!.amount = 100;
    const payment = moyasar.pay(sibling, 'pay_sibling_cheap', 'paid');
    const res = await webhook(payment);
    expect(res.body).toMatchObject({ status: 'acknowledged', reason: 'unknown payment' });
    expect(db.rows('orders')).toHaveLength(0);
  });

  it('a sibling of an attempt in the other mode is not adopted', async () => {
    const { session, sibling } = await siblingInvoice();
    db.attempts({ checkout_session_id: session.id })[0].mode = 'test';
    const res = await webhook(moyasar.pay(sibling, 'pay_sibling_mode', 'paid'));
    expect(res.body).toMatchObject({ status: 'acknowledged', reason: 'unknown payment' });
    expect(db.rows('orders')).toHaveLength(0);
  });

  it('an invoice that cannot be read now asks Moyasar to retry rather than acknowledging', async () => {
    const { sibling } = await siblingInvoice();
    const payment = moyasar.pay(sibling, 'pay_sibling_2', 'paid');
    const inner = moyasar.fetch;
    (globalThis as Record<string, unknown>).fetch = async (
      input: string | URL | Request,
      init: RequestInit = {},
    ) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === `/v1/invoices/${sibling}`) throw new TypeError('connection reset');
      return inner(input, init);
    };
    const res = await webhook(payment);
    expect(res.status).toBe(503);
    expect(db.rows('orders')).toHaveLength(0);
  });
});

describe('a payment nothing can be matched to', () => {
  it('is acknowledged as before, and logged loudly', async () => {
    const created = await moyasar.fetch('https://api.moyasar.com/v1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        amount: 6400,
        currency: 'SAR',
        metadata: { reference_transaction: 'sm_nobody' },
      }),
    });
    const inv = String(((await created.json()) as { id: string }).id);
    const res = await webhook(moyasar.pay(inv, 'pay_nobody', 'paid'));
    expect(res.body).toEqual({ status: 'acknowledged', reason: 'unknown payment' });
    expect(logged('moyasar_unknown_payment')).toEqual([
      expect.objectContaining({ payment_id: 'pay_nobody', invoice_id: inv, payment_status: 'paid' }),
    ]);
  });

  it('the admin sandbox invoice is recognised by its own metadata', async () => {
    const created = await moyasar.fetch('https://api.moyasar.com/v1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        amount: 100,
        currency: 'SAR',
        metadata: {
          reference_transaction: 'admin_test_x',
          reference_order: 'admin_test',
          purpose: 'admin_test',
        },
      }),
    });
    const inv = String(((await created.json()) as { id: string }).id);
    const res = await webhook(moyasar.pay(inv, 'pay_admin', 'paid'));
    expect(res.body).toEqual({ status: 'acknowledged', reason: 'admin_test' });
    expect(logged('moyasar_unknown_payment')).toHaveLength(0);
  });
});
