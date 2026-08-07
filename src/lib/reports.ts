/**
 * Pure report aggregations that must reflect REAL order data, never fabricated
 * values. Kept framework-free so they can be unit-tested directly.
 *
 * Previously the Reports panel *guessed* coupon codes from discount amounts and
 * *synthesized* Lazywait POS references from the order number. Both are replaced
 * here by the actual persisted fields (coupon_code, lazywait_order_number /
 * lazywait_ref) so ZATCA/POS audits match what really happened.
 */
import type { DbReportOrder } from './api';
import { mapSyncStatus } from './mappers';
import type { Order, OrderStatus, SyncStatus } from '../types';

/**
 * One line item as the REPORT feed carries it.
 *
 * Narrower than `OrderItem` on purpose: no id and no modifiers, because the
 * product report aggregates quantity and revenue and never renders a line.
 */
export interface ReportOrderItem {
  productId: string | null;
  nameEn: string;
  nameAr: string;
  price: number;
  quantity: number;
}

/**
 * One order as the REPORT feed carries it — the client-side shape of
 * `admin_list_orders_for_range`.
 *
 * Not `Order`. The absent fields are the point: there is no customer name,
 * phone, id, note or address here, because none of the six reports reads them
 * and a financial report should not be a reason for customer PII to reach a
 * browser. Everything the reports DO read is present, so the aggregations below
 * and in ReportsPanel are unchanged.
 */
export interface ReportOrder {
  id: string;
  orderNumber: string;
  branchId: string;
  branchNameEn: string;
  branchNameAr: string;
  status: OrderStatus;
  orderType: 'delivery' | 'pickup';
  subtotal: number;
  deliveryFee: number;
  discountAmount: number;
  total: number;
  couponCode?: string;
  createdAt: string;
  orderSyncStatus: SyncStatus;
  lazywaitRef?: string;
  lazywaitOrderNumber?: string;
  syncLastError?: string;
  syncBlockedReason?: string;
  items: ReportOrderItem[];
}

/** Row → domain shape, mirroring `mapOrder`'s null/undefined and Number() conventions. */
export function mapReportOrder(o: DbReportOrder): ReportOrder {
  return {
    id: o.id,
    orderNumber: o.order_number,
    branchId: o.branch_id,
    branchNameEn: o.branch_name_en ?? '',
    branchNameAr: o.branch_name_ar ?? '',
    status: o.status,
    orderType: o.order_type,
    subtotal: Number(o.subtotal),
    deliveryFee: Number(o.delivery_fee),
    discountAmount: Number(o.discount_amount),
    total: Number(o.total),
    couponCode: o.coupon_code ?? undefined,
    createdAt: o.created_at,
    orderSyncStatus: mapSyncStatus(o.sync_status),
    lazywaitRef: o.lazywait_ref ?? undefined,
    lazywaitOrderNumber: o.lazywait_order_number ?? undefined,
    syncLastError: o.sync_last_error ?? undefined,
    syncBlockedReason: o.sync_blocked_reason ?? undefined,
    items: (o.order_items ?? []).map(i => ({
      productId: i.product_id,
      nameEn: i.name_en,
      nameAr: i.name_ar,
      price: Number(i.unit_price),
      quantity: Number(i.quantity),
    })),
  };
}

export interface CouponUsageRow {
  code: string;
  count: number;
  savings: number;
}

/**
 * Real coupon-usage aggregation: groups orders by their actual `couponCode`,
 * summing the real coupon discount (`discountAmount`, which excludes loyalty).
 * Orders with no coupon are ignored; no code is ever inferred from a discount.
 *
 * Typed on the two fields it reads rather than on `Order`, so it serves both the
 * full order shape and the leaner `ReportOrder`.
 */
export function buildCouponUsage(
  orders: readonly Pick<Order, 'couponCode' | 'discountAmount'>[],
): CouponUsageRow[] {
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
