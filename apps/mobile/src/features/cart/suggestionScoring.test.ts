import { describe, expect, it } from 'vitest';

import {
  COLD_DIFFERENT,
  COLD_SAME,
  MAX_PER_CATEGORY,
  SUGGESTION_SLOTS,
  classifyAddability,
  eligibleCandidates,
  pickSuggestions,
  scoreCandidate,
  suggestionFeatures,
  type ScoreContext,
  type SuggestionCandidate,
} from './suggestionScoring';
import { EMPTY_STATE, recordAdd, recordImpressions, type SuggestionState } from './suggestionState';
import type { ModifierGroup, Product } from '../../types/models';

const T0 = 1_700_000_000_000;

function product(over: Partial<Product> & { id: string }): Product {
  return {
    categoryId: 'cat-main', nameEn: 'Item', nameAr: 'صنف', descriptionEn: '', descriptionAr: '',
    price: 12, imageUrl: '', calories: 0, isActive: true, modifierGroupIds: [], variants: [],
    ...over,
  };
}

function group(over: Partial<ModifierGroup> = {}): ModifierGroup {
  return {
    id: 'g1', nameEn: 'Size', nameAr: 'الحجم', minSelection: 0, maxSelection: 1, isRequired: false,
    modifiers: [{ id: 'm1', groupId: 'g1', nameEn: 'Large', nameAr: 'كبير', price: 3 }],
    ...over,
  };
}

function candidate(p: Product, rank = 0, addability: 'one-tap' | 'configure' = 'one-tap'): SuggestionCandidate {
  return { product: p, addability, rank };
}

function context(over: Partial<ScoreContext> = {}): ScoreContext {
  return {
    state: EMPTY_STATE, cartCategoryIds: [], cartSubtotal: 0, catalogSize: 10,
    // Pinned by default so a test asserting a personal signal is not also
    // asserting catalog order.
    curation: () => 0.5,
    ...over,
  };
}

function state(over: Partial<SuggestionState> = {}): SuggestionState {
  return { v: 1, t: T0, n: 0, p: {}, c: {}, x: {}, ...over };
}

describe('classifyAddability', () => {
  it('no modifier groups and no tier choice is a one-tap add', () => {
    expect(classifyAddability([], 0)).toBe('one-tap');
    expect(classifyAddability([], 1)).toBe('one-tap');
  });

  it('any resolved group opens the product page, matching the menu', () => {
    expect(classifyAddability([group({ isRequired: false, minSelection: 0 })], 0)).toBe('configure');
    expect(classifyAddability([group({ isRequired: true, minSelection: 1 })], 0)).toBe('configure');
  });

  it('a required group whose modifiers were all deactivated is blocked, not a dead-end tap', () => {
    expect(classifyAddability([group({ isRequired: true, modifiers: [] })], 0)).toBe('blocked');
    expect(classifyAddability([group({ minSelection: 2, modifiers: [group().modifiers[0]] })], 0)).toBe('blocked');
  });

  it('MORE THAN ONE TIER opens the page even with no modifier groups', () => {
    // The suggestion strip's version of the menu-card bug: this classified
    // 'one-tap', so the strip called addItem(product, {}, 1), which falls back
    // to cheapestVariant and handed over the cheapest tier unasked.
    expect(classifyAddability([], 2)).toBe('configure');
    expect(classifyAddability([], 11)).toBe('configure');
  });

  it('blocked still wins over a tier choice — a dead-end group is a dead end', () => {
    expect(classifyAddability([group({ isRequired: true, modifiers: [] })], 5)).toBe('blocked');
  });
});

describe('eligibleCandidates', () => {
  const base = {
    cartProductIds: new Set<string>(), excludedProductIds: new Set<string>(),
    isAvailable: () => true, groupsFor: () => [],
  };

  it('no selected branch yields no suggestions', () => {
    expect(eligibleCandidates({ ...base, products: [product({ id: 'a' })], branchId: null })).toEqual([]);
  });

  it('an inactive product is never suggested', () => {
    const out = eligibleCandidates({ ...base, products: [product({ id: 'a', isActive: false })], branchId: 'b1' });
    expect(out).toEqual([]);
  });

  it('a product unavailable at the selected branch is never suggested', () => {
    const out = eligibleCandidates({
      ...base, products: [product({ id: 'a' }), product({ id: 'b' })], branchId: 'b1',
      isAvailable: (id) => id !== 'a',
    });
    expect(out.map((c) => c.product.id)).toEqual(['b']);
  });

  it('a product already in the cart is excluded by product id, not cart-line id', () => {
    // The live cart line id would be `a::m1,m2` — matching on that would let the
    // product be suggested straight back while it sits in the cart.
    const out = eligibleCandidates({
      ...base, products: [product({ id: 'a' }), product({ id: 'b' })], branchId: 'b1',
      cartProductIds: new Set(['a']),
    });
    expect(out.map((c) => c.product.id)).toEqual(['b']);
  });

  it('a product removed this session is excluded', () => {
    const out = eligibleCandidates({
      ...base, products: [product({ id: 'a' }), product({ id: 'b' })], branchId: 'b1',
      excludedProductIds: new Set(['b']),
    });
    expect(out.map((c) => c.product.id)).toEqual(['a']);
  });

  it('a product whose required group has no modifiers is filtered out entirely', () => {
    const out = eligibleCandidates({
      ...base, products: [product({ id: 'a' }), product({ id: 'b' })], branchId: 'b1',
      groupsFor: (p) => (p.id === 'a' ? [group({ isRequired: true, modifiers: [] })] : []),
    });
    expect(out.map((c) => c.product.id)).toEqual(['b']);
  });

  it('rank is the catalog array index, so admin ordering survives the filter', () => {
    const out = eligibleCandidates({
      ...base,
      products: [product({ id: 'a', isActive: false }), product({ id: 'b' }), product({ id: 'c' })],
      branchId: 'b1',
    });
    expect(out.map((c) => [c.product.id, c.rank])).toEqual([['b', 1], ['c', 2]]);
  });

  it('a product with an optional group is a configure candidate, not a one-tap one', () => {
    const out = eligibleCandidates({
      ...base, products: [product({ id: 'a' })], branchId: 'b1', groupsFor: () => [group()],
    });
    expect(out[0].addability).toBe('configure');
  });
});

describe('features', () => {
  it('affinity saturates: one add is 0.25, three is 0.50, nine is 0.75', () => {
    const f = (a: number) => suggestionFeatures(
      candidate(product({ id: 'p' })),
      context({ state: state({ p: { p: { a, s: 0 } } }) }),
    ).affinity;
    expect(f(1)).toBeCloseTo(0.25, 6);
    expect(f(3)).toBeCloseTo(0.5, 6);
    expect(f(9)).toBeCloseTo(0.75, 6);
  });

  it('price fit peaks at the target and is symmetric in ratio', () => {
    const f = (price: number) => suggestionFeatures(
      candidate(product({ id: 'p', price })), context({ cartSubtotal: 0 }),
    ).priceFit;
    expect(f(12)).toBeCloseTo(1, 6);
    expect(f(24)).toBeCloseTo(f(6), 6);
    expect(f(24)).toBeCloseTo(0.7171, 3);
  });

  it('price fit floors the target at twelve riyals so a tiny cart is not offered the cheapest item', () => {
    // 8 x 0.25 = 2 SAR; without the floor a 2 SAR item would score a perfect 1.
    const cheap = suggestionFeatures(candidate(product({ id: 'p', price: 2 })), context({ cartSubtotal: 8 })).priceFit;
    const proper = suggestionFeatures(candidate(product({ id: 'p', price: 12 })), context({ cartSubtotal: 8 })).priceFit;
    expect(proper).toBeGreaterThan(cheap);
    expect(proper).toBeCloseTo(1, 6);
  });

  it('complement returns the cold prior on a fresh device and prefers a category the cart lacks', () => {
    const ctx = context({ cartCategoryIds: ['burgers'] });
    const different = suggestionFeatures(candidate(product({ id: 'p', categoryId: 'drinks' })), ctx).complement;
    const same = suggestionFeatures(candidate(product({ id: 'p', categoryId: 'burgers' })), ctx).complement;
    expect(different).toBeCloseTo(COLD_DIFFERENT, 6);
    expect(same).toBeCloseTo(COLD_SAME, 6);
  });

  it('complement moves toward the learned pair as confidence rises', () => {
    const pairs = { 'burgers>drinks': 9 };
    const c = candidate(product({ id: 'p', categoryId: 'drinks' }));
    const cold = suggestionFeatures(c, context({ cartCategoryIds: ['burgers'], state: state({ n: 0, x: pairs }) })).complement;
    const warm = suggestionFeatures(c, context({ cartCategoryIds: ['burgers'], state: state({ n: 40, x: pairs }) })).complement;
    expect(cold).toBeCloseTo(COLD_DIFFERENT, 6);
    expect(warm).toBeGreaterThan(cold);
    // learned = 9/12 = 0.75, blended by confidence 40/46.
    expect(warm).toBeCloseTo(0.55 + (0.75 - 0.55) * (40 / 46), 4);
  });

  it('the strongest single pair dominates rather than being averaged away', () => {
    const c = candidate(product({ id: 'p', categoryId: 'drinks' }));
    // BOTH pairs are non-zero, so a mean would be visibly different from a max:
    // max -> saturate(9,3) = 0.75, mean of matched -> (0.75 + 0.25) / 2 = 0.50.
    // "Goes with the burger" must not be diluted by "rarely follows dessert".
    const ctx = context({
      cartCategoryIds: ['burgers', 'desserts'],
      state: state({ n: 40, x: { 'burgers>drinks': 9, 'desserts>drinks': 1 } }),
    });
    const confidence = 40 / 46;
    expect(suggestionFeatures(c, ctx).complement).toBeCloseTo(0.55 + (0.75 - 0.55) * confidence, 6);
    // Pin the negative: the mean-of-matched blend would land here instead.
    expect(suggestionFeatures(c, ctx).complement).not.toBeCloseTo(0.55 + (0.5 - 0.55) * confidence, 3);
  });

  it('confidence is zero on a fresh device, so no personal term can contribute', () => {
    const c = candidate(product({ id: 'p' }));
    const ctx = context({ state: state({ n: 0, p: { p: { a: 50, s: 0 } }, c: { 'cat-main': 50 } }) });
    const f = suggestionFeatures(c, ctx);
    expect(f.confidence).toBe(0);
    expect(f.affinity).toBeGreaterThan(0.9);
    // Same context minus the history scores identically: the gate holds.
    const bare = scoreCandidate(c, context({ state: state({ n: 0 }) })).score;
    expect(scoreCandidate(c, ctx).score).toBeCloseTo(bare, 6);
  });

  it('fatigue is subtracted after the clamp so ignored items can rank below unknown ones', () => {
    const shown = candidate(product({ id: 'p', categoryId: 'burgers', price: 1000 }), 9);
    const ctx = context({
      cartCategoryIds: ['burgers'], cartSubtotal: 0, curation: () => 0,
      state: state({ p: { p: { a: 0, s: 100 } } }),
    });
    const scored = scoreCandidate(shown, ctx);
    expect(scored.score).toBeLessThan(0);
    const fresh = scoreCandidate(candidate(product({ id: 'q', categoryId: 'burgers', price: 1000 }), 9), ctx);
    expect(fresh.score).toBeGreaterThan(scored.score);
  });

  it('a non-finite price cannot produce a NaN score', () => {
    const scored = scoreCandidate(
      candidate(product({ id: 'p', price: Number.NaN })),
      context({ cartSubtotal: Number.NaN }),
    );
    expect(Number.isFinite(scored.score)).toBe(true);
    expect(Object.values(scored.features).every(Number.isFinite)).toBe(true);
  });
});

describe('pickSuggestions determinism', () => {
  const pool = [
    candidate(product({ id: 'a', categoryId: 'c1', price: 12 }), 0),
    candidate(product({ id: 'b', categoryId: 'c2', price: 12 }), 1),
    candidate(product({ id: 'c', categoryId: 'c3', price: 12 }), 2),
    candidate(product({ id: 'd', categoryId: 'c4', price: 12 }), 3),
  ];

  it('random is drawn exactly once per candidate, in candidate order', () => {
    let calls = 0;
    pickSuggestions(pool, context(), { random: () => { calls += 1; return 0; } });
    expect(calls).toBe(pool.length);
  });

  it('a zero RNG yields the pure score ranking', () => {
    const picked = pickSuggestions(pool, context({ curation: undefined, catalogSize: 4 }), { random: () => 0 });
    // Curation falls back to catalog order, so the admin's first items lead.
    expect(picked.map((s) => s.product.id)).toEqual(['a', 'b', 'c']);
    expect(picked.every((s) => s.jitter === 0)).toBe(true);
  });

  it('a constant RNG preserves the ranking because a constant offset is order-preserving', () => {
    const ctx = context({ curation: undefined, catalogSize: 4 });
    const zero = pickSuggestions(pool, ctx, { random: () => 0 }).map((s) => s.product.id);
    const high = pickSuggestions(pool, ctx, { random: () => 0.999 }).map((s) => s.product.id);
    expect(high).toEqual(zero);
  });

  it('equal scores tie-break by product id, never by array order', () => {
    const forward = pickSuggestions(pool, context(), { random: () => 0 }).map((s) => s.product.id);
    const reversed = pickSuggestions([...pool].reverse(), context(), { random: () => 0 }).map((s) => s.product.id);
    expect(forward).toEqual(['a', 'b', 'c']);
    expect(reversed).toEqual(forward);
  });

  it('a scripted RNG queue promotes the intended runner-up and nothing else', () => {
    const ctx = context({ curation: undefined, catalogSize: 4 });
    // Draws land in candidate order [a, b, c, d]; only d gets a full jitter.
    const seq = [0, 0, 0, 1];
    let i = 0;
    const picked = pickSuggestions(pool, ctx, { random: () => seq[i++] ?? 0, epsilon: 0.5 });
    expect(picked.map((s) => s.product.id)).toEqual(['d', 'a', 'b']);
  });

  it('no candidates yields an empty array and consumes no draws', () => {
    let calls = 0;
    expect(pickSuggestions([], context(), { random: () => { calls += 1; return 0; } })).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe('pickSuggestions diversity', () => {
  it('at most two of the three come from one category when the catalog allows', () => {
    const pool = [
      candidate(product({ id: 'a', categoryId: 'c1' }), 0),
      candidate(product({ id: 'b', categoryId: 'c1' }), 1),
      candidate(product({ id: 'c', categoryId: 'c1' }), 2),
      candidate(product({ id: 'd', categoryId: 'c2' }), 3),
    ];
    const picked = pickSuggestions(pool, context({ curation: undefined, catalogSize: 4 }), { random: () => 0 });
    const fromC1 = picked.filter((s) => s.product.categoryId === 'c1').length;
    expect(picked.length).toBe(SUGGESTION_SLOTS);
    expect(fromC1).toBe(MAX_PER_CATEGORY);
    expect(picked.map((s) => s.product.id)).toContain('d');
  });

  it('the cap relaxes when every eligible product shares a category', () => {
    const pool = ['a', 'b', 'c', 'd'].map((id, i) => candidate(product({ id, categoryId: 'only' }), i));
    const picked = pickSuggestions(pool, context({ curation: undefined, catalogSize: 4 }), { random: () => 0 });
    expect(picked.length).toBe(SUGGESTION_SLOTS);
    expect(new Set(picked.map((s) => s.product.categoryId))).toEqual(new Set(['only']));
  });

  it('fewer than three eligible products yields fewer cards, never a padded one', () => {
    const pool = [candidate(product({ id: 'a', categoryId: 'c1' }), 0), candidate(product({ id: 'b', categoryId: 'c2' }), 1)];
    expect(pickSuggestions(pool, context(), { random: () => 0 }).length).toBe(2);
  });

  it('a product is never returned twice, even through the relax pass', () => {
    const pool = ['a', 'b', 'c', 'd'].map((id, i) => candidate(product({ id, categoryId: 'only' }), i));
    const picked = pickSuggestions(pool, context(), { random: () => 0 });
    expect(new Set(picked.map((s) => s.product.id)).size).toBe(picked.length);
  });
});

describe('cold start', () => {
  it('a fresh device ranks by price fit and catalog order alone', () => {
    const pool = [
      candidate(product({ id: 'platter', categoryId: 'c1', price: 149 }), 0),
      candidate(product({ id: 'side', categoryId: 'c2', price: 14 }), 1),
    ];
    const ctx = context({ cartSubtotal: 48, curation: undefined, catalogSize: 2 });
    const picked = pickSuggestions(pool, ctx, { random: () => 0 });
    // Despite ranking FIRST in the catalog, the platter loses on price fit.
    expect(picked[0].product.id).toBe('side');
    expect(picked[0].features.confidence).toBe(0);
    expect(picked[0].features.affinity).toBe(0);
  });

  it('a fresh device produces different slates across RNG queues', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'].map((id, i) => candidate(product({ id, categoryId: `c${i}`, price: 12 + i }), i));
    const ctx = context({ curation: undefined, catalogSize: 5 });
    const draw = (seq: number[]) => { let i = 0; return pickSuggestions(pool, ctx, { random: () => seq[i++] ?? 0 }).map((s) => s.product.id); };
    // Exploration is the feature: with everything near-tied, the strip varies.
    expect(draw([0, 0, 0, 0, 0])).not.toEqual(draw([0, 0, 0, 1, 1]));
  });

  it('a 149 riyal platter never displaces a 14 riyal side beside a 48 riyal cart', () => {
    const platter = scoreCandidate(candidate(product({ id: 'platter', categoryId: 'c1', price: 149 })), context({ cartSubtotal: 48 }));
    const side = scoreCandidate(candidate(product({ id: 'side', categoryId: 'c1', price: 14 })), context({ cartSubtotal: 48 }));
    expect(side.score).toBeGreaterThan(platter.score);
  });
});

describe('learning', () => {
  it('three adds of one product move it above an equally-priced stranger', () => {
    let s = EMPTY_STATE;
    for (let i = 0; i < 3; i += 1) {
      s = recordAdd(s, { productId: 'favourite', categoryId: 'c1', cartCategoryIds: [] }, T0);
    }
    const ctx = context({ state: s, curation: () => 0.5 });
    const fav = scoreCandidate(candidate(product({ id: 'favourite', categoryId: 'c1', price: 12 })), ctx);
    const stranger = scoreCandidate(candidate(product({ id: 'stranger', categoryId: 'c1', price: 12 })), ctx);
    expect(fav.score).toBeGreaterThan(stranger.score);
  });

  it('two unconverted impressions push a leader below its runner-up', () => {
    let s = EMPTY_STATE;
    for (let i = 0; i < 4; i += 1) s = recordAdd(s, { productId: 'leader', categoryId: 'c1', cartCategoryIds: [] }, T0);
    const ctx = () => context({ state: s, curation: () => 0.5 });

    const leader = () => scoreCandidate(candidate(product({ id: 'leader', categoryId: 'c1', price: 12 })), ctx()).score;
    const rival = scoreCandidate(candidate(product({ id: 'rival', categoryId: 'c1', price: 12 })), ctx()).score;
    expect(leader()).toBeGreaterThan(rival);

    s = recordImpressions(s, ['leader'], T0);
    s = recordImpressions(s, ['leader'], T0);
    // Fatigue = 2/4 = 0.5, costing 0.15 — enough to hand over the slot.
    expect(leader()).toBeLessThan(rival);
  });

  it('an add clears the fatigue that had demoted a product', () => {
    let s = recordImpressions(EMPTY_STATE, ['p'], T0);
    s = recordImpressions(s, ['p'], T0);
    const demoted = scoreCandidate(candidate(product({ id: 'p' })), context({ state: s })).score;
    s = recordAdd(s, { productId: 'p', categoryId: 'cat-main', cartCategoryIds: [] }, T0);
    const restored = scoreCandidate(candidate(product({ id: 'p' })), context({ state: s })).score;
    expect(restored).toBeGreaterThan(demoted);
  });

  it('a learned category pair beats the cold structural prior once confidence is high', () => {
    let s = EMPTY_STATE;
    // Ten baskets that all went burger -> drink.
    for (let i = 0; i < 10; i += 1) {
      s = recordAdd(s, { productId: `drink${i}`, categoryId: 'drinks', cartCategoryIds: ['burgers'] }, T0);
    }
    const ctx = context({ state: s, cartCategoryIds: ['burgers'], curation: () => 0.5 });
    const drink = suggestionFeatures(candidate(product({ id: 'new-drink', categoryId: 'drinks' })), ctx).complement;
    const dessert = suggestionFeatures(candidate(product({ id: 'cake', categoryId: 'desserts' })), ctx).complement;
    expect(drink).toBeGreaterThan(COLD_DIFFERENT);
    expect(drink).toBeGreaterThan(dessert);
  });
});
