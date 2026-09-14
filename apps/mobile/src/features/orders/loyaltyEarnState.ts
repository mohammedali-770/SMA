/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether an order's loyalty points have actually been CREDITED yet.
 *
 * WHY THIS EXISTS. Since `20260918120000` the points on an order are a promise
 * until it settles: `place_order` writes an `earn_pending` ledger row and moves
 * no balance, and `admin_set_order_status` promotes it on delivery. But
 * `orders.loyalty_points_earned` is written at creation and stays positive
 * throughout, so a receipt that renders any positive value as "+64 Loyalty
 * points" tells a customer they have been awarded points they may never
 * receive — a cancelled order never earns them at all. Review caught that on
 * #372.
 *
 * THIS MIRRORS THE SERVER RULE DELIBERATELY, and the duplication is the whole
 * risk: if the promotion gate in `admin_set_order_status` changes, this must
 * change with it or the receipt starts lying again in the other direction.
 * `supabase/tests/loyalty_earn_on_settlement_test.sql` pins the server half and
 * `loyaltyEarnState.test.ts` pins this one; they are written to the same four
 * cases so a divergence shows up as a disagreement rather than as silence.
 *
 * The rule: delivery settles a CASH order (handing food over means it was paid
 * for) but not an ONLINE one, because staff can advance an unpaid online order
 * past a confirmation dialog. Online additionally requires a recorded payment.
 */

export type LoyaltyEarnState = 'credited' | 'pending' | 'forfeited';

export interface LoyaltyEarnInput {
  status: string;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  loyaltyPointsEarned: number;
}

export function loyaltyEarnState(order: LoyaltyEarnInput): LoyaltyEarnState {
  if (!(order.loyaltyPointsEarned > 0)) return 'forfeited';
  // A cancelled order's pending earn is reversed and never promoted. Showing a
  // figure at all on one would be the worst version of this bug.
  if (order.status === 'cancelled') return 'forfeited';
  if (order.status !== 'delivered') return 'pending';
  // `!== 'online'` rather than `=== 'cash'`, matching the server's
  // `is distinct from 'online'`: the column is nullable and one legacy order
  // carries no method, which must behave like cash rather than be denied.
  if (order.paymentMethod !== 'online') return 'credited';
  return order.paymentStatus === 'paid' ? 'credited' : 'pending';
}
