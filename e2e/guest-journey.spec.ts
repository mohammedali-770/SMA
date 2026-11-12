/**
 * The signed-out customer journey on the BUILT web app, end to end.
 *
 * WHY THIS EXISTS. On 2026-11-11 the Expo SDK 58 upgrade (#430) shipped a guest
 * regression no unit or wiring test could see: a direct visit to /app/orders sent
 * the customer's orders query with no session, the server refused it, and the
 * screen reported the refusal to Sentry, on every visit. It was found by
 * watching production and fixed in #432. This spec fails on that regression, and
 * on a deploy that serves the wrong shell for a deep link (the `/app/(.*)`
 * rewrite in vercel.json).
 *
 * WHAT IT RUNS AGAINST. `dist/` from `npm run build`, served by
 * e2e/serve-dist.mjs with vercel.json's headers and rewrites. The bundle is the
 * production build, so it is wired to the production Supabase project and the
 * production Sentry DSN. Nothing reaches either: every request is answered or
 * aborted here, and every name other than the app's resolves to nothing.
 *
 *   - Supabase reads are answered from e2e/fixtures/guest-catalog.json, rows of
 *     supabase/seed.sql exported AS `anon` (export-guest-catalog.sql), so RLS
 *     and column grants chose them.
 *   - `orders` is answered the way production answers a guest: 401 with
 *     42501 "permission denied for table orders". A read of it also fails the
 *     test, because a guest screen has no business asking.
 *   - Any other write, any Edge Function call, any Sentry error event and any
 *     uncaught page error fails the test. Each is aborted, never forwarded.
 *   - A read of a table the fixture does not hold fails too. Answering it with
 *     [] would let the app's reads drift away from what is modelled here.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const REPO = new URL('../', import.meta.url);
const FIXTURE = JSON.parse(readFileSync(new URL('e2e/fixtures/guest-catalog.json', REPO), 'utf8')) as Record<
  string,
  unknown
>;
// The seed leaves WhatsApp sign-in off, and the sign-in screen then shows only
// "not available right now". Production has it on, and the journey is meant to
// reach the real sign-in form, so this one answer is overridden on purpose.
const RPC = { ...(FIXTURE.rpc as Record<string, unknown>), whatsapp_login_enabled: true };

const BRANCH = 'Riyadh - Olaya';
const ITEM = 'Spicy Fries'; // no modifier group, so its card adds it directly
const GUEST_ORDERS_CARD = 'Your orders live in your account';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
};

interface Seen {
  reads: Record<string, number>;
  unmodelledReads: string[];
  writes: string[];
  functions: string[];
  sentryEvents: string[];
  aborted: Set<string>;
  pageErrors: string[];
}

async function isolateNetwork(context: BrowserContext, appHost: string): Promise<Seen> {
  const seen: Seen = {
    reads: {},
    unmodelledReads: [],
    writes: [],
    functions: [],
    sentryEvents: [],
    aborted: new Set(),
    pageErrors: [],
  };

  await context.routeWebSocket(/.*/, (ws) => {
    seen.aborted.add(`websocket ${new URL(ws.url()).hostname}`);
    void ws.close();
  });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.hostname === appHost) return route.continue();

    if (/(^|\.)sentry\.io$/.test(url.hostname)) {
      // An envelope's item header says what it carries; "event" is an error.
      const body = request.postData() ?? '';
      if (/"type"\s*:\s*"event"/.test(body))
        seen.sentryEvents.push(body.split('\n').slice(2, 3).join('').slice(0, 300));
      return route.abort();
    }

    if (url.hostname.endsWith('.supabase.co')) {
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      if (url.pathname.startsWith('/functions/')) {
        seen.functions.push(`${method} ${url.pathname}`);
        return route.abort();
      }
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if (rpc && method === 'POST' && Object.prototype.hasOwnProperty.call(RPC, rpc[1])) {
        seen.reads[`rpc/${rpc[1]}`] = (seen.reads[`rpc/${rpc[1]}`] ?? 0) + 1;
        return route.fulfill({
          status: 200,
          headers: CORS,
          contentType: 'application/json',
          json: RPC[rpc[1]],
        });
      }
      if (method !== 'GET' && method !== 'HEAD') {
        seen.writes.push(`${method} ${url.pathname}`);
        return route.abort();
      }
      const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
      const key = table ?? url.pathname;
      seen.reads[key] = (seen.reads[key] ?? 0) + 1;
      if (table === 'orders') {
        return route.fulfill({
          status: 401,
          headers: CORS,
          contentType: 'application/json',
          json: { code: '42501', message: 'permission denied for table orders', details: null, hint: null },
        });
      }
      if (!table || table === 'rpc' || !Array.isArray(FIXTURE[table])) {
        seen.unmodelledReads.push(`${method} ${url.pathname}`);
        return route.abort();
      }
      const rows = FIXTURE[table] as unknown[];
      const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        json: single ? (rows[0] ?? null) : rows,
      });
    }

    // Fonts, maps and anything else third-party: not part of this journey.
    seen.aborted.add(url.hostname);
    return route.abort();
  });

  return seen;
}

const visible = (page: Page, text: string) =>
  page.getByText(text, { exact: true }).filter({ visible: true }).first();

test('the fixture holds rows of supabase/seed.sql', () => {
  const seed = readFileSync(new URL('supabase/seed.sql', REPO), 'utf8');
  let checked = 0;
  for (const [table, rows] of Object.entries(FIXTURE)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Array<Record<string, unknown>>) {
      for (const column of ['id', 'name_en', 'product_id', 'group_id']) {
        if (typeof row[column] !== 'string') continue;
        expect(seed, `${table}.${column} ${String(row[column])} is not a seed.sql value`).toContain(
          String(row[column]),
        );
        checked += 1;
      }
    }
  }
  expect(checked).toBeGreaterThan(20);
  expect(FIXTURE).not.toHaveProperty('orders');
});

test('a guest browses, fills a cart and reaches sign-in without one write or error', async ({
  page,
  context,
  baseURL,
}) => {
  const appHost = new URL(baseURL ?? '').hostname;
  const seen = await isolateNetwork(context, appHost);
  page.on('pageerror', (error) => seen.pageErrors.push(String(error.message).slice(0, 200)));

  await test.step('open /app: the order-type gate', async () => {
    await page.goto('/app');
    await expect(visible(page, 'Pickup')).toBeVisible();
  });

  await test.step('choose Pickup, then a branch: the menu lists the fixture item', async () => {
    await visible(page, 'Pickup').click();
    await visible(page, BRANCH).click();
    await expect(visible(page, ITEM)).toBeVisible();
  });

  await test.step('add the item from its card, open the cart', async () => {
    await visible(page, 'Add').click();
    await visible(page, 'My Cart').click();
    await expect(visible(page, ITEM)).toBeVisible();
    await expect(visible(page, 'Go to Checkout')).toBeVisible();
  });

  await test.step('checkout as a guest asks for sign-in, and sends no code', async () => {
    await visible(page, 'Go to Checkout').click();
    await expect(visible(page, 'Not now — keep browsing')).toBeVisible();
    await expect(page.locator('input').filter({ visible: true }).first()).toBeVisible();
    await visible(page, 'Not now — keep browsing').click();
    await expect(visible(page, 'Go to Checkout')).toBeVisible();
  });

  await test.step('the Orders tab shows a guest the sign-in card', async () => {
    await page.locator('[aria-label="Back"]').filter({ visible: true }).first().click();
    await visible(page, 'My Orders').click();
    await expect(visible(page, GUEST_ORDERS_CARD)).toBeVisible();
  });

  await test.step('a direct load of /app/orders gets the app shell and the same card', async () => {
    const response = await page.goto('/app/orders');
    const shell = readFileSync(new URL('dist/app/index.html', REPO), 'utf8');
    expect(response?.status(), '/app/orders status').toBe(200);
    expect(await response?.text(), '/app/orders must be served dist/app/index.html').toBe(shell);
    await expect(visible(page, GUEST_ORDERS_CARD)).toBeVisible();
  });

  await test.step('nothing wrote, called a function, read orders, reported an error or threw', async () => {
    // Late requests (a focus effect, an error report) land after the card renders.
    await page.waitForTimeout(1_000);
    test
      .info()
      .annotations.push(
        { type: 'reads', description: JSON.stringify(seen.reads) },
        { type: 'aborted', description: [...seen.aborted].sort().join(', ') || 'none' },
      );
    expect(seen.writes, 'writes attempted').toEqual([]);
    expect(seen.functions, 'Edge Functions called').toEqual([]);
    expect(seen.reads.orders ?? 0, 'guest reads of orders (refused by RLS in production)').toBe(0);
    expect(
      seen.unmodelledReads,
      'reads the fixture does not model (add them to export-guest-catalog.sql)',
    ).toEqual([]);
    expect(seen.sentryEvents, 'Sentry error events').toEqual([]);
    expect(seen.pageErrors, 'uncaught page errors').toEqual([]);
  });
});
