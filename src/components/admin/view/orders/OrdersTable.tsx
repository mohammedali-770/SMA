/**
 * The live orders table — PRESENTATION ONLY.
 *
 * No API call, no permission decision, no realtime. Rows arrive already
 * filtered; opening a receipt is a callback. The order of the rows is the order
 * `AppContext` supplies them in, and this component does not re-sort — the
 * stream's own ordering is what makes "newest at the top" true on a live board.
 *
 * Order numbers, phones, POS states and money render mono: they are structured
 * values scanned down a column rather than read as prose.
 */
import React from 'react';
import { Eye } from 'lucide-react';

import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import { orderDisplayNumber } from '../../../../lib/mappers';
import { paymentDisplayState } from '../../../../lib/payment';
import type { Order } from '../../../../types';
import { Price } from '../../../Price';
import { ADMIN_LOCALES } from '../../adminLocales';
import { orderStatusTone, paymentTone, syncStateOf, syncTone } from './ordersView';

const TH = 'px-3 py-2 text-start';
const TD = 'px-3 py-3 align-top';

export function OrdersTable({
  orders,
  adminLang,
  paymentBadgeText,
  methodLabelText,
  phoneLabel,
  onView,
}: {
  orders: Order[];
  adminLang: 'en' | 'ar';
  /** Localised text for the derived payment state. */
  paymentBadgeText: (o: Order) => string;
  /** Localised text for the chosen payment method. */
  methodLabelText: (o: Order) => string;
  /** The phone, or the "no phone provided" stand-in. */
  phoneLabel: (phone: string | undefined) => string;
  onView: (o: Order) => void;
}) {
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const headers = [t.order_id, t.customer, t.branch, t.total_sar, t.status, t.sync, t.actions];

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-con-line">
            {headers.map((h, i) => (
              <th key={h || `sp-${i}`} className={TH}>
                <Text variant="caption" tone="tertiary" as="span">{h}</Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const d = orderDisplayNumber(order);
            const hasPhone = !!(order.customerPhone && order.customerPhone.trim());
            const sync = syncStateOf(order);
            return (
              <tr key={order.id} className="border-t border-con-line">
                <td className={TD}>
                  <Text variant="label" tone="ember" numeric as="p">{d.primary}</Text>
                  {d.secondary && (
                    <Text variant="caption" tone="tertiary" numeric as="p">{d.secondary}</Text>
                  )}
                </td>

                <td className={TD}>
                  <Text variant="label" as="p">{order.customerName}</Text>
                  {/* A missing phone is a WARNING, not grey filler: staff cannot
                      chase a delivery without one. */}
                  <Text
                    variant="caption"
                    tone={hasPhone ? 'tertiary' : 'warning'}
                    numeric={hasPhone}
                    as="p"
                  >
                    {phoneLabel(order.customerPhone)}
                  </Text>
                </td>

                <td className={TD}>
                  <Text variant="body" tone="secondary" as="p">
                    {isRTL ? order.branchNameAr : order.branchNameEn}
                  </Text>
                </td>

                <td className={TD}>
                  <Text variant="label" as="p"><Price amount={order.total} lang={adminLang} /></Text>
                  <Text variant="caption" tone="secondary" as="p" className="mt-1">
                    {methodLabelText(order)}
                  </Text>
                  <StatusPill
                    className="mt-1"
                    label={paymentBadgeText(order)}
                    tone={paymentTone(paymentDisplayState(order))}
                  />
                </td>

                <td className={TD}>
                  <StatusPill label={order.status} tone={orderStatusTone(order.status)} />
                </td>

                <td className={TD}>
                  <StatusPill label={sync} tone={syncTone(sync)} />
                  {order.syncBlockedReason && (
                    <Text variant="caption" tone="danger" as="p" className="mt-1 max-w-[130px]">
                      {order.syncBlockedReason}
                    </Text>
                  )}
                </td>

                <td className={TD}>
                  <button
                    type="button"
                    onClick={() => onView(order)}
                    className="ds-motion inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-2.5 transition-colors duration-150 hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <Eye className="size-3 text-ember" aria-hidden="true" />
                    <Text variant="caption" tone="ember" as="span">{t.view_details}</Text>
                  </button>
                </td>
              </tr>
            );
          })}

          {orders.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="py-12 text-center">
                <Text variant="body" tone="tertiary" as="span">{t.no_orders}</Text>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
