/**
 * The order receipt — the only place an operator changes an order's status.
 *
 * PRESENTATION plus one control. The status <select> reports a chosen status
 * upward; every decision about whether that status is reachable
 * (`canTransitionOrder`), whether the caller may make it (accountants are
 * view-only, also enforced by RLS) and whether it needs a payment confirmation
 * first stays in the panel. The options are DISABLED rather than hidden so an
 * operator can see the whole lifecycle and where this order sits in it.
 *
 * The POS section is visibility only. Nothing is synced, resent, resolved or
 * refunded from here, and the two amber notes — delivery schema unconfirmed,
 * branch not mapped — explain WHY an order is not going to the POS, which is
 * the question staff actually ask when a ticket does not print.
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';

import { canTransitionOrder } from '../../../../context/AppContext';
import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import { useDsFontClass } from '../../../../design-system/ui/useDsLang';
import { orderDisplayNumber } from '../../../../lib/mappers';
import { paymentDisplayState } from '../../../../lib/payment';
import type { Branch, Order, OrderStatus } from '../../../../types';
import { getVATBreakdown } from '../../../../utils/calculations';
import { Price } from '../../../Price';
import { DetailRow } from './DetailRow';
import { TapPaymentDetails } from './TapPaymentDetails';
import { paymentTone, syncStateOf, syncTone } from './ordersView';

const STATUS_OPTIONS: Array<{ value: OrderStatus; label: string }> = [
  { value: 'received', label: 'Received' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready (POS Buzzer)' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function OrderReceiptModal({
  order,
  branches,
  isRTL,
  adminLang,
  isAccountant,
  vatPercentage,
  methodLabelText,
  paymentBadgeText,
  paymentWarning,
  phoneLabel,
  onStatusChange,
  onClose,
}: {
  order: Order;
  branches: Branch[];
  isRTL: boolean;
  adminLang: 'en' | 'ar';
  isAccountant: boolean;
  vatPercentage: number;
  methodLabelText: (o: Order) => string;
  paymentBadgeText: (o: Order) => string;
  paymentWarning: (o: Order) => string | null;
  phoneLabel: (phone: string | undefined) => string;
  onStatusChange: (id: string, status: OrderStatus) => void;
  onClose: () => void;
}) {
  const family = useDsFontClass();
  const d = orderDisplayNumber(order);
  const warning = paymentWarning(order);
  const paymentState = paymentDisplayState(order);
  const sync = syncStateOf(order);
  const branchMapped = !!branches.find((b) => b.id === order.branchId)?.lazywaitBranchId;
  const hasPhone = !!(order.customerPhone && order.customerPhone.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4">
      {/* role="dialog" WITHOUT aria-modal: nothing here traps focus or marks the
          page inert, and claiming modality a screen reader then finds untrue is
          worse than not claiming it. Focus management would be a behaviour
          change; this migration does not make one. */}
      <div
        role="dialog"
        aria-label={isRTL ? 'تفاصيل الطلب' : 'Order receipt'}
        className="w-full max-w-md overflow-hidden rounded-[var(--radius-ds-lg)] border border-con-line bg-con-surface"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center justify-between gap-2 border-b border-con-line px-5 py-4">
          <div className="min-w-0">
            <Text variant="caption" tone="tertiary" as="p">
              {isRTL ? 'تعديل حالة الكاشير الموحدة' : 'Live POS Status Controller'}
            </Text>
            <Text variant="heading" tone="ember" numeric as="p">
              {d.primary}
              {d.secondary && (
                <Text variant="caption" tone="tertiary" numeric as="span" className="ms-1">
                  · {d.secondary}
                </Text>
              )}
            </Text>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="ds-motion inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-con-line bg-con-surface-2 transition-colors duration-150 hover:bg-con-surface focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Text variant="label" tone="secondary" as="span">✕</Text>
          </button>
        </div>

        <div className="max-h-[480px] space-y-4 overflow-y-auto p-5">
          {warning && (
            <div
              className={[
                'flex items-center gap-2 rounded-[var(--radius-ds-md)] border-s-4 px-3 py-2.5',
                paymentState === 'cash_required'
                  ? 'bg-info-tint border-s-sky'
                  : 'bg-warn-tint border-s-warn',
              ].join(' ')}
            >
              <AlertTriangle
                className={`size-4 shrink-0 ${paymentState === 'cash_required' ? 'text-sky' : 'text-amber-ink'}`}
                aria-hidden="true"
              />
              <Text
                variant="label"
                tone={paymentState === 'cash_required' ? 'info' : 'warning'}
                as="p"
              >
                {warning}
              </Text>
            </div>
          )}

          <div className="space-y-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface-2 p-3">
            {/* A <p>, not a <label>: the select is named by its aria-label, and
                a <label> bound to no control is a dead end for a screen reader. */}
            <Text variant="caption" tone="tertiary" as="p">
              {isRTL ? 'تعديل حالة الطلب الحالية:' : 'SET REALTIME ORDER STATUS:'}
            </Text>
            <select
              disabled={isAccountant}
              value={order.status}
              onChange={(e) => onStatusChange(order.id, e.target.value as OrderStatus)}
              aria-label={isRTL ? 'حالة الطلب' : 'Order status'}
              className={`ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${family}`}
            >
              {STATUS_OPTIONS.map((o) => (
                <option
                  key={o.value}
                  value={o.value}
                  disabled={!canTransitionOrder(order.status, o.value)}
                >
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface-2 p-3">
            <DetailRow label="Customer">
              <Text variant="label" as="span">{order.customerName}</Text>
            </DetailRow>
            <DetailRow label="Phone">
              <Text variant="label" tone={hasPhone ? 'primary' : 'warning'} numeric={hasPhone} as="span">
                {phoneLabel(order.customerPhone)}
              </Text>
            </DetailRow>
            {order.address && (
              <div className="border-t border-con-line pt-2">
                <Text variant="caption" tone="tertiary" as="p">Delivery Short Address:</Text>
                <Text variant="label" as="p" className="mt-1">
                  {order.address.label} • {order.address.description}
                </Text>
                <Text variant="label" tone="ember" numeric as="p">
                  {order.address.nationalShortAddress}
                </Text>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Text variant="caption" tone="tertiary" as="p">Ordered Items:</Text>
            {order.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <Text variant="label" as="p">
                    <span className="num">{item.quantity}x</span>{' '}
                    {isRTL ? item.nameAr : item.nameEn}
                  </Text>
                  {item.selectedModifiers.length > 0 && (
                    <Text variant="caption" tone="tertiary" as="p" className="mt-0.5">
                      + {item.selectedModifiers.map((m) => (isRTL ? m.nameAr : m.nameEn)).join(', ')}
                    </Text>
                  )}
                </div>
                <Text variant="label" as="span">
                  <Price amount={item.price * item.quantity} lang={adminLang} />
                </Text>
              </div>
            ))}
          </div>

          <div className="space-y-1 border-t border-con-line pt-3">
            <DetailRow label="Subtotal">
              <Text variant="body" tone="secondary" as="span">
                <Price amount={order.subtotal} lang={adminLang} />
              </Text>
            </DetailRow>
            {order.deliveryFee > 0 && (
              <DetailRow label="Delivery Fee">
                <Text variant="body" tone="secondary" as="span">
                  <Price amount={order.deliveryFee} prefix="+" lang={adminLang} />
                </Text>
              </DetailRow>
            )}
            {(order.discountAmount ?? 0) > 0 && (
              <DetailRow label={isRTL ? 'خصم القسيمة' : 'Coupon Discount'}>
                <Text variant="body" tone="success" as="span">
                  <Price amount={order.discountAmount ?? 0} prefix="−" lang={adminLang} />
                </Text>
              </DetailRow>
            )}
            {(order.loyaltyDiscountAmount ?? 0) > 0 && (
              <DetailRow label={isRTL ? 'خصم نقاط الولاء' : 'Loyalty Discount'}>
                <Text variant="body" tone="info" as="span">
                  <Price amount={order.loyaltyDiscountAmount ?? 0} prefix="−" lang={adminLang} />
                </Text>
              </DetailRow>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-con-line pt-1">
              <Text variant="label" as="span">Grand Total (VAT Inclusive)</Text>
              <Text variant="title" as="span"><Price amount={order.total} lang={adminLang} /></Text>
            </div>
          </div>

          <div className="rounded-[var(--radius-ds-md)] bg-con-surface-2 p-3">
            <DetailRow label={`${vatPercentage}% Saudi VAT component`}>
              <Text variant="caption" tone="secondary" as="span">
                <Price amount={getVATBreakdown(order.total, vatPercentage).vatAmount} lang={adminLang} />
              </Text>
            </DetailRow>
          </div>

          <div className="space-y-2 rounded-[var(--radius-ds-md)] bg-con-surface-2 p-3">
            <DetailRow label="Payment method">
              <Text variant="label" tone="secondary" as="span">{methodLabelText(order)}</Text>
            </DetailRow>
            <DetailRow label="Payment status">
              <StatusPill label={paymentBadgeText(order)} tone={paymentTone(paymentState)} />
            </DetailRow>
          </div>

          <TapPaymentDetails order={order} isAccountant={isAccountant} isRTL={isRTL} />

          <div className="space-y-2 rounded-[var(--radius-ds-md)] bg-con-surface-2 p-3">
            <DetailRow label="POS sync status">
              <StatusPill label={sync} tone={syncTone(sync)} />
            </DetailRow>
            {order.syncBlockedReason && (
              <DetailRow label="Reason">
                <Text variant="label" tone="danger" as="span">{order.syncBlockedReason}</Text>
              </DetailRow>
            )}
            {order.syncBlockedReason === 'delivery_schema_unconfirmed' && (
              <div className="flex items-start gap-1.5 border-t border-con-line pt-2">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-ink" aria-hidden="true" />
                <Text variant="caption" tone="warning" as="span">
                  {isRTL
                    ? 'مزامنة طلبات التوصيل مع Lazywait موقوفة بانتظار تأكيد صيغة طلب التوصيل من Lazywait.'
                    : 'Delivery Lazywait sync is blocked pending Lazywait delivery payload confirmation.'}
                </Text>
              </div>
            )}
            {!branchMapped && (
              <div className="flex items-start gap-1.5 border-t border-con-line pt-2">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-ink" aria-hidden="true" />
                <Text variant="caption" tone="warning" as="span">
                  {isRTL
                    ? 'غير مؤهل لمزامنة Lazywait: الفرع غير مربوط.'
                    : 'Not eligible for Lazywait sync: branch is not mapped.'}
                </Text>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
