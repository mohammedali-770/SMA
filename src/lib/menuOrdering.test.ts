import { describe, expect, it } from 'vitest';

import { moveWithin, productsInCategory, sortRows } from './menuOrdering';

const row = (id: string, sortOrder: number | undefined, nameEn: string) => ({ id, sortOrder, nameEn });

describe('sortRows', () => {
  it('orders by rank ascending', () => {
    const got = sortRows([row('c', 3, 'C'), row('a', 1, 'A'), row('b', 2, 'B')]);
    expect(got.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by English name, so an UNORDERED list is still stable', () => {
    // Today's live data: all 55 products sit at sort_order 0. Without the
    // tie-break the dashboard and the app could disagree, and either could
    // differ between two loads.
    const got = sortRows([row('x', 0, 'Wings'), row('y', 0, 'Cheese fries'), row('z', 0, 'Fries')]);
    expect(got.map((r) => r.nameEn)).toEqual(['Cheese fries', 'Fries', 'Wings']);
  });

  it('treats an absent rank as 0 rather than sorting it last', () => {
    // A parsed CSV row has no rank yet; it must not be silently demoted.
    const got = sortRows([row('a', 2, 'A'), row('b', undefined, 'B')]);
    expect(got.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('does not mutate its input', () => {
    const rows = [row('b', 2, 'B'), row('a', 1, 'A')];
    const before = rows.map((r) => r.id);
    sortRows(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('moveWithin', () => {
  const rows = [row('a', 1, 'A'), row('b', 2, 'B'), row('c', 3, 'C')];

  it('swaps with the previous item on up', () => {
    expect(moveWithin(rows, 1, 'up')).toEqual(['b', 'a', 'c']);
  });

  it('swaps with the next item on down', () => {
    expect(moveWithin(rows, 1, 'down')).toEqual(['a', 'c', 'b']);
  });

  it('returns null at the ends, so no pointless write is issued', () => {
    expect(moveWithin(rows, 0, 'up')).toBeNull();
    expect(moveWithin(rows, 2, 'down')).toBeNull();
  });

  it('returns null for an out-of-range or non-integer index', () => {
    expect(moveWithin(rows, -1, 'down')).toBeNull();
    expect(moveWithin(rows, 3, 'up')).toBeNull();
    expect(moveWithin(rows, 1.5, 'up')).toBeNull();
    expect(moveWithin([], 0, 'up')).toBeNull();
  });

  it('returns EVERY id, not just the two that moved', () => {
    // The RPC assigns ranks from array position over the whole list, so a
    // partial array would silently renumber the menu.
    const five = ['a', 'b', 'c', 'd', 'e'].map((id, i) => row(id, i + 1, id.toUpperCase()));
    expect(moveWithin(five, 3, 'up')).toEqual(['a', 'b', 'd', 'c', 'e']);
  });

  it('does not mutate its input', () => {
    const before = rows.map((r) => r.id);
    moveWithin(rows, 1, 'up');
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('productsInCategory', () => {
  const products = [
    { id: 'p1', categoryId: 'c1', sortOrder: 2, nameEn: 'A2' },
    { id: 'p2', categoryId: 'c2', sortOrder: 1, nameEn: 'B1' },
    { id: 'p3', categoryId: 'c1', sortOrder: 1, nameEn: 'A1' },
  ];

  it('returns only that category, in display order', () => {
    expect(productsInCategory(products, 'c1').map((p) => p.id)).toEqual(['p3', 'p1']);
  });

  it('never leaks a sibling from another category into the list sent to the RPC', () => {
    // reorder_products refuses the whole call on a cross-category id, so a leak
    // here would surface as a hard failure for the administrator.
    expect(productsInCategory(products, 'c2').every((p) => p.categoryId === 'c2')).toBe(true);
  });

  it('returns empty for a category with no products', () => {
    expect(productsInCategory(products, 'nope')).toEqual([]);
  });
});
