/**
 * Ranking for the cart suggestion strip — PURE and framework-free, so every
 * weight, filter and tie-break is unit-tested under Node
 * (suggestionScoring.test.ts). Type-only model imports are safe here; the menu
 * does the same in `features/menu/menuSections.ts`.
 *
 * THIS MODULE HAS NO CLOCK. The caller decays the profile to `now` and hands
 * over the result, so scoring is a pure function of an already-current state.
 * That is what keeps the tests free of fake timers.
 *
 * THIS MODULE CARRIES NO COPY. It returns ids, features and scores — never a
 * user-facing string. Bilingual text is the screen's job.
 *
 * SIX FEATURES, EACH NORMALISED TO [0,1], POSITIVE WEIGHTS SUMMING TO EXACTLY
 * 1.00. The score band is therefore legible: the positive sum is [0,1], and
 * fatigue is subtracted afterwards, so the final range is [-0.30, 1.00]. A
 * product owner can read `SUGGESTION_WEIGHTS` and predict the behaviour, which
 * at this data scale is worth more than statistical sophistication.
 */
import type { ModifierGroup, Product } from '../../types/models';
import type { SuggestionState } from './suggestionState';

/** Positive weights sum to EXACTLY 1.00, so the score band stays legible. */
export const SUGGESTION_WEIGHTS = {
  /** Highest-precision personal signal — this is why a regular's strip feels personal. */
  affinity: 0.3,
  /** Generalises affinity to products never added; coarser, partly redundant with affinity. */
  category: 0.16,
  /** The only cart-dependent term. That dependence is the whole premise of an upsell strip. */
  complement: 0.24,
  /** Needs zero data: large enough to carry a cold device, small enough that a proven
   *  favourite still beats a perfectly-priced stranger. */
  priceFit: 0.2,
  /** Smallest, because it rests on a nondeterministic tie-break of a column defaulting to 0. */
  curation: 0.1,
} as const;

/**
 * SUBTRACTED, not blended. Two ignored impressions cost 0.15 — above the
 * jitter band, so a twice-ignored leader genuinely loses its slot.
 */
export const W_FATIGUE = 0.3;

/** 1 add -> .25, 3 -> .50, 9 -> .75. */
export const K_AFFINITY = 3;
/** Category mass grows roughly N times faster than product mass (N products per category). */
export const K_CATEGORY = 6;
/** Per cell: 1 co-occurrence -> .25, 3 -> .50. */
export const K_PAIR = 3;
/** 1 impression -> .33, 2 -> .50, 4 -> .67. */
export const K_FATIGUE = 2;
/** 3 adds -> .33, 6 -> .50, 12 -> .67 — the right pace for "a handful of interactions". */
export const K_CONFIDENCE = 6;

/** Structural prior: with no evidence, prefer a category the cart does NOT already hold. */
export const COLD_DIFFERENT = 0.55;
export const COLD_SAME = 0.15;

/** An add-on is about a quarter of the basket. */
export const PRICE_TARGET_RATIO = 0.25;
/** Without a floor a 9 SAR cart targets 2.25 and the feature degenerates into "cheapest wins". */
export const PRICE_TARGET_FLOOR = 12;
/** 2x mismatch costs ~28%, 3x ~57%, 5x ~83%: tolerant of a normal menu, brutal on a platter. */
export const PRICE_SIGMA = 0.85;

/** Hard-bounded exploration: nothing more than this below the leader can ever win. */
export const EXPLORATION_EPSILON = 0.1;
export const SUGGESTION_SLOTS = 3;
export const MAX_PER_CATEGORY = 2;
/** One lone card reads as broken UI, so render nothing rather than one. */
export const MIN_RENDER = 2;

export type Addability = 'one-tap' | 'configure' | 'blocked';

export interface SuggestionCandidate {
  product: Product;
  addability: Exclude<Addability, 'blocked'>;
  /** Index in the catalog `products[]` array, which IS the admin sort order. */
  rank: number;
}

export interface FeatureBreakdown {
  affinity: number;
  category: number;
  complement: number;
  priceFit: number;
  curation: number;
  fatigue: number;
  confidence: number;
}

export interface ScoredSuggestion extends SuggestionCandidate {
  features: FeatureBreakdown;
  score: number;
  jitter: number;
  ranked: number;
}

export type SuggestionWeights = typeof SUGGESTION_WEIGHTS;

export interface ScoreContext {
  /** MUST already be decayed to the current instant — this module has no clock. */
  state: SuggestionState;
  /** Distinct category ids currently in the cart. */
  cartCategoryIds: readonly string[];
  cartSubtotal: number;
  catalogSize: number;
  weights?: SuggestionWeights;
  /** Seam for a future server-side popularity signal; defaults to catalog order. */
  curation?: (productId: string, rank: number, catalogSize: number) => number;
}

/** The single NaN firewall. Every feature passes through it. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Diminishing returns: `w / (w + k)`. One event is already meaningful, ten are not ten times so. */
function saturate(weight: number, k: number): number {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  return weight / (weight + k);
}

/**
 * A product whose required group has no selectable modifiers is a trap: the
 * product page's save button can never be satisfied, so the tap dead-ends.
 * This is reachable in production — `modifier_groups` has no active flag, but
 * RLS returns only active `modifiers`, so a group can arrive required-and-empty.
 */
export function classifyAddability(
  groups: readonly ModifierGroup[],
  /**
   * `product.variants.length`. REQUIRED rather than defaulted: a caller that
   * forgets it would silently restore the cheapest-tier bug this guards.
   */
  tierCount: number,
): Addability {
  for (const g of groups) {
    const floor = Math.max(g.minSelection ?? 0, g.isRequired ? 1 : 0);
    if (floor > (g.modifiers?.length ?? 0)) return 'blocked';
  }
  // More than one price tier means the customer has to choose, exactly as the
  // menu card does (`needsChoice`). Without this a tiered product with no
  // modifier groups classified 'one-tap', and the strip called
  // `addItem(product, {}, 1)` — which falls back to `cheapestVariant` and hands
  // over the cheapest tier unasked. That is the same defect the menu list was
  // fixed for, and it kept the invariant in the next comment from holding.
  if (tierCount > 1) return 'configure';
  // Deliberately stricter than the server-legal floor: a product that opens a
  // page from the menu must not silently one-tap from the cart, and an
  // optional PRICED group would otherwise be added cheaper than the card shows.
  return groups.length === 0 ? 'one-tap' : 'configure';
}

export function eligibleCandidates(input: {
  products: readonly Product[];
  branchId: string | null;
  /** Matched on `product.id` — never `cartItemId`, which carries a `::modA,modB` suffix. */
  cartProductIds: ReadonlySet<string>;
  excludedProductIds: ReadonlySet<string>;
  isAvailable: (productId: string, branchId: string) => boolean;
  groupsFor: (product: Product) => readonly ModifierGroup[];
}): SuggestionCandidate[] {
  const { products, branchId, cartProductIds, excludedProductIds, isAvailable, groupsFor } = input;
  if (!branchId) return [];

  const out: SuggestionCandidate[] = [];
  products.forEach((product, rank) => {
    if (!product.isActive) return;
    if (!isAvailable(product.id, branchId)) return;
    if (cartProductIds.has(product.id)) return;
    if (excludedProductIds.has(product.id)) return;
    // Always the RESOLVED groups: `groupsForProduct` filters out unresolved ids,
    // so `product.modifierGroupIds.length` can disagree with reality.
    // `?? 0` is defensive, not decorative: `variants` is populated by the
    // catalog mapper from the network, and a malformed payload must degrade to
    // "no tier choice" rather than crash the cart's suggestion strip. The test
    // fixture omitted it and TypeScript could not see that, because the
    // `Partial<Product>` spread in the factory hides a missing required field.
    const addability = classifyAddability(groupsFor(product), product.variants?.length ?? 0);
    if (addability === 'blocked') return;
    out.push({ product, addability, rank });
  });
  return out;
}

/** Default curation: earlier in the admin's sort order scores higher. */
export function catalogRankCuration(_productId: string, rank: number, catalogSize: number): number {
  if (!Number.isFinite(rank) || catalogSize <= 1) return 0.5;
  return clamp01(1 - rank / (catalogSize - 1));
}

export function suggestionFeatures(c: SuggestionCandidate, ctx: ScoreContext): FeatureBreakdown {
  const { state, cartCategoryIds } = ctx;
  const stat = state.p[c.product.id];
  const categoryId = c.product.categoryId;

  const confidence = clamp01(saturate(state.n, K_CONFIDENCE));
  const affinity = clamp01(saturate(stat?.a ?? 0, K_AFFINITY));
  const category = clamp01(saturate(state.c[categoryId] ?? 0, K_CATEGORY));
  const fatigue = clamp01(saturate(stat?.s ?? 0, K_FATIGUE));

  // Max, not mean: the strongest single relationship dominates. "Goes with the
  // burger" must not be diluted by "does not go with the coke".
  let learned = 0;
  let cartHoldsCategory = false;
  const seen = new Set<string>();
  for (const from of cartCategoryIds) {
    if (!from || seen.has(from)) continue;
    seen.add(from);
    if (from === categoryId) cartHoldsCategory = true;
    const w = state.x[`${from}>${categoryId}`] ?? 0;
    if (w > 0) learned = Math.max(learned, saturate(w, K_PAIR));
  }
  const cold = cartHoldsCategory ? COLD_SAME : COLD_DIFFERENT;
  const complement = clamp01(cold + (learned - cold) * confidence);

  const subtotal = Number.isFinite(ctx.cartSubtotal) ? Math.max(ctx.cartSubtotal, 0) : 0;
  const target = Math.max(subtotal * PRICE_TARGET_RATIO, PRICE_TARGET_FLOOR);
  const price = Number.isFinite(c.product.price) ? Math.max(c.product.price, 0.01) : 0.01;
  const lr = Math.log(price / target);
  // Log-normal bell, symmetric in ratio: 2x and 1/2x score identically.
  const priceFit = clamp01(Math.exp(-(lr * lr) / (2 * PRICE_SIGMA * PRICE_SIGMA)));

  const curationFn = ctx.curation ?? catalogRankCuration;
  const curation = clamp01(curationFn(c.product.id, c.rank, ctx.catalogSize));

  return { affinity, category, complement, priceFit, curation, fatigue, confidence };
}

export function scoreCandidate(
  c: SuggestionCandidate,
  ctx: ScoreContext,
): Omit<ScoredSuggestion, 'jitter' | 'ranked'> {
  const features = suggestionFeatures(c, ctx);
  const w = ctx.weights ?? SUGGESTION_WEIGHTS;

  // `confidence` gates the two PERSONAL terms only. `complement` already blends
  // itself toward its cold prior via confidence, and gating it twice would zero
  // the structural "suggest something different" prior on a fresh device —
  // exactly backwards. `priceFit` and `curation` are not personal at all.
  const positive = clamp01(
    features.confidence * (w.affinity * features.affinity + w.category * features.category)
      + w.complement * features.complement
      + w.priceFit * features.priceFit
      + w.curation * features.curation,
  );

  // Clamped BEFORE fatigue is subtracted. Clamping the final value at 0 would
  // flatten every fatigued item into a tie broken by jitter alone.
  return { ...c, features, score: positive - W_FATIGUE * features.fatigue };
}

export function pickSuggestions(
  candidates: readonly SuggestionCandidate[],
  ctx: ScoreContext,
  opts?: { slots?: number; maxPerCategory?: number; epsilon?: number; random?: () => number },
): ScoredSuggestion[] {
  if (candidates.length === 0) return [];

  const slots = opts?.slots ?? SUGGESTION_SLOTS;
  const maxPerCategory = opts?.maxPerCategory ?? MAX_PER_CATEGORY;
  const epsilon = opts?.epsilon ?? EXPLORATION_EPSILON;
  const random = opts?.random ?? Math.random;

  // EXACTLY one draw per candidate, in candidate-array order, no conditionals.
  // That contract is what lets a test script the draws as a plain array.
  const scored: ScoredSuggestion[] = candidates.map((c) => {
    const base = scoreCandidate(c, ctx);
    const draw = random();
    const jitter = epsilon * (Number.isFinite(draw) ? draw : 0);
    return { ...base, jitter, ranked: base.score + jitter };
  });

  // Tie-break by product id, never array order: `sort_order` defaults to 0 and
  // PostgREST leaves ties unspecified, so array position is not stable.
  scored.sort((l, r) => r.ranked - l.ranked || (l.product.id < r.product.id ? -1 : l.product.id > r.product.id ? 1 : 0));

  const picked: ScoredSuggestion[] = [];
  const perCategory = new Map<string, number>();
  for (const s of scored) {
    if (picked.length >= slots) break;
    const used = perCategory.get(s.product.categoryId) ?? 0;
    if (used >= maxPerCategory) continue;
    perCategory.set(s.product.categoryId, used + 1);
    picked.push(s);
  }

  // Relax only when the eligible pool genuinely cannot supply the spread. This
  // is what satisfies "not all from one category unless unavoidable" by
  // construction rather than by a special case.
  if (picked.length < slots) {
    const have = new Set(picked.map((s) => s.product.id));
    for (const s of scored) {
      if (picked.length >= slots) break;
      if (have.has(s.product.id)) continue;
      have.add(s.product.id);
      picked.push(s);
    }
  }

  return picked;
}
