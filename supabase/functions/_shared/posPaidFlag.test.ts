import { describe, expect, it } from 'vitest';

import {
  maskedCardNumber,
  posCardType,
  posIsPaidFlag,
  posOrderPayments,
  posPaymentNames,
  posWarnings,
} from './posPaidFlag.ts';

const captured = { rows: 1, lookupFailed: false };

describe('posIsPaidFlag: a ticket is created paid only when the payment is certain', () => {
  it('a paid card order with a captured payment is sent as paid', () => {
    expect(posIsPaidFlag({ payment_method: 'online', payment_status: 'paid' }, captured)).toBe(true);
  });

  it('no captured payment record: not marked paid', () => {
    expect(
      posIsPaidFlag({ payment_method: 'online', payment_status: 'paid' }, { rows: 0, lookupFailed: false }),
    ).toBeUndefined();
  });

  it('a failed lookup is never read as paid', () => {
    expect(
      posIsPaidFlag({ payment_method: 'online', payment_status: 'paid' }, { rows: 1, lookupFailed: true }),
    ).toBeUndefined();
  });

  it('an online order the row does not call paid is never marked paid', () => {
    for (const status of ['pending', 'failed', 'refunded', null, undefined]) {
      expect(posIsPaidFlag({ payment_method: 'online', payment_status: status }, captured)).toBeUndefined();
    }
  });

  it('cash is never marked paid at creation', () => {
    expect(posIsPaidFlag({ payment_method: 'cash', payment_status: 'paid' }, captured)).toBeUndefined();
    expect(posIsPaidFlag({ payment_method: 'cash', payment_status: 'pending' }, captured)).toBeUndefined();
  });
});

const record = { provider_ref: 'pay_1', card_scheme: 'visa', card_last_four: '4242' };

describe('posOrderPayments: the payment line on a ticket created paid', () => {
  it('one line for the total, named after the card brand, with the card fields', () => {
    expect(posOrderPayments(true, 64.5, record)).toEqual([
      {
        names: { en: 'VISA', ar: 'فيزا' },
        amount: 64.5,
        payment_amount: 64.5,
        Card_Type: 'VISA',
        Card_Number: '****4242',
        status: 'approved',
        Approval_No: 'pay_1',
        transaction_uuid: 'pay_1',
      },
    ]);
  });

  // F-EFP-05-001: a TEST-mode payment moved no money, and the branch must be
  // able to see that on the ticket. Only the label changes.
  it('a TEST-mode payment is labelled as a test in both languages, nothing else changes', () => {
    const live = posOrderPayments(true, 64.5, { ...record, mode: 'live' })![0];
    const test = posOrderPayments(true, 64.5, { ...record, mode: 'test' })![0];
    expect(live.names).toEqual({ en: 'VISA', ar: 'فيزا' });
    expect(test.names).toEqual({ en: 'TEST - VISA', ar: 'اختبار - فيزا' });
    expect({ ...test, names: null }).toEqual({ ...live, names: null });
    // No mode (an older row): the ordinary label.
    expect(posOrderPayments(true, 64.5, record)![0].names).toEqual({ en: 'VISA', ar: 'فيزا' });
  });

  it('rounds the amount to halalas, the same under both names', () => {
    const entry = posOrderPayments(true, '19.999', record)![0];
    expect(entry.amount).toBe(20);
    expect(entry.payment_amount).toBe(20);
    // Disproved by the probe order (#10): the list never read it.
    expect(entry).not.toHaveProperty('Trans_Amount');
  });

  it('nothing unless the ticket is certain to be paid', () => {
    expect(posOrderPayments(undefined, 64.5, record)).toBeUndefined();
  });

  it('nothing without a payment record', () => {
    expect(posOrderPayments(true, 64.5, null)).toBeUndefined();
    expect(posOrderPayments(true, 64.5, undefined)).toBeUndefined();
  });

  it('nothing for a zero, negative or unreadable total', () => {
    for (const t of [0, -1, 'abc', null, undefined, Number.NaN]) {
      expect(posOrderPayments(true, t, record)).toBeUndefined();
    }
  });

  it('no approval number or reference when the record has no payment id', () => {
    const entry = posOrderPayments(true, 10, { ...record, provider_ref: '  ' })![0];
    expect(entry).not.toHaveProperty('Approval_No');
    expect(entry).not.toHaveProperty('transaction_uuid');
  });

  it('unknown card details still give a valid line, with the generic label', () => {
    const entry = posOrderPayments(true, 10, { provider_ref: 'p' })![0];
    expect(entry.Card_Type).toBe('CARD');
    expect(entry.Card_Number).toBe('****');
    expect(entry.names).toEqual({ en: 'ONLINE CREDIT CARD', ar: 'بطاقة ائتمانية' });
  });

  it('Apple Pay is named from the stored Moyasar source', () => {
    const entry = posOrderPayments(true, 10, {
      ...record,
      card_scheme: 'mada',
      raw: { source: { type: 'applepay' } },
    })![0];
    expect(entry.names).toEqual({ en: 'APPLE PAY - MADA', ar: 'Apple Pay - مدى' });
  });
});

describe('posWarnings: Create Order warnings, bounded for the log', () => {
  it('keeps a warning as sent', () => {
    const w = [{ code: 'ORDER_TOTAL_MISMATCH', sent_total: 49.45, till: { total: 51.75 } }];
    expect(posWarnings(w)).toEqual(w);
  });

  it('null when there are none', () => {
    for (const raw of [undefined, null, [], {}, 'x']) expect(posWarnings(raw)).toBeNull();
  });

  it('at most five entries', () => {
    expect(posWarnings(Array.from({ length: 9 }, (_, i) => ({ i })))).toHaveLength(5);
  });

  it('masks long digit runs and stays bounded', () => {
    const out = posWarnings([{ note: '4111111111111111', pad: 'y'.repeat(2000) }]);
    expect(JSON.stringify(out)).not.toMatch(/\d{12,}/);
    expect(typeof out === 'string' ? out.length : JSON.stringify(out).length).toBeLessThanOrEqual(1002);
  });
});

// Codex review on #508 (P1): masking digit runs in the JSON TEXT turned a
// float like 28.749999999999996, or a millisecond timestamp, into invalid
// JSON, and JSON.parse threw. In the worker that throw lands after the ticket
// was created and before its reference is saved, so a created ticket was
// treated as unconfirmed. Logging a warning must never throw.
describe('posWarnings never throws, whatever the warning holds', () => {
  it('keeps an ordinary float as a number', () => {
    expect(posWarnings([{ till: { total: 28.749999999999996 } }])).toEqual([
      { till: { total: 28.749999999999996 } },
    ]);
  });

  it('masks a 12+ digit integer such as a millisecond timestamp, without throwing', () => {
    expect(posWarnings([{ at: 1795071294000 }])).toEqual([{ at: '[digits]' }]);
  });

  it('masks a card-like digit run inside a string', () => {
    expect(posWarnings([{ note: 'card 4111111111111111 seen' }])).toEqual([{ note: 'card [digits] seen' }]);
  });

  it('survives cycles, BigInt and other unserializable values', () => {
    const cyc: Record<string, unknown> = { code: 'X' };
    cyc.self = cyc;
    expect(() => posWarnings([cyc])).not.toThrow();
    expect(() => posWarnings([{ big: BigInt(1) }])).not.toThrow();
    expect(() => posWarnings([{ f: () => 1 }])).not.toThrow();
  });
});

describe('posPaymentNames: the payment type the POS shows', () => {
  it.each([
    ['mada', 'creditcard', { en: 'MADA', ar: 'مدى' }],
    ['visa', 'creditcard', { en: 'VISA', ar: 'فيزا' }],
    ['master', 'creditcard', { en: 'MASTERCARD', ar: 'ماستركارد' }],
    ['mastercard', undefined, { en: 'MASTERCARD', ar: 'ماستركارد' }],
    ['amex', 'creditcard', { en: 'AMEX', ar: 'أمريكان إكسبريس' }],
    [' MADA ', 'creditcard', { en: 'MADA', ar: 'مدى' }],
    ['mada', 'applepay', { en: 'APPLE PAY - MADA', ar: 'Apple Pay - مدى' }],
    ['visa', 'ApplePay', { en: 'APPLE PAY - VISA', ar: 'Apple Pay - فيزا' }],
  ])('%s via %s', (scheme, type, names) => {
    expect(posPaymentNames(scheme, type)).toEqual(names);
  });

  it('an unknown brand keeps the generic label; Apple Pay without a brand says so', () => {
    for (const scheme of [undefined, null, '', 'unionpay', 7]) {
      expect(posPaymentNames(scheme, 'creditcard')).toEqual({
        en: 'ONLINE CREDIT CARD',
        ar: 'بطاقة ائتمانية',
      });
    }
    expect(posPaymentNames(undefined, 'applepay')).toEqual({ en: 'APPLE PAY', ar: 'Apple Pay' });
  });

  it('never hands out the shared constant itself, so a caller cannot mutate it', () => {
    const a = posPaymentNames(undefined, undefined);
    a.en = 'X';
    expect(posPaymentNames(undefined, undefined).en).toBe('ONLINE CREDIT CARD');
  });
});

// Moved here from paymentPosTiming.test.ts on 2026-11-19, with the helpers,
// when the separate update-online-payment call was removed.
describe('the card number the POS receives is masked to the last four', () => {
  it("four asterisks and the last four digits, as Lazywait's example shows", () => {
    expect(maskedCardNumber('1234')).toBe('****1234');
    expect(maskedCardNumber(' 0042 ')).toBe('****0042');
  });

  it('anything but exactly four digits sends the asterisks alone', () => {
    for (const bad of [null, undefined, '', '123', '12345', '4111111111111111', 'abcd', 1234]) {
      expect(maskedCardNumber(bad)).toBe('****');
    }
  });
});

describe('the card type the POS receives is the card scheme', () => {
  it('upper-cases what Moyasar reports', () => {
    expect(posCardType('mada')).toBe('MADA');
    expect(posCardType('visa')).toBe('VISA');
    expect(posCardType(' master ')).toBe('MASTER');
    expect(posCardType('amex')).toBe('AMEX');
  });

  it('sends CARD when the scheme is missing or odd', () => {
    for (const bad of [null, undefined, '', 'x', '4111111111111111', 'a b', 'visa;drop', 'x'.repeat(30), 7]) {
      expect(posCardType(bad)).toBe('CARD');
    }
  });
});
