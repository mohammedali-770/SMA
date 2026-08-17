import { describe, expect, it } from 'vitest';

import {
  EMPTY_STATE,
  HALF_LIFE_ADD_MS,
  HALF_LIFE_IMPRESSION_MS,
  MAX_CART_CATEGORIES,
  MAX_DECAY_SPAN_MS,
  MAX_TRACKED_CATEGORIES,
  MAX_TRACKED_PAIRS,
  MAX_TRACKED_PRODUCTS,
  PRUNE_EPSILON,
  SUGGESTION_STATE_MAX_CHARS,
  decayState,
  parseSuggestionState,
  recordAdd,
  recordImpressions,
  serializeSuggestionState,
  type SuggestionState,
} from './suggestionState';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

/** A 36-char key, the shape a Postgres uuid actually takes. */
function uuidLike(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function state(over: Partial<SuggestionState> = {}): SuggestionState {
  return { v: 1, t: T0, n: 0, p: {}, c: {}, x: {}, ...over };
}

describe('parseSuggestionState', () => {
  it('an absent value yields the empty state, not a throw', () => {
    expect(parseSuggestionState(null)).toEqual(EMPTY_STATE);
    expect(parseSuggestionState(undefined)).toEqual(EMPTY_STATE);
    expect(parseSuggestionState('')).toEqual(EMPTY_STATE);
  });

  it('non-JSON garbage yields the empty state', () => {
    expect(parseSuggestionState('{')).toEqual(EMPTY_STATE);
    expect(parseSuggestionState('nope')).toEqual(EMPTY_STATE);
  });

  it('a JSON array or primitive yields the empty state', () => {
    expect(parseSuggestionState('[]')).toEqual(EMPTY_STATE);
    expect(parseSuggestionState('7')).toEqual(EMPTY_STATE);
    expect(parseSuggestionState('null')).toEqual(EMPTY_STATE);
  });

  it('an unknown schema version discards the profile rather than mis-reading it', () => {
    const body = '"t":1,"n":5,"p":{"a":{"a":3,"s":0}},"c":{},"x":{}';
    expect(parseSuggestionState(`{"v":2,${body}}`)).toEqual(EMPTY_STATE);
    expect(parseSuggestionState(`{"v":"1",${body}}`)).toEqual(EMPTY_STATE);
    expect(parseSuggestionState(`{${body}}`)).toEqual(EMPTY_STATE);
  });

  it('a corrupt row is dropped while the rest of the profile survives', () => {
    const raw = JSON.stringify({
      v: 1, t: T0, n: 5,
      p: { good1: { a: 1, s: 0 }, good2: { a: 2, s: 1 }, bad: { a: 'x', s: 0 }, good3: { a: 3, s: 0 }, good4: { a: 4, s: 0 } },
      c: {}, x: {},
    });
    const out = parseSuggestionState(raw);
    expect(Object.keys(out.p).sort()).toEqual(['good1', 'good2', 'good3', 'good4']);
  });

  it('NaN, Infinity and negative weights never reach a score', () => {
    // JSON cannot carry NaN/Infinity literally, so they arrive as the strings
    // or nulls a hand-edited/partially-written file would contain.
    const raw = '{"v":1,"t":1,"n":1,"p":{"neg":{"a":-4,"s":0},"ok":{"a":2,"s":0}},"c":{"cneg":-1,"cok":2},"x":{}}';
    const out = parseSuggestionState(raw);
    expect(Object.keys(out.p)).toEqual(['ok']);
    expect(Object.keys(out.c)).toEqual(['cok']);
    expect(Object.values(out.p).every((r) => Number.isFinite(r.a) && Number.isFinite(r.s))).toBe(true);
  });

  it('an over-length key is skipped', () => {
    const long = 'k'.repeat(200);
    const raw = JSON.stringify({ v: 1, t: T0, n: 1, p: { [long]: { a: 5, s: 0 }, ok: { a: 1, s: 0 } }, c: {}, x: {} });
    expect(Object.keys(parseSuggestionState(raw).p)).toEqual(['ok']);
  });

  it('a hand-crafted over-cap payload is evicted down to the caps on read', () => {
    const p: Record<string, { a: number; s: number }> = {};
    for (let i = 0; i < 400; i += 1) p[uuidLike(i)] = { a: 1 + i, s: 0 };
    const out = parseSuggestionState(JSON.stringify({ v: 1, t: T0, n: 400, p, c: {}, x: {} }));
    expect(Object.keys(out.p).length).toBe(MAX_TRACKED_PRODUCTS);
    // The heaviest survive, so eviction keeps what the model actually knows.
    expect(out.p[uuidLike(399)]).toBeDefined();
    expect(out.p[uuidLike(0)]).toBeUndefined();
  });
});

describe('serializeSuggestionState', () => {
  it('round-trips a realistic profile to three decimal places', () => {
    const before = state({ n: 4, p: { p1: { a: 2.5, s: 1.25 } }, c: { c1: 3.5 }, x: { 'c1>c2': 1.5 } });
    const after = parseSuggestionState(serializeSuggestionState(before));
    expect(after.n).toBe(4);
    expect(after.p.p1).toEqual({ a: 2.5, s: 1.25 });
    expect(after.c.c1).toBe(3.5);
    expect(after.x['c1>c2']).toBe(1.5);
    expect(after.t).toBe(T0);
  });

  it('a profile saturated at every cap serialises within SUGGESTION_STATE_MAX_CHARS', () => {
    const p: Record<string, { a: number; s: number }> = {};
    for (let i = 0; i < MAX_TRACKED_PRODUCTS; i += 1) p[uuidLike(i)] = { a: 99.999, s: 99.999 };
    const c: Record<string, number> = {};
    for (let i = 0; i < MAX_TRACKED_CATEGORIES; i += 1) c[uuidLike(1000 + i)] = 99.999;
    const x: Record<string, number> = {};
    for (let i = 0; i < MAX_TRACKED_PAIRS; i += 1) x[`${uuidLike(2000 + i)}>${uuidLike(3000 + i)}`] = 99.999;

    const out = serializeSuggestionState(state({ n: 999, p, c, x }));
    expect(out.length).toBeLessThanOrEqual(SUGGESTION_STATE_MAX_CHARS);
    // Nothing was dropped: the caps alone keep the saturated case under the ceiling.
    expect(Object.keys(parseSuggestionState(out).p).length).toBe(MAX_TRACKED_PRODUCTS);
  });

  it('output is pure ASCII so character length equals byte length', () => {
    const p: Record<string, { a: number; s: number }> = {};
    for (let i = 0; i < MAX_TRACKED_PRODUCTS; i += 1) p[uuidLike(i)] = { a: 99.999, s: 99.999 };
    const out = serializeSuggestionState(state({ n: 999, p }));
    expect(Buffer.byteLength(out, 'utf8')).toBe(out.length);
  });

  it('an artificially oversized state is shrunk until it fits, and terminates', () => {
    // Ids are not ours to guarantee; 300-char keys blow past the derived ceiling.
    const p: Record<string, { a: number; s: number }> = {};
    for (let i = 0; i < MAX_TRACKED_PRODUCTS; i += 1) p[`${'k'.repeat(88)}${i}`] = { a: 5, s: 5 };
    const out = serializeSuggestionState(state({ n: 50, p }));
    expect(out.length).toBeLessThanOrEqual(SUGGESTION_STATE_MAX_CHARS);
    expect(() => JSON.parse(out)).not.toThrow();
  });
});

describe('decayState', () => {
  it('one add half-life halves every add-derived weight', () => {
    const before = recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'c1', cartCategoryIds: ['c2'] }, T0);
    const after = decayState(before, T0 + HALF_LIFE_ADD_MS);
    expect(after.p.p1.a).toBeCloseTo(0.5, 6);
    expect(after.c.c1).toBeCloseTo(0.5, 6);
    expect(after.x['c2>c1']).toBeCloseTo(0.5, 6);
    expect(after.n).toBeCloseTo(0.5, 6);
  });

  it('impressions decay on the seven-day half-life, not the forty-five-day one', () => {
    const withBoth = recordImpressions(
      recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'c1', cartCategoryIds: [] }, T0),
      ['p1'], T0,
    );
    // The add zeroed nothing here — the impression lands after it.
    const after = decayState(withBoth, T0 + HALF_LIFE_IMPRESSION_MS);
    expect(after.p.p1.s).toBeCloseTo(0.5, 6);
    expect(after.p.p1.a).toBeCloseTo(Math.pow(2, -HALF_LIFE_IMPRESSION_MS / HALF_LIFE_ADD_MS), 6);
    expect(after.p.p1.a).toBeGreaterThan(after.p.p1.s);
  });

  it('a backwards device clock does not inflate any weight', () => {
    const before = recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'c1', cartCategoryIds: [] }, T0);
    const after = decayState(before, T0 - 30 * DAY);
    expect(after.p.p1.a).toBe(1);
    expect(after.n).toBe(1);
    // The clock is re-anchored so later decay measures from the new reading.
    expect(after.t).toBe(T0 - 30 * DAY);
  });

  it('a decade-long gap clamps at MAX_DECAY_SPAN_MS and returns finite weights', () => {
    const before = state({ n: 10, p: { p1: { a: 10, s: 10 } }, c: { c1: 10 }, x: { 'c1>c1': 10 } });
    const after = decayState(before, T0 + 10 * 365 * DAY);
    // A decade decays no further than a year: no denormals, no Infinity.
    const clamped = 10 * Math.pow(2, -MAX_DECAY_SPAN_MS / HALF_LIFE_ADD_MS);
    expect(Number.isFinite(after.n)).toBe(true);
    expect(after.n).toBeCloseTo(clamped, 6);
    expect(after.n).toBeLessThan(0.05);
  });

  it('a dormant year returns an ordinary profile to cold start', () => {
    const before = recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'c1', cartCategoryIds: ['c2'] }, T0);
    const after = decayState(before, T0 + 365 * DAY);
    // 2^(-365/45) = 0.0036, under the epsilon floor: every row is swept.
    expect(after.p).toEqual({});
    expect(after.c).toEqual({});
    expect(after.x).toEqual({});
  });

  it('weights below PRUNE_EPSILON are dropped so the profile cannot accumulate dead rows', () => {
    const before = recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'c1', cartCategoryIds: [] }, T0);
    // 2^-6 = 0.0156, below the 0.02 floor.
    const after = decayState(before, T0 + 6 * HALF_LIFE_ADD_MS);
    expect(after.p.p1).toBeUndefined();
    expect(after.c.c1).toBeUndefined();
    expect(PRUNE_EPSILON).toBeGreaterThan(Math.pow(2, -6));
  });

  it('decaying an already-current state is a no-op', () => {
    const before = recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'c1', cartCategoryIds: [] }, T0);
    expect(decayState(before, before.t)).toBe(before);
  });
});

describe('eviction', () => {
  it('exceeding MAX_TRACKED_PRODUCTS evicts the least-known product, not the newest', () => {
    let s = EMPTY_STATE;
    for (let i = 0; i < MAX_TRACKED_PRODUCTS; i += 1) {
      // Earlier products are added more often, so they are the better known.
      for (let k = 0; k < (MAX_TRACKED_PRODUCTS - i); k += 1) {
        s = recordAdd(s, { productId: uuidLike(i), categoryId: 'c1', cartCategoryIds: [] }, T0);
      }
    }
    const newcomer = uuidLike(9999);
    s = recordAdd(s, { productId: newcomer, categoryId: 'c1', cartCategoryIds: [] }, T0);
    expect(Object.keys(s.p).length).toBe(MAX_TRACKED_PRODUCTS);
    // The weakest incumbent (1 add) loses its slot; the newcomer (1 add, but a
    // higher key) is retained by the ascending-key tie-break.
    expect(s.p[newcomer]).toBeDefined();
    expect(s.p[uuidLike(MAX_TRACKED_PRODUCTS - 1)]).toBeUndefined();
  });

  it('ties evict by key ascending so eviction is reproducible', () => {
    const p: Record<string, { a: number; s: number }> = {};
    for (let i = 0; i < MAX_TRACKED_PRODUCTS + 3; i += 1) p[uuidLike(i)] = { a: 1, s: 0 };
    const first = parseSuggestionState(JSON.stringify({ v: 1, t: T0, n: 1, p, c: {}, x: {} }));
    const second = parseSuggestionState(JSON.stringify({ v: 1, t: T0, n: 1, p, c: {}, x: {} }));
    expect(Object.keys(first.p).sort()).toEqual(Object.keys(second.p).sort());
    // All weights equal, so the three lowest keys are the ones that go.
    expect(first.p[uuidLike(0)]).toBeUndefined();
    expect(first.p[uuidLike(2)]).toBeUndefined();
    expect(first.p[uuidLike(3)]).toBeDefined();
  });

  it('two hundred adds across four hundred products never exceed the caps or the char ceiling', () => {
    let s = EMPTY_STATE;
    for (let i = 0; i < 200; i += 1) {
      s = recordAdd(s, {
        productId: uuidLike(i % 400),
        categoryId: uuidLike(5000 + (i % 30)),
        cartCategoryIds: [uuidLike(5000 + ((i + 1) % 30)), uuidLike(5000 + ((i + 2) % 30))],
      }, T0 + i * DAY);
      s = recordImpressions(s, [uuidLike((i + 7) % 400), uuidLike((i + 8) % 400)], T0 + i * DAY);
    }
    expect(Object.keys(s.p).length).toBeLessThanOrEqual(MAX_TRACKED_PRODUCTS);
    expect(Object.keys(s.c).length).toBeLessThanOrEqual(MAX_TRACKED_CATEGORIES);
    expect(Object.keys(s.x).length).toBeLessThanOrEqual(MAX_TRACKED_PAIRS);
    expect(serializeSuggestionState(s).length).toBeLessThanOrEqual(SUGGESTION_STATE_MAX_CHARS);
  });
});

describe('recordAdd', () => {
  it('an add bumps product, category, pair and total together', () => {
    const s = recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'burgers', cartCategoryIds: ['drinks'] }, T0);
    expect(s.p.p1).toEqual({ a: 1, s: 0 });
    expect(s.c.burgers).toBe(1);
    expect(s.x['drinks>burgers']).toBe(1);
    expect(s.n).toBe(1);
  });

  it("an add zeroes the product's impression fatigue — this is the accept signal", () => {
    const shown = recordImpressions(EMPTY_STATE, ['p1', 'p1'], T0);
    const seeded = recordImpressions(shown, ['p1'], T0);
    expect(seeded.p.p1.s).toBe(2);
    const added = recordAdd(seeded, { productId: 'p1', categoryId: 'c1', cartCategoryIds: [] }, T0);
    expect(added.p.p1).toEqual({ a: 1, s: 0 });
  });

  it('quantity does not scale the weight: appetite is not preference', () => {
    // There is no quantity parameter at all — that is the point.
    const once = recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'c1', cartCategoryIds: [] }, T0);
    expect(once.p.p1.a).toBe(1);
    expect(once.n).toBe(1);
  });

  it('an empty cart records no pair, only the product and category', () => {
    const s = recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'c1', cartCategoryIds: [] }, T0);
    expect(s.x).toEqual({});
    expect(s.c.c1).toBe(1);
  });

  it('a self-pair is recorded when the cart already holds the same category', () => {
    const s = recordAdd(EMPTY_STATE, { productId: 'p2', categoryId: 'mains', cartCategoryIds: ['mains'] }, T0);
    expect(s.x['mains>mains']).toBe(1);
  });

  it('more than MAX_CART_CATEGORIES distinct cart categories cannot fan out unbounded', () => {
    const many = Array.from({ length: 20 }, (_, i) => `cat${i}`);
    const s = recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'target', cartCategoryIds: many }, T0);
    expect(Object.keys(s.x).length).toBe(MAX_CART_CATEGORIES);
  });

  it('duplicate cart categories count once', () => {
    const s = recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'c2', cartCategoryIds: ['c1', 'c1', 'c1'] }, T0);
    expect(s.x['c1>c2']).toBe(1);
    expect(Object.keys(s.x).length).toBe(1);
  });

  it('recordAdd does not mutate the frozen EMPTY_STATE', () => {
    recordAdd(EMPTY_STATE, { productId: 'p1', categoryId: 'c1', cartCategoryIds: ['c2'] }, T0);
    expect(EMPTY_STATE.p).toEqual({});
    expect(EMPTY_STATE.c).toEqual({});
    expect(EMPTY_STATE.x).toEqual({});
    expect(EMPTY_STATE.n).toBe(0);
  });
});

describe('recordImpressions', () => {
  it('an impression raises fatigue for a product with no add history', () => {
    const s = recordImpressions(EMPTY_STATE, ['p1'], T0);
    expect(s.p.p1).toEqual({ a: 0, s: 1 });
  });

  it('recording the same slate twice raises fatigue twice — the caller owns the once-per-slate guard', () => {
    const once = recordImpressions(EMPTY_STATE, ['p1'], T0);
    const twice = recordImpressions(once, ['p1'], T0);
    expect(twice.p.p1.s).toBe(2);
  });

  it('an empty slate changes nothing', () => {
    const s = recordImpressions(EMPTY_STATE, [], T0);
    expect(s.p).toEqual({});
  });
});
