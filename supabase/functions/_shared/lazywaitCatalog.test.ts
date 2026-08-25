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

  it('reads an add-on GROUP envelope, whatever plural it uses', () => {
    // Note which of these are actually new: the generic list already carried a
    // bare `groups`, so that one parsed before this change too. The four
    // `addons_`/`addon_` spellings did not, and are what this fixes.
    for (const key of ['addons_groups', 'addon_groups', 'addonsGroups', 'addonGroups', 'groups']) {
      expect(extractCatalogList({ [key]: [{ id: 'G1' }, { id: 'G2' }] }, 'addon_group').length).toBe(2);
    }
  });

  it('pins WHICH spellings the old generic path missed', () => {
    // Guards the claim the docs and the ENTITY_LIST_KEYS comment both make.
    for (const key of ['addons_groups', 'addon_groups', 'addonsGroups', 'addonGroups']) {
      expect(extractCatalogList({ [key]: [{ id: 'G1' }] }).length).toBe(0);   // no hint -> missed
    }
    expect(extractCatalogList({ groups: [{ id: 'G1' }] }).length).toBe(1);    // already worked
  });

  it('prefers the group envelope over an `addons` key on the same body', () => {
    // A group response may carry the add-ons belonging to each group. `addons`
    // sits ahead of `groups` in the generic order, so without the entity hint
    // the group list would be read as an add-on list.
    const body = { addons_groups: [{ id: 'G1' }], addons: [{ id: 'A1' }, { id: 'A2' }] };
    expect(extractCatalogList(body, 'addon_group')).toEqual([{ id: 'G1' }]);
    expect(extractCatalogList(body, 'addon')).toEqual([{ id: 'A1' }, { id: 'A2' }]);
  });

  it('is unchanged for every other entity, and when no entity is given', () => {
    const bodies: Array<[Parameters<typeof extractCatalogList>[1], Record<string, unknown>]> = [
      ['branch', { branches: [{ id: '1' }] }],
      ['category', { categories: [{ id: '1' }] }],
      ['item', { items: [{ id: '1' }] }],
      ['addon', { addons: [{ id: '1' }] }],
    ];
    for (const [entity, body] of bodies) {
      expect(extractCatalogList(body, entity).length).toBe(1);
      expect(extractCatalogList(body).length).toBe(1);      // no hint -> same answer
    }
    // The hint never invents a list where there is none.
    expect(extractCatalogList({ nope: 1 }, 'addon_group')).toEqual([]);
  });
});

describe('normalizeCatalogPayload — add-on groups reach the catalog cache', () => {
  it('normalizes a group list that only the entity-aware keys can find', () => {
    const records = normalizeCatalogPayload('addon_group', {
      addons_groups: [
        { addons_group_id: 'G_HEAT', names: { en: 'Heat Level', ar: 'مستوى الحرارة' },
          min_selection: 1, max_selection: 1, multi_max: 1 },
        { addons_group_id: 'G_DRINKS', name_en: 'Drinks', name_ar: 'مشروبات' },
      ],
    });
    expect(records.length).toBe(2);
    expect(records[0].entity_type).toBe('addon_group');
    expect(records[0].lazywait_id).toBe('G_HEAT');
    expect(records[0].name_en).toBe('Heat Level');
    expect(records[0].name_ar).toBe('مستوى الحرارة');
    expect(records[0].min_selection).toBe(1);
    expect(records[1].lazywait_id).toBe('G_DRINKS');
  });

  it('REGRESSION: the same body returned nothing before the entity hint', () => {
    // Exactly the shape the importer was handed; the generic key list has no
    // `addons_groups`, so this produced 0 records and a success with no error.
    const body = { addons_groups: [{ addons_group_id: 'G1', name_en: 'Test' }] };
    expect(extractCatalogList(body).length).toBe(0);            // old path
    expect(normalizeCatalogPayload('addon_group', body).length).toBe(1); // fixed path
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

  it('reads the Lazywait `names` object shape (en/ar/tr) on an item', () => {
    const r = extractCatalogRecord('item', {
      menu_item_id: 'wN2', names: { ar: 'برجر', en: 'Burgeer', tr: 'Burgeer' },
    });
    expect(r?.name_en).toBe('Burgeer');
    expect(r?.name_ar).toBe('برجر');
    expect(r?.name_other).toBe('Burgeer');
  });

  it('reads a category with only a Turkish `names` entry via name_other', () => {
    const r = extractCatalogRecord('category', { id: 'C3', names: { tr: 'Yemekler' } });
    expect(r?.name_en).toBeNull();
    expect(r?.name_ar).toBeNull();
    expect(r?.name_other).toBe('Yemekler');
  });

  it('falls back to `item_names` when `names` is absent', () => {
    const r = extractCatalogRecord('item', { id: 'I5', item_names: { en: 'Fries', ar: 'بطاطس' } });
    expect(r?.name_en).toBe('Fries');
    expect(r?.name_ar).toBe('بطاطس');
  });

  it('reads a price variant label from its `names` object', () => {
    const r = extractCatalogRecord('item', {
      menu_item_id: 'I6', names: { en: 'Burger' },
      prices: [{ price_id: 'PR1', names: { ar: 'دجاج', en: 'Chicken' }, price_with_vat: 8 }],
    });
    expect(r?.prices?.[0].price_id).toBe('PR1');
    expect(r?.prices?.[0].name).toBe('Chicken');
    expect(r?.prices?.[0].price_with_vat).toBe(8);
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
    expect(r?.prices?.[0]).toMatchObject({
      price_id: 'P_S', name: 'Small', price_with_vat: 25, price_excl_vat: 21.74,
    });
    expect(r?.prices?.[1]).toMatchObject({
      price_id: null, name: 'Large', price_with_vat: 40, price_excl_vat: null,
    });
  });

  // The regression that emptied the menu: Lazywait puts the money in `price`,
  // and it is the NET figure. Reading it as gross would overcharge nobody but
  // would under-price every line by the VAT, so it must land in price_excl_vat
  // and leave price_with_vat null for the importer to gross up.
  it('reads the plain `price` field as the VAT-EXCLUSIVE price', () => {
    const r = extractCatalogRecord('item', {
      menu_item_id: 'I_CW', names: { en: 'Chicken Wings' },
      menu_category_id: 'CAT_SIDES',
      prices: [
        { price_id: 'P1', names: { en: 'Small', ar: 'صغير' }, price: 6.086956521739131,
          show_online: true, active: true, calories: 0 },
      ],
    });
    expect(r?.prices?.[0].price_excl_vat).toBe(6.086956521739131);
    expect(r?.prices?.[0].price_with_vat).toBeNull();
    expect(r?.prices?.[0].name_ar).toBe('صغير');
    expect(r?.prices?.[0].show_online).toBe(true);
  });

  // Dashboard-authored items send both, and the gross one is authoritative.
  it('keeps an explicitly supplied price_with_vat alongside `price`', () => {
    const r = extractCatalogRecord('item', {
      menu_item_id: 'I_EX', names: { en: 'Extreme' },
      prices: [{ price_id: 'P2', price: 21.73913043478261, price_with_vat: 25 }],
    });
    expect(r?.prices?.[0].price_excl_vat).toBe(21.73913043478261);
    expect(r?.prices?.[0].price_with_vat).toBe(25);
  });

  it('reads menu_category_id as the item parent', () => {
    const r = extractCatalogRecord('item', {
      menu_item_id: 'I9', names: { en: 'X' }, menu_category_id: 'CAT_9',
    });
    expect(r?.parent_id).toBe('CAT_9');
  });

  it('reads details{en,ar} as the item description', () => {
    const r = extractCatalogRecord('item', {
      menu_item_id: 'I10', names: { en: 'Wings' },
      details: { en: 'Five or ten pieces.', ar: 'خمس أو عشر قطع' },
    });
    expect(r?.description_en).toBe('Five or ten pieces.');
    expect(r?.description_ar).toBe('خمس أو عشر قطع');
  });

  it('carries record-level show_online / active', () => {
    const r = extractCatalogRecord('item', {
      menu_item_id: 'I11', names: { en: 'Extra Bread' }, show_online: false, active: true,
    });
    expect(r?.show_online).toBe(false);
    expect(r?.active).toBe(true);
  });

  it('falls back to a single flat numeric price, read as net', () => {
    const r = extractCatalogRecord('item', { id: 'I2', name_en: 'Water', price: 3 });
    expect(r?.prices?.length).toBe(1);
    expect(r?.prices?.[0].price_excl_vat).toBe(3);
    expect(r?.prices?.[0].price_with_vat).toBeNull();
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
