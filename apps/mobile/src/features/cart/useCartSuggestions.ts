/**
 * Wires the pure suggestion ranking to live catalog + cart state and owns the
 * feedback loop's timing. All decisions live in `suggestionScoring.ts`; all
 * persistence lives in `suggestionStore.ts`.
 *
 * THE SLATE IS PINNED, NOT REFILLED. It is generated once per cart visit and
 * then only ever shrinks: accepting a card removes it and the remaining two
 * stay put, then one, then the strip disappears. Re-picking a replacement the
 * instant a card is tapped makes the row feel like it is fighting the
 * customer — the thing they just chose is replaced by something they did not,
 * under their finger. A fresh set of three is generated next time they open
 * the cart.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCart, useCatalog, useOrderContext } from '../../store';
import {
  MIN_RENDER,
  eligibleCandidates,
  pickSuggestions,
  type ScoredSuggestion,
} from './suggestionScoring';
import { hydrateSuggestions, noteImpressions, readSuggestions } from './suggestionStore';
import type { Product } from '../../types/models';

/**
 * A customer who lands on the cart and taps Checkout in 400 ms has not seen
 * anything. Without a dwell, fatigue would measure navigation speed rather than
 * indifference.
 */
const IMPRESSION_DWELL_MS = 800;

export function useCartSuggestions(): {
  suggestions: ScoredSuggestion[];
  noteRemoved: (productId: string) => void;
  /** Called by the screen once the rail is actually inside the viewport. */
  noteSlateVisible: () => void;
} {
  const cart = useCart();
  const catalog = useCatalog();
  const orderCtx = useOrderContext();

  const [ready, setReady] = useState(false);
  const [removedTick, setRemovedTick] = useState(0);
  const removedRef = useRef<Set<string>>(new Set());
  const [onScreen, setOnScreen] = useState(false);
  /** The last slate actually charged an impression, so a re-entry cannot double-count. */
  const chargedRef = useRef('');
  /** The pinned slate. Generated once per catalog/branch context, then only shrinks. */
  const [slate, setSlate] = useState<ScoredSuggestion[]>([]);

  // Hydrate once. Load-bearing: a write that fires before the read resolves
  // would persist EMPTY_STATE over the customer's real profile.
  const hydrating = useRef(false);
  useEffect(() => {
    if (hydrating.current) return;
    hydrating.current = true;
    let alive = true;
    hydrateSuggestions()
      .catch(() => undefined)
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  const noteRemoved = useCallback((productId: string) => {
    if (!productId || removedRef.current.has(productId)) return;
    removedRef.current.add(productId);
    // Session-scoped only, never persisted: a removal is "not today", not a
    // preference, and would poison a 45-day profile.
    setRemovedTick((n) => n + 1);
  }, []);

  const { products, selectedBranchId, isAvailable, groupsForProduct } = catalog;

  // Read the cart through refs: the slate is generated from a snapshot, and
  // neither a quantity tap nor an add should trigger a regeneration.
  const cartRef = useRef(cart.items);
  cartRef.current = cart.items;
  const subtotalRef = useRef(cart.subtotal);
  subtotalRef.current = cart.subtotal;

  // Generate the slate once per (branch, catalog) context. Identity comparison
  // rather than a length key, so a reload that swaps the array regenerates.
  const generatedFor = useRef<{ branch: string; products: readonly Product[] } | null>(null);
  useEffect(() => {
    if (!ready || catalog.loading || catalog.error) return;
    if (!selectedBranchId || !orderCtx.valid) return;
    // CartScreen early-returns the empty view before the strip exists, so a
    // slate generated here would be scored and charged but never shown.
    if (cartRef.current.length === 0) return;
    const seen = generatedFor.current;
    if (seen && seen.branch === selectedBranchId && seen.products === products) return;
    generatedFor.current = { branch: selectedBranchId, products };

    const candidates = eligibleCandidates({
      products,
      branchId: selectedBranchId,
      cartProductIds: new Set(cartRef.current.map((it) => it.product.id)),
      excludedProductIds: removedRef.current,
      isAvailable,
      groupsFor: groupsForProduct,
    });
    const picked = pickSuggestions(candidates, {
      // The sole clock in the feature.
      state: readSuggestions(Date.now()),
      cartCategoryIds: [...new Set(cartRef.current.map((it) => it.product.categoryId))],
      cartSubtotal: subtotalRef.current,
      catalogSize: products.length,
    });
    // A strip that opens with one lone card reads as broken. Shrinking DOWN to
    // one is fine — that is the customer working through the row.
    setSlate(picked.length >= MIN_RENDER ? picked : []);
  }, [ready, catalog.loading, catalog.error, selectedBranchId, orderCtx.valid, products, isAvailable, groupsForProduct]);

  // Rendering only ever removes from the pinned slate. Accepting a card puts it
  // in the cart, which drops it here and leaves the rest untouched.
  const cartProductKey = useMemo(
    () => [...new Set(cart.items.map((it) => it.product.id))].sort().join('|'),
    [cart.items],
  );
  const suggestions = useMemo<ScoredSuggestion[]>(() => {
    if (cart.items.length === 0 || !selectedBranchId) return [];
    const inCart = new Set(cartProductKey ? cartProductKey.split('|') : []);
    return slate.filter((s) => {
      if (inCart.has(s.product.id) || removedRef.current.has(s.product.id)) return false;
      // Cheap re-check: the catalog can drop a product's availability while the
      // screen is open, and a pinned card must not outlive its eligibility.
      return s.product.isActive && isAvailable(s.product.id, selectedBranchId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- removedRef is read
    // through removedTick; cart.items only matters via cartProductKey.
  }, [slate, cartProductKey, removedTick, selectedBranchId, isAvailable, cart.items.length]);

  // Keyed on the PINNED slate, not the shrinking rendered subset: the three
  // cards were shown once, so they are charged once. Sorted so a re-pick that
  // reorders an unchanged trio cannot bill a second impression.
  const slateKey = slate.map((s) => s.product.id).sort().join('|');

  const noteSlateVisible = useCallback(() => setOnScreen(true), []);
  // A new slate has to earn its own impression.
  useEffect(() => { setOnScreen(false); }, [slateKey]);

  // Dwell measures attention, but only once the rail is genuinely on screen.
  // With four or more cart lines the strip sits below the fold, so a timer
  // armed on mount alone would charge impressions for cards nobody saw.
  useEffect(() => {
    if (!slateKey || !onScreen || chargedRef.current === slateKey) return;
    const ids = slateKey.split('|');
    const timer = setTimeout(() => {
      chargedRef.current = slateKey;
      noteImpressions(ids);
    }, IMPRESSION_DWELL_MS);
    return () => clearTimeout(timer);
  }, [slateKey, onScreen]);

  return { suggestions, noteRemoved, noteSlateVisible };
}
