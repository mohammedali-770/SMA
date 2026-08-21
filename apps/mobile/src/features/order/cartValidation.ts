/**
 * Cart validation against a branch/order-type change. PURE and framework-free so
 * it is unit-tested under Node (cartValidation.test.ts) and reused by the
 * selection screen. It never mutates the cart — it only classifies which lines
 * are still orderable for the target branch; the screen decides what to remove
 * (and only after the customer confirms).
 *
 * "Available for a branch" mirrors HomeMenuScreen's menu filter exactly: the
 * product must be active AND present in the branch availability matrix. A line
 * also fails when one of the OPTIONS it already carries has been closed — that
 * cart line names a specific modifier, so a branch closing it invalidates the
 * line even though the product itself is still on sale. The server still
 * recomputes availability + prices in place_order, so this is a UX pre-check,
 * not the final authority.
 */
import type { CartItem } from '../../types/models';

export interface CartValidation {
  valid: CartItem[];
  invalid: CartItem[];
  allValid: boolean;
}

export function validateCartForBranch(
  items: CartItem[],
  branchId: string | null,
  isAvailable: (productId: string, branchId: string) => boolean,
  /**
   * Optional so the branch-switch screen, which only asks about products, is
   * unchanged. Omitted means "no option is closed" — the pre-existing
   * behaviour, and the safe direction: over-reporting a sold-out cart is worse
   * than letting the server give the final answer.
   */
  isModifierAvailable?: (modifierId: string, branchId: string) => boolean,
): CartValidation {
  if (!branchId) {
    // No branch resolved yet → nothing is orderable; an empty cart is trivially ok.
    return { valid: [], invalid: [...items], allValid: items.length === 0 };
  }
  const valid: CartItem[] = [];
  const invalid: CartItem[] = [];
  for (const it of items) {
    const optionsOk = !isModifierAvailable || Object.values(it.selectedModifiers)
      .every((mods) => mods.every((m) => isModifierAvailable(m.id, branchId)));
    const ok = it.product.isActive && isAvailable(it.product.id, branchId) && optionsOk;
    (ok ? valid : invalid).push(it);
  }
  return { valid, invalid, allValid: invalid.length === 0 };
}

/**
 * Adapt a freshly fetched availability matrix into the lookup
 * `validateCartForBranch` expects.
 *
 * The `?? true` is the load-bearing part and mirrors the database: the
 * availability table stores only EXCEPTIONS, so a missing entry means the item
 * is on sale, not that it is unknown. Defaulting the other way would tell a
 * customer their whole cart had sold out the first time a new product appeared.
 */
export function availabilityLookup(
  matrix: { [productId: string]: { [branchId: string]: boolean } },
): (productId: string, branchId: string) => boolean {
  return (productId, branchId) => matrix[productId]?.[branchId] ?? true;
}
