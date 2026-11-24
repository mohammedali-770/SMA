import { beforeEach, describe, expect, it, vi } from 'vitest';

import { currentDb, freshDb, loadHandler, type FakeDb, type Row } from './__fixtures__/handlerFakes.ts';

/**
 * F-X12-003 (2026-11-19 audit): the admin gate of push-dispatch
 * (`callingAdmin`) could be removed with every test green. The pure decision
 * has unit tests (adminAuth.test.ts) and two text pins exist in
 * adminAuthWiring.test.ts, but nothing called the REAL handler as someone who
 * is not an administrator. Push is live (CLAUDE.md section 7) and `broadcast`
 * cannot be recalled, so this drives the real handler over handlerFakes.ts.
 *
 * `is_admin()` is answered by the test, because in Production it is the SQL
 * predicate role AND AAL2 and the handler only ever sees its boolean. The
 * three callers that matter:
 *   - no Authorization header at all                       -> 401;
 *   - a signed-in customer (role customer, is_admin false) -> 403 forbidden;
 *   - an administrator by role without TOTP (role admin,
 *     is_admin false, i.e. AAL1)                           -> 403 mfa_required.
 *
 * Every refusal also asserts that the stubbed Expo endpoint was never called,
 * and that a device which WOULD have been messaged was left alone. The
 * positive controls use a real admin and prove the gate is not simply closed
 * to everyone; nothing real can be sent, since fetch is a stub that only
 * answers the Expo URL and the database is the in-memory fake.
 */

/** What the caller's own client answers; set per test. */
let caller: { user: { id: string } | null; isAdmin: boolean };

vi.mock('./supabaseClient.ts', () => ({
  // The fake models reads and updates; the handler's log writes are inserts.
  adminClient: () => {
    const base = currentDb().client();
    return {
      ...base,
      from: (table: string) => {
        const q = base.from(table) as unknown as Record<string, unknown>;
        q.insert = async (row: Row) => {
          currentDb()
            .rows(table)
            .push({ id: crypto.randomUUID(), attempt_count: 1, ...structuredClone(row) });
          return { error: null };
        };
        return q;
      },
    };
  },
  userClient: () => ({
    auth: { getUser: async () => ({ data: { user: caller.user } }) },
    rpc: async (name: string) =>
      name === 'is_admin'
        ? { data: caller.isAdmin, error: null }
        : { data: null, error: { message: 'unexpected rpc' } },
  }),
}));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = 'cust-1';

let db: FakeDb;
let expoCalls: Array<{ to: string }>;

beforeEach(() => {
  db = freshDb({ SUPABASE_URL: 'https://project.example' });
  db.rows('integration_settings').push({
    provider_type: 'push',
    enabled: true,
    provider_name: 'expo',
    public_config: { provider: 'expo' },
    secret_config: {},
  });
  // A customer, an administrator, and one device each that a send would reach.
  db.rows('profiles').push({ id: 'cust-1', role: 'customer' }, { id: 'admin-1', role: 'admin' });
  device(CUSTOMER_ID, 'cust');
  device('admin-1', 'admin');
  db.rows('orders').push({
    id: ORDER_ID,
    customer_id: CUSTOMER_ID,
    status: 'preparing',
    order_type: 'pickup',
  });

  expoCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url) !== 'https://exp.host/--/api/v2/push/send') throw new Error(`unexpected fetch ${url}`);
      const messages = JSON.parse(String(init.body)) as { to: string }[];
      expoCalls.push(...messages);
      return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok' })) }), { status: 200 });
    }),
  );
  caller = { user: { id: 'cust-1' }, isAdmin: false };
});

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

const BODIES: Record<string, Record<string, unknown>> = {
  broadcast: { action: 'broadcast', titleEn: 'T', titleAr: 'ع', bodyEn: 'B', bodyAr: 'ن' },
  test: { action: 'test' },
  order_status: { action: 'order_status', orderId: ORDER_ID, status: 'preparing' },
};

async function post(body: Record<string, unknown>, headers: Record<string, string>) {
  const h = await loadHandler('push-dispatch', () => import('../push-dispatch/index.ts'));
  const res = await h(
    new Request('https://project.example/functions/v1/push-dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const asUser = (action: string) => post(BODIES[action], { Authorization: 'Bearer user-jwt' });

describe.each(Object.keys(BODIES))('push-dispatch %s: the admin gate', (action) => {
  it('refuses a request with no Authorization header (401)', async () => {
    const res = await post(BODIES[action], {});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'unauthorized' });
    expect(expoCalls).toEqual([]);
  });

  it('refuses a session that resolves to no user (401)', async () => {
    caller = { user: null, isAdmin: false };
    const res = await asUser(action);
    expect(res.status).toBe(401);
    expect(expoCalls).toEqual([]);
  });

  it('refuses a signed-in customer for whom is_admin answers false (403 forbidden)', async () => {
    caller = { user: { id: 'cust-1' }, isAdmin: false };
    const res = await asUser(action);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden', code: 'forbidden' });
    expect(expoCalls).toEqual([]);
  });

  it('refuses an administrator by role who is not AAL2: is_admin answers false (403 mfa_required)', async () => {
    caller = { user: { id: 'admin-1' }, isAdmin: false };
    const res = await asUser(action);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'mfa_required' });
    expect(expoCalls).toEqual([]);
  });

  it('refuses when is_admin is true for the RPC but the profile role is not admin (403)', async () => {
    // The two halves of the decision are both required.
    caller = { user: { id: 'cust-1' }, isAdmin: true };
    const res = await asUser(action);
    expect(res.status).toBe(403);
    expect(expoCalls).toEqual([]);
  });

  it('no refusal wrote a log row or touched a device', async () => {
    await post(BODIES[action], {});
    caller = { user: { id: 'admin-1' }, isAdmin: false };
    await asUser(action);
    expect(db.rows('notification_log')).toEqual([]);
    expect(db.writes).toEqual([]);
  });
});

describe('push-dispatch: positive controls (a real AAL2 administrator passes the gate)', () => {
  beforeEach(() => {
    caller = { user: { id: 'admin-1' }, isAdmin: true };
  });

  it('broadcast reaches the opted-in devices through the stubbed Expo endpoint only', async () => {
    const res = await asUser('broadcast');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', sent: 2 });
    expect(expoCalls.map((m) => m.to).sort()).toEqual([
      'ExponentPushToken[admin]',
      'ExponentPushToken[cust]',
    ]);
  });

  it('test sends only to the administrator’s own device', async () => {
    const res = await asUser('test');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', sent: 1 });
    expect(expoCalls.map((m) => m.to)).toEqual(['ExponentPushToken[admin]']);
  });

  it('order_status announces a real transition to the order’s customer only', async () => {
    const res = await asUser('order_status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(expoCalls.map((m) => m.to)).toEqual(['ExponentPushToken[cust]']);
  });
});
