import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildCreateOrderPayload, classifyCreateOrderResult, classifyLazywaitError, composeItemDetails,
  computeBackoffMs, computePosNextAttempt, extractOrderRef, hmacSha256Hex, MAX_POS_ATTEMPTS, MAX_SYNC_ATTEMPTS,
  normalizePhone, parseRetryAfterMs, POS_DEADLINE_MINUTES, POS_RETRY_OFFSETS_MIN, round2,
  mapOrderItemRows, ORDER_ITEM_SELECT, shouldResendCreateOrder, splitPhoneForPos,
  STALE_SYNC_TIMEOUT_MINUTES, verifyWebhookSignature,
} from './lazywait';

const items = [{ menuItemId: 'ITEM_1', name: 'Burger', quantity: 2, unitPrice: 25 }];

describe('buildCreateOrderPayload — confirmed contract (owner-supplied 2026-08-24)', () => {
  it('builds the confirmed pickup payload with server-trusted fields + source LWAPI', () => {
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'Ahmed', items });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual({
      client_id: 'C', branch_id: 'B', order_type: 'pickup',
      order_items: [{
        menu_item_id: 'ITEM_1', name: 'Burger', names: { en: 'Burger' }, quantity: 2, price: 25,
      }],
      customer_name: 'Ahmed', source: 'LWAPI',
    });
    // Nothing the contract does not carry, and no totals (see the Q9 note).
    expect(JSON.stringify(r.payload))
      .not.toMatch(/delivery|latitude|longitude|subtotal|tax|total|is_paid/i);
  });

  it('builds the FULL confirmed pickup body — names, details, price_id, menu_category_id, addons, phone split', () => {
    const r = buildCreateOrderPayload({
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'Ahmed',
      orderDetails: '  Ring the bell twice  ',
      customerId: 'CRM_42',
      customerPhone: '0541234567',
      items: [{
        menuItemId: 'IT_BURGER', name: 'Beef Burger', nameAr: 'برجر لحم',
        quantity: 2, unitPrice: 30, menuCategoryId: 'CAT_MAIN', priceId: 'PR_SINGLE',
        note: 'No onions',
        addons: [{ addonId: 'AD_CHEESE', nameEn: 'Extra Cheese', nameAr: 'جبن إضافي', price: 5 }],
      }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual({
      client_id: 'CID_1',
      branch_id: 'BR_RUH',
      order_type: 'pickup',
      order_items: [{
        menu_item_id: 'IT_BURGER',
        name: 'Beef Burger',
        names: { en: 'Beef Burger', ar: 'برجر لحم' },
        quantity: 2,
        // 30 (modifier-inclusive unit price) − 5 (the add-on) = the bare item price.
        price: 25,
        menu_category_id: 'CAT_MAIN',
        price_id: 'PR_SINGLE',
        details: 'No onions',
        addons: [{
          addon_id: 'AD_CHEESE',
          name: 'Extra Cheese',
          names: { en: 'Extra Cheese', ar: 'جبن إضافي' },
          quantity: 1,
          price: 5,
        }],
      }],
      customer_name: 'Ahmed',
      source: 'LWAPI',
      order_details: 'Ring the bell twice',
      customer_id: 'CRM_42',
      customer_cell: '541234567',
      country_code: '+966',
    });
  });

  it('keeps `name` ALONGSIDE `names` — undocumented but Production-proven, so it is not dropped', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{ menuItemId: 'I', name: 'Fries', nameAr: 'بطاطس', quantity: 1, unitPrice: 10 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = (r.payload.order_items as Record<string, unknown>[])[0];
    expect(item.name).toBe('Fries');
    expect(item.names).toEqual({ en: 'Fries', ar: 'بطاطس' });
  });

  it('emits `details` for an item WITH a note and OMITS the key entirely for one without', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [
        { menuItemId: 'I1', name: 'Burger', quantity: 1, unitPrice: 25, note: 'No onions' },
        { menuItemId: 'I2', name: 'Cola', quantity: 1, unitPrice: 5 },
        { menuItemId: 'I3', name: 'Salad', quantity: 1, unitPrice: 12, note: '   ' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [withNote, without, blank] = r.payload.order_items as Record<string, unknown>[];
    expect(withNote.details).toBe('No onions');
    // Pinned: the key is ABSENT, not present-and-null.
    expect('details' in without).toBe(false);
    expect('details' in blank).toBe(false);
  });

  it('still OMITS `details` when there is neither a note nor an unmapped modifier', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [
        { menuItemId: 'I1', name: 'Cola', quantity: 1, unitPrice: 5 },
        {
          menuItemId: 'I2', name: 'Burger', quantity: 1, unitPrice: 30,
          addons: [{ addonId: 'AD_CHEESE', nameEn: 'Extra Cheese', price: 5 }],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [plain, allMapped] = r.payload.order_items as Record<string, unknown>[];
    expect('details' in plain).toBe(false);
    // A fully MAPPED add-on is untouched by the fold: addons[] carries it and
    // `details` never appears.
    expect('details' in allMapped).toBe(false);
    expect(allMapped.price).toBe(25);
  });

  it('composeItemDetails composes the note and the unmapped choices, or returns null', () => {
    expect(composeItemDetails(null, [])).toBeNull();
    expect(composeItemDetails('  ', [])).toBeNull();
    expect(composeItemDetails('  ', [{ addonId: null, nameEn: '  ', nameAr: '  ' }])).toBeNull();
    expect(composeItemDetails('No onions', [])).toBe('No onions');
    expect(composeItemDetails(null, [{ addonId: null, nameEn: 'Hot' }])).toBe('Hot');
    // Arabic-only modifier falls back to names.ar rather than printing nothing.
    expect(composeItemDetails(null, [{ addonId: null, nameEn: '', nameAr: 'حار' }])).toBe('حار');
    // Quantity is appended only above 1, and a missing or <1 quantity means 1.
    expect(composeItemDetails(null, [{ addonId: null, nameEn: 'Hot', quantity: 1 }])).toBe('Hot');
    expect(composeItemDetails(null, [{ addonId: null, nameEn: 'Hot', quantity: 0 }])).toBe('Hot');
    expect(composeItemDetails(null, [{ addonId: null, nameEn: 'Hot', quantity: 3 }])).toBe('Hot ×3');
    expect(composeItemDetails('No onions', [
      { addonId: null, nameEn: 'Volcano' },
      { addonId: null, nameEn: 'Extra Hot', quantity: 2 },
    ])).toBe('Volcano, Extra Hot ×2 — No onions');
  });

  it('sends the order-level note as `order_details` and omits it when there is none', () => {
    const base = { clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items } as const;
    const withNote = buildCreateOrderPayload({ ...base, orderDetails: 'Extra napkins' });
    expect(withNote.ok && withNote.payload.order_details).toBe('Extra napkins');
    const without = buildCreateOrderPayload({ ...base, orderDetails: '  ' });
    expect(without.ok && 'order_details' in without.payload).toBe(false);
  });

  it('splits the phone: customer_cell is the LOCAL number and country_code is separate — never E.164', () => {
    for (const stored of ['0541234567', '+966541234567', '966541234567', '054 123 4567']) {
      const r = buildCreateOrderPayload({
        clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items,
        customerPhone: stored,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.payload.customer_cell).toBe('541234567');
      expect(r.payload.country_code).toBe('+966');
      expect(String(r.payload.customer_cell)).not.toMatch(/^\+/);
      expect(String(r.payload.customer_cell)).not.toContain('966');
    }
  });

  it('sends NEITHER phone field for a non-Saudi or unusable number rather than guessing the split', () => {
    for (const stored of ['+14155550123', '', null, 'not-a-phone']) {
      const r = buildCreateOrderPayload({
        clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items,
        customerPhone: stored,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect('customer_cell' in r.payload).toBe(false);
      expect('country_code' in r.payload).toBe(false);
    }
    expect(splitPhoneForPos('+14155550123')).toBeNull();
    expect(splitPhoneForPos('0541234567')).toEqual({ countryCode: '+966', cell: '541234567' });
  });

  it('decomposes the price so add-ons are never charged twice: price + Σ add-ons === unit_price', () => {
    const unitPrice = 41.5;                       // burger 30 + cheese 5 + bacon 6.5
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{
        menuItemId: 'I', name: 'Burger', quantity: 3, unitPrice,
        addons: [
          { addonId: 'AD_CHEESE', nameEn: 'Cheese', price: 5 },
          { addonId: 'AD_BACON', nameEn: 'Bacon', price: 6.5 },
        ],
      }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = (r.payload.order_items as Record<string, unknown>[])[0];
    const addons = item.addons as Array<{ price: number; quantity: number }>;
    expect(item.price).toBe(30);
    const implied = Number(item.price) + addons.reduce((s, a) => s + a.price * a.quantity, 0);
    expect(implied).toBe(unitPrice);
  });

  it('BLOCKS delivery orders (schema unconfirmed) — the gate is untouched by the contract', () => {
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'delivery', customerName: 'A', items });
    expect(r).toEqual({ ok: false, blockedReason: 'delivery_schema_unconfirmed' });
    // Even with every confirmed field supplied, delivery still blocks.
    expect(buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'delivery', customerName: 'A', items,
      orderDetails: 'Gate 3', customerId: 'CRM_1', customerPhone: '0541234567', isPaid: true,
    })).toEqual({ ok: false, blockedReason: 'delivery_schema_unconfirmed' });
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

  it('FOLDS an unmapped modifier into `details` instead of blocking, leaving its money in `price`', () => {
    for (const addonId of [null, '', undefined as unknown as string]) {
      const r = buildCreateOrderPayload({
        clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
        items: [{
          menuItemId: 'I', name: 'Burger', quantity: 1, unitPrice: 30,
          addons: [{ addonId, nameEn: 'Cheese', price: 5 }],
        }],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const item = (r.payload.order_items as Record<string, unknown>[])[0];
      // There is no mapped add-on, so the contract array is not emitted at all.
      expect('addons' in item).toBe(false);
      // The kitchen still sees the choice...
      expect(item.details).toBe('Cheese');
      // ...and the 5.00 stays inside the price the customer was charged, exactly
      // as the pre-add-on worker sent it.
      expect(item.price).toBe(30);
    }
  });

  it('MIXES mapped and unmapped modifiers on one line without moving any money', () => {
    const unitPrice = 37;                     // burger 30 + cheese 5 + volcano 2
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{
        menuItemId: 'I', name: 'Burger', quantity: 1, unitPrice,
        addons: [
          { addonId: 'AD_CHEESE', nameEn: 'Extra Cheese', nameAr: 'جبن', price: 5 },
          { addonId: null, nameEn: 'Volcano', nameAr: 'بركان', price: 2 },
        ],
      }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = (r.payload.order_items as Record<string, unknown>[])[0];
    // Only the MAPPED add-on becomes a contract line...
    expect(item.addons).toEqual([{
      addon_id: 'AD_CHEESE', name: 'Extra Cheese',
      names: { en: 'Extra Cheese', ar: 'جبن' }, quantity: 1, price: 5,
    }]);
    // ...and only the mapped add-on is subtracted: 37 − 5 = 32 (the 2.00 stays).
    expect(item.price).toBe(32);
    expect(item.details).toBe('Volcano');
    // THE INVARIANT: what the POS ticket implies is what the customer was charged.
    const addons = item.addons as Array<{ price: number; quantity: number }>;
    const implied = Number(item.price) + addons.reduce((s, a) => s + a.price * a.quantity, 0);
    expect(implied).toBe(unitPrice);
  });

  it('keeps a PRICED unmapped modifier price on the line — Volcano (+2) is never given away', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{
        menuItemId: 'I', name: 'Chicken Burger', quantity: 3, unitPrice: 22,
        addons: [{ addonId: null, nameEn: 'Volcano (+2)', nameAr: 'بركان', price: 2 }],
      }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = (r.payload.order_items as Record<string, unknown>[])[0];
    expect(item.price).toBe(22);            // NOT 20 — nothing is subtracted
    expect(item.details).toBe('Volcano (+2)');
    expect('addons' in item).toBe(false);
  });

  it('combines the note and the unmapped modifiers in the documented order', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{
        menuItemId: 'I', name: 'Burger', quantity: 1, unitPrice: 30, note: '  No onions  ',
        addons: [
          { addonId: null, nameEn: 'Volcano', price: 2, quantity: 2 },
          { addonId: '', nameEn: '', nameAr: 'حار', price: 0 },
        ],
      }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = (r.payload.order_items as Record<string, unknown>[])[0];
    expect(item.details).toBe('Volcano ×2, حار — No onions');
  });

  it('skips an unmapped modifier with NO usable name rather than emitting an empty fragment', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [
        {
          menuItemId: 'I1', name: 'Burger', quantity: 1, unitPrice: 30,
          addons: [{ addonId: null, nameEn: '   ', nameAr: '  ', price: 0 }],
        },
        {
          menuItemId: 'I2', name: 'Fries', quantity: 1, unitPrice: 10, note: 'Crispy',
          addons: [{ addonId: null, nameEn: '', nameAr: null, price: 0 }],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [nameless, withNote] = r.payload.order_items as Record<string, unknown>[];
    // No fragment, no separator, no `details` key at all.
    expect('details' in nameless).toBe(false);
    // The note survives alone — it is not prefixed with a dangling em dash.
    expect(withNote.details).toBe('Crispy');
  });

  it('BLOCKS when the add-on money exceeds the line price (the decomposition would be unsafe)', () => {
    const r = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{
        menuItemId: 'I', name: 'Burger', quantity: 1, unitPrice: 4,
        addons: [{ addonId: 'AD', nameEn: 'Cheese', price: 5 }],
      }],
    });
    expect(r).toEqual({ ok: false, blockedReason: 'addon_price_exceeds_item_price' });
  });

  it('BLOCKS an empty cart and rounds prices to 2dp', () => {
    expect(buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items: [] }))
      .toEqual({ ok: false, blockedReason: 'no_items' });
    const r = buildCreateOrderPayload({ clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: [{ menuItemId: 'I', name: 'N', quantity: 1, unitPrice: 25.005 }] });
    expect(r.ok && (r.payload.order_items as { price: number }[])[0].price).toBe(25.01);
  });

  it('sends is_paid only when the caller sets it — the live worker does not (payment freeze)', () => {
    const base = { clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items } as const;
    expect(buildCreateOrderPayload(base).ok && 'is_paid' in (buildCreateOrderPayload(base) as { payload: Record<string, unknown> }).payload).toBe(false);
    const paid = buildCreateOrderPayload({ ...base, isPaid: false });
    expect(paid.ok && paid.payload.is_paid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The worker's order query -> Create Order items. Pure, so the join that feeds
// a live POS ticket is testable without a database.
// ---------------------------------------------------------------------------
describe('mapOrderItemRows — order_items join -> Create Order items', () => {
  const row = {
    id: 'oi-1', name_en: 'Beef Burger', name_ar: 'برجر لحم', note: 'No onions',
    quantity: 2, unit_price: 35, product_id: 'p-1',
    products: {
      lazywait_item_id: 'IT_BURGER',
      lazywait_price_id: 'PR_SINGLE',
      categories: { lazywait_category_id: 'CAT_MAIN' },
    },
    order_item_modifiers: [
      { modifier_id: 'm-1', name_en: 'Extra Cheese', name_ar: 'جبن', price: 5,
        modifiers: { lazywait_addon_id: 'AD_CHEESE' } },
    ],
  };

  it('carries the catalog mappings and the snapshots through to the payload', () => {
    const built = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: mapOrderItemRows([row]),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.order_items).toEqual([{
      menu_item_id: 'IT_BURGER',
      name: 'Beef Burger',
      names: { en: 'Beef Burger', ar: 'برجر لحم' },
      quantity: 2,
      price: 30,                              // 35 − the 5.00 add-on
      menu_category_id: 'CAT_MAIN',
      price_id: 'PR_SINGLE',
      details: 'No onions',
      addons: [{
        addon_id: 'AD_CHEESE', name: 'Extra Cheese',
        names: { en: 'Extra Cheese', ar: 'جبن' }, quantity: 1, price: 5,
      }],
    }]);
  });

  it('a modifier with NO lazywait_addon_id reaches the kitchen in `details` instead of vanishing', () => {
    const unmapped = {
      ...row,
      order_item_modifiers: [
        { modifier_id: 'm-1', name_en: 'Extra Cheese', name_ar: 'جبن', price: 5, modifiers: { lazywait_addon_id: null } },
      ],
    };
    expect(mapOrderItemRows([unmapped])[0].addons?.[0].addonId).toBeNull();
    const built = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: mapOrderItemRows([unmapped]),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const item = (built.payload.order_items as Record<string, unknown>[])[0];
    expect('addons' in item).toBe(false);
    expect(item.details).toBe('Extra Cheese — No onions');
    // 35 is the stored unit_price; nothing is subtracted, so the ticket implies
    // exactly what place_order charged.
    expect(item.price).toBe(35);

    // Same when the modifier row itself was orphaned (modifier_id set null).
    const orphan = { ...row, order_item_modifiers: [{ modifier_id: null, name_en: 'X', name_ar: 'X', price: 0, modifiers: null }] };
    const builtOrphan = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A',
      items: mapOrderItemRows([orphan]),
    });
    expect(builtOrphan.ok).toBe(true);
    if (!builtOrphan.ok) return;
    const orphanItem = (builtOrphan.payload.order_items as Record<string, unknown>[])[0];
    expect('addons' in orphanItem).toBe(false);
    expect(orphanItem.details).toBe('X — No onions');
    expect(orphanItem.price).toBe(35);
  });

  it('survives a row with no modifiers, no note and no catalog extras', () => {
    const bare = {
      name_en: 'Cola', name_ar: 'كولا', quantity: 1, unit_price: 5,
      products: { lazywait_item_id: 'IT_COLA', lazywait_price_id: null, categories: null },
      order_item_modifiers: [],
    };
    const built = buildCreateOrderPayload({
      clientId: 'C', branchId: 'B', orderType: 'pickup', customerName: 'A', items: mapOrderItemRows([bare]),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.order_items).toEqual([
      { menu_item_id: 'IT_COLA', name: 'Cola', names: { en: 'Cola', ar: 'كولا' }, quantity: 1, price: 5 },
    ]);
  });

  it('ORDER_ITEM_SELECT actually asks for everything the mapper reads', () => {
    for (const fragment of [
      'name_ar', 'note', 'unit_price',
      'lazywait_item_id', 'lazywait_price_id',
      'categories(lazywait_category_id)',
      'order_item_modifiers(', 'modifiers(lazywait_addon_id)',
    ]) {
      expect(ORDER_ITEM_SELECT).toContain(fragment);
    }
  });
});

describe('lazywait-sync worker wiring (source contract)', () => {
  const workerSrc = readFileSync(
    fileURLToPath(new URL('../lazywait-sync/index.ts', import.meta.url)), 'utf8',
  );

  it('builds its items from the shared select + mapper, not a hand-rolled query', () => {
    expect(workerSrc).toContain('ORDER_ITEM_SELECT');
    expect(workerSrc).toContain('mapOrderItemRows(');
  });

  it('forwards the order note, the CRM id and the phone, and does NOT set is_paid', () => {
    expect(workerSrc).toContain('orderDetails: (order.notes as string | null)');
    expect(workerSrc).toContain('customerId: crmCustomerId');
    expect(workerSrc).toContain('customerPhone: (order.customer_phone as string | null)');
    // `is_paid` is a confirmed field but a financial signal to the cashier;
    // wiring it is a separate owner decision under the payment freeze.
    expect(workerSrc).not.toMatch(/\bisPaid\s*:/);
  });

  it('never logs the customer phone into the sync request metadata', () => {
    const reqMeta = workerSrc.slice(workerSrc.indexOf('const reqMeta'));
    expect(reqMeta.slice(0, 200)).not.toMatch(/phone|cell|customer_name/);
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
