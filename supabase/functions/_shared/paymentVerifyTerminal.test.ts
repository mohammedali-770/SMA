import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PUBLIC, SECRETS, type FakeMoyasar, type FakePaymentDb } from './__fixtures__/paymentFakes.ts';
import { call, currentDb, freshRuntime } from './__fixtures__/paymentRuntime.ts';
import {
  recoverPendingSession,
  type PendingSession,
  type VerifyOutcome,
} from '../../../apps/mobile/src/features/checkout/pendingSession.ts';
import { STRINGS } from '../../../apps/mobile/src/i18n/strings.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * C3 and C4 of the 2026-11-12 review: a checkout session that never got a
 * usable invoice was answered 'pending' by payment-verify for ever. Every
 * build saves the session id before payment-initiate and resolves it before
 * EVERY order, cash included, so that one answer locked the device out of
 * ordering. The fix is in payment-verify because that is the only change that
 * reaches the builds already installed.
 *
 * Driven through the real payment-initiate and payment-verify handlers over
 * paymentFakes.ts, and the app's real recoverPendingSession.
 */

/**
 * The recovery decision of the builds ALREADY IN THE STORES, frozen here
 * verbatim from apps/mobile/src/features/checkout/pendingSession.ts on the
 * default branch (claude/project-build-ie4b56 at 8df5408, lines 63-77). It
 * cannot change any more; the server's answers have to fit it.
 */
const SHIPPED_TERMINAL_STATUSES = new Set(['failed', 'cancelled', 'expired']);
function shippedDecidePendingAction(res: VerifyOutcome | null | undefined) {
  if (!res) return { kind: 'keep' };
  if (res.status === 'paid' && res.orderId) return { kind: 'receipt', orderId: res.orderId };
  if (res.status === 'paid') return { kind: 'keep' };
  if (SHIPPED_TERMINAL_STATUSES.has(res.status)) return { kind: 'clear' };
  return { kind: 'keep' };
}

let db: FakePaymentDb;
let moyasar: FakeMoyasar;

beforeEach(() => {
  ({ db, moyasar } = freshRuntime());
  db.paymentRow(LIVE_PUBLIC, SECRETS);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const verify = async (sessionId: unknown) =>
  (await call('payment-verify', { checkoutSessionId: sessionId })).body;
const past = () => new Date(Date.now() - 60_000).toISOString();
const CANCELLED = { status: 'cancelled', messageKey: 'payCancelled', orderId: null };
const EXPIRED = { status: 'expired', messageKey: 'payExpired', orderId: null };

function attempt(sessionId: unknown, input: Record<string, unknown>) {
  return db.insertRow('payment_records', {
    checkout_session_id: sessionId,
    provider: 'moyasar',
    amount: 64,
    mode: 'live',
    reference_transaction: `sm_${Math.random().toString(16).slice(2)}`,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...input,
  });
}

describe('a session with nothing payable is answered terminal, without a key', () => {
  it('no Moyasar attempt at all: cancelled while the session is open', async () => {
    const s = db.session();
    expect(await verify(s.id)).toEqual(CANCELLED);
  });

  it('…and expired once it is past its expires_at or no longer pending_payment', async () => {
    expect(await verify(db.session({ expires_at: past() }).id)).toEqual(EXPIRED);
    expect(await verify(db.session({ status: 'expired' }).id)).toEqual(EXPIRED);
    expect(await verify(db.session({ status: 'cancelled' }).id)).toEqual(EXPIRED);
  });

  // Production holds a 19 July session whose only attempt is a Tap row.
  it('a session whose only attempts belong to an old provider', async () => {
    const s = db.session({ expires_at: past() });
    attempt(s.id, { provider: 'tap', status: 'failed', failure_code: 'ABANDONED', provider_ref: 'chg_x' });
    expect(await verify(s.id)).toEqual(EXPIRED);
  });

  it('the newest Moyasar attempt closed without ever getting an invoice', async () => {
    const s = db.session();
    attempt(s.id, { status: 'failed', failure_code: 'create_401' });
    expect(await verify(s.id)).toEqual(CANCELLED);
  });

  it('the newest attempt is open with no invoice: pending while the session is open, terminal once it is over', async () => {
    const open = db.session();
    attempt(open.id, { status: 'initiated' });
    expect(await verify(open.id)).toEqual({ status: 'pending' });

    const over = db.session({ expires_at: past() });
    attempt(over.id, { status: 'initiated' });
    expect(await verify(over.id)).toEqual(EXPIRED);
  });

  it.each([
    ['no payment row', () => (db.tables.integration_settings = [])],
    ['a disabled payment row', () => db.paymentRow(LIVE_PUBLIC, SECRETS, { enabled: false })],
    ['a row with no keys', () => db.paymentRow(LIVE_PUBLIC, {})],
  ])('needs no configuration: %s', async (_label, configure) => {
    configure();
    expect(await verify(db.session().id)).toEqual(CANCELLED);
    expect(await verify(db.session({ expires_at: past() }).id)).toEqual(EXPIRED);
  });

  it('never writes the session', async () => {
    const s = db.session({ expires_at: past() });
    const before = JSON.stringify(db.rows('checkout_sessions'));
    await verify(s.id);
    await verify(db.session().id);
    expect(JSON.stringify(db.rows('checkout_sessions').slice(0, 1))).toBe(JSON.stringify(JSON.parse(before)));
    expect(db.rows('checkout_sessions').map((r) => r.status)).toEqual(['pending_payment', 'pending_payment']);
  });

  it('a failed read of the attempts is pending, never terminal', async () => {
    const s = db.session();
    db.failNext('payment_records.select');
    expect(await verify(s.id)).toEqual({ status: 'pending' });
  });

  it.each([
    ['cancelled', CANCELLED],
    ['expired', EXPIRED],
  ])('answers %s in a status and key every shipped build treats as terminal and can show', (_s, answer) => {
    expect(shippedDecidePendingAction(answer)).toEqual({ kind: 'clear' });
    expect(Object.keys(STRINGS.en)).toContain(answer.messageKey);
    expect(Object.keys(STRINGS.ar)).toContain(answer.messageKey);
  });
});

describe('an attempt with an invoice is still decided by Moyasar', () => {
  it('an open invoice is pending; with no configuration it stays pending, since only a key can tell', async () => {
    const s = db.session();
    const init = await call('payment-initiate', { checkoutSessionId: s.id, language: 'en' });
    expect(init.status).toBe(200);
    expect(await verify(s.id)).toMatchObject({ status: 'pending' });
    db.tables.integration_settings = [];
    expect(await verify(s.id)).toEqual({ status: 'pending' });
  });

  it('a paid invoice confirms, as before', async () => {
    const s = db.session();
    const init = await call('payment-initiate', { checkoutSessionId: s.id, language: 'en' });
    moyasar.pay(String(init.body.invoiceId), 'pay_1', 'paid');
    expect(await verify(s.id)).toMatchObject({
      status: 'paid',
      orderId: db.rows('checkout_sessions')[0].order_id,
    });
  });
});

/**
 * The review's lock-out, end to end: online payment on, the card in TEST mode.
 * payment-initiate refuses before any attempt exists, then the customer
 * switches to cash. Recovery runs before EVERY order (CheckoutScreen.placeOrder)
 * and used to resume the dead session for ever.
 */
describe('a refused start no longer locks the device out (old builds and new)', () => {
  function device() {
    let stored: PendingSession | null = null;
    return {
      save: (id: string) => (stored = { sessionId: id, at: Date.now() }),
      deps: {
        read: async () => stored,
        clear: async () => {
          stored = null;
        },
        verify: async (id: string) =>
          (await call('payment-verify', { checkoutSessionId: id })).body as VerifyOutcome,
      },
      get stored() {
        return stored;
      },
    };
  }

  /** CheckoutScreen.placeOrder's branch on recovery: only receipt and resume return early. */
  const cashOrderProceeds = (kind: string) => kind !== 'receipt' && kind !== 'resume';

  it.each([
    ['the card in TEST mode', () => db.paymentRow({ ...LIVE_PUBLIC, mode: 'test' }, SECRETS), 'test_mode'],
    ['the gateway disabled', () => db.paymentRow(LIVE_PUBLIC, SECRETS, { enabled: false }), undefined],
  ])('%s: the stored session is released and the cash order is placed', async (_label, configure, reason) => {
    configure();
    const s = db.session();
    const phone = device();
    phone.save(String(s.id)); // savePendingSession, before payment-initiate
    const init = await call('payment-initiate', { checkoutSessionId: s.id, language: 'en' });
    expect(init.body).toEqual(reason ? { status: 'disabled', reason } : { status: 'disabled' });
    expect(db.attempts({ checkout_session_id: s.id })).toHaveLength(0);

    // The shipped builds' decision clears on the server's answer...
    expect(shippedDecidePendingAction(await phone.deps.verify(String(s.id)))).toEqual({ kind: 'clear' });
    // ...and so does the new build's real recovery, after which the order goes through.
    const rec = await recoverPendingSession(phone.deps);
    expect(rec).toEqual({ kind: 'cleared' });
    expect(phone.stored).toBeNull();
    expect(cashOrderProceeds(rec.kind)).toBe(true);
    expect((await recoverPendingSession(phone.deps)).kind).toBe('none');
  });

  it('a total under 1.00 SAR: the same, and the retired session reads expired', async () => {
    const s = db.session({ total: 0.5 });
    const phone = device();
    phone.save(String(s.id));
    expect((await call('payment-initiate', { checkoutSessionId: s.id, language: 'en' })).body).toEqual({
      status: 'disabled',
      reason: 'amount_below_minimum',
    });
    expect(await phone.deps.verify(String(s.id))).toEqual(EXPIRED);
    expect(cashOrderProceeds((await recoverPendingSession(phone.deps)).kind)).toBe(true);
  });

  it('LIVE without the Allowed-IPs proxy: the invoice create is refused, and the session is still released', async () => {
    const s = db.session();
    const phone = device();
    phone.save(String(s.id));
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ type: 'authentication_error', message: 'This IP Address is not whitelisted' }),
        {
          status: 401,
        },
      );
    const init = await call('payment-initiate', { checkoutSessionId: s.id, language: 'en' });
    globalThis.fetch = realFetch;
    expect(init.status).toBe(502);
    expect(db.attempts({ checkout_session_id: s.id })[0]).toMatchObject({
      status: 'failed',
      failure_code: 'create_401',
    });
    expect(shippedDecidePendingAction(await phone.deps.verify(String(s.id)))).toEqual({ kind: 'clear' });
    expect(cashOrderProceeds((await recoverPendingSession(phone.deps)).kind)).toBe(true);
  });

  // The review's pending_lockout scratch test, inverted: it pinned 'resume'
  // for ever on {status:'pending'}. 'pending' itself still means keep, which
  // is right for a payment that may settle; what changed is that the server no
  // longer gives that answer for a session that cannot be paid.
  it('a session that really may still settle is still kept', async () => {
    const s = db.session();
    attempt(s.id, { status: 'initiated' });
    const phone = device();
    phone.save(String(s.id));
    expect(await recoverPendingSession(phone.deps)).toEqual({ kind: 'resume', sessionId: s.id });
  });

  it('CheckoutScreen places the order unless recovery returns receipt or resume', () => {
    const screen = readFileSync(
      new URL('../../../apps/mobile/src/features/checkout/CheckoutScreen.tsx', import.meta.url),
      'utf8',
    );
    const place = screen.slice(screen.indexOf('const placeOrder = async () => {'));
    const recovery = place.slice(place.indexOf('const rec = await recoverPendingSession({'));
    const branch = recovery.slice(0, recovery.indexOf('let deliveryAddressId'));
    expect(branch).toContain("if (rec.kind === 'receipt') {");
    expect(branch).toContain("if (rec.kind === 'resume') { await runOnlinePayment(rec.sessionId); return; }");
    expect(branch.match(/return;/g)).toHaveLength(2);
  });
});
