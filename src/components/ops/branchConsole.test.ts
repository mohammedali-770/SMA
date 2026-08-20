import { describe, expect, it } from 'vitest';
import {
  DURATION_OPTIONS,
  REASON_OPTIONS,
  closedItems,
  closedProductIds,
  formatRemaining,
  searchableGroups,
} from './branchConsole';
import type { Category, Product } from '../../types';
import type { BranchAvailabilityRow } from '../../lib/opsApi';

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  categoryId: 'c1',
  nameAr: `صنف ${id}`,
  nameEn: `Item ${id}`,
  descriptionAr: '', descriptionEn: '',
  price: 10, imageUrl: '', calories: 0,
  isActive: true, modifierGroupIds: [],
  ...over,
});

const category = (id: string, sortOrder: number): Category => ({
  id, nameAr: `تصنيف ${id}`, nameEn: `Cat ${id}`, sortOrder,
});

const row = (
  productId: string,
  isAvailable: boolean,
  snoozedUntil: string | null = null,
): BranchAvailabilityRow => ({ productId, isAvailable, snoozedUntil, reasonCode: null });

describe('duration and reason vocabularies', () => {
  it('offers only timed closures — a cashier cannot close something forever', () => {
    // The untimed close is deliberately an admin-only control. If an "until I
    // reopen" option ever appears here, items start staying closed over
    // weekends again, which is the failure this feature exists to prevent.
    expect(DURATION_OPTIONS.every((d) => d.minutes > 0)).toBe(true);
    expect(DURATION_OPTIONS.map((d) => d.minutes)).toEqual([30, 60, 180, 360, 720]);
  });

  it('stays inside the server-side 1..1440 minute bound', () => {
    expect(DURATION_OPTIONS.every((d) => d.minutes >= 1 && d.minutes <= 1440)).toBe(true);
  });

  it('matches the reason_code vocabulary the database accepts', () => {
    expect(REASON_OPTIONS.map((r) => r.code)).toEqual([
      'out_of_stock', 'supplier_delay', 'equipment_down', 'quality_hold', 'other',
    ]);
  });
});

describe('formatRemaining', () => {
  const now = Date.parse('2026-08-20T10:00:00.000Z');
  const inMs = (ms: number) => new Date(now + ms).toISOString();

  it('formats under an hour as M:SS', () => {
    expect(formatRemaining(inMs(90_000), now)).toBe('1:30');
  });

  it('formats an hour or more as H:MM:SS', () => {
    expect(formatRemaining(inMs(3_661_000), now)).toBe('1:01:01');
  });

  it('returns null once the timer has run out, so the UI can say "reopening now"', () => {
    // A stopped clock reads as a broken screen; null lets the caller say
    // something true instead.
    expect(formatRemaining(inMs(0), now)).toBeNull();
    expect(formatRemaining(inMs(-5_000), now)).toBeNull();
  });

  it('returns null for an untimed closure or an unparseable value', () => {
    expect(formatRemaining(null, now)).toBeNull();
    expect(formatRemaining('not a date', now)).toBeNull();
  });
});

describe('closedItems', () => {
  const products = [product('p1'), product('p2'), product('p3')];
  const t = (mins: number) => new Date(Date.parse('2026-08-20T10:00:00Z') + mins * 60_000).toISOString();

  it('returns only closed products', () => {
    const out = closedItems(products, [row('p1', false, t(30)), row('p2', true)]);
    expect(out.map((c) => c.product.id)).toEqual(['p1']);
  });

  it('puts the soonest-returning item first', () => {
    const out = closedItems(products, [row('p1', false, t(60)), row('p2', false, t(10))]);
    expect(out.map((c) => c.product.id)).toEqual(['p2', 'p1']);
  });

  it('sorts untimed closures last — they are admin delistings, not a wait', () => {
    const out = closedItems(products, [row('p1', false, null), row('p2', false, t(60))]);
    expect(out.map((c) => c.product.id)).toEqual(['p2', 'p1']);
  });

  it('ignores rows whose product is not in the catalog', () => {
    expect(closedItems(products, [row('ghost', false, t(30))])).toEqual([]);
  });
});

describe('closedProductIds', () => {
  it('collects every closed id and no available ones', () => {
    const ids = closedProductIds([row('p1', false), row('p2', true), row('p3', false)]);
    expect([...ids].sort()).toEqual(['p1', 'p3']);
  });
});

describe('searchableGroups', () => {
  const categories = [category('c2', 2), category('c1', 1)];
  const products = [
    product('p1', { categoryId: 'c1', nameEn: 'Spicy Fries', nameAr: 'بطاطس حارة' }),
    product('p2', { categoryId: 'c2', nameEn: 'Cola' }),
    product('p3', { categoryId: 'c1', isActive: false }),
  ];

  it('groups by category in menu order', () => {
    const out = searchableGroups(products, categories, '');
    expect(out.map((g) => g.categoryId)).toEqual(['c1', 'c2']);
  });

  it('excludes inactive products — a delisted item is not the counter\'s to reopen', () => {
    const out = searchableGroups(products, categories, '');
    expect(out.flatMap((g) => g.products.map((p) => p.id))).not.toContain('p3');
  });

  it('searches both languages', () => {
    expect(searchableGroups(products, categories, 'spicy')[0].products[0].id).toBe('p1');
    expect(searchableGroups(products, categories, 'حارة')[0].products[0].id).toBe('p1');
  });

  it('drops categories with no match rather than showing empty headers', () => {
    const out = searchableGroups(products, categories, 'cola');
    expect(out.map((g) => g.categoryId)).toEqual(['c2']);
  });

  it('keeps products whose category is missing reachable under a null group', () => {
    // Otherwise an orphaned product simply cannot be closed from the console.
    const orphan = product('p9', { categoryId: 'gone' });
    const out = searchableGroups([...products, orphan], categories, '');
    expect(out.find((g) => g.categoryId === null)?.products.map((p) => p.id)).toEqual(['p9']);
  });

  it('returns nothing when the search matches nothing', () => {
    expect(searchableGroups(products, categories, 'zzzz')).toEqual([]);
  });
});
