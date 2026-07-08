import { describe, it, expect } from 'vitest';
import {
  extractCatalogRecord, extractCatalogList, normalizeCatalogPayload,
} from './lazywaitCatalog';

describe('extractCatalogList (response envelope)', () => {
  it('accepts a bare array or a wrapped {data|results|<plural>}', () => {
    expect(extractCatalogList([{ id: '1' }]).length).toBe(1);
    expect(extractCatalogList({ data: [{ id: '1' }, { id: '2' }] }).length).toBe(2);
    expect(extractCatalogList({ branches: [{ id: '1' }] }).length).toBe(1);
    expect(extractCatalogList(null)).toEqual([]);
    expect(extractCatalogList({ nope: 1 })).toEqual([]);
  });
});

describe('extractCatalogRecord — ids + names', () => {
  it('extracts the branch id + en/ar names', () => {
    const r = extractCatalogRecord('branch', { branch_id: 'B1', name_en: 'Downtown', name_ar: 'وسط البلد' });
    expect(r?.lazywait_id).toBe('B1');
    expect(r?.name_en).toBe('Downtown');
    expect(r?.name_ar).toBe('وسط البلد');
  });

  it('drops a record with no usable id', () => {
    expect(extractCatalogRecord('item', { name_en: 'No Id' })).toBeNull();
  });

  it('handles Turkish-only test data via name_other', () => {
    const r = extractCatalogRecord('item', { menu_item_id: 'I9', name: 'Köfte' });
    expect(r?.lazywait_id).toBe('I9');
    expect(r?.name_en).toBeNull();
    expect(r?.name_ar).toBeNull();
    expect(r?.name_other).toBe('Köfte');
  });

  it('reads a localized name object and a translations array', () => {
    const r = extractCatalogRecord('category', {
      category_id: 'C1', name: { en: 'Drinks', ar: 'مشروبات', tr: 'İçecekler' },
    });
    expect(r?.name_en).toBe('Drinks');
    expect(r?.name_ar).toBe('مشروبات');
    const r2 = extractCatalogRecord('category', {
      id: 'C2', translations: [{ locale: 'en', name: 'Salads' }, { locale: 'ar', name: 'سلطات' }],
    });
    expect(r2?.name_en).toBe('Salads');
    expect(r2?.name_ar).toBe('سلطات');
  });
});

describe('extractCatalogRecord — items with multiple prices', () => {
  it('parses a multi-price item, preserving null price_id', () => {
    const r = extractCatalogRecord('item', {
      menu_item_id: 'I1', name_en: 'Pizza',
      category_id: 'CAT1', branches_ids: ['B1', 'B2'],
      prices: [
        { price_id: 'P_S', name: 'Small', price_with_vat: 25, price_excl_vat: 21.74 },
        { price_id: null, name: 'Large', price_with_vat: 40 },
      ],
    });
    expect(r?.parent_id).toBe('CAT1');
    expect(r?.branches_ids).toEqual(['B1', 'B2']);
    expect(r?.prices?.length).toBe(2);
    expect(r?.prices?.[0]).toEqual({ price_id: 'P_S', name: 'Small', price_with_vat: 25, price_excl_vat: 21.74 });
    expect(r?.prices?.[1]).toEqual({ price_id: null, name: 'Large', price_with_vat: 40, price_excl_vat: null });
  });

  it('falls back to a single flat numeric price', () => {
    const r = extractCatalogRecord('item', { id: 'I2', name_en: 'Water', price: 3 });
    expect(r?.prices?.length).toBe(1);
    expect(r?.prices?.[0].price_with_vat).toBe(3);
  });

  it('single branch_id becomes a one-element branches_ids', () => {
    const r = extractCatalogRecord('item', { id: 'I3', name_en: 'X', branch_id: 'B7' });
    expect(r?.branches_ids).toEqual(['B7']);
  });
});

describe('extractCatalogRecord — null-heavy addons / groups', () => {
  it('addon with null price + null price_id does not crash (prices -> null)', () => {
    const r = extractCatalogRecord('addon', { addon_id: 'A1', name_en: 'Extra Cheese', price: null, price_id: null });
    expect(r?.lazywait_id).toBe('A1');
    expect(r?.prices).toBeNull();
    expect(r?.min_selection).toBeNull();
  });

  it('addon group with null min/max/multi keeps them null', () => {
    const r = extractCatalogRecord('addon_group', {
      addons_group_id: 'G1', name_en: 'Sauces',
      min_selection: null, max_selection: null, multi_max: null,
    });
    expect(r?.lazywait_id).toBe('G1');
    expect(r?.min_selection).toBeNull();
    expect(r?.max_selection).toBeNull();
    expect(r?.multi_max).toBeNull();
  });

  it('addon group parses present bounds', () => {
    const r = extractCatalogRecord('addon_group', { group_id: 'G2', name_en: 'Size', min_selection: 1, max_selection: 1, multi_max: 3 });
    expect(r?.min_selection).toBe(1);
    expect(r?.max_selection).toBe(1);
    expect(r?.multi_max).toBe(3);
  });
});

describe('normalizeCatalogPayload', () => {
  it('normalizes a full endpoint response and drops id-less rows', () => {
    const out = normalizeCatalogPayload('addon', {
      data: [{ addon_id: 'A1', name_en: 'Cheese' }, { name_en: 'no id' }],
    });
    expect(out.length).toBe(1);
    expect(out[0].lazywait_id).toBe('A1');
  });
});
