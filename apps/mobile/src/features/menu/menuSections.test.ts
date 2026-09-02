import { describe, expect, it } from 'vitest';

import { buildMenuSections, buildSearchIndex, hasPriceRange, hasTierChoice, menuItemKey } from './menuSections';
import type { Category, Product, ProductVariant } from '../../types/models';

function product(id: string, over: Partial<Product> = {}): Product {
  return {
    id, categoryId: 'c1', nameEn: `Name ${id}`, nameAr: `اسم ${id}`, descriptionEn: `desc ${id}`,
    descriptionAr: '', price: 10, imageUrl: '', calories: 0, isActive: true, sortOrder: 0,
    modifierGroupIds: [],
    variants: [],
    ...over,
  };
}
function tier(id: string, price: number): ProductVariant {
  return { id, productId: 'p1', nameEn: id, nameAr: id, price, calories: null };
}
function category(id: string, sortOrder: number): Category {
  return { id, nameEn: id, nameAr: id, sortOrder };
}

const allAvailable = () => true;
const noModifiers = () => false;

function build(over: Partial<Parameters<typeof buildMenuSections>[0]> = {}) {
  const products = over.products ?? [product('p1')];
  return buildMenuSections({
    products,
    categories: [category('c1', 1)],
    branchId: 'b1',
    query: '',
    searchIndex: buildSearchIndex(products),
    isOrderable: allAvailable,
    hasModifiers: noModifiers,
    ...over,
  });
}

describe('menuItemKey (branch-selection crash regression)', () => {
  it('returns the stable product id for real rows', () => {
    expect(menuItemKey({ product: product('p9'), needsChoice: false, showFromPrice: false, available: true }, 4)).toBe('p9');
  });
  it('NEVER throws on the synthetic header/footer rows RN feeds through keyExtractor', () => {
    // Reproduced crash: VirtualizedSectionList._convertViewable calls
    // keyExtractor(undefined, index) for section header/footer tokens the
    // moment the menu mounts after selecting a branch. This must not throw.
    expect(() => menuItemKey(undefined, 7)).not.toThrow();
    expect(menuItemKey(undefined, 7)).toBe('menu-row-7');
    expect(menuItemKey(null, 0)).toBe('menu-row-0');
  });
  it('synthetic keys are positional and distinct', () => {
    expect(menuItemKey(undefined, 1)).not.toBe(menuItemKey(undefined, 2));
  });
});

describe('buildSearchIndex', () => {
  it('lowercases EN name, AR name and EN description per product', () => {
    const idx = buildSearchIndex([product('p1', { nameEn: 'Spicy BURGER', nameAr: 'برجر حار', descriptionEn: 'Crispy Chicken' })]);
    const text = idx.get('p1')!;
    expect(text).toContain('spicy burger');
    expect(text).toContain('برجر حار');
    expect(text).toContain('crispy chicken');
  });
});

describe('buildMenuSections', () => {
  it('no branch selected → no sections', () => {
    expect(build({ branchId: null })).toEqual([]);
  });

  it('empty query includes all active/available products', () => {
    const out = build({ products: [product('p1'), product('p2')] });
    expect(out[0].data.map((i) => i.product.id)).toEqual(['p1', 'p2']);
  });

  it('search matches English name case-insensitively', () => {
    const products = [product('p1', { nameEn: 'Spicy Burger' }), product('p2', { nameEn: 'Fries' })];
    const out = build({ products, query: 'SPICY' });
    expect(out[0].data.map((i) => i.product.id)).toEqual(['p1']);
  });

  it('search matches Arabic name', () => {
    const products = [product('p1', { nameAr: 'برجر حار' }), product('p2', { nameAr: 'بطاطس' })];
    const out = build({ products, query: 'برجر' });
    expect(out[0].data.map((i) => i.product.id)).toEqual(['p1']);
  });

  it('search matches English description', () => {
    const products = [product('p1', { descriptionEn: 'with golden fries' }), product('p2')];
    const out = build({ products, query: 'golden' });
    expect(out[0].data.map((i) => i.product.id)).toEqual(['p1']);
  });

  it('filters DELISTED products out entirely', () => {
    const products = [product('p1', { isActive: false }), product('p2')];
    const out = build({ products });
    expect(out[0].data.map((i) => i.product.id)).toEqual(['p2']);
  });

  it('KEEPS branch-unavailable products, flagged rather than removed', () => {
    // Changed deliberately: a sold-out item used to vanish, which reads to a
    // customer as "the app lost it". It now stays listed and renders as out of
    // stock, so the menu answers the question instead of raising it.
    const products = [product('p1'), product('p2'), product('p3')];
    const out = build({ products, isOrderable: (pid) => pid !== 'p3' });
    expect(out[0].data.map((i) => i.product.id)).toEqual(['p1', 'p2', 'p3']);
    expect(out[0].data.map((i) => i.available)).toEqual([true, true, false]);
  });

  it('keeps a category whose items are all sold out', () => {
    const products = [product('p1')];
    const out = build({ products, isOrderable: () => false });
    expect(out).toHaveLength(1);
    expect(out[0].data[0].available).toBe(false);
  });

  it('does not reorder sold-out items — the menu stays where customers expect', () => {
    const products = [product('p1'), product('p2'), product('p3')];
    const out = build({ products, isOrderable: (pid) => pid === 'p2' });
    expect(out[0].data.map((i) => i.product.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('orders sections by category sortOrder and drops empty sections', () => {
    const products = [product('p1', { categoryId: 'late' }), product('p2', { categoryId: 'early' })];
    const out = buildMenuSections({
      products,
      categories: [category('late', 9), category('early', 1), category('empty', 5)],
      branchId: 'b1', query: '', searchIndex: buildSearchIndex(products),
      isOrderable: allAvailable, hasModifiers: noModifiers,
    });
    expect(out.map((s) => s.category.id)).toEqual(['early', 'late']);
  });

  it('carries the injected hasModifiers flag per item as needsChoice', () => {
    const products = [product('p1'), product('p2')];
    const out = build({ products, hasModifiers: (p) => p.id === 'p2' });
    expect(out[0].data.map((i) => i.needsChoice)).toEqual([false, true]);
  });
});

describe('tier choice — a multi-tier product must never be added from the card', () => {
  it('hasTierChoice is true only above one tier', () => {
    expect(hasTierChoice(product('p', { variants: [] }))).toBe(false);
    expect(hasTierChoice(product('p', { variants: [tier('a', 10)] }))).toBe(false);
    expect(hasTierChoice(product('p', { variants: [tier('a', 10), tier('b', 14)] }))).toBe(true);
  });

  it('needsChoice is set by tiers ALONE, with no modifier groups', () => {
    // The regression this exists for: a tiered product with no modifiers used
    // to be added straight from the card, silently taking the cheapest tier.
    const products = [product('p1', { variants: [tier('s', 20), tier('l', 26)] })];
    const out = build({ products, hasModifiers: () => false });
    expect(out[0].data[0].needsChoice).toBe(true);
  });

  it('a single-tier product is still one-tap addable', () => {
    const products = [product('p1', { variants: [tier('only', 20)] })];
    const out = build({ products, hasModifiers: () => false });
    expect(out[0].data[0].needsChoice).toBe(false);
  });
});

describe('from-price — only claim a range when one exists', () => {
  it('is true when the tiers span different prices', () => {
    expect(hasPriceRange(product('p', { variants: [tier('s', 20), tier('l', 26)] }))).toBe(true);
  });

  it('is FALSE when every tier costs the same', () => {
    // Live data: Kinza is six flavours all at 2.00, Kids Meal eight at 15.00.
    // "from 2.00" would advertise a cheaper option that does not exist.
    const flavours = [tier('cola', 2), tier('pepsi', 2), tier('orange', 2)];
    expect(hasPriceRange(product('p', { variants: flavours }))).toBe(false);
  });

  it('is false for one tier and for none', () => {
    expect(hasPriceRange(product('p', { variants: [tier('a', 10)] }))).toBe(false);
    expect(hasPriceRange(product('p', { variants: [] }))).toBe(false);
  });

  it('same-price flavours still need a choice, they just do not show "from"', () => {
    const products = [product('p1', { variants: [tier('cola', 2), tier('pepsi', 2)] })];
    const out = build({ products, hasModifiers: () => false });
    expect(out[0].data[0].needsChoice).toBe(true);
    expect(out[0].data[0].showFromPrice).toBe(false);
  });

  it('does not depend on tier order — cheapest last still reads as a range', () => {
    expect(hasPriceRange(product('p', { variants: [tier('big', 30), tier('small', 12)] }))).toBe(true);
  });
});

describe('product order within a category', () => {
  it('follows sortOrder, not the order the products arrived in', () => {
    // The administrator's ordering is the whole point; the input array is
    // deliberately shuffled relative to it.
    const sections = build({
      products: [
        product('p1', { sortOrder: 3, nameEn: 'Wings' }),
        product('p2', { sortOrder: 1, nameEn: 'Cheese fries' }),
        product('p3', { sortOrder: 2, nameEn: 'Fries' }),
      ],
    });
    expect(sections[0].data.map((d) => d.product.nameEn)).toEqual(['Cheese fries', 'Fries', 'Wings']);
  });

  it('breaks ties by name so an UNORDERED menu is still stable', () => {
    // This is today's live data: every product at sort_order 0. Without a
    // tie-break the order is whatever the fetch happened to return, which can
    // differ between two loads of the same menu.
    const sections = build({
      products: [
        product('p1', { sortOrder: 0, nameEn: 'Wings' }),
        product('p2', { sortOrder: 0, nameEn: 'Cheese fries' }),
        product('p3', { sortOrder: 0, nameEn: 'Fries' }),
      ],
    });
    expect(sections[0].data.map((d) => d.product.nameEn)).toEqual(['Cheese fries', 'Fries', 'Wings']);
  });

  it('does not mutate the caller\'s products array', () => {
    // buildMenuSections is called on every keystroke in the search box; sorting
    // the caller's array in place would reorder the app's catalog state.
    const products = [
      product('p1', { sortOrder: 2, nameEn: 'B' }),
      product('p2', { sortOrder: 1, nameEn: 'A' }),
    ];
    const before = products.map((p) => p.id);
    build({ products });
    expect(products.map((p) => p.id)).toEqual(before);
  });

  it('orders within EACH category independently', () => {
    // reorder_products is category-scoped, so rank 1 exists in every category.
    const sections = buildMenuSections({
      products: [
        product('p1', { categoryId: 'c1', sortOrder: 2, nameEn: 'A2' }),
        product('p2', { categoryId: 'c2', sortOrder: 1, nameEn: 'B1' }),
        product('p3', { categoryId: 'c1', sortOrder: 1, nameEn: 'A1' }),
        product('p4', { categoryId: 'c2', sortOrder: 2, nameEn: 'B2' }),
      ],
      categories: [category('c1', 1), category('c2', 2)],
      branchId: 'b1',
      query: '',
      searchIndex: new Map(),
      isOrderable: allAvailable,
      hasModifiers: noModifiers,
    });
    expect(sections.map((s) => s.data.map((d) => d.product.nameEn))).toEqual([['A1', 'A2'], ['B1', 'B2']]);
  });
});
