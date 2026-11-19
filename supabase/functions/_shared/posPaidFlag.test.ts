import { describe, expect, it } from 'vitest';

import { posIsPaidFlag, posOrderPayments, posWarnings } from './posPaidFlag.ts';

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
  it('one Online Credit Card line for the total, with the card fields', () => {
    expect(posOrderPayments(true, 64.5, record)).toEqual([
      {
        names: { en: 'ONLINE CREDIT CARD', ar: 'بطاقة ائتمانية' },
        amount: 64.5,
        Card_Type: 'VISA',
        Card_Number: '****4242',
        status: 'approved',
        Approval_No: 'pay_1',
        transaction_uuid: 'pay_1',
      },
    ]);
  });

  it('rounds the amount to halalas', () => {
    expect(posOrderPayments(true, '19.999', record)?.[0].amount).toBe(20);
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

  it('unknown card details still give a valid line', () => {
    const entry = posOrderPayments(true, 10, { provider_ref: 'p' })![0];
    expect(entry.Card_Type).toBe('CARD');
    expect(entry.Card_Number).toBe('****');
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
