/**
 * Framework-free decision helpers for the Checkout screen's two interaction
 * hazards: the quantity stepper (never drop a line without confirming) and the
 * sticky footer's single blocking message (say the right reason the button is
 * dead). Kept pure and unit-tested so these rules can be verified without a
 * renderer — CheckoutScreen is a thin wrapper that maps these decisions onto
 * cart calls and localized copy.
 */

export type QuantityAction =
  | { kind: 'ignore' } // a change is already settling for this line — drop the tap
  | { kind: 'confirm-remove' } // a decrement that would remove the line
  | { kind: 'apply'; direction: 1 | -1 };

/**
 * Decide what a single quantity-stepper tap should do.
 *
 * `recalcActive` is the caller's SYNCHRONOUS guard (a ref, not React state).
 * A second "−" dispatched in the same frame — before React commits the first —
 * must see the guard already set and be ignored. State cannot do this: both
 * taps would read the same pre-commit value and both would fall through. The
 * old code set and cleared the guard in the same handler, so it never survived a
 * render and was a no-op — two fast "−" at qty 2 both read quantity===2, neither
 * hit the confirm branch, and the functional decrement ran 2→1→0, silently
 * dropping the line past the "Remove this item?" modal.
 *
 * With the guard held across the settle: the first tap applies (2→1) and the
 * second is ignored; a genuine tap at qty 1 always routes to confirm-remove, so
 * no rapid sequence can remove a line without the modal.
 */
export function decideQuantityChange(input: {
  recalcActive: boolean;
  quantity: number;
  direction: 1 | -1;
}): QuantityAction {
  if (input.recalcActive) return { kind: 'ignore' };
  if (input.direction === -1 && input.quantity <= 1) return { kind: 'confirm-remove' };
  return { kind: 'apply', direction: input.direction };
}

export type BlockReason =
  | 'no-branch'
  | 'branch-closed'
  | 'no-order-type'
  | 'empty-cart'
  | 'below-minimum'
  | 'no-payment'
  | 'delivery-unserviceable'
  | 'need-description';

/**
 * The single blocking reason for the sticky footer, in priority order.
 *
 * `empty-cart` is checked BEFORE `below-minimum`: removing the last delivery
 * line must read "your cart is empty", not "below the delivery minimum". An
 * empty cart is trivially under every minimum, so the minimum check would
 * otherwise win and show a nonsensical "add X more" for a cart with nothing in
 * it. Everything upstream of the cart (no branch / closed / no order type) still
 * outranks both.
 */
export function resolveBlockReason(input: {
  hasBranch: boolean;
  branchOpen: boolean;
  hasOrderType: boolean;
  isEmpty: boolean;
  belowMinimum: boolean;
  paymentUnavailable: boolean;
  deliveryBlocked: boolean;
  needsDescription: boolean;
}): BlockReason | null {
  if (!input.hasBranch) return 'no-branch';
  if (!input.branchOpen) return 'branch-closed';
  if (!input.hasOrderType) return 'no-order-type';
  if (input.isEmpty) return 'empty-cart';
  if (input.belowMinimum) return 'below-minimum';
  if (input.paymentUnavailable) return 'no-payment';
  if (input.deliveryBlocked) return 'delivery-unserviceable';
  if (input.needsDescription) return 'need-description';
  return null;
}

/**
 * Whether an applied coupon still describes the basket in front of the
 * customer.
 *
 * `validate_coupon` is a function of (code, subtotal): minimum-spend rules and
 * percentage discounts both move with the basket. `place_order` re-runs it
 * against the RECOMPUTED subtotal and raises `Coupon rejected: %` when it no
 * longer holds, as does `begin_checkout_session`. So a coupon carried past a
 * cart change is not a cosmetically wrong number on the totals card — it is an
 * order that fails at submit, after the customer has committed to paying.
 *
 * Only an APPLIED coupon (`ok`) is subject to this. A rejection message is
 * about the code the customer typed, not about the basket, and dropping it
 * would erase the explanation they are reading.
 *
 * The comparison is deliberately exact rather than tolerant. Cart subtotals are
 * built from `round2`-ed unit prices, so equal baskets produce equal numbers;
 * an epsilon here would only widen the window in which the client shows a
 * discount the server will refuse.
 */
export function appliedCouponSurvives(
  applied: { ok: boolean; subtotal: number } | null | undefined,
  currentSubtotal: number,
): boolean {
  if (!applied) return false;
  if (!applied.ok) return true; // a rejection message is about the code, not the cart
  return applied.subtotal === currentSubtotal;
}

/**
 * What to do when the comped membership read at submission disagrees with the
 * one this screen was painted from.
 *
 * An administrator can revoke a comp while checkout sits open. The mount-time
 * read never re-runs — the customer has not changed — so the screen would keep
 * showing 0.00 while `place_order` re-reads the now-inactive membership and
 * charges in full. That is the customer being charged MORE than they were
 * shown, which is the one direction that is never acceptable.
 *
 * The three outcomes are deliberately asymmetric:
 *
 *   'block'   the comp was LOST. Correct the screen and refuse this submission,
 *             so the customer sees the real total before committing to it.
 *   'update'  the comp was GAINED. Charging less than was displayed breaks
 *             nothing, so this only corrects the screen and lets the order go.
 *   'none'    nothing changed, or the read could not answer (`null`). An
 *             unknown answer must never block: the server is the authority, and
 *             a flaky network is not a reason to refuse a valid order. This is
 *             the same rule the availability refresh in the same function
 *             already follows.
 */
export function decideCompChange(input: {
  /** What the totals card is currently showing. */
  displayed: boolean;
  /** The fresh read; `null` when it could not be determined. */
  fresh: boolean | null;
}): { action: 'none' | 'update' | 'block'; comped: boolean } {
  if (input.fresh === null || input.fresh === input.displayed) {
    return { action: 'none', comped: input.displayed };
  }
  return { action: input.fresh ? 'update' : 'block', comped: input.fresh };
}
