import { describe, expect, it } from 'vitest';

import { posIsPaidFlag } from './posPaidFlag.ts';

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
