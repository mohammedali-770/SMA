/**
 * Where the customer gets the VAT (tax) invoice: the POS issues it at the
 * branch (owner, 2026-11-19), so the app's receipt is not the tax invoice and
 * says where the real one comes from. Pickup: at the counter. Delivery: from
 * the driver. A cancelled order, or one with nothing charged, gets no note,
 * because no tax invoice follows it.
 */
import type { StringKey } from '../../i18n/strings';

export function vatInvoiceNoteKey(order: {
  status: string;
  orderType: string;
  total: number;
}): StringKey | null {
  if (order.status === 'cancelled' || !(order.total > 0)) return null;
  if (order.orderType === 'pickup') return 'vatInvoicePickup';
  if (order.orderType === 'delivery') return 'vatInvoiceDelivery';
  return null;
}
