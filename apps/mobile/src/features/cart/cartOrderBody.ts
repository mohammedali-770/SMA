/**
 * The cart as `place_order` receives it, and the key that identifies it.
 *
 * Pure and framework-free. `CartProvider.toOrderItems` returns exactly this,
 * and the cart's idempotency key rotates when, and only when, this changes.
 */
import type { CartItem } from '../../types/models';

export interface OrderItemInput {
  product_id: string;
  quantity: number;
  variant_id?: string;
  modifier_ids?: string[];
  note?: string;
}

// `note` is omitted rather than sent as null when there is none: place_order
// reads it with `->> 'note'`, and an absent key and a JSON null both normalize
// to NULL server-side, but omitting keeps the submitted body honest.
export function cartOrderItems(items: CartItem[]): OrderItemInput[] {
  return items.map((it) => ({
    product_id: it.product.id,
    quantity: it.quantity,
    // Omitted, not null, when the product has no tiers — same convention as the
    // note, and place_order reads it with `->> 'variant_id'`.
    ...(it.variant ? { variant_id: it.variant.id } : {}),
    modifier_ids: Object.values(it.selectedModifiers)
      .flat()
      .map((m) => m.id),
    ...(it.note ? { note: it.note } : {}),
  }));
}

/**
 * What the idempotency key stands for: the order the customer is asking for.
 *
 * Prices are not in it, because the client never sends a price — place_order
 * prices every line itself. So re-pricing a cart from fresh menu rows leaves
 * this unchanged, and must not rotate the key. Rotating it would turn a retry
 * after a lost response (the order was placed, the reply never arrived) into a
 * second order, because place_order returns the existing order only for the
 * key it was placed under.
 */
export function cartOrderSignature(items: CartItem[]): string {
  return JSON.stringify(cartOrderItems(items));
}
