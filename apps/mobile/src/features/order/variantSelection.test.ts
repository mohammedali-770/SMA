/**
 * Price tiers in the cart — identity, pricing and how a line is named.
 *
 * These three rules are what stop a customer paying for a Small and receiving
 * a Large. `place_order` re-derives all of it server-side, so nothing here is
 * a security boundary; it is what the customer SEES, and it has to agree with
 * what the server will charge or the cart lies.
 */
import { describe, expect, it } from 'vitest';
import { cartLineLabel, computeUnitPrice, makeCartItemId } from '../../utils/format';
import { mapProduct } from '../../lib/mappers';
import type { CartItem, Modifier, Product, ProductVariant } from '../../types/models';

const NO_MODS: { [groupId: string]: Modifier[] } = {};

const tier = (id: string, nameEn: string, price: number): ProductVariant =>
  ({ id, productId: 'p1', nameEn, nameAr: nameEn, price, calories: null });

const wings: Product = {
  id: 'p1', categoryId: 'c1', nameEn: 'Chicken Wings', nameAr: 'أجنحة الدجاج',
  descriptionEn: '', descriptionAr: '', price: 7, imageUrl: '', calories: 0,
  isActive: true, modifierGroupIds: [],
  variants: [tier('v-s', 'Small', 7), tier('v-l', 'Large', 13)],
};

describe('makeCartItemId — the tier is part of the identity', () => {
  it('keeps a Small and a Large as two separate lines', () => {
    const small = makeCartItemId('p1', NO_MODS, undefined, 'v-s');
    const large = makeCartItemId('p1', NO_MODS, undefined, 'v-l');
    expect(small).not.toBe(large);
  });

  it('merges two of the same tier', () => {
    expect(makeCartItemId('p1', NO_MODS, undefined, 'v-l'))
      .toBe(makeCartItemId('p1', NO_MODS, undefined, 'v-l'));
  });

  it('is unchanged for a product with no tiers', () => {
    expect(makeCartItemId('p1', NO_MODS)).toBe('p1');
    expect(makeCartItemId('p1', NO_MODS, undefined, null)).toBe('p1');
  });

  it('still separates by note and by modifier on top of the tier', () => {
    const a = makeCartItemId('p1', NO_MODS, 'no salt', 'v-l');
    const b = makeCartItemId('p1', NO_MODS, undefined, 'v-l');
    expect(a).not.toBe(b);
  });
});

describe('computeUnitPrice — the tier sets the base', () => {
  it('prices from the chosen tier, not the product "from" price', () => {
    expect(computeUnitPrice(wings, NO_MODS, wings.variants[1])).toBe(13);
  });

  it('falls back to the product price when there is no tier', () => {
    expect(computeUnitPrice(wings, NO_MODS)).toBe(7);
    expect(computeUnitPrice(wings, NO_MODS, null)).toBe(7);
  });

  it('adds modifiers ON TOP of the tier', () => {
    const mods = { g1: [{ id: 'm1', groupId: 'g1', nameEn: 'Extra dip', nameAr: 'صوص', price: 3 }] };
    expect(computeUnitPrice(wings, mods, wings.variants[1])).toBe(16);
  });
});

describe('cartLineLabel — what the line is called', () => {
  const line = (variant?: ProductVariant): CartItem => ({
    cartItemId: 'x', product: wings, variant, selectedModifiers: {}, quantity: 1, unitPrice: 0,
  });
  const pickEn = (en: string) => en;

  it('names the tier next to the product', () => {
    expect(cartLineLabel(line(wings.variants[1]), pickEn)).toBe('Chicken Wings — Large');
  });

  it('omits the tier when there is none', () => {
    expect(cartLineLabel(line(), pickEn)).toBe('Chicken Wings');
  });

  it('does not repeat the product name when the tier just echoes it', () => {
    // The importer names a single UNNAMED Lazywait price after its item, which
    // is most sauces — "Grill Sauce — Grill Sauce" helps nobody.
    expect(cartLineLabel(line(tier('v1', 'Chicken Wings', 7)), pickEn)).toBe('Chicken Wings');
  });
});

describe('mapProduct — which tiers reach the customer', () => {
  const row = {
    id: 'p1', category_id: 'c1', name_en: 'Wings', name_ar: 'أجنحة',
    description_en: null, description_ar: null, price: 7, calories: null,
    image_url: null, is_active: true, sort_order: 1,
  };
  const variantRow = (id: string, name: string, price: number, sort: number, active = true) => ({
    id, product_id: 'p1', name_en: name, name_ar: name, price,
    calories: null, sort_order: sort, is_active: active,
  });

  it('keeps only active tiers, in sort order', () => {
    const p = mapProduct(row, [], [
      variantRow('v-l', 'Large', 13, 2),
      variantRow('v-s', 'Small', 7, 1),
      variantRow('v-dead', 'Retired', 99, 3, false),
    ]);
    expect(p.variants.map((v) => v.nameEn)).toEqual(['Small', 'Large']);
  });

  it('ignores tiers belonging to another product', () => {
    const p = mapProduct(row, [], [{ ...variantRow('v-x', 'Other', 1, 1), product_id: 'p2' }]);
    expect(p.variants).toEqual([]);
  });

  it('gives an untiered product an empty list, never undefined', () => {
    expect(mapProduct(row, []).variants).toEqual([]);
  });
});
