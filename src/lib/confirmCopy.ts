/**
 * The wording of the console's destructive confirmations, kept here so the text
 * is tested against what each action actually does (audit findings F-TAA4-001
 * and F-TAA4-004, 2026-11-24).
 *
 * Arabic here is engineering-drafted and has not had a native read
 * (docs/OWNER_ACTIONS.md section 35).
 */
import type { OrderStatus } from '../types';

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

// ---------------------------------------------------------------------------
// Live or unrecallable console changes (audit Phase 3, 2026-11-25). Each is a
// plain window.confirm line, like the ones above, so the text is tested against
// what the action does and the call sites stay one line.
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<OrderStatus, { en: string; ar: string }> = {
  received: { en: 'Received', ar: 'تم الاستلام' },
  preparing: { en: 'Preparing', ar: 'قيد التحضير' },
  ready: { en: 'Ready', ar: 'جاهز' },
  out_for_delivery: { en: 'Out for delivery', ar: 'خرج للتوصيل' },
  delivered: { en: 'Delivered', ar: 'تم التسليم' },
  cancelled: { en: 'Cancelled', ar: 'ملغي' },
};

/**
 * Moving an order to any status from the receipt's select sends the customer a
 * push (push-dispatch has a message for every status) and the move cannot be
 * reverted: ORDER_STATUS_TRANSITIONS is forward-only. Delivered is also the end
 * of the line, with no cancel after it. Cancelling has its own confirmation
 * (`cancelOrderConfirmMessage`) and does not come through here.
 *
 * `unpaidOnline` prefixes the long-standing unsettled-payment warning so the
 * operator answers ONE question, not two in a row.
 */
export function orderStatusChangeConfirmMessage(
  target: OrderStatus,
  isRTL: boolean,
  opts: { unpaidOnline?: boolean } = {},
): string {
  const label = STATUS_LABEL[target];
  const final = target === 'delivered';
  if (isRTL) {
    return [
      opts.unpaidOnline ? 'لم يكتمل الدفع الإلكتروني لهذا الطلب بعد.' : '',
      `نقل الطلب إلى «${label.ar}»؟`,
      'سيصل العميل إشعار بتحديث حالة الطلب إن كانت إشعارات الطلبات مفعّلة لديه، ولا يمكن سحبه بعد إرساله.',
      'لا يمكن إرجاع الطلب إلى حالة سابقة.',
      final ? 'حالة «تم التسليم» نهائية: لا يمكن تعديل الطلب أو إلغاؤه بعدها.' : '',
    ].filter(Boolean).join(' ');
  }
  return [
    opts.unpaidOnline ? 'Online payment for this order has not completed.' : '',
    `Move this order to “${label.en}”?`,
    'The customer is sent an order-update notification if they have order updates on, and it cannot be recalled once sent.',
    'An order cannot be moved back to an earlier status.',
    final ? '“Delivered” is final: the order cannot be changed or cancelled afterwards.' : '',
  ].filter(Boolean).join(' ');
}

export type BranchServiceOff = 'close' | 'delivery' | 'pickup' | 'pause';

/** Taking a branch, or one of its channels, away from customers. Reversible with one click, but live at once. */
export function branchServiceOffConfirmMessage(kind: BranchServiceOff, branchName: string, isRTL: boolean): string {
  if (isRTL) {
    switch (kind) {
      case 'close': return `إغلاق فرع «${branchName}»؟ لن يتمكن العملاء من الطلب من هذا الفرع إلى أن يُفتح من جديد.`;
      case 'delivery': return `إيقاف التوصيل لفرع «${branchName}»؟ لن يتمكن العملاء من تقديم طلبات توصيل لهذا الفرع إلى أن يُعاد تفعيله.`;
      case 'pickup': return `إيقاف الاستلام لفرع «${branchName}»؟ لن يتمكن العملاء من تقديم طلبات استلام من هذا الفرع إلى أن يُعاد تفعيله.`;
      case 'pause': return `إيقاف التوصيل لفرع «${branchName}» بدون مدة؟ لن يُستأنف من تلقاء نفسه، ويبقى موقوفاً إلى أن يستأنفه أحد.`;
    }
  }
  switch (kind) {
    case 'close': return `Close “${branchName}”? Customers can no longer order from this branch until it is opened again.`;
    case 'delivery': return `Turn delivery OFF for “${branchName}”? Customers can no longer place delivery orders with this branch until it is turned back on.`;
    case 'pickup': return `Turn pickup OFF for “${branchName}”? Customers can no longer place pickup orders at this branch until it is turned back on.`;
    case 'pause': return `Pause delivery for “${branchName}” with no timer? It does not resume by itself and stays paused until someone resumes it.`;
  }
}

/**
 * The live delivery area. Clearing it makes `place_order` refuse every delivery
 * order for the branch ("Delivery area is not configured for this branch.");
 * saving replaces the area at once, and the console keeps no copy of the old one.
 */
export function deliveryZoneConfirmMessage(
  action: 'save' | 'clear',
  branchName: string,
  isRTL: boolean,
  hasExisting = true,
): string {
  if (isRTL) {
    return action === 'clear'
      ? `مسح منطقة التوصيل لفرع «${branchName}»؟ سيتم رفض كل طلبات التوصيل لهذا الفرع إلى أن تُحفظ منطقة جديدة.`
      : hasExisting
        ? `استبدال منطقة التوصيل الحالية لفرع «${branchName}»؟ ستُقبل طلبات التوصيل داخل المنطقة الجديدة فقط ابتداءً من الآن، ولا يُحتفظ بالمنطقة القديمة.`
        : `حفظ منطقة التوصيل لفرع «${branchName}»؟ ستُقبل طلبات التوصيل داخل هذه المنطقة ابتداءً من الآن.`;
  }
  return action === 'clear'
    ? `Clear the delivery area for “${branchName}”? Every delivery order for this branch is refused until a new area is saved.`
    : hasExisting
      ? `Replace the live delivery area for “${branchName}”? From now on delivery orders are accepted only inside the new area, and the old area is not kept.`
      : `Save the delivery area for “${branchName}”? Delivery orders are accepted inside it from now on.`;
}

/**
 * The most points one console adjustment may move. The RPC has no ceiling of its
 * own (an integer is the only bound), and a balance is redeemable at the
 * programme's rate, 0.10 SAR a point by default, so 1,000 is about SAR 100 at
 * that rate: more than any goodwill credit or correction an operator makes in
 * one step, and small enough that a stray digit cannot mint a large liability.
 * A larger correction is made as several adjustments, each confirmed.
 */
export const MAX_LOYALTY_ADJUSTMENT = 1000;

export function loyaltyAdjustLimitMessage(isRTL: boolean): string {
  return isRTL
    ? `يُسمح بتعديل ${MAX_LOYALTY_ADJUSTMENT.toLocaleString('en-US')} نقطة كحدٍّ أقصى في كل مرة. نفّذ التعديلات الأكبر على عدة مرات.`
    : `An adjustment is limited to ${MAX_LOYALTY_ADJUSTMENT.toLocaleString('en-US')} points at a time. Make a larger correction in several steps.`;
}

export function loyaltyAdjustConfirmMessage(
  o: { customerName: string; current: number; target: number; ratePerPoint: number },
  isRTL: boolean,
): string {
  const delta = Math.round(o.target - o.current);
  const points = Math.abs(delta);
  const worth = (points * o.ratePerPoint).toFixed(2);
  const rate = String(Number(o.ratePerPoint.toFixed(3)));
  const adding = delta > 0;
  if (isRTL) {
    return [
      adding
        ? `إضافة ${points} نقطة إلى ${o.customerName}؟`
        : `خصم ${points} نقطة من ${o.customerName}؟`,
      `الرصيد: ${o.current} ← ${o.target}.`,
      adding ? `بسعر ${rate} ريال للنقطة، تعادل هذه النقاط خصماً يصل إلى ${worth} ريال على طلبات العميل.` : '',
      'يسري التعديل فوراً ويُسجَّل كتعديل من المشرف، ولا يمكن التراجع عنه إلا بتعديل معاكس.',
    ].filter(Boolean).join(' ');
  }
  return [
    adding ? `Add ${points} points to ${o.customerName}?` : `Remove ${points} points from ${o.customerName}?`,
    `Balance: ${o.current} → ${o.target}.`,
    adding ? `At ${rate} SAR per point they are worth up to SAR ${worth} off the customer’s orders.` : '',
    'It takes effect immediately and is recorded as an admin adjustment; only an opposite adjustment undoes it.',
  ].filter(Boolean).join(' ');
}

/** A legal document's text goes straight to the app; `legal_documents` keeps no earlier version. */
export function legalSaveConfirmMessage(title: string, isRTL: boolean): string {
  return isRTL
    ? `حفظ التغييرات على «${title}»؟ سيظهر النص الجديد لكل العملاء فوراً بالعربية والإنجليزية، ولا يُحتفظ بالنص السابق.`
    : `Save changes to “${title}”? The new text is live for every customer immediately, in both languages, and the previous text is not kept.`;
}

export function legalDeactivateConfirmMessage(title: string, isRTL: boolean): string {
  return isRTL
    ? `إيقاف «${title}»؟ سيُزال من التطبيق لكل العملاء فوراً. النص محفوظ، وإعادة تفعيله تعيده.`
    : `Switch “${title}” OFF? It is removed from the app for every customer immediately. The text is kept, and switching it back on restores it.`;
}

/** The loyalty programme switch: it gates earning and redemption for every customer. */
export function loyaltyProgrammeConfirmMessage(enable: boolean, isRTL: boolean): string {
  if (isRTL) {
    return enable
      ? 'تفعيل برنامج المكافآت؟ سيبدأ العملاء بكسب النقاط على الطلبات المؤهلة ويمكنهم استبدال ما لديهم منها.'
      : 'إيقاف برنامج المكافآت؟ سيتوقف كسب النقاط واستبدالها لكل العملاء فوراً. لا تتغير الأرصدة الحالية.';
  }
  return enable
    ? 'Turn the rewards programme ON? Customers start earning points on eligible orders and can redeem the points they hold.'
    : 'Turn the rewards programme OFF? Earning and redeeming points stops for every customer immediately. Existing balances are not changed.';
}

/** Arming points expiry. Nothing expires today; the next reset date is what zeroes every balance. */
export function loyaltyExpiryEnableConfirmMessage(isRTL: boolean): string {
  return isRTL
    ? 'تفعيل انتهاء صلاحية النقاط؟ في موعد التصفير المحدد ستُصفَّر نقاط جميع العملاء ويُسجَّل ذلك في سجل كل عميل. لا تنتهي أي نقاط اليوم، لكن شروط الولاء تَعِد العملاء بإشعار مسبق قبل أي تغيير يقلّل قيمة النقاط التي يملكونها. هل تريد المتابعة؟'
    : 'Turn points expiry ON? On the reset date shown, EVERY customer’s points are set to zero and the reset is written to each customer’s ledger. Nothing expires today, but the loyalty terms promise customers advance notice before a change that reduces the value of points they hold. Continue?';
}

export type IntegrationSwitch = 'lazywait' | 'push' | 'whatsapp';

/**
 * Saving an integration card with its enable switch (or, for WhatsApp, the
 * customer-login flag) changed. These switch live systems: the POS feed, every
 * customer push, and whether customers can sign in. `change` is the direction
 * of each switch that moved, null for one that did not.
 */
export function integrationSwitchConfirmMessage(
  provider: IntegrationSwitch,
  change: { enabled: 'on' | 'off' | null; login?: 'on' | 'off' | null },
  isRTL: boolean,
): string {
  const lines: string[] = [];
  if (change.enabled) {
    const on = change.enabled === 'on';
    if (provider === 'lazywait') {
      lines.push(isRTL
        ? (on ? 'تفعيل ربط نقطة البيع Lazywait؟ ستبدأ الطلبات الجديدة بالانتقال إلى نقطة بيع المطبخ.'
              : 'إيقاف ربط نقطة البيع Lazywait؟ ستتوقف الطلبات الجديدة عن الانتقال إلى نقطة بيع المطبخ إلى أن يُعاد تفعيله.')
        : (on ? 'Turn ON the Lazywait POS integration? New orders start being sent to the kitchen POS.'
              : 'Turn OFF the Lazywait POS integration? New orders stop being sent to the kitchen POS until it is turned back on.'));
    } else if (provider === 'push') {
      lines.push(isRTL
        ? (on ? 'تفعيل الإشعارات الفورية؟ ستبدأ رسائل حقيقية بالوصول إلى هواتف العملاء: تحديثات الطلبات، والعروض للأجهزة التي وافقت عليها.'
              : 'إيقاف الإشعارات الفورية؟ سيتوقف العملاء عن تلقي رسائل حالة الطلب، ولا يمكن إرسال البث.')
        : (on ? 'Turn ON push notifications? Real messages start reaching customers’ phones: order updates, and offers to devices that opted in.'
              : 'Turn OFF push notifications? Customers stop receiving order-status messages and broadcasts cannot be sent.'));
    } else {
      lines.push(isRTL
        ? (on ? 'تفعيل تكامل واتساب؟ تُرسل رموز التحقق عبره.'
              : 'إيقاف تكامل واتساب؟ لن تُرسل رموز التحقق عبره.')
        : (on ? 'Turn ON the WhatsApp OTP integration? Verification codes are sent through it.'
              : 'Turn OFF the WhatsApp OTP integration? Verification codes are no longer sent through it.'));
    }
  }
  if (change.login) {
    const on = change.login === 'on';
    lines.push(isRTL
      ? (on ? 'تفعيل تسجيل دخول العملاء عبر واتساب؟ سيستلم العملاء رموز الدخول على واتساب.'
            : 'إيقاف تسجيل دخول العملاء عبر واتساب؟ لن يتمكن العملاء من استلام رموز الدخول، وقد لا يتمكنون من تسجيل الدخول.')
      : (on ? 'Turn ON WhatsApp customer login? Customers receive their sign-in codes on WhatsApp.'
            : 'Turn OFF WhatsApp customer login? Customers can no longer receive sign-in codes, and may be unable to sign in.'));
  }
  return lines.join('\n\n');
}
