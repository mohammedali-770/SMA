import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { currentDb, freshDb, loadHandler, type FakeDb, type Row } from './__fixtures__/handlerFakes.ts';

/**
 * Three changes to live customer messaging in push-dispatch, driven through the
 * REAL handler over handlerFakes.ts (CLAUDE.md section 7: push is live):
 *
 *   F-X08-002  a queued POS-outcome message older than 30 minutes is closed as
 *              superseded instead of sent when the master flag comes back;
 *   F-X08-003  a broadcast skips a customer whose account-deletion request is in
 *              flight (it can only shrink the audience);
 *   F-X08-004  the `delivered` push says "Collected" to a PICKUP customer, and
 *              delivery customers keep the copy they always had.
 *
 * The claim and pre-send RPCs are modelled as token fences only and always find
 * the event current. What the database decides about sync state is covered by
 * supabase/tests/lazywait_fencing_test.sql; what is pinned here is what the
 * HANDLER now decides itself.
 */

vi.mock('./supabaseClient.ts', () => {
  /** The fake client plus the one write it does not model: `insert`. */
  const withInsert = () => {
    const base = currentDb().client();
    return {
      ...base,
      from: (table: string) => {
        const q = base.from(table) as unknown as Record<string, unknown>;
        q.insert = async (row: Row) => {
          const rows = currentDb().rows(table);
          const dup = rows.some(
            (r) =>
              r.kind === row.kind &&
              r.order_id === row.order_id &&
              r.status === row.status &&
              row.order_id != null,
          );
          if (dup) return { error: { message: 'duplicate key' } };
          rows.push({ id: crypto.randomUUID(), attempt_count: 1, ...structuredClone(row) });
          return { error: null };
        };
        return q;
      },
    };
  };
  return {
    adminClient: () => withInsert(),
    // The caller as an AAL2 administrator: getUser resolves, is_admin is true.
    userClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
      rpc: async () => ({ data: true, error: null }),
    }),
  };
});

const SERVICE_KEY = 'sb_secret_fixture0000';
const MINUTE = 60_000;

let db: FakeDb;
let expo: Array<{ to: string; title: string; body: string }>;

beforeEach(() => {
  db = freshDb({
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: SERVICE_KEY }),
  });
  setFlag(true);
  db.rows('profiles').push({ id: 'admin-1', role: 'admin' });

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
  db.rpcs.release_pos_sync_notification = () => true;

  expo = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url) !== 'https://exp.host/--/api/v2/push/send') throw new Error(`unexpected fetch ${url}`);
      const messages = JSON.parse(String(init.body)) as { to: string; title: string; body: string }[];
      expo.push(...messages);
      return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok' })) }), { status: 200 });
    }),
  );
});

function setFlag(enabled: boolean) {
  const rows = db.rows('integration_settings');
  rows.length = 0;
  rows.push({
    provider_type: 'push',
    enabled,
    provider_name: 'expo',
    public_config: { provider: 'expo' },
    secret_config: {},
  });
}

function device(customerId: string, tag: string, over: Row = {}) {
  db.rows('push_devices').push({
    id: crypto.randomUUID(),
    customer_id: customerId,
    expo_push_token: `ExponentPushToken[${tag}]`,
    lang: 'en',
    is_active: true,
    order_updates_enabled: true,
    promos_enabled: true,
    ...over,
  });
}

function call(body: Record<string, unknown>, who: 'service' | 'admin') {
  return loadHandler('push-dispatch', () => import('../push-dispatch/index.ts')).then(async (h) => {
    const res = await h(
      new Request('https://project.example/functions/v1/push-dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(who === 'service' ? { apikey: SERVICE_KEY } : { Authorization: 'Bearer admin-jwt' }),
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json() };
  });
}

// --------------------------------------------------------------------------- F-X08-002

describe('pos_sync: a queued message that has gone stale is closed, not sent', () => {
  function seed(ageMs: number | null, posStatus = 'pos_confirmed'): { orderId: string; row: Row } {
    const orderId = crypto.randomUUID();
    const customerId = crypto.randomUUID();
    db.rows('orders').push({
      id: orderId,
      customer_id: customerId,
      status: 'delivered',
      order_type: 'pickup',
    });
    device(customerId, orderId);
    const row: Row = {
      id: crypto.randomUUID(),
      kind: 'pos_sync',
      order_id: orderId,
      status: posStatus,
      send_status: 'pending',
      claim_token: null,
    };
    if (ageMs !== null) row.created_at = new Date(Date.now() - ageMs).toISOString();
    db.rows('notification_log').push(row);
    return { orderId, row };
  }

  it('an event older than 30 minutes is superseded and nobody is messaged', async () => {
    const { orderId, row } = seed(31 * MINUTE);
    const res = await call({ action: 'pos_sync', orderId, status: 'pos_confirmed' }, 'service');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'superseded', reason: 'event too old to send' });
    expect(row.send_status).toBe('superseded');
    expect(expo).toHaveLength(0);
    // Closed before the claim: nothing past the age check ran.
    expect(db.rpcLog).toHaveLength(0);
  });

  it('an event a few minutes old is sent exactly as before', async () => {
    const { orderId, row } = seed(5 * MINUTE);
    const res = await call({ action: 'pos_sync', orderId, status: 'pos_confirmed' }, 'service');
    expect(res.body).toMatchObject({ status: 'ok', send_status: 'sent', sent: 1 });
    expect(row.send_status).toBe('sent');
    expect(expo).toHaveLength(1);
    expect(expo[0].title).toBe('Order confirmed ✅');
  });

  it('the cut-off sits just past 30 minutes', async () => {
    const inside = seed(29 * MINUTE);
    const outside = seed(31 * MINUTE, 'pos_failed');
    expect(
      (await call({ action: 'pos_sync', orderId: inside.orderId, status: 'pos_confirmed' }, 'service')).body
        .status,
    ).toBe('ok');
    expect(
      (await call({ action: 'pos_sync', orderId: outside.orderId, status: 'pos_failed' }, 'service')).body
        .status,
    ).toBe('superseded');
  });

  it('a row with no readable age is NOT treated as stale (fails open, as before)', async () => {
    const { orderId, row } = seed(null);
    const res = await call({ action: 'pos_sync', orderId, status: 'pos_confirmed' }, 'service');
    expect(res.body).toMatchObject({ status: 'ok', send_status: 'sent' });
    expect(row.send_status).toBe('sent');
  });

  it('the scenario of the finding: flag off, rows age, flag back on, nothing stale goes out', async () => {
    const stale = seed(3 * 24 * 60 * MINUTE);
    const fresh = seed(1 * MINUTE, 'pos_retrying');

    setFlag(false);
    const off = await call(
      { action: 'pos_sync', orderId: stale.orderId, status: 'pos_confirmed' },
      'service',
    );
    expect(off.body.status).toBe('disabled');
    // Disabled answers before anything is claimed: the row waits.
    expect(stale.row.send_status).toBe('pending');
    expect(expo).toHaveLength(0);

    setFlag(true);
    const a = await call({ action: 'pos_sync', orderId: stale.orderId, status: 'pos_confirmed' }, 'service');
    const b = await call({ action: 'pos_sync', orderId: fresh.orderId, status: 'pos_retrying' }, 'service');
    expect(a.body.status).toBe('superseded');
    expect(b.body.status).toBe('ok');
    expect(stale.row.send_status).toBe('superseded');
    expect(expo.map((m) => m.title)).toEqual(['Confirming your order…']);
  });

  it('never touches an event another dispatcher already holds', async () => {
    const { orderId, row } = seed(2 * 24 * 60 * MINUTE);
    row.send_status = 'processing';
    row.claim_token = 'someone-else';
    const res = await call({ action: 'pos_sync', orderId, status: 'pos_confirmed' }, 'service');
    expect(res.body.status).toBe('in_progress');
    expect(row.send_status).toBe('processing');
    expect(row.claim_token).toBe('someone-else');
    expect(expo).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------- F-X08-003

describe('broadcast: a customer who asked to be erased is not marketed to', () => {
  const BROADCAST = { action: 'broadcast', titleEn: 'T', titleAr: 'ت', bodyEn: 'B', bodyAr: 'ب' };

  it.each([
    'queued',
    'waiting_for_active_order',
    'waiting_for_financial_process',
    'processing',
    'retry_scheduled',
    'manual_review',
  ])('skips an account whose request is %s', async (status) => {
    const leaving = crypto.randomUUID();
    const staying = crypto.randomUUID();
    device(leaving, 'leaving');
    device(staying, 'staying');
    db.rows('account_deletion_requests').push({ id: crypto.randomUUID(), user_id: leaving, status });

    const res = await call(BROADCAST, 'admin');
    expect(res.body).toMatchObject({ status: 'ok', targeted: 1, sent: 1 });
    expect(expo.map((m) => m.to)).toEqual(['ExponentPushToken[staying]']);
  });

  it('a finished or failed request does not exclude anybody', async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    device(a, 'a');
    device(b, 'b');
    db.rows('account_deletion_requests').push({ id: crypto.randomUUID(), user_id: a, status: 'completed' });
    db.rows('account_deletion_requests').push({ id: crypto.randomUUID(), user_id: b, status: 'failed' });
    const res = await call(BROADCAST, 'admin');
    expect(res.body).toMatchObject({ targeted: 2, sent: 2 });
  });

  it('with no deletion requests the audience is exactly what it was', async () => {
    device(crypto.randomUUID(), 'one');
    device(crypto.randomUUID(), 'two');
    device(crypto.randomUUID(), 'off', { promos_enabled: false });
    device(crypto.randomUUID(), 'inactive', { is_active: false });
    const res = await call(BROADCAST, 'admin');
    expect(res.body).toMatchObject({ targeted: 2, sent: 2 });
  });

  it('refuses to send, rather than falling back to everyone, when the lookup fails', async () => {
    device(crypto.randomUUID(), 'one');
    // Make the deletion read fail.
    const client = currentDb().client;
    vi.spyOn(currentDb(), 'client').mockImplementation(() => {
      const real = client.call(currentDb());
      return {
        ...real,
        from: (t: string) => {
          if (t !== 'account_deletion_requests') return (real.from as (x: string) => unknown)(t);
          const failing = {
            select: () => failing,
            in: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
          };
          return failing;
        },
      } as never;
    });
    const res = await call(BROADCAST, 'admin');
    expect(res.status).toBe(500);
    expect(res.body.reason).toBe('deletion lookup failed (transient)');
    expect(expo).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------- F-X08-004

describe('order_status delivered: a pickup customer is told "Collected"', () => {
  function seedOrder(orderType: string, status: string, lang: 'en' | 'ar' = 'en'): string {
    const orderId = crypto.randomUUID();
    const customerId = crypto.randomUUID();
    db.rows('orders').push({ id: orderId, customer_id: customerId, status, order_type: orderType });
    device(customerId, orderId, { lang });
    return orderId;
  }

  it('pickup, English: a new title and the unchanged body', async () => {
    const orderId = seedOrder('pickup', 'delivered');
    await call({ action: 'order_status', orderId, status: 'delivered' }, 'service');
    expect(expo).toEqual([
      {
        to: expect.any(String),
        title: 'Collected 🎉',
        body: 'Enjoy your meal! Thanks for ordering Spicy Meal.',
        data: { type: 'order', orderId },
        sound: 'default',
        channelId: 'default',
      },
    ]);
  });

  it('pickup, Arabic: «تم الاستلام» in the title, the approved body untouched', async () => {
    const orderId = seedOrder('pickup', 'delivered', 'ar');
    await call({ action: 'order_status', orderId, status: 'delivered' }, 'service');
    expect(expo[0]).toMatchObject({
      title: 'تم الاستلام 🎉',
      body: 'بالهناء والشفاء! شكراً لطلبك من سبايسي ميل.',
    });
  });

  it("delivery keeps today's copy byte for byte, in both languages", async () => {
    const en = seedOrder('delivery', 'delivered');
    await call({ action: 'order_status', orderId: en, status: 'delivered' }, 'service');
    const ar = seedOrder('delivery', 'delivered', 'ar');
    await call({ action: 'order_status', orderId: ar, status: 'delivered' }, 'service');
    expect(expo.map((m) => [m.title, m.body])).toEqual([
      ['Delivered 🎉', 'Enjoy your meal! Thanks for ordering Spicy Meal.'],
      ['تم التوصيل 🎉', 'بالهناء والشفاء! شكراً لطلبك من سبايسي ميل.'],
    ]);
  });

  it('an order type other than pickup keeps the legacy copy', async () => {
    const orderId = seedOrder('dine_in', 'delivered');
    await call({ action: 'order_status', orderId, status: 'delivered' }, 'service');
    expect(expo[0].title).toBe('Delivered 🎉');
  });

  it('only `delivered` moved: ready and out_for_delivery are as they were for a pickup order', async () => {
    const ready = seedOrder('pickup', 'ready');
    await call({ action: 'order_status', orderId: ready, status: 'ready' }, 'service');
    const out = seedOrder('pickup', 'out_for_delivery');
    await call({ action: 'order_status', orderId: out, status: 'out_for_delivery' }, 'service');
    expect(expo.map((m) => [m.title, m.body])).toEqual([
      ['Order ready ✅', 'Your order is ready for pickup.'],
      ['On the way 🛵', 'Your order is out for delivery.'],
    ]);
  });
});

// --------------------------------------------------------------------------- F-X08-002, drain half

describe('lazywait-sync drain: only an `ok` answer counts as a dispatch', () => {
  // lazywait-sync ends in Deno.serve and imports Deno-only modules, so this is a
  // source-shape tripwire, in the idiom of pushReadyCopyWiring.test.ts. It reads
  // the function body with comments removed so the explanation cannot satisfy it.
  function drain(): string {
    const src = readFileSync(new URL('../lazywait-sync/index.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    const start = src.indexOf('async function dispatchPendingPosSync');
    return src.slice(start, src.indexOf('function safeErr', start));
  }

  it('reads the answer instead of counting every 200, which `disabled` also is', () => {
    const body = drain();
    expect(body).toContain("answer?.status === 'ok'");
    expect(body).not.toMatch(/if \(res\.ok\) out\.dispatched\+\+;/);
  });
});
