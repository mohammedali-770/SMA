import { describe, it, expect } from 'vitest';
import {
  getVATBreakdown,
  formatSAR,
  calculateDistance,
  generateId,
  parseCSVMenu,
  riyadhMonthRange,
} from './calculations';
import { Category } from '../types';

describe('getVATBreakdown', () => {
  it('splits a VAT-inclusive total into pre-VAT subtotal + VAT at 15% (default)', () => {
    // 115 inclusive => 100 net + 15 VAT.
    expect(getVATBreakdown(115)).toEqual({
      subtotalExcludingVat: 100,
      vatAmount: 15,
      totalInclusive: 115,
    });
  });

  it('honours a custom VAT percentage', () => {
    // 110 inclusive at 10% => 100 net + 10 VAT.
    expect(getVATBreakdown(110, 10)).toEqual({
      subtotalExcludingVat: 100,
      vatAmount: 10,
      totalInclusive: 110,
    });
  });

  it('rounds to two decimals and the parts still sum to the total', () => {
    const b = getVATBreakdown(100);
    expect(b.subtotalExcludingVat).toBe(86.96);
    expect(b.vatAmount).toBe(13.04);
    expect(b.subtotalExcludingVat + b.vatAmount).toBeCloseTo(b.totalInclusive, 2);
  });

  it('handles a zero total', () => {
    expect(getVATBreakdown(0)).toEqual({
      subtotalExcludingVat: 0,
      vatAmount: 0,
      totalInclusive: 0,
    });
  });
});

describe('formatSAR', () => {
  it('defaults to the English "SAR" label with two decimals', () => {
    expect(formatSAR(123)).toBe('123.00 SAR');
  });

  it('uses the Arabic "ر.س" abbreviation when lang is "ar"', () => {
    expect(formatSAR(123, 'ar')).toBe('123.00 ر.س');
  });

  it('always shows two decimals, including a trailing zero', () => {
    // The bug this fixed: bare numbers rendered "12.5" instead of "12.50".
    expect(formatSAR(12.5, 'en')).toBe('12.50 SAR');
    expect(formatSAR(0, 'ar')).toBe('0.00 ر.س');
  });
});

describe('calculateDistance', () => {
  it('is zero for identical coordinates', () => {
    expect(calculateDistance(24.7136, 46.6753, 24.7136, 46.6753)).toBe(0);
  });

  it('approximates one degree of longitude at the equator (~111 km)', () => {
    const d = calculateDistance(0, 0, 0, 1);
    expect(d).toBeGreaterThan(111);
    expect(d).toBeLessThan(112);
  });

  it('is symmetric between the two points', () => {
    const ab = calculateDistance(24.71, 46.67, 21.42, 39.82);
    const ba = calculateDistance(21.42, 39.82, 24.71, 46.67);
    expect(ab).toBe(ba);
  });
});

describe('generateId', () => {
  it('prefixes the id and uses base36 characters', () => {
    expect(generateId('prod')).toMatch(/^prod-[a-z0-9]+$/);
  });

  it('produces distinct ids across calls', () => {
    const a = generateId('cat');
    const b = generateId('cat');
    expect(a).not.toBe(b);
  });
});

describe('riyadhMonthRange', () => {
  it('returns the first and last day of the month containing the given date', () => {
    expect(riyadhMonthRange(new Date('2026-07-13T09:00:00Z'))).toEqual({
      start: '2026-07-01',
      end: '2026-07-31',
    });
  });

  it('handles February in a non-leap year (28 days)', () => {
    expect(riyadhMonthRange(new Date('2026-02-15T12:00:00Z'))).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
  });

  it('handles a leap-year February (29 days)', () => {
    expect(riyadhMonthRange(new Date('2028-02-10T12:00:00Z'))).toEqual({
      start: '2028-02-01',
      end: '2028-02-29',
    });
  });

  it('uses the Riyadh (UTC+3) calendar day at a UTC day boundary', () => {
    // 2026-07-31T22:30Z is 2026-08-01 01:30 in Riyadh → August, not July.
    expect(riyadhMonthRange(new Date('2026-07-31T22:30:00Z'))).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    });
  });
});

describe('parseCSVMenu', () => {
  const HEADER =
    'category_name_en,category_name_ar,product_name_en,product_name_ar,description_en,description_ar,price_sar,calories,image_url';

  it('parses a valid row into a product and creates its category', () => {
    const csv = `${HEADER}\nBurgers,برجر,Test Burger,برجر تجريبي,tasty,لذيذ,25.50,600,http://img`;
    const { products, categories, errors } = parseCSVMenu(csv, []);

    expect(errors).toEqual([]);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      nameEn: 'Test Burger',
      nameAr: 'برجر تجريبي',
      price: 25.5,
      calories: 600,
    });
    // A new "Burgers" category was created and the product points at it.
    const cat = categories.find(c => c.nameEn === 'Burgers');
    expect(cat).toBeDefined();
    expect(products[0].categoryId).toBe(cat!.id);
  });

  it('reuses an existing category instead of duplicating it', () => {
    const existing: Category[] = [
      { id: 'cat-1', nameEn: 'Burgers', nameAr: 'برجر', sortOrder: 1 },
    ];
    const csv = `${HEADER}\nBurgers,برجر,Another,آخر,d,و,10,100,http://img`;
    const { products, categories } = parseCSVMenu(csv, existing);

    expect(categories.filter(c => c.nameEn === 'Burgers')).toHaveLength(1);
    expect(products[0].categoryId).toBe('cat-1');
  });

  it('reports an error for a header-only (empty) file', () => {
    const { products, errors } = parseCSVMenu(HEADER, []);
    expect(products).toEqual([]);
    expect(errors[0]).toMatch(/empty or missing headers/i);
  });

  it('reports an error for an invalid price and skips the row', () => {
    const csv = `${HEADER}\nBurgers,برجر,X,Y,d,و,not-a-number,600,http://img`;
    const { products, errors } = parseCSVMenu(csv, []);
    expect(products).toHaveLength(0);
    expect(errors.some(e => /invalid price/i.test(e))).toBe(true);
  });

  it('reports an error for a row missing required fields', () => {
    // Empty product_name_en.
    const csv = `${HEADER}\nBurgers,برجر,,Y,d,و,25,600,http://img`;
    const { products, errors } = parseCSVMenu(csv, []);
    expect(products).toHaveLength(0);
    expect(errors.some(e => /missing required fields/i.test(e))).toBe(true);
  });
});
