import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  exportErrorMessage,
  exportShareText,
  exportTitle,
  isTooLargeToShare,
  SHARE_TEXT_LIMIT_BYTES,
  shouldStartExport,
  summarizeExport,
  summaryLine,
  tooLargeMessage,
} from './dataExport';

describe('shouldStartExport', () => {
  it('ignores a second tap while a request is in flight', () => {
    // Each call reads the whole order history; a double tap would run it twice.
    expect(shouldStartExport('working')).toBe(false);
  });

  it('allows a retry after a failure, and a second export after a success', () => {
    expect(shouldStartExport('idle')).toBe(true);
    expect(shouldStartExport('error')).toBe(true);
    expect(shouldStartExport('shared')).toBe(true);
  });
});

describe('summarizeExport', () => {
  it('counts each collection', () => {
    expect(
      summarizeExport({
        orders: [1, 2, 3],
        saved_addresses: [1],
        loyalty_history: [1, 2],
        notification_devices: [],
      }),
    ).toEqual({ orders: 3, addresses: 1, loyaltyEntries: 2, devices: 0 });
  });

  it('never throws on unexpected input', () => {
    // The boundary between two systems. Losing the customer's export because the
    // summary line could not be computed would be a cosmetic failure with a real
    // cost, so every shape degrades to zero instead.
    for (const bad of [null, undefined, {}, { orders: 'nope' }, 42, 'string']) {
      expect(() => summarizeExport(bad)).not.toThrow();
    }
    expect(summarizeExport(null)).toEqual({
      orders: 0,
      addresses: 0,
      loyaltyEntries: 0,
      devices: 0,
    });
  });
});

describe('summaryLine', () => {
  it('reads as a sentence in both languages', () => {
    const s = { orders: 2, addresses: 1, loyaltyEntries: 5, devices: 1 };
    expect(summaryLine(s, 'en')).toBe('2 orders · 1 addresses · 5 loyalty entries · 1 devices');
    // Arabic carries the same four counts, in Arabic, and is not the English
    // string with the words swapped out.
    const ar = summaryLine(s, 'ar');
    expect(ar).toContain('طلب');
    expect(ar).toContain('عنوان');
    for (const n of ['2', '1', '5']) expect(ar).toContain(n);
    expect(ar).not.toBe(summaryLine(s, 'en'));
  });
});

/**
 * Gap PG-26: the copy now carries the customer's payment records, the one part
 * of it with card details, so the line names them. Only when the server sent
 * the list: `/app` ships on merge, before the migration that adds it is
 * applied, and "0 payment records" would then be untrue.
 */
describe('payment records in the summary', () => {
  it('counts the payment records the server sends', () => {
    expect(
      summarizeExport({
        orders: [1],
        saved_addresses: [],
        loyalty_history: [],
        notification_devices: [],
        payments: [1, 2, 3],
      }),
    ).toEqual({ orders: 1, addresses: 0, loyaltyEntries: 0, devices: 0, payments: 3 });
  });

  it('counts an empty list as zero, because the server did look', () => {
    expect(summarizeExport({ payments: [] }).payments).toBe(0);
  });

  it('says nothing about payments when the server sent no list', () => {
    for (const payload of [{ orders: [1] }, { payments: 'nope' }, null]) {
      const s = summarizeExport(payload);
      expect(s).not.toHaveProperty('payments');
      expect(summaryLine(s, 'en')).not.toMatch(/payment/i);
      expect(summaryLine(s, 'ar')).not.toContain('دفع');
    }
  });

  it('names the payment records in both languages', () => {
    const s = { orders: 2, addresses: 1, loyaltyEntries: 5, devices: 1, payments: 3 };
    expect(summaryLine(s, 'en')).toBe(
      '2 orders · 1 addresses · 5 loyalty entries · 1 devices · 3 payment records',
    );
    const ar = summaryLine(s, 'ar');
    expect(ar).toContain('3 سجل دفع');
    expect(ar).not.toBe(summaryLine(s, 'en'));
  });
});

describe('exportTitle', () => {
  it('uses LOCAL calendar parts, not a UTC-shifted date', () => {
    // Same trap as loyaltyExpiry.ts: a UTC-derived date reads as the previous
    // day west of Greenwich, so two exports on one day could carry two dates.
    const late = new Date(2026, 8, 8, 23, 30); // 8 Sep, local
    expect(exportTitle(late, 'en')).toBe('Spicy Meal data 2026-09-08');
  });

  it('zero-pads so titles sort', () => {
    expect(exportTitle(new Date(2026, 0, 5), 'en')).toBe('Spicy Meal data 2026-01-05');
  });
});

describe('exportErrorMessage', () => {
  it('tells an offline customer to retry, and anyone else to contact support', () => {
    expect(exportErrorMessage(new Error('Network request failed'), 'en')).toMatch(/connection/i);
    expect(exportErrorMessage(new Error('permission denied'), 'en')).toMatch(/contact us/i);
  });

  it('never surfaces the raw error to the customer', () => {
    const leaky = new Error('permission denied for function export_my_data');
    for (const lang of ['en', 'ar'] as const) {
      expect(exportErrorMessage(leaky, lang)).not.toContain('export_my_data');
    }
  });
});

/**
 * The Android Binder ceiling. A share that silently does nothing is worse than
 * a refusal that explains itself, and it would fail for exactly the customers
 * with the most data.
 */
describe('isTooLargeToShare', () => {
  it('passes a realistic export', () => {
    const realistic = JSON.stringify({ orders: Array.from({ length: 120 }, (_, i) => ({ n: i })) });
    expect(isTooLargeToShare(realistic)).toBe(false);
  });

  it('refuses one past the limit', () => {
    expect(isTooLargeToShare('x'.repeat(SHARE_TEXT_LIMIT_BYTES + 1))).toBe(true);
    expect(isTooLargeToShare('x'.repeat(SHARE_TEXT_LIMIT_BYTES))).toBe(false);
  });

  it('measures BYTES, not characters', () => {
    // Arabic is 2 bytes per character in UTF-8, so a string well under the limit
    // by `.length` can be over it in bytes — which is what Binder counts.
    const arabic = 'ب'.repeat(SHARE_TEXT_LIMIT_BYTES - 10);
    expect(arabic.length).toBeLessThan(SHARE_TEXT_LIMIT_BYTES);
    expect(isTooLargeToShare(arabic)).toBe(true);
  });

  it('tells the customer what to do instead, in both languages', () => {
    for (const lang of ['en', 'ar'] as const) {
      expect(tooLargeMessage(lang).length).toBeGreaterThan(0);
    }
    expect(tooLargeMessage('en')).toMatch(/contact us/i);
    expect(tooLargeMessage('ar')).not.toBe(tooLargeMessage('en'));
  });
});

/**
 * What is shared, and how much history fits. One card order exactly as
 * `export_my_data()` returned it on the local chain on 2026-11-14 (built
 * through begin_checkout_session, begin_session_attempt and
 * finalize_checkout_session; synthetic ids): the order, its payment record and
 * its completed checkout. See `docs/MIGRATIONS.md` §66.
 */
const CARD_ORDER = {
  order: {
    vat: 9.91,
    items: [
      {
        item: 'Spicy Double Beef',
        add_ons: [],
        variant: null,
        quantity: 2,
        your_note: null,
        line_total: 64,
        unit_price: 32,
      },
      {
        item: 'Spicy Fries',
        add_ons: [],
        variant: null,
        quantity: 1,
        your_note: null,
        line_total: 12,
        unit_price: 12,
      },
    ],
    total: 76,
    branch: 'Riyadh - Olaya',
    comped: false,
    status: 'received',
    paid_at: '2026-11-14T14:13:46.356631+00:00',
    subtotal: 76,
    placed_at: '2026-11-14T14:13:46.356631+00:00',
    your_note: null,
    order_type: 'pickup',
    coupon_code: null,
    delivered_to: null,
    delivery_fee: 0,
    order_number: 'SM-2026-000080',
    comp_discount: 0,
    points_earned: 76,
    payment_method: 'online',
    payment_status: 'paid',
    coupon_discount: 0,
    points_redeemed: 0,
    loyalty_discount: 0,
  },
  payment: {
    mode: 'live',
    note: null,
    tries: [
      {
        at: '2026-11-14T10:00:00.000Z',
        method: 'creditcard',
        status: 'paid',
        payment_id: 'pay_f033ab37c30201f73f142449d037028d',
        card_issuer: 'Saudi National Bank',
        card_scheme: 'mada',
        bank_message: 'APPROVED',
        response_code: '00',
        card_last_four: '4242',
        reference_number: '123456789012',
        authorization_code: '123456',
        card_issuer_country: 'SA',
      },
    ],
    amount: 76,
    status: 'paid',
    currency: 'SAR',
    provider: 'moyasar',
    failed_at: null,
    expires_at: '2026-11-14T14:43:46.356631+00:00',
    invoice_id: null,
    payment_id: 'pay_f033ab37c30201f73f142449d037028d',
    started_at: '2026-11-14T14:13:46.356631+00:00',
    card_scheme: 'mada',
    checkout_id: 'b8099861-bc79-41fc-b414-2a3629739ac2',
    confirmed_at: '2026-11-14T14:13:46.356631+00:00',
    order_number: 'SM-2026-000080',
    card_last_four: '4242',
  },
  checkout: {
    status: 'consumed',
    expires_at: '2026-11-14T14:43:46.356631+00:00',
    order_type: 'pickup',
    started_at: '2026-11-14T14:13:46.356631+00:00',
    checkout_id: 'b8099861-bc79-41fc-b414-2a3629739ac2',
    completed_at: '2026-11-14T14:13:46.356631+00:00',
    order_number: 'SM-2026-000080',
    payment_method: 'online',
  },
};

function cardCustomerCopy(n: number): unknown {
  return {
    generated_at: '2026-11-14T14:13:46.356631+00:00',
    about: 'Everything Spicy Meal holds about you that is personal to you.',
    account: { name: 'Volume Test', phone: '+966500000000' },
    saved_addresses: [],
    loyalty_history: [],
    notification_devices: [],
    orders: Array.from({ length: n }, () => CARD_ORDER.order),
    checkouts: Array.from({ length: n }, () => CARD_ORDER.checkout),
    payments: Array.from({ length: n }, () => CARD_ORDER.payment),
    refunds: [],
  };
}

describe('exportShareText', () => {
  it('is the JSON, unchanged when read back', () => {
    const copy = cardCustomerCopy(2);
    expect(JSON.parse(exportShareText(copy))).toEqual(copy);
  });

  it('is compact: indentation was about a third of the bytes', () => {
    expect(exportShareText(cardCustomerCopy(1))).not.toMatch(/\n/);
  });

  it('fits a card customer with 120 orders, which indented JSON did not', () => {
    // 120 sits between the indented ceiling (about 93) and the compact one
    // (about 132), so this fails if the share goes back to indented JSON.
    expect(isTooLargeToShare(JSON.stringify(cardCustomerCopy(120), null, 2))).toBe(true);
    expect(isTooLargeToShare(exportShareText(cardCustomerCopy(120)))).toBe(false);
  });

  it('is what the screen shares', () => {
    // The screen has no renderer test, so its one line is read as text: going
    // back to JSON.stringify there would bypass everything above.
    const screen = readFileSync(new URL('./AccountSettingsScreen.tsx', import.meta.url), 'utf8');
    expect(screen).toMatch(/const json = exportShareText\(payload\);/);
    expect(screen).not.toMatch(/JSON\.stringify\(payload/);
  });

  it('still refuses a card customer far past the ceiling', () => {
    expect(isTooLargeToShare(exportShareText(cardCustomerCopy(200)))).toBe(true);
  });
});
