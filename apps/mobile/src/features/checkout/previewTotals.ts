/**
 * Checkout preview totals — FRAMEWORK-FREE and fully unit-tested.
 *
 * Editing quantities on the Checkout screen must move every dependent number at
 * once: line total, subtotal, delivery fee, coupon, loyalty, minimum-order
 * eligibility and the final total. Those numbers were previously computed as
 * loose expressions inline in CheckoutScreen.tsx, which made it impossible to
 * test that "decrement puts the cart back below the branch minimum" and easy for
 * a second, drifting calculation to appear next to the first.
 *
 * This is still a PREVIEW. `place_order` recomputes every amount server-side
 * from product and modifier ids and is the only authority — see
 * `subtotal` derivation via `cartSubtotal`, which reads the same `unitPrice` the
 * cart store already stores. Nothing here may be sent as an amount.
 */
import { cartSubtotal } from '../../utils/format';
import type { CartItem } from '../../types/models';

export interface PreviewInput {
  items: CartItem[];
  orderType: 'delivery' | 'pickup' | null;
  /** Branch delivery fee; ignored for pickup. */
  deliveryFee: number;
  /** Branch minimum for delivery; ignored for pickup. */
  minDeliveryOrder: number;
  /** Validated coupon discount, 0 when none applied. */
  couponDiscount: number;
  /** Loyalty points the customer is redeeming (0 when the toggle is off). */
  loyaltyPoints: number;
  /** Currency value of one loyalty point. */
  discountPerPoint: number;
}

export interface PreviewTotals {
  subtotal: number;
  deliveryFee: number;
  couponDiscount: number;
  loyaltyDiscount: number;
  total: number;
  /** True when delivery is selected and the subtotal is under the minimum. */
  belowMinimum: boolean;
  /** How much more is needed to reach the minimum; 0 when not below it. */
  missingForMinimum: number;
  itemCount: number;
}

function money(n: number): number {
  return Number(Math.max(0, n).toFixed(2));
}

/** Per-line total. Exported so the row and the summary cannot disagree. */
export function lineTotal(item: Pick<CartItem, 'unitPrice' | 'quantity'>): number {
  return Number((item.unitPrice * item.quantity).toFixed(2));
}

/**
 * Recompute the whole preview from the cart. Pure: same input, same output — so
 * a quantity change is just a re-run, with no partially-updated intermediate.
 */
export function computePreviewTotals(input: PreviewInput): PreviewTotals {
  const subtotal = cartSubtotal(input.items);
  const isDelivery = input.orderType === 'delivery';
  const itemCount = input.items.reduce((n, it) => n + it.quantity, 0);
  // An EMPTY cart carries no delivery fee. The preview used to apply it on
  // order type alone, so an empty delivery checkout read subtotal 0.00,
  // delivery 15.00, total 15.00 — a payable amount for nothing.
  //
  // Fixed HERE rather than by hiding the row, because hiding the row alone
  // would leave "Total 15.00" with nothing on screen explaining it. This is the
  // CLIENT preview only: `canSubmitOrder` already refuses at `itemCount === 0`,
  // so a zero-item cart can never reach `place_order` and the two cannot
  // disagree in any reachable state. Server calculation, delivery-zone rules
  // and place-order behaviour are untouched.
  const deliveryFee = isDelivery && itemCount > 0 ? money(input.deliveryFee) : 0;

  // Discounts never exceed the goods value: a coupon plus loyalty must not make
  // the delivery fee free or drive the total negative.
  const couponDiscount = money(Math.min(input.couponDiscount, subtotal));
  const loyaltyCap = Math.max(0, subtotal - couponDiscount);
  const loyaltyDiscount = money(
    Math.min(input.loyaltyPoints * input.discountPerPoint, loyaltyCap),
  );

  const total = money(subtotal + deliveryFee - couponDiscount - loyaltyDiscount);

  // The minimum is judged on goods only — adding a delivery fee to clear the
  // branch minimum would let a customer buy their way past it with the fee.
  const belowMinimum = isDelivery && subtotal < input.minDeliveryOrder;
  const missingForMinimum = belowMinimum
    ? Number((input.minDeliveryOrder - subtotal).toFixed(2))
    : 0;

  return {
    subtotal,
    deliveryFee,
    couponDiscount,
    loyaltyDiscount,
    total,
    belowMinimum,
    missingForMinimum,
    itemCount,
  };
}

/**
 * Whether the order may be submitted. `pendingRecalc` is the guard for section
 * 3: while a quantity change is settling, submission is refused so the server
 * can never be handed a cart the customer has not seen priced.
 */
export function canSubmitOrder(input: {
  totals: PreviewTotals;
  blocked: boolean;
  placing: boolean;
  pendingRecalc: boolean;
  descriptionValid: boolean;
  requiresDescription: boolean;
}): boolean {
  if (input.blocked || input.placing || input.pendingRecalc) return false;
  if (input.totals.itemCount === 0) return false;
  if (input.totals.belowMinimum) return false;
  if (input.requiresDescription && !input.descriptionValid) return false;
  return true;
}
