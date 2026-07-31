/**
 * Static safety assertions for the dev fixture mechanism.
 *
 * These read the fixture source files as TEXT rather than importing them, so
 * they hold even for modules that pull in React Native (which the mobile test
 * environment forbids). The point is to make "the fixture cannot reach a real
 * API, Supabase, Lazywait, a payment SDK, order creation, a POS resend, a
 * refund or an account deletion" a checked property instead of a claim in a
 * code comment.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DEV_DIR = join(__dirname);
const readRaw = (f: string) => readFileSync(join(DEV_DIR, f), 'utf8');

/**
 * Strip comments before scanning. The docblocks in these files legitimately
 * NAME the things that are forbidden ("no Supabase", "never Math.random") —
 * matching prose instead of code is how a safety check turns into noise and
 * then gets deleted.
 */
const read = (f: string) =>
  readRaw(f)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const FIXTURE_FILES = [
  'FixtureProvider.tsx',
  'fixtureData.ts',
  'fixtureGate.ts',
  'fixtureOrders.ts',
  'OrderFixtures.tsx',
];

/**
 * Anything that could reach the network, the database or money.
 *
 * The lazywait rule targets an IMPORT or a CALL, not the bare word. Three
 * `lazywait*` fields are columns on the Order model — they are the raw inputs
 * `deriveCustomerOrderState` reads, so an order fixture cannot describe a POS
 * state without naming them. Matching the bare word fired on
 * `lazywaitSyncState: 'synced'`, which is data, not a call. A check that cries
 * wolf on legitimate data is a check that gets deleted, so it is narrowed to
 * the shapes that could actually talk to the POS — and widened to cover the
 * other endpoints this surface must never reach: resend, refund, deletion.
 */
const FORBIDDEN = [
  { pattern: /from\s+['"][^'"]*services\/api['"]/, label: 'services/api' },
  { pattern: /supabase/i, label: 'supabase' },
  { pattern: /from\s+['"][^'"]*lazywait/i, label: 'a lazywait import' },
  { pattern: /lazywait[A-Za-z]*\s*\(/i, label: 'a lazywait call' },
  { pattern: /requestResend|resendToPos/i, label: 'POS resend' },
  { pattern: /accountDeletion|deleteAccount/i, label: 'account deletion' },
  { pattern: /refund[A-Za-z]*\s*\(/i, label: 'a refund call' },
  { pattern: /\bfetch\s*\(/, label: 'fetch(' },
  { pattern: /\btap\b(?!e)/i, label: 'Tap payment provider' },
  { pattern: /placeOrder|createOrder|payment-initiate|checkout-session/i, label: 'order/payment creation' },
];

describe('fixture mechanism cannot reach production systems', () => {
  it.each(FIXTURE_FILES)('%s imports nothing dangerous', (file) => {
    const src = read(file);
    for (const { pattern, label } of FORBIDDEN) {
      expect(pattern.test(src), `${file} must not reference ${label}`).toBe(false);
    }
  });

  it('every fixture mutator is a no-op', () => {
    const src = read('FixtureProvider.tsx');
    // The provider supplies handlers to the real contexts; each must be inert.
    expect(src).toMatch(/const noop = \(\) => \{\};/);
    // No handler may be anything other than `noop` or a pure lookup.
    const handlerAssignments = src.match(/^\s+(addItem|removeLine|incrementLine|decrementLine|clear|setContext|refresh|selectBranch|reload|setNotes):\s*(.+),$/gm) ?? [];
    expect(handlerAssignments.length).toBeGreaterThan(0);
    for (const line of handlerAssignments) {
      expect(line.trim()).toMatch(/:\s*noop,$/);
    }
  });

  it('the provider is itself gated on __DEV__', () => {
    // Read RAW here: the gate is code, and stripping comments would not hide it,
    // but being explicit avoids a future refactor moving it into a comment.
    expect(readRaw('FixtureProvider.tsx')).toMatch(/if \(!__DEV__\)/);
  });

  it('fixture data is deterministic — no clocks, no randomness', () => {
    for (const file of ['fixtureData.ts', 'fixtureOrders.ts']) {
      const src = read(file);
      expect(src, `${file} must be deterministic`).not.toMatch(/Date\.now|new Date\(|Math\.random/);
    }
  });

  it('every order-type scene injects noDeliveryZones', () => {
    // OrderTypeSelectScreen is the one fixture-rendered screen that CAN write
    // (`addresses.create`). With no zones injected, `resolveDeliveryBranch`
    // returns null for any pin, so `confirmNewAddress` returns at the
    // "delivery unavailable" branch before it ever reaches the create call.
    // That is what makes the write unreachable — not the review environment
    // happening to lack a Maps API key. If a scene is added without the flag,
    // this fails.
    const route = readFileSync(join(DEV_DIR, '..', 'app', 'dev-fixture.tsx'), 'utf8');
    const sceneLines = route.match(/^\s*'order-type-[a-z-]+':\s*\{[^}]*\},$/gm) ?? [];
    expect(sceneLines.length).toBeGreaterThan(0);
    for (const line of sceneLines) {
      expect(line, 'order-type scenes must inject noDeliveryZones').toMatch(/noDeliveryZones:\s*true/);
    }
  });

  it('the order fixtures render presentational components, never the screens', () => {
    // OrdersScreen and ReceiptScreen call orders.listWithItems / orders.byId on
    // mount, and requestResend is a REAL POS action. Mounting either under a
    // fixture would put a live endpoint one render away from a review session.
    const src = read('OrderFixtures.tsx');
    expect(src).not.toMatch(/OrdersScreen/);
    expect(src).not.toMatch(/ReceiptScreen/);
  });
});
