import { beforeEach, describe, expect, it, vi } from 'vitest';

import { currentDb, freshDb, loadHandler, type FakeDb, type Row } from './__fixtures__/handlerFakes.ts';

vi.mock('./supabaseClient.ts', () => ({
  adminClient: () => currentDb().client(),
  userClient: () => currentDb().client(),
}));

/**
 * push-dispatch's POS-outcome pushes skip a CANCELLED order
 * (docs/OWNER_ACTIONS.md §57, docs/MIGRATIONS.md §67).
 *
 * THE DEFECT. The `pos_sync` action decides whether an event still holds by
 * `pos_sync_status_matches`, which reads the sync state and never
 * `orders.status`. So a cancelled order that the stale sweep dead-lettered when
 * its POS deadline ran out was sent "We could not send your order to the
 * restaurant", and one cancelled just after reaching the POS could be sent
 * "confirmed". Push is a live customer channel (CLAUDE.md §7).
 *
 * Driven through the REAL handler over handlerFakes.ts, as the service-role
 * caller lazywait-sync's drain is. The claim and pre-send RPCs are modelled as
 * their token fences only, and always find the event current: what they
 * decide about the sync state is the database's business and is covered by
 * supabase/tests/lazywait_fencing_test.sql. What this file pins is the one
 * thing the handler now decides itself.
 *
 * Fails on push-dispatch v9: every cancelled case sends.
 */

const SERVICE_KEY = 'sb_secret_fixture0000';
const POS_STATUSES = ['pos_failed', 'pos_retrying', 'pos_confirmation_required', 'pos_confirmed'] as const;
const LIVE_STATUSES = ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered'] as const;

let db: FakeDb;
let expo: Array<{ to: string; title: string; body: string }[]>;

function event(db: FakeDb, orderId: string, status: string): Row | undefined {
  return db.rows('notification_log').find((r) => r.order_id === orderId && r.status === status);
}

beforeEach(() => {
  db = freshDb({
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: SERVICE_KEY }),
  });
  db.rows('integration_settings').push({
    provider_type: 'push',
    enabled: true,
    provider_name: 'expo',
    public_config: { provider: 'expo' },
    secret_config: {},
  });

  const fenced = (args: Row) =>
    db
      .rows('notification_log')
      .find((r) => r.kind === 'pos_sync' && r.order_id === args.p_order_id && r.status === args.p_status);
  db.rpcs.claim_pos_sync_notification = (_db, args) => {
    const row = fenced(args);
    if (!row) return 'no_event';
    if (['sent', 'no_targets', 'failed', 'superseded'].includes(String(row.send_status))) return 'duplicate';
    if (row.send_status === 'processing') return 'in_progress';
    row.send_status = 'processing';
    row.claim_token = args.p_claim_token;
    return 'claimed';
  };
  db.rpcs.validate_pos_sync_notification_before_send = (_db, args) => {
    const row = fenced(args);
    return row && row.send_status === 'processing' && row.claim_token === args.p_claim_token
      ? 'ready_to_send'
      : 'lost_claim';
  };
  db.rpcs.finalize_pos_sync_notification = (_db, args) => {
    const row = fenced(args);
    if (!row || row.send_status !== 'processing' || row.claim_token !== args.p_claim_token) return false;
    row.send_status = args.p_send_status;
    return true;
  };
  db.rpcs.release_pos_sync_notification = (_db, args) => {
    const row = fenced(args);
    if (!row || row.send_status !== 'processing' || row.claim_token !== args.p_claim_token) return false;
    row.send_status = 'pending';
    row.claim_token = null;
    return true;
  };

  expo = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url) !== 'https://exp.host/--/api/v2/push/send') throw new Error(`unexpected fetch ${url}`);
      const messages = JSON.parse(String(init.body)) as { to: string; title: string; body: string }[];
      expo.push(messages);
      return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok' })) }), { status: 200 });
    }),
  );
});

/** An order with one opted-in device and one pending pos_sync event. */
function seed(orderStatus: string, posStatus: string): string {
  const orderId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  db.rows('orders').push({ id: orderId, customer_id: customerId, status: orderStatus, order_type: 'pickup' });
  db.rows('push_devices').push({
    id: crypto.randomUUID(),
    customer_id: customerId,
    expo_push_token: `ExponentPushToken[${orderId}]`,
    lang: 'en',
    is_active: true,
    order_updates_enabled: true,
    promos_enabled: true,
  });
  db.rows('notification_log').push({
    id: crypto.randomUUID(),
    kind: 'pos_sync',
    order_id: orderId,
    status: posStatus,
    send_status: 'pending',
    claim_token: null,
  });
  return orderId;
}

async function dispatch(orderId: string, status: string) {
  const h = await loadHandler('push-dispatch', () => import('../push-dispatch/index.ts'));
  const res = await h(
    new Request('https://project.example/functions/v1/push-dispatch', {
      method: 'POST',
      // The service call as lazywait-sync makes it: the secret key on `apikey` only.
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY },
      body: JSON.stringify({ action: 'pos_sync', orderId, status }),
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe('push-dispatch pos_sync: a cancelled order is told nothing about the POS', () => {
  it.each(POS_STATUSES)('%s: not sent, and the event is closed as superseded', async (posStatus) => {
    const orderId = seed('cancelled', posStatus);
    const res = await dispatch(orderId, posStatus);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'superseded', reason: 'order cancelled; not sent' });
    expect(expo).toHaveLength(0);
    // Terminal, under this dispatch's own token, so the oldest-first drain in
    // lazywait-sync never picks it up again.
    const row = event(db, orderId, posStatus);
    expect(row?.send_status).toBe('superseded');
    expect(row?.claim_token).toEqual(
      db.rpcLog.find((c) => c.name === 'claim_pos_sync_notification')?.args.p_claim_token,
    );
    // Nothing past the skip ran: no device read, no pre-send check, no finalize.
    expect(db.rpcLog.map((c) => c.name)).toEqual(['claim_pos_sync_notification']);
  });

  it('a second dispatch of the same event is a no-op', async () => {
    const orderId = seed('cancelled', 'pos_failed');
    await dispatch(orderId, 'pos_failed');
    const again = await dispatch(orderId, 'pos_failed');
    expect(again.body.status).toBe('duplicate');
    expect(expo).toHaveLength(0);
  });

  it('never closes an event another dispatcher holds', async () => {
    const orderId = seed('cancelled', 'pos_failed');
    const row = event(db, orderId, 'pos_failed')!;
    row.send_status = 'processing';
    row.claim_token = 'someone-else';
    const res = await dispatch(orderId, 'pos_failed');
    expect(res.body.status).toBe('in_progress');
    expect(row.send_status).toBe('processing');
    expect(row.claim_token).toBe('someone-else');
    expect(expo).toHaveLength(0);
  });

  it('closes only its own claim: the write is fenced by the claim token', async () => {
    // Not reachable today, because a 'processing' pos_sync row is never
    // reclaimed. Pinned anyway: every other write on this row is token-fenced,
    // and an unfenced one would close a claim a later reclaim path handed on.
    const orderId = seed('cancelled', 'pos_failed');
    const claim = db.rpcs.claim_pos_sync_notification;
    db.rpcs.claim_pos_sync_notification = (d, args) => {
      const answer = claim(d, args);
      event(d, orderId, 'pos_failed')!.claim_token = 'someone-else';
      return answer;
    };
    await dispatch(orderId, 'pos_failed');
    const row = event(db, orderId, 'pos_failed')!;
    expect(row.send_status).toBe('processing');
    expect(row.claim_token).toBe('someone-else');
    expect(expo).toHaveLength(0);
  });
});

describe('push-dispatch pos_sync: every other order is sent exactly as before', () => {
  const cases = LIVE_STATUSES.flatMap((o) => POS_STATUSES.map((p) => [o, p] as const));
  it.each(cases)('%s order, %s: sent once, finalized sent', async (orderStatus, posStatus) => {
    const orderId = seed(orderStatus, posStatus);
    const res = await dispatch(orderId, posStatus);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', send_status: 'sent', targeted: 1, sent: 1 });
    expect(expo).toHaveLength(1);
    expect(expo[0]).toHaveLength(1);
    expect(event(db, orderId, posStatus)?.send_status).toBe('sent');
  });

  it('the copy is unchanged: pos_failed still says what it always said', async () => {
    const orderId = seed('received', 'pos_failed');
    await dispatch(orderId, 'pos_failed');
    expect(expo[0][0]).toMatchObject({
      title: 'Order not confirmed',
      body: 'We could not send your order to the restaurant, and the order was not confirmed. Our team will follow up.',
    });
  });
});
