import { describe, it, expect } from 'vitest';
import { buildCouponUsage, buildProductSales, lazywaitRefOf, UNKNOWN_CATEGORY_LABEL } from './reports';
import type { Order } from '../types';

/** Minimal Order factory — only the fields these pure aggregations read. */
const order = (o: Partial<Order>): Order => o as Order;

describe('buildCouponUsage', () => {
  it('groups by the REAL coupon code and sums the real coupon discount', () => {
    const rows = buildCouponUsage([
      order({ couponCode: 'SEEDPCT15', discountAmount: 8.1 }),
      order({ couponCode: 'SEEDPCT15', discountAmount: 5.4 }),
      order({ couponCode: 'SEEDFIX10', discountAmount: 10 }),
    ]);
    expect(rows).toEqual([
      { code: 'SEEDPCT15', count: 2, savings: 13.5 },
      { code: 'SEEDFIX10', count: 1, savings: 10 },
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

describe('buildProductSales (F-TAA4-006)', () => {
  const products = [{ id: 'p1', categoryId: 'c1', nameEn: 'Fries', nameAr: 'بطاطس' }];
  const categories = [{ id: 'c1', nameEn: 'Sides', nameAr: 'مقبلات' }];
  const line = (productId: string | null, nameEn: string, price: number, quantity: number) => ({
    productId, nameEn, nameAr: `${nameEn}-ar`, price, quantity,
  });

  it('keeps two deleted products as two rows, named from the order-item snapshot', () => {
    const rows = buildProductSales(
      [{ items: [line(null, 'Old Burger', 20, 2), line(null, 'Old Wrap', 15, 1), line(null, 'Old Burger', 20, 1)] }],
      products, categories, false,
    );
    expect(rows).toHaveLength(2);
    const burger = rows.find(r => r.name === 'Old Burger');
    const wrap = rows.find(r => r.name === 'Old Wrap');
    expect(burger).toMatchObject({ qty: 3, rev: 60 });
    expect(wrap).toMatchObject({ qty: 1, rev: 15 });
  });

  it('does not borrow a hard-coded category for a deleted product', () => {
    const [row] = buildProductSales([{ items: [line(null, 'Old Burger', 20, 1)] }], products, categories, false);
    expect(row.category).toBe(UNKNOWN_CATEGORY_LABEL.en);
    expect(row.category).not.toMatch(/Burgers/);
    const [ar] = buildProductSales([{ items: [line(null, 'Old Burger', 20, 1)] }], products, categories, true);
    expect(ar.category).toBe(UNKNOWN_CATEGORY_LABEL.ar);
  });

  it('still groups a live product by id and uses its current name and category', () => {
    const [row] = buildProductSales(
      [{ items: [line('p1', 'Fries (old name)', 5, 2)] }, { items: [line('p1', 'Fries', 5, 1)] }],
      products, categories, false,
    );
    expect(row).toMatchObject({ name: 'Fries', category: 'Sides', qty: 3, rev: 15 });
  });

  it('keeps the grand totals identical to the sum of the lines', () => {
    const rows = buildProductSales(
      [{ items: [line(null, 'A', 10, 1), line(null, 'B', 7, 3), line('p1', 'Fries', 5, 2)] }],
      products, categories, false,
    );
    expect(rows.reduce((t, r) => t + r.rev, 0)).toBe(10 + 21 + 10);
    expect(rows.reduce((t, r) => t + r.qty, 0)).toBe(6);
  });
});
