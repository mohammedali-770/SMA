/**
 * The persisted cart's schema, and the tier a bare Add assumes.
 *
 * Pure and framework-free. These lived in `store/CartProvider.tsx` until that
 * module started reading the catalog, which pulls React Native into its import
 * graph; Node tests import them from here instead. CartProvider re-exports them.
 */
import type { CartItem, ProductVariant } from '../../types/models';

/**
 * The tier a bare Add uses when the customer was never asked to choose.
 *
 * Deliberately NOT `variants[0]`. Variants arrive in Lazywait `sort_order`,
 * while `products.price` — the "from" price the menu card advertises — is
 * independently the CHEAPEST tier. Taking the first row therefore charges
 * whatever tier the POS happened to list first: for Coral the card reads 20.00
 * and the first row is 29.00, so a one-tap Add silently charged 9.00 more than
 * the card showed. Selecting by price keeps what the customer is charged equal
 * to what they were shown.
 *
 * This is the floor, not the finished behaviour: a multi-tier product should
 * arguably open a picker instead of assuming a tier at all. That is a product
 * decision (see the PR body); this function makes the assumed tier honest under
 * either answer.
 */
export function cheapestVariant(variants: ProductVariant[]): ProductVariant | null {
  let best: ProductVariant | null = null;
  for (const v of variants) {
    if (!best || v.price < best.price) best = v;
  }
  return best;
}

/**
 * Persisted cart schema version, stored INSIDE the payload.
 *
 * The version is not a key suffix because `storageKeys.ts` forbids changing a
 * key's value outright, and `SUGGESTIONS_STORAGE_KEY` sets the same precedent.
 *
 * v1 persisted a bare `CartItem[]` and predates tiers, so its rows carry no
 * `variant`. Hydrating one would omit `variant_id` from `toOrderItems`, and
 * `place_order` rejects a product that has active tiers but no chosen tier — so
 * the customer would be unable to check out at all, with nothing on screen
 * explaining why. A v1 payload is therefore DROPPED rather than half-migrated:
 * a cart that cannot be ordered is worse than an empty one. Parsing has no
 * catalog to resolve tiers from; CartProvider re-prices what it does hydrate
 * (`repriceCart`), and would only flag such rows, not repair them.
 */
export const CART_SCHEMA_VERSION = 2;

/** Read a persisted cart, discarding anything not written by this version. */
export function parsePersistedCart(raw: string): CartItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  // v1: a bare array, written before tiers existed.
  if (Array.isArray(parsed)) return [];
  if (!parsed || typeof parsed !== 'object') return [];
  const env = parsed as { v?: unknown; items?: unknown };
  if (env.v !== CART_SCHEMA_VERSION || !Array.isArray(env.items)) return [];
  return env.items as CartItem[];
}
