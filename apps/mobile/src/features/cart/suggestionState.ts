/**
 * On-device behaviour profile behind the cart suggestion strip — PURE and
 * framework-free, so every decay / eviction / corruption rule is unit-tested
 * under Node (suggestionState.test.ts). The AsyncStorage side lives in
 * `suggestionStore.ts`, mirroring the split this repo already uses for the
 * checkout session (`features/checkout/pendingSession.ts` vs
 * `pendingSessionStore.ts`).
 *
 * WHAT IS RECORDED. Nothing but product ids, category ids and decayed counts.
 * No names, no prices, no order ids, no customer identity — and the profile
 * never leaves the device. There is no server aggregate and no analytics sink;
 * see `docs`-level notes in the feature's non-goals.
 *
 * TIME IS ALWAYS A PARAMETER. `Date.now()` never appears in this module. Every
 * entry point takes `now`, which is what makes decay and eviction testable
 * without fake timers — the convention `isFixFresh(fix, now, …)` already
 * follows in `components/locationControl.ts`.
 *
 * ONE CLOCK, WHOLE-STATE DECAY. Rather than stamping every row with its own
 * timestamp and decaying lazily on touch, the whole profile carries a single
 * `t` and is decayed to `now` before every read and every mutation. The result
 * is exact rather than approximate, and it keeps a decayed weight comparable
 * across rows — which the scoring module relies on.
 *
 * AN UNKNOWN SCHEMA VERSION DISCARDS THE PROFILE. That is safe *here* because
 * suggestion history is disposable: losing it costs a few visits of slightly
 * worse ranking, and the cold-start path is the best-covered path in the
 * system. DO NOT copy this to a payload holding real user data — discarding
 * the cart or the address book on a version bump would lose something the
 * customer typed.
 */

/** What the device knows about one product. Both weights are decayed to `state.t`. */
export interface ProductStat {
  /** Decayed add-to-cart weight. +1 per add, from anywhere in the app. */
  a: number;
  /** Decayed strip impressions SINCE this product was last added. Zeroed by an add. */
  s: number;
}

export interface SuggestionState {
  /** Schema version. Anything else is discarded (see the docblock). */
  v: 1;
  /** Epoch ms every weight is current as of. Callers decay to `now` before use. */
  t: number;
  /** Total decayed add count. Drives the confidence gate. */
  n: number;
  /** productId -> stats. */
  p: Record<string, ProductStat>;
  /** categoryId -> decayed add weight. */
  c: Record<string, number>;
  /** `${cartCategoryId}>${addedCategoryId}` -> decayed DIRECTED co-occurrence weight. */
  x: Record<string, number>;
}

/**
 * Frozen INCLUDING its nested maps: modules are strict-mode, so a reducer that
 * forgets to copy throws in dev instead of silently corrupting the shared
 * constant that every cold start returns.
 */
export const EMPTY_STATE: SuggestionState = Object.freeze({
  v: 1 as const,
  t: 0,
  n: 0,
  p: Object.freeze({}) as Record<string, ProductStat>,
  c: Object.freeze({}) as Record<string, number>,
  x: Object.freeze({}) as Record<string, number>,
});

const DAY_MS = 86_400_000;

/** Adds, categories, pairs and the total all share one half-life so `n` stays a real total. */
export const HALF_LIFE_ADD_MS = 45 * DAY_MS;
/**
 * Impressions decay far faster: this is a display counter, not a preference.
 * Suppression has to wear off within a week or the strip permanently starves.
 */
export const HALF_LIFE_IMPRESSION_MS = 7 * DAY_MS;
/** A garbage future timestamp must not produce a denormal. A year away is cold start anyway. */
export const MAX_DECAY_SPAN_MS = 365 * DAY_MS;

export const MAX_TRACKED_PRODUCTS = 80;
export const MAX_TRACKED_CATEGORIES = 24;
export const MAX_TRACKED_PAIRS = 96;
/** Fan-out cap per add, so one enormous basket cannot write an unbounded row set. */
export const MAX_CART_CATEGORIES = 8;
export const MAX_WEIGHT = 99;
export const MAX_TOTAL = 999;
export const MAX_KEY_LEN = 96;
/** Below this a row contributes < 0.007 to any feature — invisible, so drop it. */
export const PRUNE_EPSILON = 0.02;
/** Hard ceiling on the serialised payload. The saturated worst case is ~14.2 KiB. */
export const SUGGESTION_STATE_MAX_CHARS = 16_384;

/** Passes of the shrink loop in `serializeSuggestionState` before giving up entirely. */
const MAX_SHRINK_PASSES = 8;
/** Fraction of the lowest-weight rows dropped per shrink pass. */
const SHRINK_FRACTION = 0.12;

function clampWeight(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > max ? max : value;
}

/** Ascending by weight, then by key, so eviction is reproducible in a test. */
function lowestFirst(keys: string[], weightOf: (key: string) => number): string[] {
  return keys.sort((l, r) => weightOf(l) - weightOf(r) || (l < r ? -1 : l > r ? 1 : 0));
}

function normalizeWeights(map: Record<string, number>, cap: number): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const key of Object.keys(map)) {
    const w = clampWeight(map[key], MAX_WEIGHT);
    if (w >= PRUNE_EPSILON) kept[key] = w;
  }
  const keys = Object.keys(kept);
  if (keys.length <= cap) return kept;
  const evicted = lowestFirst(keys, (k) => kept[k]).slice(keys.length - cap);
  const out: Record<string, number> = {};
  for (const key of evicted) out[key] = kept[key];
  return out;
}

function normalizeProducts(map: Record<string, ProductStat>): Record<string, ProductStat> {
  const kept: Record<string, ProductStat> = {};
  for (const key of Object.keys(map)) {
    const row = map[key];
    const a = clampWeight(row?.a ?? 0, MAX_WEIGHT);
    const s = clampWeight(row?.s ?? 0, MAX_WEIGHT);
    // "How much do I know about this product" — an add and an impression are
    // both 1.0 when fresh, so the magnitudes are directly comparable.
    if (a + s >= PRUNE_EPSILON) kept[key] = { a, s };
  }
  const keys = Object.keys(kept);
  if (keys.length <= MAX_TRACKED_PRODUCTS) return kept;
  const evicted = lowestFirst(keys, (k) => kept[k].a + kept[k].s).slice(keys.length - MAX_TRACKED_PRODUCTS);
  const out: Record<string, ProductStat> = {};
  for (const key of evicted) out[key] = kept[key];
  return out;
}

/** ε-prune, then cap-evict, then clamp — the ratchet that holds the ceiling for all time. */
function normalize(draft: SuggestionState): SuggestionState {
  return {
    v: 1,
    t: Number.isFinite(draft.t) && draft.t > 0 ? draft.t : 0,
    n: clampWeight(draft.n, MAX_TOTAL),
    p: normalizeProducts(draft.p),
    c: normalizeWeights(draft.c, MAX_TRACKED_CATEGORIES),
    x: normalizeWeights(draft.x, MAX_TRACKED_PAIRS),
  };
}

/**
 * Brings every weight forward to `now`. A backwards clock decays nothing but
 * still re-anchors `t`, mirroring the explicit clock-change guard in
 * `components/locationControl.ts` ("a negative age means a clock change").
 */
export function decayState(state: SuggestionState, now: number): SuggestionState {
  const t = Number.isFinite(now) ? now : state.t;
  if (t === state.t) return state;

  const dt = Math.min(Math.max(t - state.t, 0), MAX_DECAY_SPAN_MS);
  const fAdd = Math.pow(2, -dt / HALF_LIFE_ADD_MS);
  const fImp = Math.pow(2, -dt / HALF_LIFE_IMPRESSION_MS);

  const p: Record<string, ProductStat> = {};
  for (const key of Object.keys(state.p)) {
    const row = state.p[key];
    p[key] = { a: row.a * fAdd, s: row.s * fImp };
  }
  const c: Record<string, number> = {};
  for (const key of Object.keys(state.c)) c[key] = state.c[key] * fAdd;
  const x: Record<string, number> = {};
  for (const key of Object.keys(state.x)) x[key] = state.x[key] * fAdd;

  return normalize({ v: 1, t, n: state.n * fAdd, p, c, x });
}

export interface AddEvent {
  productId: string;
  categoryId: string;
  /** Distinct category ids already in the cart BEFORE this add. */
  cartCategoryIds: readonly string[];
}

/**
 * Records one add-to-cart, from anywhere in the app.
 *
 * Quantity is deliberately ignored — +1 per add regardless. Quantity is
 * appetite, not preference, and the strip's own add is always 1, so scaling by
 * quantity would systematically bias the model against strip adds.
 */
export function recordAdd(state: SuggestionState, event: AddEvent, now: number): SuggestionState {
  const { productId, categoryId } = event;
  if (!productId) return decayState(state, now);

  const base = decayState(state, now);
  const prior = base.p[productId];

  const p: Record<string, ProductStat> = { ...base.p };
  // The add IS the accept signal: it clears whatever fatigue the strip built up.
  p[productId] = { a: (prior?.a ?? 0) + 1, s: 0 };

  const c: Record<string, number> = { ...base.c };
  if (categoryId) c[categoryId] = (c[categoryId] ?? 0) + 1;

  const x: Record<string, number> = { ...base.x };
  if (categoryId) {
    const seen = new Set<string>();
    for (const from of event.cartCategoryIds) {
      if (!from || seen.has(from)) continue;
      seen.add(from);
      if (seen.size > MAX_CART_CATEGORIES) break;
      // Directed on purpose: holding a burger predicts adding a drink far more
      // strongly than the reverse, and "cart has A, suggest B" is the query.
      // Self-pairs are recorded — "adds a second main" is real behaviour.
      const key = `${from}>${categoryId}`;
      if (key.length <= MAX_KEY_LEN) x[key] = (x[key] ?? 0) + 1;
    }
  }

  return normalize({ v: 1, t: base.t, n: base.n + 1, p, c, x });
}

/**
 * Records that these products were shown in the strip.
 *
 * This write is the feature, not bookkeeping: fatigue is the ONLY rotation
 * mechanism, so a caller that skips it pins the same three cards forever.
 * The once-per-slate guard belongs to the caller, not here.
 */
export function recordImpressions(
  state: SuggestionState,
  productIds: readonly string[],
  now: number,
): SuggestionState {
  const base = decayState(state, now);
  if (productIds.length === 0) return base;

  const p: Record<string, ProductStat> = { ...base.p };
  const seen = new Set<string>();
  for (const id of productIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const prior = p[id];
    p[id] = { a: prior?.a ?? 0, s: (prior?.s ?? 0) + 1 };
  }

  return normalize({ v: 1, t: base.t, n: base.n, p, c: base.c, x: base.x });
}

/**
 * A weight that is present but unreadable poisons the row; a weight that is
 * merely absent is 0. Returning `null` means "drop this row", matching the way
 * `parsePendingSession` refuses a payload it cannot trust.
 */
function readWeight(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function usableKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LEN;
}

/** Never throws and never returns null — a corrupt profile degrades to cold start. */
export function parseSuggestionState(raw: string | null | undefined): SuggestionState {
  if (!raw) return EMPTY_STATE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return EMPTY_STATE;

  const obj = parsed as Record<string, unknown>;
  if (obj.v !== 1) return EMPTY_STATE;

  const t = readWeight(obj.t);
  const n = readWeight(obj.n);

  const p: Record<string, ProductStat> = {};
  const rawProducts = obj.p;
  if (typeof rawProducts === 'object' && rawProducts !== null && !Array.isArray(rawProducts)) {
    for (const [key, value] of Object.entries(rawProducts as Record<string, unknown>)) {
      if (!usableKey(key)) continue;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      const a = readWeight(row.a);
      const s = readWeight(row.s);
      // One bad row is dropped; the other seventy-nine survive.
      if (a === null || s === null) continue;
      p[key] = { a, s };
    }
  }

  const readMap = (value: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return out;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!usableKey(key)) continue;
      const w = readWeight(entry);
      if (w === null) continue;
      out[key] = w;
    }
    return out;
  };

  return normalize({
    v: 1,
    t: t ?? 0,
    n: n ?? 0,
    p,
    c: readMap(obj.c),
    x: readMap(obj.x),
  });
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function shrink<T>(map: Record<string, T>, weightOf: (entry: T) => number): Record<string, T> {
  const keys = Object.keys(map);
  if (keys.length === 0) return map;
  const drop = Math.max(1, Math.ceil(keys.length * SHRINK_FRACTION));
  const survivors = lowestFirst(keys, (k) => weightOf(map[k])).slice(drop);
  const out: Record<string, T> = {};
  for (const key of survivors) out[key] = map[key];
  return out;
}

/**
 * The ceiling is MEASURED, not trusted. The caps make ~14.2 KiB the saturated
 * worst case for 36-char UUID keys, but the ids are not ours to guarantee, so
 * the payload is stringified and shrunk until it actually fits. Termination is
 * guaranteed: `EMPTY_STATE` serialises to ~60 chars.
 */
export function serializeSuggestionState(state: SuggestionState): string {
  let current = normalize(state);

  for (let pass = 0; pass <= MAX_SHRINK_PASSES; pass += 1) {
    const p: Record<string, [number, number]> = {};
    for (const key of Object.keys(current.p)) {
      const row = current.p[key];
      p[key] = [round3(row.a), round3(row.s)];
    }
    const c: Record<string, number> = {};
    for (const key of Object.keys(current.c)) c[key] = round3(current.c[key]);
    const x: Record<string, number> = {};
    for (const key of Object.keys(current.x)) x[key] = round3(current.x[key]);

    const payload = JSON.stringify({
      v: 1,
      t: Math.round(current.t),
      n: round3(current.n),
      p: Object.fromEntries(Object.keys(p).map((k) => [k, { a: p[k][0], s: p[k][1] }])),
      c,
      x,
    });
    if (payload.length <= SUGGESTION_STATE_MAX_CHARS) return payload;

    current = {
      ...current,
      x: shrink(current.x, (w) => w),
      c: shrink(current.c, (w) => w),
      p: shrink(current.p, (row) => row.a + row.s),
    };
  }

  return JSON.stringify(EMPTY_STATE);
}
