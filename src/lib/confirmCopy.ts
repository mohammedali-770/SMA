/**
 * The wording of the console's destructive confirmations, kept here so the text
 * is tested against what each action actually does (audit findings F-TAA4-001
 * and F-TAA4-004, 2026-11-24).
 *
 * Arabic here is engineering-drafted and has not had a native read
 * (docs/OWNER_ACTIONS.md section 35).
 */

/** The fields of an order that decide what cancelling it does. */
export interface CancelOrderFacts {
  paymentStatus: 'pending' | 'paid';
  paymentMethod?: string | null;
  total: number;
}

/**
 * True when cancelling the order enrols an automatic full refund to the card.
 * It mirrors set_order_refund_enrollment (20261018120000): the write makes a
 * paid, online, non-zero order cancelled. The server also needs a captured
 * payment record, so for an order marked paid without one the line overstates,
 * which is the safer way to be wrong in a confirmation.
 */
export function cancelRefundsCard(o: CancelOrderFacts): boolean {
  return o.paymentStatus === 'paid' && o.paymentMethod === 'online' && Number(o.total) > 0;
}

export function cancelOrderConfirmMessage(o: CancelOrderFacts, isRTL: boolean): string {
  const refund = cancelRefundsCard(o);
  if (isRTL) {
    return [
      'سيتم إلغاء الطلب.',
      refund
        ? 'هذا الطلب مدفوع بالبطاقة: سيُعاد المبلغ كاملاً إلى بطاقة العميل تلقائياً ولا يمكن التراجع عن ذلك.'
        : '',
      'سيصل العميل إشعار «تم إلغاء الطلب» إن كانت إشعارات الطلبات مفعّلة لديه.',
      'سيتم عكس حركة نقاط الولاء واستخدام الكوبون المرتبط به.',
      'هل أنت متأكد؟',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    'Cancel this order?',
    refund
      ? 'It was paid by card: the full amount is refunded to the customer’s card automatically, and this cannot be undone.'
      : '',
    'The customer is sent an “Order cancelled” notification if they have order updates on.',
    'Loyalty movements and any consumed coupon usage are compensated by the server.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Deleting a product is a permanent hard delete: its size tiers, per-branch
 * availability and any points campaign scoped to it go with it. The panel has no
 * way to switch a product off, so this is the only way to take one off the menu.
 */
export function deleteProductConfirmMessage(isRTL: boolean): string {
  return isRTL
    ? 'حذف نهائي لهذا المنتج؟ سيتم أيضاً حذف أحجامه وأسعارها وتوفره في الفروع وأي حملة نقاط مرتبطة به، ولا يمكن التراجع عن ذلك.'
    : 'Permanently delete this product? Its sizes and prices, its branch availability and any points campaign for it are deleted too. This cannot be undone.';
}

/**
 * products.category_id is ON DELETE RESTRICT, so deleting a category that still
 * has products fails; it never disables them.
 */
export function deleteCategoryConfirmMessage(isRTL: boolean): string {
  return isRTL
    ? 'حذف هذه الفئة؟ لا يمكن حذف فئة ما دامت تحتوي على منتجات؛ انقل منتجاتها أو احذفها أولاً.'
    : 'Delete this category? A category that still has products cannot be deleted; move or delete its products first.';
}
