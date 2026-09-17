import { describe, expect, it } from 'vitest';
import {
  DURATION_OPTIONS,
  REASON_OPTIONS,
  TILE_HUES,
  activeVariants,
  closedItems,
  closedModifierIds,
  closedOptions,
  closedProductIds,
  closedVariantIds,
  closedVariants,
  formatRemaining,
  fromPrice,
  groupsForProduct,
  productBlockedByOptions,
  productBlockedBySizes,
  reopenAllTargets,
  requiredCount,
  searchableGroups,
  tileHue,
} from './branchConsole';
import type { Category, Modifier, ModifierGroup, Product, ProductVariant } from '../../types';
import type {
  BranchAvailabilityRow, BranchModifierAvailabilityRow, BranchVariantAvailabilityRow,
} from '../../lib/opsApi';

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  categoryId: 'c1',
  nameAr: `صنف ${id}`,
  nameEn: `Item ${id}`,
  descriptionAr: '', descriptionEn: '',
  price: 10, imageUrl: '', calories: 0,
  isActive: true, earnsLoyaltyPoints: true, modifierGroupIds: [], variants: [],
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

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
const modifier = (id: string, groupId = 'g1'): Modifier => ({
  id, groupId, nameAr: `خيار ${id}`, nameEn: `Option ${id}`, price: 0,
});

const group = (id: string, over: Partial<ModifierGroup> = {}): ModifierGroup => ({
  id, nameAr: `مجموعة ${id}`, nameEn: `Group ${id}`,
  minSelection: 0, maxSelection: 1, isRequired: false,
  modifiers: [modifier('m1', id), modifier('m2', id)],
  ...over,
});

const modRow = (
  modifierId: string, over: Partial<BranchModifierAvailabilityRow> = {},
): BranchModifierAvailabilityRow => ({
  modifierId, isAvailable: false, snoozedUntil: null, reasonCode: null, ...over,
});

describe('closedModifierIds', () => {
  it('lists only the closed options', () => {
    const ids = closedModifierIds([modRow('m1'), modRow('m2', { isAvailable: true })]);
    expect([...ids]).toEqual(['m1']);
  });
});

describe('closedOptions', () => {
  it('carries the owning group so a cashier knows which choice is affected', () => {
    const out = closedOptions([group('g1')], [modRow('m1')]);
    expect(out).toHaveLength(1);
    expect(out[0].modifier.id).toBe('m1');
    expect(out[0].group.id).toBe('g1');
  });

  it('sorts soonest-returning first and puts untimed closures last', () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 600_000).toISOString();
    const g = group('g1', { modifiers: [modifier('m1'), modifier('m2'), modifier('m3')] });
    const out = closedOptions([g], [
      modRow('m1', { snoozedUntil: null }),
      modRow('m2', { snoozedUntil: later }),
      modRow('m3', { snoozedUntil: soon }),
    ]);
    expect(out.map((o) => o.modifier.id)).toEqual(['m3', 'm2', 'm1']);
  });

  it('ignores rows for options this catalog no longer has', () => {
    expect(closedOptions([group('g1')], [modRow('gone')])).toEqual([]);
  });
});

describe('groupsForProduct', () => {
  it('keeps the product\u2019s own group order', () => {
    const p = product('p1', { modifierGroupIds: ['g2', 'g1'] });
    expect(groupsForProduct(p, [group('g1'), group('g2')]).map((g) => g.id)).toEqual(['g2', 'g1']);
  });

  it('drops ids with no matching group instead of rendering holes', () => {
    const p = product('p1', { modifierGroupIds: ['g1', 'missing'] });
    expect(groupsForProduct(p, [group('g1')]).map((g) => g.id)).toEqual(['g1']);
  });
});

describe('requiredCount', () => {
  it('a required group needs one even when minSelection is 0', () => {
    expect(requiredCount(group('g1', { isRequired: true, minSelection: 0 }))).toBe(1);
  });
  it('an optional group needs nothing', () => {
    expect(requiredCount(group('g1'))).toBe(0);
  });
});

describe('productBlockedByOptions', () => {
  const required = group('g1', { isRequired: true });
  const p = product('p1', { modifierGroupIds: ['g1'] });

  it('one option left in a required group does NOT block the product', () => {
    // Closing one sauce is not closing the burger.
    expect(productBlockedByOptions(p, [required], new Set(['m1']))).toBe(false);
  });

  it('every option closed in a required group blocks the product', () => {
    expect(productBlockedByOptions(p, [required], new Set(['m1', 'm2']))).toBe(true);
  });

  it('an OPTIONAL group never blocks, however many options are closed', () => {
    const optional = group('g1');
    expect(productBlockedByOptions(p, [optional], new Set(['m1', 'm2']))).toBe(false);
  });

  it('blocks when fewer options remain than a multi-select minimum demands', () => {
    const two = group('g1', { isRequired: true, minSelection: 2, maxSelection: 3 });
    expect(productBlockedByOptions(p, [two], new Set(['m1']))).toBe(true);
  });

  it('a product with no groups is never blocked', () => {
    expect(productBlockedByOptions(product('p2'), [required], new Set(['m1', 'm2']))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cashier grid helpers
// ---------------------------------------------------------------------------

const variant = (
  id: string, price: number, over: Partial<ProductVariant> = {},
): ProductVariant => ({
  id, productId: 'p1', nameAr: `حجم ${id}`, nameEn: `Size ${id}`,
  price, calories: null, isActive: true, sortOrder: 0, ...over,
});

describe('tileHue', () => {
  const cats = [category('c1', 1), category('c2', 2), category('c3', 3)];

  it('gives two categories two different colours', () => {
    // The whole point of the fallback: a cashier finds the block of colour, not
    // the letter. Same hue for neighbouring categories would defeat it.
    expect(tileHue('c1', cats)).not.toBe(tileHue('c2', cats));
  });

  it('is stable for the same category', () => {
    expect(tileHue('c2', cats)).toBe(tileHue('c2', cats));
  });

  it('wraps rather than running off the end of the palette', () => {
    const many = Array.from({ length: TILE_HUES.length + 3 }, (_, i) => category(`k${i}`, i));
    for (const c of many) expect(TILE_HUES).toContain(tileHue(c.id, many));
  });

  it('gives an uncategorised product a real colour rather than undefined', () => {
    expect(TILE_HUES).toContain(tileHue(null, cats));
    expect(TILE_HUES).toContain(tileHue('gone', cats));
  });
});

describe('activeVariants', () => {
  it('drops inactive tiers — a retired size is not a size a cashier can sell', () => {
    const p = product('p1', {
      variants: [variant('v1', 10), variant('v2', 20, { isActive: false })],
    });
    expect(activeVariants(p).map((v) => v.id)).toEqual(['v1']);
  });

  it('sorts cheapest first, then by name so equal prices do not shuffle', () => {
    const p = product('p1', {
      variants: [
        variant('v3', 30), variant('v1', 10),
        variant('vb', 20, { nameEn: 'B' }), variant('va', 20, { nameEn: 'A' }),
      ],
    });
    expect(activeVariants(p).map((v) => v.id)).toEqual(['v1', 'va', 'vb', 'v3']);
  });

  it('does not mutate the product it was handed', () => {
    const p = product('p1', { variants: [variant('v3', 30), variant('v1', 10)] });
    activeVariants(p);
    expect(p.variants.map((v) => v.id)).toEqual(['v3', 'v1']);
  });

  it('a product with no tiers has none, rather than throwing', () => {
    expect(activeVariants(product('p2'))).toEqual([]);
  });
});

describe('fromPrice', () => {
  it('is the cheapest ACTIVE tier, not the denormalised column', () => {
    // `product.price` is a copy that can drift. The tile and the sheet must
    // never disagree about what the item costs.
    const p = product('p1', {
      price: 99,
      variants: [variant('v1', 25), variant('v2', 12), variant('v3', 5, { isActive: false })],
    });
    expect(fromPrice(p)).toBe(12);
  });

  it('falls back to the product price when there are no tiers', () => {
    expect(fromPrice(product('p2', { price: 7 }))).toBe(7);
  });
});

describe('reopenAllTargets', () => {
  // The helper takes the DISPLAYED items, so every case here goes through
  // `closedItems` first — that composition is the property under test.
  const catalog = [product('p1'), product('p2'), product('p3')];

  it('names every closed product and nothing else', () => {
    const rows: BranchAvailabilityRow[] = [
      { productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
      { productId: 'p2', isAvailable: true, snoozedUntil: null, reasonCode: null },
      { productId: 'p3', isAvailable: false, snoozedUntil: '2026-01-01T00:00:00Z', reasonCode: 'out_of_stock' },
    ];
    expect(reopenAllTargets(closedItems(catalog, rows)).sort()).toEqual(['p1', 'p3']);
  });

  it('includes the UNTIMED closures, which is the case worth stating', () => {
    // An admin delisting has no timer, so the sweeper will never clear it. If
    // "reopen all" skipped those it would leave exactly the items that need it.
    const rows: BranchAvailabilityRow[] = [
      { productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ];
    expect(reopenAllTargets(closedItems(catalog, rows))).toEqual(['p1']);
  });

  it('is empty when nothing is closed', () => {
    expect(reopenAllTargets([])).toEqual([]);
  });

  it('never clears a row the cashier was not shown', () => {
    // THE REGRESSION THIS SIGNATURE EXISTS FOR (#393 review). A closed
    // availability row can name a product the client catalog does not carry —
    // deactivated, or unreadable by this role. `closedItems` drops it from the
    // count; the first version of this helper read the raw rows and kept it, so
    // the confirm said one number and the action did another.
    const rows: BranchAvailabilityRow[] = [
      { productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
      { productId: 'ghost', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ];
    const shown = closedItems(catalog, rows);
    expect(shown).toHaveLength(1);
    expect(reopenAllTargets(shown)).toEqual(['p1']);
  });

  it('returns exactly as many ids as the confirm counts, for any catalog', () => {
    // Stated as the invariant rather than as a case: the number a cashier
    // agrees to and the number of RPCs fired are the same list.
    const rows: BranchAvailabilityRow[] = [
      { productId: 'p1', isAvailable: false, snoozedUntil: null, reasonCode: null },
      { productId: 'p3', isAvailable: false, snoozedUntil: null, reasonCode: null },
      { productId: 'ghost', isAvailable: false, snoozedUntil: null, reasonCode: null },
    ];
    for (const cat of [catalog, [product('p1')], []]) {
      const shown = closedItems(cat, rows);
      expect(reopenAllTargets(shown)).toHaveLength(shown.length);
    }
  });
});

const varRow = (
  variantId: string, over: Partial<BranchVariantAvailabilityRow> = {},
): BranchVariantAvailabilityRow => ({
  variantId, isAvailable: false, snoozedUntil: null, reasonCode: null, ...over,
});

describe('closedVariantIds', () => {
  it('lists only the closed tiers', () => {
    const ids = closedVariantIds([varRow('v1'), varRow('v2', { isAvailable: true })]);
    expect([...ids]).toEqual(['v1']);
  });
});

describe('closedVariants', () => {
  it('carries the owning PRODUCT, because "Large" alone names nothing', () => {
    const p = product('p1', { variants: [variant('v1', 10)] });
    const out = closedVariants([p], [varRow('v1')]);
    expect(out).toHaveLength(1);
    expect(out[0].variant.id).toBe('v1');
    expect(out[0].product.id).toBe('p1');
  });

  it('sorts soonest-returning first and puts untimed closures last', () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 600_000).toISOString();
    const p = product('p1', {
      variants: [variant('v1', 10), variant('v2', 20), variant('v3', 30)],
    });
    const out = closedVariants([p], [
      varRow('v1', { snoozedUntil: null }),
      varRow('v2', { snoozedUntil: later }),
      varRow('v3', { snoozedUntil: soon }),
    ]);
    expect(out.map((o) => o.variant.id)).toEqual(['v3', 'v2', 'v1']);
  });

  it('ignores rows for tiers this catalog no longer has', () => {
    expect(closedVariants([product('p1')], [varRow('gone')])).toEqual([]);
  });

  it('ignores an INACTIVE tier — the sheet cannot show it and nobody can reopen it', () => {
    // The Lazywait importer deactivates a tier it stops seeing rather than
    // deleting it, so a stale closed row can outlive the size it names.
    const p = product('p1', { variants: [variant('v1', 10, { isActive: false })] });
    expect(closedVariants([p], [varRow('v1')])).toEqual([]);
  });
});

describe('productBlockedBySizes', () => {
  it('EVERY size closed blocks the product', () => {
    const p = product('p1', { variants: [variant('v1', 10), variant('v2', 20)] });
    expect(productBlockedBySizes(p, new Set(['v1', 'v2']))).toBe(true);
  });

  it('one size still open does not', () => {
    const p = product('p1', { variants: [variant('v1', 10), variant('v2', 20)] });
    expect(productBlockedBySizes(p, new Set(['v1']))).toBe(false);
  });

  it('a product with NO tiers is never blocked by this rule', () => {
    // `every` on an empty list is true, so without the length guard the
    // untiered majority of the menu would be marked unorderable.
    expect(productBlockedBySizes(product('p1'), new Set(['v1']))).toBe(false);
  });

  it('an INACTIVE tier does not keep a product alive', () => {
    // A retired size is not something a customer can order, so a product whose
    // only ACTIVE tier is closed is blocked even though an inactive one is not.
    const p = product('p1', {
      variants: [variant('v1', 10), variant('v2', 20, { isActive: false })],
    });
    expect(productBlockedBySizes(p, new Set(['v1']))).toBe(true);
  });

  it('closing nothing blocks nothing', () => {
    const p = product('p1', { variants: [variant('v1', 10)] });
    expect(productBlockedBySizes(p, new Set())).toBe(false);
  });
});
