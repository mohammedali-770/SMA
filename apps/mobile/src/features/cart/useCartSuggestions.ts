/**
 * Wires the pure suggestion ranking to live catalog + cart state and owns the
 * feedback loop's timing. All decisions live in `suggestionScoring.ts`; all
 * persistence lives in `suggestionStore.ts`.
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

/**
 * A customer who lands on the cart and taps Checkout in 400 ms has not seen
 * anything. Without a dwell, fatigue would measure navigation speed rather than
 * indifference.
 */
const IMPRESSION_DWELL_MS = 800;

export function useCartSuggestions(): {
  suggestions: ScoredSuggestion[];
  noteRemoved: (productId: string) => void;
} {
  const cart = useCart();
  const catalog = useCatalog();
  const orderCtx = useOrderContext();

  const [ready, setReady] = useState(false);
  const [removedTick, setRemovedTick] = useState(0);
  const removedRef = useRef<Set<string>>(new Set());

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

  // The cart's own identity churns on every quantity tap — CartProvider rotates
  // the checkout idempotency key on each items change — so the slate is keyed on
  // the DISTINCT PRODUCT SET, not on `cart.items`. Changing a quantity must not
  // reshuffle the three cards under the customer's finger.
  const cartProductKey = useMemo(
    () => [...new Set(cart.items.map((it) => it.product.id))].sort().join('|'),
    [cart.items],
  );

  // Read through a ref for the same reason: the subtotal moves with quantity and
  // must not be a recompute trigger, but the value used when we DO recompute
  // should be current.
  const subtotalRef = useRef(cart.subtotal);
  subtotalRef.current = cart.subtotal;
  const cartCategoriesRef = useRef<string[]>([]);
  cartCategoriesRef.current = [...new Set(cart.items.map((it) => it.product.categoryId))];

  const suggestions = useMemo<ScoredSuggestion[]>(() => {
    if (!ready || catalog.loading || catalog.error) return [];
    if (!selectedBranchId || !orderCtx.valid) return [];

    const cartProductIds = new Set(cartProductKey ? cartProductKey.split('|') : []);
    const candidates = eligibleCandidates({
      products,
      branchId: selectedBranchId,
      cartProductIds,
      excludedProductIds: removedRef.current,
      isAvailable,
      groupsFor: groupsForProduct,
    });

    const picked = pickSuggestions(candidates, {
      // The sole clock in the feature.
      state: readSuggestions(Date.now()),
      cartCategoryIds: cartCategoriesRef.current,
      cartSubtotal: subtotalRef.current,
      catalogSize: products.length,
    });

    // One lone card reads as broken; render nothing instead.
    return picked.length >= MIN_RENDER ? picked : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the two refs above:
    // quantity changes deliberately do not recompute the slate.
  }, [ready, catalog.loading, catalog.error, selectedBranchId, orderCtx.valid, products, cartProductKey, removedTick, isAvailable, groupsForProduct]);

  // Impressions are keyed on the slate itself, so re-renders cannot inflate
  // them. If this write is skipped the strip shows the same cards forever —
  // fatigue is the only rotation mechanism there is.
  const slateKey = suggestions.map((s) => s.product.id).join('|');
  useEffect(() => {
    if (!slateKey) return;
    const ids = slateKey.split('|');
    const timer = setTimeout(() => noteImpressions(ids), IMPRESSION_DWELL_MS);
    return () => clearTimeout(timer);
  }, [slateKey]);

  return { suggestions, noteRemoved };
}
