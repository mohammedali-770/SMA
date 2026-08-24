import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildCreateOrderPayload, classifyCreateOrderResult, classifyLazywaitError, computeBackoffMs,
  computePosNextAttempt, extractOrderRef, hmacSha256Hex, MAX_POS_ATTEMPTS, MAX_SYNC_ATTEMPTS,
  normalizePhone, parseRetryAfterMs, POS_DEADLINE_MINUTES, POS_RETRY_OFFSETS_MIN, round2,
  shouldResendCreateOrder, splitPhoneForPos, STALE_SYNC_TIMEOUT_MINUTES, verifyWebhookSignature,
} from './lazywait';

const items = [{ menuItemId: 'ITEM_1', name: 'Burger', quantity: 2, unitPrice: 25 }];

describe('buildCreateOrderPayload', () => {
  it('builds the confirmed pickup payload with server-trusted fields + source LWAPI', () => {
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'Ahmed', items });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual({
      client_id: 'C', branch_id: 'B', order_type: 'pickup',
      order_items: [{ menu_item_id: 'ITEM_1', name: 'Burger', quantity: 2, price: 25 }],
      customer_name: 'Ahmed', source: 'LWAPI',
    });
    // With no optional data supplied, NOTHING optional is invented. (price_id,
    // addons, customer_cell/customer_id ARE confirmed as of 2026-08-24 and are
    // sent when we hold them — see the contract-fields suite below.)
    expect(JSON.stringify(r.payload)).not.toMatch(/price_id|addon|delivery|customer_cell|customer_id/i);
  });

  it('BLOCKS delivery orders (schema unconfirmed)', () => {
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'delivery', customerName: 'A', items });
    expect(r).toEqual({ ok: false, blockedReason: 'delivery_schema_unconfirmed' });
  });

  it('BLOCKS when branch mapping is missing', () => {
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: null, orderType: 'pickup', customerName: 'A', items });
    expect(r).toEqual({ ok: false, blockedReason: 'missing_branch_mapping' });
  });

  it('BLOCKS when any item is missing its lazywait_item_id', () => {
    const bad = [{ menuItemId: null, name: 'X', quantity: 1, unitPrice: 5 }];
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items: bad });
    expect(r).toEqual({ ok: false, blockedReason: 'missing_item_mapping' });
  });

  it('BLOCKS an empty cart and rounds prices to 2dp', () => {
    expect(buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items: [] }))
      .toEqual({ ok: false, blockedReason: 'no_items' });
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{ menuItemId: 'I', name: 'N', quantity: 1, unitPrice: 25.005 }] });
    expect(r.ok && (r.payload.order_items as { price: number }[])[0].price).toBe(25.01);
  });
});

// ---------------------------------------------------------------------------
// The CONFIRMED contract body (owner-supplied Lazywait document, 2026-08-24).
// This is the live customer-order path: the lazywait-sync worker calls
// buildCreateOrderPayload directly, so these assertions pin what a real POS
// ticket receives.
// ---------------------------------------------------------------------------
describe('buildCreateOrderPayload — confirmed 2026-08-24 contract fields', () => {
  const richItems = [{
    menuItemId: 'ITEM_1',
    name: 'Burger',
    names: { en: 'Burger', ar: 'برجر' },
    menuCategoryId: 'CAT_MAIN',
    priceId: 'PRICE_1',
    quantity: 1,
    unitPrice: 25,
    details: 'No onions',
    addons: [{
      addonId: 'AD_CHEESE',
      name: 'Extra Cheese',
      names: { en: 'Extra Cheese', ar: 'جبنة إضافية' },
    }],
  }];

  it('builds the EXACT pickup payload — names, category, price_id, details, addons', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'Ahmed',
      items: richItems,
      customerId: 'CRM_9',
      customerPhone: '0541234567',
      orderDetails: 'Ring the bell',
      isPaid: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual({
      client_id: 'C',
      branch_id: 'B',
      order_type: 'pickup',
      order_items: [{
        menu_item_id: 'ITEM_1',
        // `name` is kept ALONGSIDE `names` on purpose — see buildConfirmedOrderItem.
        name: 'Burger',
        names: { en: 'Burger', ar: 'برجر' },
        menu_category_id: 'CAT_MAIN',
        price_id: 'PRICE_1',
        quantity: 1,
        price: 25,
        details: 'No onions',
        addons: [{
          addon_id: 'AD_CHEESE',
          name: 'Extra Cheese',
          names: { en: 'Extra Cheese', ar: 'جبنة إضافية' },
          quantity: 1,
          // 0: the add-on's cost is already inside the item price.
          price: 0,
        }],
      }],
      customer_name: 'Ahmed',
      source: 'LWAPI',
      customer_id: 'CRM_9',
      customer_cell: '541234567',
      country_code: '+966',
      order_details: 'Ring the bell',
      is_paid: true,
    });
  });

  it('keeps `name` as well as `names` (API tolerates undocumented fields)', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items: richItems,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = (r.payload.order_items as Array<Record<string, unknown>>)[0];
    expect(line.name).toBe('Burger');
    expect(line.names).toEqual({ en: 'Burger', ar: 'برجر' });
  });

  // ---- per-item note -> details -------------------------------------------
  it('an item WITH a note emits `details`; one WITHOUT emits NO `details` key', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [
        { menuItemId: 'I1', name: 'A', quantity: 1, unitPrice: 5, details: 'No onions' },
        { menuItemId: 'I2', name: 'B', quantity: 1, unitPrice: 5 },
        { menuItemId: 'I3', name: 'C', quantity: 1, unitPrice: 5, details: '   ' },
        { menuItemId: 'I4', name: 'D', quantity: 1, unitPrice: 5, details: null },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = r.payload.order_items as Array<Record<string, unknown>>;
    expect(lines[0].details).toBe('No onions');
    // PINNED: absent key, not null and not ''. A whitespace-only or null note is
    // the same as no note.
    expect('details' in lines[1]).toBe(false);
    expect('details' in lines[2]).toBe(false);
    expect('details' in lines[3]).toBe(false);
  });

  it('order-level note maps to `order_details` (there is no delivery_notes field)', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items,
      orderDetails: 'Extra napkins',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.order_details).toBe('Extra napkins');
    expect(JSON.stringify(r.payload)).not.toMatch(/delivery_notes/);
  });

  it('omits order_details when the order has no note', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items, orderDetails: '  ',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('order_details' in r.payload).toBe(false);
  });

  // ---- add-ons -------------------------------------------------------------
  it('modifiers become addons[] carrying addon_id from the mapping', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{
        menuItemId: 'I1', name: 'A', quantity: 1, unitPrice: 5,
        addons: [
          { addonId: 'AD_1', name: 'Cheese' },
          { addonId: 'AD_2', name: 'Bacon', quantity: 2 },
        ],
      }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = (r.payload.order_items as Array<Record<string, unknown>>)[0];
    expect(line.addons).toEqual([
      { addon_id: 'AD_1', name: 'Cheese', quantity: 1, price: 0 },
      { addon_id: 'AD_2', name: 'Bacon', quantity: 2, price: 0 },
    ]);
  });

  it('add-on price is ALWAYS 0 — the item price already includes it', () => {
    // place_order folds modifier prices into order_items.unit_price
    // (v_unit_price := v_unit_price + v_modifier.price), and unit_price is what
    // we send as `price`. Echoing the add-on's own price would let a POS that
    // sums item + add-ons charge it twice. A 27.00 "Volcano (+2)" burger must
    // reach the POS as 27.00 + a 0-priced add-on line, never 27.00 + 2.00.
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{
        menuItemId: 'I1', name: 'Burger', quantity: 1, unitPrice: 27,
        addons: [{ addonId: 'AD_VOLCANO', name: 'Volcano (+2)' }],
      }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = (r.payload.order_items as Array<Record<string, unknown>>)[0];
    expect(line.price).toBe(27);
    const addons = line.addons as Array<Record<string, unknown>>;
    expect(addons[0].price).toBe(0);
    // The whole ticket's money is the item price alone.
    expect(Number(line.price) + Number(addons[0].price)).toBe(27);
  });

  it('an UNMAPPED modifier BLOCKS the order — never a silent drop', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{
        menuItemId: 'I1', name: 'A', quantity: 1, unitPrice: 5,
        // The worker maps a modifier with no lazywait_addon_id to addonId ''.
        addons: [{ addonId: 'AD_1', name: 'Cheese' }, { addonId: '', name: 'Unmapped' }],
      }],
    });
    // A ticket that silently lost "Unmapped" is a ticket the kitchen cooks wrong.
    expect(r).toEqual({ ok: false, blockedReason: 'missing_addon_mapping' });
  });

  it('never emits addons_group_id on an order (that is a CATALOG field)', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items: richItems,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.payload)).not.toMatch(/addons_group_id/);
  });

  // ---- phone: split, NOT E.164 --------------------------------------------
  it('customer_cell is the LOCAL subscriber number and country_code is separate', () => {
    for (const input of ['0541234567', '+966541234567', '966541234567', '541234567']) {
      const r = buildCreateOrderPayload({
        clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items,
        customerPhone: input,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.payload.customer_cell).toBe('541234567');
      expect(r.payload.country_code).toBe('+966');
      // The contract does NOT take E.164 in customer_cell.
      expect(String(r.payload.customer_cell)).not.toMatch(/^\+/);
      expect(String(r.payload.customer_cell)).not.toContain('966');
    }
  });

  it('omits BOTH phone fields when the number cannot be split confidently', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items,
      customerPhone: '+14155550123',   // out of market: no dialling plan to split on
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('customer_cell' in r.payload).toBe(false);
    expect('country_code' in r.payload).toBe(false);
  });

  // ---- money / totals ------------------------------------------------------
  it('sends NO order-level money or totals fields (inclusive-vs-exclusive open)', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items: richItems,
      isPaid: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of ['subtotal', 'discount', 'tax', 'tax_percentage', 'taxes_charges',
                     'tip', 'tip_percentage', 'total', 'order_delivery_fee']) {
      expect(k in r.payload).toBe(false);
    }
    // is_paid is a state flag, not an amount — it IS confirmed and IS sent.
    expect(r.payload.is_paid).toBe(false);
  });

  it('never emits the server-owned identity fields', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items: richItems,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.payload)).not.toMatch(/order_ref|order_id|order_number|order_date/);
  });

  // ---- the gate that must NOT move ----------------------------------------
  it('DELIVERY is still blocked — the gate is provably untouched', () => {
    expect(buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'delivery', customerName: 'A', items: richItems,
      customerId: 'CRM_9', customerPhone: '0541234567', orderDetails: 'x', isPaid: true,
    })).toEqual({ ok: false, blockedReason: 'delivery_schema_unconfirmed' });
  });
});

describe('splitPhoneForPos', () => {
  it('splits KSA numbers in every stored form', () => {
    expect(splitPhoneForPos('0541234567')).toEqual({ countryCode: '+966', subscriber: '541234567' });
    expect(splitPhoneForPos('+966541234567')).toEqual({ countryCode: '+966', subscriber: '541234567' });
    expect(splitPhoneForPos('00966541234567')).toEqual({ countryCode: '+966', subscriber: '541234567' });
    expect(splitPhoneForPos('054 123 4567')).toEqual({ countryCode: '+966', subscriber: '541234567' });
  });

  it('returns null rather than guessing a split it cannot justify', () => {
    expect(splitPhoneForPos(null)).toBeNull();
    expect(splitPhoneForPos('')).toBeNull();
    expect(splitPhoneForPos('+14155550123')).toBeNull();   // non-KSA dialling code
    expect(splitPhoneForPos('+9661')).toBeNull();          // too short to be real
  });
});

describe('classifyLazywaitError', () => {
  it('classifies terminal vs retryable per the confirmed error codes', () => {
    expect(classifyLazywaitError(200).kind).toBe('ok');
    expect(classifyLazywaitError(429).kind).toBe('retryable');   // rate limit
    expect(classifyLazywaitError(0).kind).toBe('retryable');     // network/timeout
    expect(classifyLazywaitError(503).kind).toBe('retryable');   // 5xx
    expect(classifyLazywaitError(401).kind).toBe('terminal');    // INVALID_KEY
    expect(classifyLazywaitError(401).reason).toBe('auth_invalid_key');
    expect(classifyLazywaitError(403, 'LICENSE_EXPIRED').reason).toBe('license_expired');
    expect(classifyLazywaitError(400).kind).toBe('terminal');    // bad payload/mapping
  });
});

describe('verifyWebhookSignature (HMAC-SHA256 hex)', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ order: { order_ref: 'r1', order_status_id: 'new-order' } });

  it('matches an independent Node HMAC reference and accepts it', async () => {
    const ref = createHmac('sha256', secret).update(body).digest('hex');
    expect(await hmacSha256Hex(body, secret)).toBe(ref); // Web Crypto == node crypto
    expect(await verifyWebhookSignature([body], ref, secret)).toBe(true);
  });

  it('rejects a tampered signature and a missing signature', async () => {
    const bad = createHmac('sha256', 'wrong').update(body).digest('hex');
    expect(await verifyWebhookSignature([body], bad, secret)).toBe(false);
    expect(await verifyWebhookSignature([body], null, secret)).toBe(false);
    expect(await verifyWebhookSignature([body], 'abc', '')).toBe(false); // no secret
  });
});

describe('computeBackoffMs', () => {
  it('is exponential (30s,60s,120s…), capped at 1h; jitter injectable', () => {
    const noJitter = () => 0.5; // -> jitter factor 1.0
    expect(computeBackoffMs(1, noJitter)).toBe(30_000);
    expect(computeBackoffMs(2, noJitter)).toBe(60_000);
    expect(computeBackoffMs(3, noJitter)).toBe(120_000);
    expect(computeBackoffMs(MAX_SYNC_ATTEMPTS, noJitter)).toBeLessThanOrEqual(3_600_000);
  });
});

describe('normalizePhone (KSA E.164)', () => {
  it('normalizes common KSA formats', () => {
    expect(normalizePhone('0501234567')).toBe('+966501234567');
    expect(normalizePhone('+966501234567')).toBe('+966501234567');
    expect(normalizePhone('966501234567')).toBe('+966501234567');
    expect(normalizePhone('501234567')).toBe('+966501234567');
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('round2', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(25.005)).toBe(25.01);
    expect(round2(25)).toBe(25);
  });
});

describe('shouldResendCreateOrder (duplicate-send guard)', () => {
  it('NEVER re-sends Create Order once a Lazywait ref exists', () => {
    expect(shouldResendCreateOrder({ lazywait_ref: 'ORDER_REF_1' })).toBe(false);
  });
  it('allows the first send when no ref is stored yet', () => {
    expect(shouldResendCreateOrder({ lazywait_ref: null })).toBe(true);
    expect(shouldResendCreateOrder({ lazywait_ref: '' })).toBe(true);
    expect(shouldResendCreateOrder({})).toBe(true);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds, keeping a valid 0 (retry now)', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
    expect(parseRetryAfterMs('0')).toBe(0);              // must NOT become null
  });
  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-07-08T00:00:00Z');
    expect(parseRetryAfterMs('Wed, 08 Jul 2026 00:00:30 GMT', now)).toBe(30_000);
    // A past date clamps to 0 rather than going negative.
    expect(parseRetryAfterMs('Wed, 08 Jul 2026 00:00:00 GMT', now + 5_000)).toBe(0);
  });
  it('returns null for absent/blank/garbage values (falls back to backoff)', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
  });
});

describe('STALE_SYNC_TIMEOUT_MINUTES', () => {
  it('is a safe 5–10 min lease window, longer than the worker network budget', () => {
    expect(STALE_SYNC_TIMEOUT_MINUTES).toBeGreaterThanOrEqual(5);
    expect(STALE_SYNC_TIMEOUT_MINUTES).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Customer-confirmation lifecycle helpers
// ---------------------------------------------------------------------------
describe('extractOrderRef', () => {
  it('returns a trimmed non-empty order_ref, else null', () => {
    expect(extractOrderRef({ order: { order_ref: 'REF_1' } })).toBe('REF_1');
    expect(extractOrderRef({ order: { order_ref: '  REF_2 ' } })).toBe('REF_2');
    expect(extractOrderRef({ order: { order_ref: '' } })).toBeNull();
    expect(extractOrderRef({ order: { order_ref: null } })).toBeNull();
    expect(extractOrderRef({ order: {} })).toBeNull();
    expect(extractOrderRef({})).toBeNull();
    expect(extractOrderRef(null)).toBeNull();
    expect(extractOrderRef('nonsense')).toBeNull();
  });
});

describe('classifyCreateOrderResult (customer-confirmation safety)', () => {
  it('OK only for 2xx + success:true + a usable order_ref', () => {
    const r = classifyCreateOrderResult({ status: 200, data: { success: true, order: { order_ref: 'R1' } } });
    expect(r.kind).toBe('ok');
    expect(r.orderRef).toBe('R1');
  });
  it('2xx + success:true but NO ref is AMBIGUOUS (missing_ref) — never resent', () => {
    const r = classifyCreateOrderResult({ status: 200, data: { success: true, order: {} } });
    expect(r.kind).toBe('ambiguous');
    expect(r.confirmationReason).toBe('missing_ref');
    expect(r.orderRef).toBeNull();
  });
  it('2xx without success/ref is AMBIGUOUS (ambiguous_response)', () => {
    const r = classifyCreateOrderResult({ status: 200, data: { foo: 'bar' } });
    expect(r.kind).toBe('ambiguous');
    expect(r.confirmationReason).toBe('ambiguous_response');
  });
  it('429 is the ONLY safe_retry (explicit not-processed)', () => {
    expect(classifyCreateOrderResult({ status: 429 }).kind).toBe('safe_retry');
  });
  it('status 0 timeout vs network map to distinct ambiguous reasons', () => {
    expect(classifyCreateOrderResult({ status: 0, error: 'timeout' }).confirmationReason).toBe('timeout');
    expect(classifyCreateOrderResult({ status: 0, error: 'connection reset' }).confirmationReason).toBe('connection');
    expect(classifyCreateOrderResult({ status: 0, error: 'timeout' }).kind).toBe('ambiguous');
  });
  it('5xx is AMBIGUOUS (provider_5xx) — the POS may have created it', () => {
    const r = classifyCreateOrderResult({ status: 503 });
    expect(r.kind).toBe('ambiguous');
    expect(r.confirmationReason).toBe('provider_5xx');
  });
  it('401/403/other-4xx are TERMINAL known failures (never confirmation_required)', () => {
    expect(classifyCreateOrderResult({ status: 401 }).kind).toBe('terminal');
    expect(classifyCreateOrderResult({ status: 403 }).kind).toBe('terminal');
    expect(classifyCreateOrderResult({ status: 400 }).kind).toBe('terminal');
    expect(classifyCreateOrderResult({ status: 422 }).kind).toBe('terminal');
  });
});

describe('computePosNextAttempt (5 attempts / 10-minute deadline)', () => {
  const t0 = Date.parse('2026-07-20T00:00:00.000Z');
  const deadline = t0 + POS_DEADLINE_MINUTES * 60_000;

  it('exposes the fixed schedule contract', () => {
    expect(MAX_POS_ATTEMPTS).toBe(5);
    expect(POS_DEADLINE_MINUTES).toBe(10);
    expect([...POS_RETRY_OFFSETS_MIN]).toEqual([0, 1, 3, 6, 9]);
  });
  it('schedules attempt N+1 at started + offset[N] within the window', () => {
    expect(computePosNextAttempt(t0, 1, deadline)).toEqual({ final: false, nextAttemptAtMs: t0 + 1 * 60_000 });
    expect(computePosNextAttempt(t0, 2, deadline)).toEqual({ final: false, nextAttemptAtMs: t0 + 3 * 60_000 });
    expect(computePosNextAttempt(t0, 3, deadline)).toEqual({ final: false, nextAttemptAtMs: t0 + 6 * 60_000 });
    expect(computePosNextAttempt(t0, 4, deadline)).toEqual({ final: false, nextAttemptAtMs: t0 + 9 * 60_000 });
  });
  it('is FINAL once the attempt ceiling is hit', () => {
    expect(computePosNextAttempt(t0, 5, deadline)).toEqual({ final: true });
    expect(computePosNextAttempt(t0, 6, deadline)).toEqual({ final: true });
  });
  it('is FINAL when the next scheduled attempt would fall past the deadline', () => {
    const tightDeadline = t0 + 2 * 60_000; // only room for +1min
    expect(computePosNextAttempt(t0, 1, tightDeadline)).toEqual({ final: false, nextAttemptAtMs: t0 + 60_000 });
    expect(computePosNextAttempt(t0, 2, tightDeadline)).toEqual({ final: true }); // +3min > deadline
  });
  it('with no deadline, only the attempt ceiling bounds it', () => {
    expect(computePosNextAttempt(t0, 4, null)).toEqual({ final: false, nextAttemptAtMs: t0 + 9 * 60_000 });
    expect(computePosNextAttempt(t0, 5, null)).toEqual({ final: true });
  });
});
