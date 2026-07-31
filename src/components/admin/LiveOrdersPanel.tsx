import React, { useState } from 'react';

import { useApp } from '../../context/AppContext';
import { Card } from '../../design-system/ui/Card';
import { Text } from '../../design-system/ui/Text';
import { useDsFontClass } from '../../design-system/ui/useDsLang';
import { paymentDisplayState, paymentMethodLabel } from '../../lib/payment';
import { Order, OrderStatus } from '../../types';
import { ADMIN_LOCALES } from './adminLocales';
import { OrderReceiptModal } from './view/orders/OrderReceiptModal';
import { OrdersRequiringVerificationCard } from './view/orders/OrdersRequiringVerificationCard';
import { OrdersTable } from './view/orders/OrdersTable';
import {
  ORDER_FILTERS, matchesOrderFilter, matchesOrderSearch, needsPaymentConfirm,
} from './view/orders/ordersView';

/**
 * Live Orders — the console's busiest surface.
 *
 * WHAT THIS FILE DOES NOT OWN, and deliberately so: the realtime stream. Orders
 * come from `useApp().orders`, and `AppContext` owns the
 * `admin-orders-${currentUser.id}` channel, the 12s fast poll, the 60s slow
 * poll, the `document.hidden` check and the reconnect fallback. This panel has
 * always been a consumer of that list and still is — no subscription, no timer
 * and no ordering logic was added, moved or removed here.
 *
 * The one timer the panel side owns is inside
 * `OrdersRequiringVerificationCard`: a 60s re-read of the ambiguous-POS queue.
 *
 * This file owns FILTERING, THE RECEIPT SELECTION AND THE STATUS CHANGE.
 * Presentation is in `./view/orders/*` and the derived state in `ordersView.ts`.
 */
export const LiveOrdersPanel: React.FC = () => {
  const { orders, branches, updateOrderStatus, brandSettings, currentUser, adminLang } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const family = useDsFontClass();
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';
  const [orderFilter, setOrderFilter] = useState<string>('all');
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [activeReceiptOrder, setActiveReceiptOrder] = useState<Order | null>(null);

  // Show the actual chosen method — Online Payment / Cash on Pickup / Cash on
  // Delivery — never a blanket "Cash on Delivery". Unknown method reads as unset.
  const methodLabelText = (o: Order): string => {
    switch (paymentMethodLabel(o.paymentMethod, o.orderType)) {
      case 'online': return isRTL ? 'الدفع الإلكتروني' : 'Online Payment';
      case 'cash_pickup': return isRTL ? 'نقداً عند الاستلام' : 'Cash on Pickup';
      case 'cash_delivery': return isRTL ? 'نقداً عند التوصيل' : 'Cash on Delivery';
      case 'cash': return isRTL ? 'دفع نقدي' : 'Cash Payment';
      default: return isRTL ? 'لم تُحدَّد طريقة الدفع' : 'Payment method not set';
    }
  };

  // Derived payment status text (paid / pending online / cash required / unpaid).
  // The tone lives in `paymentTone` so the table and the receipt cannot disagree.
  const paymentBadgeText = (o: Order): string => {
    switch (paymentDisplayState(o)) {
      case 'paid': return 'PAID';
      case 'pending_online': return isRTL ? 'بانتظار الدفع الإلكتروني' : 'PENDING ONLINE PAYMENT';
      case 'cash_required': return isRTL ? 'مطلوب تحصيل نقدي' : 'CASH PAYMENT REQUIRED';
      default: return isRTL ? 'غير مدفوع' : 'UNPAID';
    }
  };

  // Actionable warning for staff (collect cash / online not completed / unpaid).
  const paymentWarning = (o: Order): string | null => {
    switch (paymentDisplayState(o)) {
      case 'cash_required': return isRTL ? 'يجب تحصيل المبلغ نقداً من العميل.' : 'Payment must be collected from the customer.';
      case 'pending_online': return isRTL ? 'لم يكتمل الدفع الإلكتروني بعد.' : 'Online payment has not been completed.';
      case 'unpaid': return isRTL ? 'هذا الطلب غير مدفوع ولم تُحدَّد طريقة الدفع.' : 'This order is unpaid and has no payment method set.';
      default: return null;
    }
  };

  const phoneLabel = (phone: string | undefined): string =>
    (phone && phone.trim()) ? phone : (isRTL ? 'لا يوجد رقم جوال' : 'No phone provided');

  // "View" from the verification card opens the same read-only receipt by
  // resolving the full order from the in-memory (realtime) list.
  const viewById = (id: string) => {
    const match = orders.find((o) => o.id === id);
    if (match) setActiveReceiptOrder(match);
  };

  const handleUpdateStatus = (orderId: string, status: OrderStatus) => {
    if (isAccountant) return; // accountant is view-only (also enforced by RLS server-side)
    const target = orders.find((o) => o.id === orderId) ?? activeReceiptOrder ?? undefined;
    // Cash orders are legitimately unpaid until collected — keep the banner but
    // don't block. Only confirm when an ONLINE payment (or unknown method) has
    // not completed before advancing past "Received".
    const st = target ? paymentDisplayState(target) : 'paid';
    if (target && needsPaymentConfirm(st, status)) {
      const proceed = window.confirm(
        isRTL
          ? 'لم يكتمل الدفع الإلكتروني لهذا الطلب بعد. هل أنت متأكد من تغيير حالته؟'
          : 'Online payment for this order has not completed. Are you sure you want to advance its status?'
      );
      if (!proceed) return;
    }
    updateOrderStatus(orderId, status);
    if (activeReceiptOrder?.id === orderId) {
      const match = orders.find((o) => o.id === orderId);
      if (match) setActiveReceiptOrder({ ...match, status });
    }
  };

  const filteredOrders = orders.filter((o) =>
    matchesOrderSearch(o, orderSearch) && matchesOrderFilter(o.status, orderFilter));

  return (
    <>
      <div className="space-y-4">
        {/* Read-only ambiguous-POS feed. Self-hides when the queue is empty. */}
        <OrdersRequiringVerificationCard adminLang={adminLang} onView={viewById} />

        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <Text variant="heading" as="h3">{t.live_alerts}</Text>

          <div className="flex flex-wrap gap-1.5">
            {ORDER_FILTERS.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setOrderFilter(st)}
                aria-pressed={orderFilter === st}
                className={[
                  'ds-motion inline-flex min-h-9 items-center rounded-[var(--radius-ds-md)] px-2.5',
                  'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
                  orderFilter === st ? 'bg-ember' : 'bg-con-surface-2 hover:bg-con-surface',
                ].join(' ')}
              >
                <Text variant="caption" tone={orderFilter === st ? 'onEmber' : 'secondary'} as="span">
                  {st === 'all' ? (isRTL ? 'الكل' : 'All') : st}
                </Text>
              </button>
            ))}
          </div>
        </div>

        <input
          type="text"
          value={orderSearch}
          onChange={(e) => setOrderSearch(e.target.value)}
          placeholder={isRTL ? 'ابحث برقم الطلب، اسم العميل، جوال العميل...' : 'Search by order#, client, phone...'}
          aria-label={isRTL ? 'بحث في الطلبات' : 'Search orders'}
          className={`ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-4 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 ${family}`}
        />

        <Card flush className="overflow-hidden">
          <OrdersTable
            orders={filteredOrders}
            adminLang={adminLang}
            paymentBadgeText={paymentBadgeText}
            methodLabelText={methodLabelText}
            phoneLabel={phoneLabel}
            onView={setActiveReceiptOrder}
          />
        </Card>
      </div>

      {activeReceiptOrder && (
        <OrderReceiptModal
          order={activeReceiptOrder}
          branches={branches}
          isRTL={isRTL}
          adminLang={adminLang}
          isAccountant={isAccountant}
          vatPercentage={brandSettings?.vatPercentage || 15}
          methodLabelText={methodLabelText}
          paymentBadgeText={paymentBadgeText}
          paymentWarning={paymentWarning}
          phoneLabel={phoneLabel}
          onStatusChange={handleUpdateStatus}
          onClose={() => setActiveReceiptOrder(null)}
        />
      )}
    </>
  );
};
