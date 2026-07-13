import { describe, it, expect } from 'vitest';
import { buildCouponUsage, lazywaitRefOf } from './reports';
import type { Order } from '../types';

/** Minimal Order factory — only the fields these pure aggregations read. */
const order = (o: Partial<Order>): Order => o as Order;

describe('buildCouponUsage', () => {
  it('groups by the REAL coupon code and sums the real coupon discount', () => {
    const rows = buildCouponUsage([
      order({ couponCode: 'SPICY15', discountAmount: 8.1 }),
      order({ couponCode: 'SPICY15', discountAmount: 5.4 }),
      order({ couponCode: 'RIYADH10', discountAmount: 10 }),
    ]);
    expect(rows).toEqual([
      { code: 'SPICY15', count: 2, savings: 13.5 },
      { code: 'RIYADH10', count: 1, savings: 10 },
    ]);
  });

  it('ignores orders with no coupon (never infers a code from the discount)', () => {
    const rows = buildCouponUsage([
      order({ couponCode: undefined, discountAmount: 12 }), // loyalty-only discount, no coupon
      order({ couponCode: '', discountAmount: 4 }),
      order({ couponCode: '   ', discountAmount: 4 }),
      order({ couponCode: 'WELCOME', discountAmount: 3 }),
    ]);
    expect(rows).toEqual([{ code: 'WELCOME', count: 1, savings: 3 }]);
  });

  it('treats a missing discount as zero savings', () => {
    expect(buildCouponUsage([order({ couponCode: 'FREESHIP' })])).toEqual([
      { code: 'FREESHIP', count: 1, savings: 0 },
    ]);
  });

  it('sorts by total savings descending', () => {
    const rows = buildCouponUsage([
      order({ couponCode: 'SMALL', discountAmount: 2 }),
      order({ couponCode: 'BIG', discountAmount: 50 }),
      order({ couponCode: 'MID', discountAmount: 20 }),
    ]);
    expect(rows.map(r => r.code)).toEqual(['BIG', 'MID', 'SMALL']);
  });

  it('is empty when no orders carry a coupon', () => {
    expect(buildCouponUsage([order({ discountAmount: 5 }), order({})])).toEqual([]);
  });
});

describe('lazywaitRefOf', () => {
  it('prefers the human POS order number once synced', () => {
    expect(lazywaitRefOf({ lazywaitOrderNumber: '#42', lazywaitRef: 'chg_abc' })).toBe('#42');
  });

  it('falls back to the Lazywait ref id when there is no POS number', () => {
    expect(lazywaitRefOf({ lazywaitOrderNumber: undefined, lazywaitRef: 'chg_abc' })).toBe('chg_abc');
  });

  it('is empty (never fabricated) when the order has not synced', () => {
    expect(lazywaitRefOf({ lazywaitOrderNumber: undefined, lazywaitRef: undefined })).toBe('');
    expect(lazywaitRefOf({ lazywaitOrderNumber: '  ', lazywaitRef: '  ' })).toBe('');
  });
});
