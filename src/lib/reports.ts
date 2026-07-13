/**
 * Pure report aggregations that must reflect REAL order data, never fabricated
 * values. Kept framework-free so they can be unit-tested directly.
 *
 * Previously the Reports panel *guessed* coupon codes from discount amounts and
 * *synthesized* Lazywait POS references from the order number. Both are replaced
 * here by the actual persisted fields (coupon_code, lazywait_order_number /
 * lazywait_ref) so ZATCA/POS audits match what really happened.
 */
import type { Order } from '../types';

export interface CouponUsageRow {
  code: string;
  count: number;
  savings: number;
}

/**
 * Real coupon-usage aggregation: groups orders by their actual `couponCode`,
 * summing the real coupon discount (`discountAmount`, which excludes loyalty).
 * Orders with no coupon are ignored; no code is ever inferred from a discount.
 */
export function buildCouponUsage(orders: Order[]): CouponUsageRow[] {
  const map = new Map<string, CouponUsageRow>();
  for (const o of orders) {
    const code = (o.couponCode ?? '').trim();
    if (!code) continue;
    const savings = Number(o.discountAmount) || 0;
    const row = map.get(code) ?? { code, count: 0, savings: 0 };
    row.count += 1;
    row.savings += savings;
    map.set(code, row);
  }
  return [...map.values()].sort((a, b) => b.savings - a.savings);
}

/**
 * The real Lazywait POS reference for an order: the human POS order number once
 * it has synced, else the Lazywait ref id, else empty string. Never fabricated.
 */
export function lazywaitRefOf(o: Pick<Order, 'lazywaitOrderNumber' | 'lazywaitRef'>): string {
  return (o.lazywaitOrderNumber ?? o.lazywaitRef ?? '').trim();
}
