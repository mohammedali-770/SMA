import { describe, expect, it } from 'vitest';

import type { DbModifier, DbModifierGroup, DbProduct, DbProductVariant } from '../types/db';
import { mapPricedMenu } from './catalogMapping';

const product = {
  id: 'P1',
  category_id: 'C1',
  name_en: 'Wings',
  name_ar: 'أجنحة',
  price: '32.00',
  is_active: true,
  sort_order: 1,
} as unknown as DbProduct;
const variants = [
  {
    id: 'V1',
    product_id: 'P1',
    name_en: 'S',
    name_ar: 'ص',
    price: '20',
    calories: null,
    sort_order: 1,
    is_active: true,
  },
  {
    id: 'V2',
    product_id: 'P1',
    name_en: 'L',
    name_ar: 'ك',
    price: '29',
    calories: null,
    sort_order: 2,
    is_active: false,
  },
] as DbProductVariant[];
const groups = [
  { id: 'G1', name_en: 'Sauce', name_ar: 'صوص', min_select: 0, max_select: null, is_required: false },
] as unknown as DbModifierGroup[];
const modifiers = [
  { id: 'M1', group_id: 'G1', name_en: 'Hot', name_ar: 'حار', price: '2.5' },
  { id: 'M2', group_id: 'G9', name_en: 'Other', name_ar: 'آخر', price: '1' },
] as unknown as DbModifier[];

describe('mapPricedMenu', () => {
  it('maps prices, tiers and options the way the full load always has', () => {
    const menu = mapPricedMenu({
      products: [product],
      productVariants: variants,
      modifiers,
      modifierGroups: groups,
      links: [{ product_id: 'P1', group_id: 'G1', sort_order: 0 }],
    });
    expect(menu.products).toHaveLength(1);
    expect(menu.products[0].price).toBe(32);
    expect(menu.products[0].modifierGroupIds).toEqual(['G1']);
    // An inactive tier is never offered, even to a staff session that can read it.
    expect(menu.products[0].variants.map((v) => [v.id, v.price])).toEqual([['V1', 20]]);
    expect(Object.keys(menu.modifierGroupsById)).toEqual(['G1']);
    expect(menu.modifierGroupsById.G1.modifiers.map((m) => [m.id, m.price])).toEqual([['M1', 2.5]]);
  });
});
