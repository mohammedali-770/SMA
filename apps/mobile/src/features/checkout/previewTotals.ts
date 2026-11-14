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
 * from product and modifier ids and is the only authority — see `subtotal`
 * derivation via `cartSubtotal`, which reads the same `unitPrice` the cart store
 * already stores. Nothing here may be sent as an amount.
 *
 * That applies to the comp as well: `comped` only decides what this screen
 * SHOWS. The server reads `public.comp_members` itself and never trusts a
 * client flag, so a customer who forged one would still be charged in full.
 *
 * A preview is still a promise about money, so where it reproduces a server
 * rule it reproduces it EXACTLY, not approximately. The loyalty block below is
 * the server's redemption, step for step, in whole halalas. Until 2026-11-14 it
 * was "balance times point value, capped at the goods", which read 0.00 for a
 * SAR 8.00 pickup order while the server used no points and charged 8.00 (gap
 * PG-31). `previewParity.test.ts` holds it to the real `compute_order_snapshot`.
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
  /**
   * Loyalty points the app asks the server to redeem: the customer's WHOLE
   * balance with the switch on, 0 with it off. The app cannot ask for part of a
   * balance (`LoyaltyToggle` is on or off), so this is also the balance in the
   * server's `least(requested, balance, …)`.
   */
  loyaltyPoints: number;
  /** Currency value of one loyalty point (`app_settings.discount_per_point`). */
  discountPerPoint: number;
  /**
   * `app_settings.min_points_to_redeem`. The server uses NO points at all when
   * fewer than this many whole points fit the order, so this decides whether a
   * small order gets any discount. A value that is not a finite number (the
   * settings row has not loaded) withholds the discount: the preview may only
   * under-promise.
   */
  minPointsToRedeem: number;
  /**
   * `app_settings.loyalty_pickup_only`. While on, points are earned and
   * redeemed on PICKUP orders only, so a delivery checkout must not offer a
   * redemption the server will refuse.
   *
   * Defaults TRUE when omitted — the same direction as the column default and
   * as `mapLoyaltySettings`. An unknown value withholds the discount rather
   * than promising one, so the preview can only ever under-promise.
   */
  loyaltyPickupOnly?: boolean;
  /**
   * The customer is a comped member (`public.comp_members`, active). The server
   * decides this; the flag is here only so the screen shows 0.00 instead of a
   * full price the customer will not be charged.
   */
  comped?: boolean;
}

export interface PreviewTotals {
  subtotal: number;
  deliveryFee: number;
  couponDiscount: number;
  loyaltyDiscount: number;
  /**
   * The whole points the server will take for `loyaltyDiscount`, which is what
   * the receipt's points line will show. 0 when none are used.
   */
  loyaltyPointsRedeemed: number;
  /**
   * Points were asked for and the order type allows them, but the server will
   * use none: fewer than `minPointsToRedeem` whole points fit the order's value
   * before points. The screen says so, because otherwise the switch reads "on"
   * while the summary shows no points at all.
   */
  loyaltyOrderTooSmall: boolean;
  /**
   * The order value, before points, from which the minimum fits: the minimum's
   * worth (points times point value), rounded UP to the halala. The figure the
   * "too small" note quotes. 0 when there is no minimum or no point value.
   */
  loyaltyMinimumOrder: number;
  /**
   * What the comp is worth: everything that would otherwise have been owed,
   * delivery fee included. 0 when the customer is not comped. Kept apart from
   * `couponDiscount` because a comp is not a coupon.
   */
  compDiscount: number;
  /**
   * The channel rule -- not the comp, not an empty cart, not a zero balance --
   * is why no loyalty discount is applied. The screen uses it to EXPLAIN the
   * refusal; showing a silent 0.00 was the alternative, and a customer with a
   * balance would read that as the app losing their points.
   *
   * False whenever the customer would not have redeemed anyway (comped, or no
   * points selected), so it never fires on a screen with nothing to explain.
   */
  loyaltyBlockedByChannel: boolean;
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

/**
 * An amount as whole halalas. Every amount here has at most two decimals (the
 * server stores them as numeric(10,2)), so rounding removes only the binary
 * noise of the float, never a real halala.
 */
function halalas(sar: number): number {
  return Math.round(Math.max(0, sar) * 100);
}

/**
 * floor(a / b) for non-negative whole numbers, exactly. `Math.floor(a / b)` is
 * not exact once the quotient is a float: 0.30 / 0.10 is 2.9999999999999996 in
 * binary, which floors to 2 where the server's numeric division gives 3.
 */
function floorDiv(a: number, b: number): number {
  return (a - (a % b)) / b;
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

  // A coupon never exceeds the goods value (validate_coupon caps it at the
  // subtotal), and nothing drives the total negative. Points are capped at the
  // whole amount before points, delivery fee INCLUDED, because that is the
  // server's `v_pre_loyalty`; see the loyalty block below.
  //
  // A comped customer gets NEITHER, and that is not a display choice — it is
  // what the server does. `place_order` and `compute_order_snapshot` both skip
  // the coupon block and the loyalty redemption entirely for a comped customer,
  // so the code is not consumed and the points are not burned. Subtracting them
  // here would show two reductions that will not happen, and would report a
  // comp SMALLER than the `comp_discount_amount` the order actually records.
  //
  // The CHANNEL rule is the second refusal, and it is the server's rule rather
  // than a display choice: `place_order` and `compute_order_snapshot` both
  // derive `v_loyalty_channel_ok` and skip the redemption AND the earning for a
  // delivery order while `loyalty_pickup_only` is on
  // (20260907120000_loyalty_pickup_only). Mirroring it here is what stops the
  // checkout showing a 10.00 reduction the server will not grant.
  const comped = Boolean(input.comped);
  const pickupOnly = input.loyaltyPickupOnly ?? true;
  const channelOk = !pickupOnly || input.orderType === 'pickup';
  const couponDiscount = comped ? 0 : money(Math.min(input.couponDiscount, subtotal));

  // ---- Loyalty: the server's redemption, step for step ---------------------
  // `place_order` and `compute_order_snapshot` (the latest definitions, in
  // 20260924120000_place_order_variant_availability.sql) both run:
  //
  //   v_pre_loyalty      := greatest(0, subtotal + delivery_fee - discount)
  //   v_loyalty_redeemed := least(requested, balance, floor(v_pre_loyalty / per_point))
  //   if v_loyalty_redeemed < min_points_to_redeem then v_loyalty_redeemed := 0
  //   v_loyalty_discount := least(round(v_loyalty_redeemed * per_point, 2), v_pre_loyalty)
  //
  // So only WHOLE points that fit the order are used, and none at all when
  // fewer than the minimum fit: at 0.10 a point and a minimum of 100, an order
  // under SAR 10.00 gets no points, however large the balance. The sums are in
  // whole halalas and the point value in ten-thousandths (it is numeric(10,4)),
  // so the floor and the rounding are exact, as they are in Postgres.
  const subtotalH = halalas(subtotal);
  const deliveryFeeH = halalas(deliveryFee);
  const couponH = halalas(couponDiscount);
  const preLoyaltyH = Math.max(0, subtotalH + deliveryFeeH - couponH);
  const perPointUnits = Math.round(input.discountPerPoint * 10000);
  const minPoints = Number.isFinite(input.minPointsToRedeem) ? input.minPointsToRedeem : Infinity;
  const requested = Math.max(0, Math.floor(input.loyaltyPoints || 0));
  const redeeming = !comped && channelOk && requested > 0 && perPointUnits > 0;

  let loyaltyPointsRedeemed = 0;
  let loyaltyDiscountH = 0;
  let loyaltyOrderTooSmall = false;
  if (redeeming) {
    const fit = floorDiv(preLoyaltyH * 100, perPointUnits);
    loyaltyPointsRedeemed = Math.min(requested, fit);
    if (loyaltyPointsRedeemed < minPoints) {
      // Said out loud only when the ORDER is the reason. From the app the
      // balance is never under the minimum here: the switch is not shown then.
      loyaltyOrderTooSmall = Number.isFinite(minPoints) && requested >= minPoints;
      loyaltyPointsRedeemed = 0;
    }
    // round(points * per_point, 2), half away from zero like Postgres.
    loyaltyDiscountH = Math.min(floorDiv(loyaltyPointsRedeemed * perPointUnits + 50, 100), preLoyaltyH);
  }
  const loyaltyDiscount = loyaltyDiscountH / 100;
  // fit >= minimum exactly when the order before points is worth at least
  // minimum x per point, rounded up to the halala.
  const loyaltyMinimumOrder =
    Number.isFinite(minPoints) && minPoints > 0 && perPointUnits > 0
      ? floorDiv(minPoints * perPointUnits + 99, 100) / 100
      : 0;
  // Only worth explaining when the customer was actually trying to spend
  // something: a comped order already says why it costs nothing, and a customer
  // who redeemed nothing has nothing withheld.
  const loyaltyBlockedByChannel = !comped && !channelOk && input.loyaltyPoints > 0;

  // A comped customer owes nothing at all. The comp is worth exactly what was
  // about to be charged — delivery fee included, which is what the owner asked
  // for. Mirrors place_order and compute_order_snapshot, which zero v_total in
  // the same position, before VAT is derived from it.
  const payable = Math.max(0, preLoyaltyH - loyaltyDiscountH) / 100;
  const compDiscount = comped ? payable : 0;
  const total = comped ? 0 : payable;

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
    loyaltyPointsRedeemed,
    loyaltyOrderTooSmall,
    loyaltyMinimumOrder,
    compDiscount,
    loyaltyBlockedByChannel,
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
