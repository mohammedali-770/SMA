/**
 * Whether a product can actually be ordered at a branch right now — PURE and
 * framework-free so it is unit-tested under Node and shared by the menu list,
 * the product screen and the cart pre-check.
 *
 * A branch closes an OPTION as readily as it closes an item: one sauce runs
 * out, not the burger. Usually that is invisible to the menu — the item stays
 * on sale with one fewer choice. But if the closed options are the whole of a
 * REQUIRED group, there is no valid selection left, so the product cannot be
 * ordered at all even though its own availability row says otherwise.
 *
 * The same shape applies one level down, to PRICE TIERS (20260923120000): a
 * branch can close "Large" and keep "Regular". That is invisible to the menu
 * too — until EVERY tier is closed, at which point a tiered product has no
 * sellable size left even though its own availability row says it is on sale.
 *
 * The server agrees by construction rather than by a second rule: a required
 * group forces a selection, a tiered product forces a tier, and `place_order`
 * refuses any line naming a closed option or a closed tier. So there is nothing
 * here the backend does not already enforce — this exists so the customer learns
 * it on the menu instead of at the payment screen.
 */
import type { ModifierGroup } from '../types/models';

/**
 * How many options the customer MUST pick from this group.
 *
 * `isRequired` and `minSelection` are two half-expressions of one rule and the
 * data does not keep them in step: a required group may still carry
 * `min_selection = 0`. The product screen has always resolved that the same
 * way, and this is now the one place it is written down.
 */
export function requiredCount(group: ModifierGroup): number {
  return group.isRequired ? Math.max(1, group.minSelection) : group.minSelection;
}

/**
 * Required groups that can no longer be satisfied at this branch — fewer
 * available options left than the customer is obliged to choose.
 *
 * Optional groups never appear here however many of their options are closed:
 * "no sauce" stays a valid answer.
 */
export function blockingGroups(
  groups: ModifierGroup[],
  isModifierAvailable: (modifierId: string) => boolean,
): ModifierGroup[] {
  return groups.filter(
    (g) => g.modifiers.filter((m) => isModifierAvailable(m.id)).length < requiredCount(g),
  );
}

/**
 * Every SIZE closed is the item closed.
 *
 * A product with no price tiers is sold at its own price and has nothing here
 * to close, so it is never blocked by this rule — hence the length check rather
 * than a bare `every`, which is vacuously true on an empty list and would make
 * every untiered product unorderable.
 *
 * Closing SOME sizes is not this: the item stays on sale with fewer choices,
 * exactly as for options. `place_order` agrees by construction — a tiered
 * product forces a tier and the server refuses any line naming a closed one.
 */
export function allTiersClosed(
  variants: { id: string }[],
  isVariantAvailable: (variantId: string) => boolean,
): boolean {
  return variants.length > 0 && !variants.some((v) => isVariantAvailable(v.id));
}

/**
 * The product's own availability AND every required group still satisfiable AND
 * at least one size still on sale.
 *
 * The size axis is OPTIONAL so a caller that knows nothing about tiers keeps its
 * previous answer rather than silently having every product declared closed —
 * omitted means "no size is closed", which is the safe direction and matches the
 * exception-only storage.
 */
export function productOrderable(opts: {
  productAvailable: boolean;
  groups: ModifierGroup[];
  isModifierAvailable: (modifierId: string) => boolean;
  variants?: { id: string }[];
  isVariantAvailable?: (variantId: string) => boolean;
}): boolean {
  if (!opts.productAvailable) return false;
  if (opts.variants && opts.isVariantAvailable
      && allTiersClosed(opts.variants, opts.isVariantAvailable)) return false;
  return blockingGroups(opts.groups, opts.isModifierAvailable).length === 0;
}
