import { describe, expect, it } from 'vitest';

import { buildMenuSections, buildSearchIndex, menuItemKey } from './menuSections';
import type { Category, Product } from '../../types/models';

function product(id: string, over: Partial<Product> = {}): Product {
  return {
    id, categoryId: 'c1', nameEn: `Name ${id}`, nameAr: `اسم ${id}`, descriptionEn: `desc ${id}`,
    descriptionAr: '', price: 10, imageUrl: '', calories: 0, isActive: true, modifierGroupIds: [],
    ...over,
  };
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
    isAvailable: allAvailable,
    hasModifiers: noModifiers,
    ...over,
  });
}

describe('menuItemKey (branch-selection crash regression)', () => {
  it('returns the stable product id for real rows', () => {
    expect(menuItemKey({ product: product('p9'), hasModifiers: false }, 4)).toBe('p9');
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

  it('filters inactive products and branch-unavailable products', () => {
    const products = [product('p1', { isActive: false }), product('p2'), product('p3')];
    const out = build({ products, isAvailable: (pid) => pid !== 'p3' });
    expect(out[0].data.map((i) => i.product.id)).toEqual(['p2']);
  });

  it('orders sections by category sortOrder and drops empty sections', () => {
    const products = [product('p1', { categoryId: 'late' }), product('p2', { categoryId: 'early' })];
    const out = buildMenuSections({
      products,
      categories: [category('late', 9), category('early', 1), category('empty', 5)],
      branchId: 'b1', query: '', searchIndex: buildSearchIndex(products),
      isAvailable: allAvailable, hasModifiers: noModifiers,
    });
    expect(out.map((s) => s.category.id)).toEqual(['early', 'late']);
  });

  it('carries the injected hasModifiers flag per item', () => {
    const products = [product('p1'), product('p2')];
    const out = build({ products, hasModifiers: (p) => p.id === 'p2' });
    expect(out[0].data.map((i) => i.hasModifiers)).toEqual([false, true]);
  });
});
