import React, { useEffect, useMemo, useState } from 'react';
import { Download, Info } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Field } from '../../design-system/ui/Field';
import { StatusPill, type PillTone } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { useDsFontClass } from '../../design-system/ui/useDsLang';
import {
  isCalendarDate, riyadhDateOnly, riyadhMonthRange, riyadhRangeToUtc,
} from '../../utils/calculations';
import { Price } from '../Price';
import { isMissingFunctionError, orders as ordersApi } from '../../lib/api';
import { buildCouponUsage, lazywaitRefOf, mapReportOrder, type ReportOrder } from '../../lib/reports';
import { ADMIN_LOCALES } from './adminLocales';

const SELECT = [
  'ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3',
  'text-[15px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

const LABEL = 'text-start text-[13px] font-semibold text-con-text-2';
const TH = 'px-4 py-2.5 text-start';
const TD = 'px-4 py-2.5 align-middle';

const SYNC_TONE: Record<string, PillTone> = {
  synced: 'success',
  sync_failed: 'danger',
  pending_sync: 'warning',
};

/** Financial reports backed by the bounded server-side ranged order feed. */
export const ReportsPanel: React.FC = () => {
  const { branches, products, categories, adminLang } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const family = useDsFontClass();
  const [selectedReport, setSelectedReport] = useState<'sales_by_day' | 'sales_by_branch' | 'sales_by_product' | 'coupon_usage' | 'delivery_fees' | 'lazywait_report'>('sales_by_day');
  const [reportBranchId, setReportBranchId] = useState<string>('all');
  const defaultRange = useMemo(() => riyadhMonthRange(), []);
  const [reportStartDate, setReportStartDate] = useState<string>(defaultRange.start);
  const [reportEndDate, setReportEndDate] = useState<string>(defaultRange.end);

  const [rangeOrders, setRangeOrders] = useState<ReportOrder[]>([]);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [rangeError, setRangeError] =
    useState<{ kind: 'missing-migration' } | { kind: 'other'; message: string } | null>(null);
  const [rangeOverflow, setRangeOverflow] = useState<{ rows: number; max: number } | null>(null);

  const rangeIsComplete =
    isCalendarDate(reportStartDate) && isCalendarDate(reportEndDate)
    && reportStartDate <= reportEndDate;

  useEffect(() => {
    if (!rangeIsComplete) {
      setRangeOrders([]); setRangeOverflow(null); setRangeError(null); setRangeLoading(false);
      return;
    }
    let cancelled = false;
    setRangeLoading(true);
    setRangeOrders([]);
    setRangeOverflow(null);
    const { fromIso, toIso } = riyadhRangeToUtc(reportStartDate, reportEndDate);
    ordersApi.listForRange(fromIso, toIso, reportBranchId === 'all' ? null : reportBranchId)
      .then(res => {
        if (cancelled) return;
        setRangeOrders(res.orders.map(mapReportOrder));
        setRangeOverflow(res.limit_exceeded ? { rows: res.row_count, max: res.max_rows } : null);
        setRangeError(null);
      })
      .catch(e => {
        if (cancelled) return;
        setRangeOrders([]);
        setRangeOverflow(null);
        setRangeError(isMissingFunctionError(e)
          ? { kind: 'missing-migration' }
          : { kind: 'other', message: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => { if (!cancelled) setRangeLoading(false); });
    return () => { cancelled = true; };
  }, [rangeIsComplete, reportStartDate, reportEndDate, reportBranchId]);

  const exportDisabled = !rangeIsComplete || rangeLoading || rangeError !== null || rangeOverflow !== null;
  const filteredOrders = rangeOrders;
  const deliveredOrders = useMemo(
    () => filteredOrders.filter(o => o.status === 'delivered'),
    [filteredOrders],
  );

  const repGrossSales = deliveredOrders.reduce((sum, o) => sum + o.total, 0);
  const repDiscounts = deliveredOrders.reduce((sum, o) => sum + Math.max(0, (o.subtotal + o.deliveryFee) - o.total), 0);
  const repDeliveryFees = deliveredOrders.reduce((sum, o) => sum + o.deliveryFee, 0);
  const repOrdersCount = deliveredOrders.length;

  // The VAT figure is the immutable amount persisted on EACH order. This is a
  // financial-history boundary: changing app_settings.vat_percentage later must
  // never rewrite a prior period merely by viewing/exporting it.
  const dayReport = (() => {
    const map: { [date: string]: { subtotal: number; deliveryFee: number; discount: number; total: number; vat: number; ordersCount: number } } = {};
    deliveredOrders.forEach(o => {
      const date = riyadhDateOnly(o.createdAt);
      const disc = Math.max(0, (o.subtotal + o.deliveryFee) - o.total);
      if (!map[date]) map[date] = { subtotal: 0, deliveryFee: 0, discount: 0, total: 0, vat: 0, ordersCount: 0 };
      map[date].subtotal += o.subtotal;
      map[date].deliveryFee += o.deliveryFee;
      map[date].discount += disc;
      map[date].total += o.total;
      map[date].vat += o.vatAmount;
      map[date].ordersCount += 1;
    });
    return Object.keys(map).sort().map(date => ({ date, ...map[date] }));
  })();

  const branchReport = branches.map(b => {
    const bOrders = deliveredOrders.filter(o => o.branchId === b.id);
    const count = bOrders.length;
    const revenue = bOrders.reduce((sum, o) => sum + o.total, 0);
    const fees = bOrders.reduce((sum, o) => sum + o.deliveryFee, 0);
    const disc = bOrders.reduce((sum, o) => sum + Math.max(0, (o.subtotal + o.deliveryFee) - o.total), 0);
    const avg = count > 0 ? revenue / count : 0;
    return {
      id: b.id,
      name: isRTL ? b.nameAr : b.nameEn,
      ordersCount: count,
      totalRevenue: revenue,
      deliveryFees: fees,
      avgTicket: avg,
      discounts: disc
    };
  });

  const productReport = (() => {
    const map: { [id: string]: { name: string; category: string; qty: number; rev: number } } = {};
    deliveredOrders.forEach(o => {
      o.items.forEach(item => {
        const pId = item.productId;
        const pRef = products.find(p => p.id === pId);
        const catRef = categories.find(c => c.id === pRef?.categoryId);
        const name = isRTL ? (pRef?.nameAr || item.nameAr) : (pRef?.nameEn || item.nameEn);
        const catName = isRTL ? (catRef?.nameAr || 'مقبلات وأطباق') : (catRef?.nameEn || 'Sides & Burgers');
        if (!map[pId]) map[pId] = { name, category: catName, qty: 0, rev: 0 };
        map[pId].qty += item.quantity;
        map[pId].rev += item.price * item.quantity;
      });
    });
    return Object.keys(map).map(id => ({ id, ...map[id] })).sort((a, b) => b.rev - a.rev);
  })();

  const couponReport = buildCouponUsage(deliveredOrders);

  const deliveryReport = branches.map(b => {
    const delOrders = deliveredOrders.filter(o => o.branchId === b.id && o.orderType === 'delivery');
    const count = delOrders.length;
    const fees = delOrders.reduce((sum, o) => sum + o.deliveryFee, 0);
    const avg = count > 0 ? fees / count : 0;
    return {
      id: b.id,
      name: isRTL ? b.nameAr : b.nameEn,
      deliveryCount: count,
      totalFees: fees,
      avgFee: avg
    };
  });

  const syncStatusLabel = (s: string) =>
    s === 'sync_failed' ? (isRTL ? 'فشلت المزامنة' : 'Sync failed')
    : s === 'pending_sync' ? (isRTL ? 'بانتظار المزامنة' : 'Awaiting sync')
    : (isRTL ? 'غير مجدول' : 'Not scheduled');
  const lazywaitReport = filteredOrders.map(o => {
    const realError = (o.syncLastError ?? o.syncBlockedReason ?? '').trim();
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      date: riyadhDateOnly(o.createdAt),
      branch: isRTL ? o.branchNameAr : o.branchNameEn,
      total: o.total,
      status: o.orderSyncStatus,
      ref: lazywaitRefOf(o),
      error: o.orderSyncStatus === 'synced' ? '' : (realError || syncStatusLabel(o.orderSyncStatus)),
    };
  });

  const csvCell = (value: unknown): string => {
    let s = String(value ?? '');
    // Spreadsheet formula injection: user/admin-controlled names beginning with
    // these characters must be data, not executable spreadsheet formulae.
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };

  const triggerCSVExport = () => {
    let csv = '';
    if (selectedReport === 'sales_by_day') {
      csv = "Date,Orders Count,Subtotal (SAR),Delivery Fees (SAR),Discounts (SAR),Net Sales (SAR),VAT Amount (SAR)\n" +
        dayReport.map(r => `${csvCell(r.date)},${r.ordersCount},${r.subtotal.toFixed(2)},${r.deliveryFee.toFixed(2)},${r.discount.toFixed(2)},${r.total.toFixed(2)},${r.vat.toFixed(2)}`).join("\n");
    } else if (selectedReport === 'sales_by_branch') {
      csv = "Branch,Orders Count,Total Revenue (SAR),Delivery Fees (SAR),Average Ticket (SAR),Discounts (SAR)\n" +
        branchReport.map(r => `${csvCell(r.name)},${r.ordersCount},${r.totalRevenue.toFixed(2)},${r.deliveryFees.toFixed(2)},${r.avgTicket.toFixed(2)},${r.discounts.toFixed(2)}`).join("\n");
    } else if (selectedReport === 'sales_by_product') {
      csv = "Product,Category,Quantity Sold,Total Revenue (SAR)\n" +
        productReport.map(r => `${csvCell(r.name)},${csvCell(r.category)},${r.qty},${r.rev.toFixed(2)}`).join("\n");
    } else if (selectedReport === 'coupon_usage') {
      csv = "Coupon Code,Usage Count,Total Discounts Saved (SAR)\n" +
        couponReport.map(r => `${csvCell(r.code)},${r.count},${r.savings.toFixed(2)}`).join("\n");
    } else if (selectedReport === 'delivery_fees') {
      csv = "Branch,Delivery Count,Total Delivery Fees Collected (SAR),Average Delivery Fee (SAR)\n" +
        deliveryReport.map(r => `${csvCell(r.name)},${r.deliveryCount},${r.totalFees.toFixed(2)},${r.avgFee.toFixed(2)}`).join("\n");
    } else if (selectedReport === 'lazywait_report') {
      csv = "Order Number,Date,Branch,Total (SAR),Sync Status,Lazywait Reference,Error Log\n" +
        lazywaitReport.map(r => `${csvCell(r.orderNumber)},${csvCell(r.date)},${csvCell(r.branch)},${r.total.toFixed(2)},${csvCell(r.status)},${csvCell(r.ref || 'N/A')},${csvCell(r.error || '')}`).join("\n");
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spicymeal_${selectedReport}_${reportStartDate}_to_${reportEndDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const head = (labels: (readonly [string, string])[]) => (
    <thead>
      <tr className="border-b border-con-line">
        {labels.map(([key, label]) => (
          <th key={key} className={TH}>
            <Text variant="caption" tone="tertiary" as="span">{label}</Text>
          </th>
        ))}
      </tr>
    </thead>
  );

  const emptyRow = (cols: number, message: string) => (
    <tr>
      <td colSpan={cols} className="py-8 text-center">
        <Text variant="body" tone="tertiary" as="span">{message}</Text>
      </td>
    </tr>
  );

  const money = (amount: number, prefix?: string) => (
    <Text variant="caption" as="span"><Price amount={amount} prefix={prefix} lang={adminLang} /></Text>
  );

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-con-line pb-3">
        <div className="min-w-0">
          <Text variant="title" as="h3">
            {isRTL ? 'نظام التقارير والتحليلات المالية' : 'Financial Reports & Sales Analytics'}
          </Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-0.5">
            {isRTL
              ? 'تقارير فورية ودقيقة لمراجعة المبيعات الداخلية'
              : 'Realtime financial audits and cashier reconciliation logs'}
          </Text>
        </div>
        <Button
          label={isRTL ? 'تصدير التقرير كـ Excel/CSV' : 'Export Active Audit CSV'}
          onClick={triggerCSVExport}
          variant="secondary"
          disabled={exportDisabled}
          leading={<Download className="size-3.5" aria-hidden="true" />}
        />
      </div>

      <Card className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <label className="flex flex-col gap-2">
          <span className={LABEL}>{isRTL ? 'فرع المبيعات المستهدف' : 'Branch Scope'}</span>
          <select
            value={reportBranchId}
            onChange={(e) => setReportBranchId(e.target.value)}
            className={`${SELECT} ${family}`}
          >
            <option value="all">{isRTL ? 'جميع الفروع والسياسات' : 'All Branches'}</option>
            {branches.map(b => <option key={b.id} value={b.id}>{isRTL ? b.nameAr : b.nameEn}</option>)}
          </select>
        </label>

        <Field
          label={isRTL ? 'تاريخ البداية (من)' : 'Start Date (From)'}
          type="date"
          numeric
          value={reportStartDate}
          onValueChange={setReportStartDate}
        />
        <Field
          label={isRTL ? 'تاريخ النهاية (إلى)' : 'End Date (To)'}
          type="date"
          numeric
          value={reportEndDate}
          onValueChange={setReportEndDate}
        />

        <label className="flex flex-col gap-2">
          <span className={LABEL}>{isRTL ? 'نوع التقرير المالي' : 'Reporting Metric'}</span>
          <select
            value={selectedReport}
            onChange={(e) => setSelectedReport(e.target.value as typeof selectedReport)}
            className={`${SELECT} ${family}`}
          >
            <option value="sales_by_day">{isRTL ? 'المبيعات اليومية التفصيلية' : '1. Sales by Day'}</option>
            <option value="sales_by_branch">{isRTL ? 'المبيعات حسب الفروع' : '2. Sales by Branch'}</option>
            <option value="sales_by_product">{isRTL ? 'تحليل مبيعات المنتجات' : '3. Sales by Product'}</option>
            <option value="coupon_usage">{isRTL ? 'تقرير استخدام الكوبونات' : '4. Coupon Usage'}</option>
            <option value="delivery_fees">{isRTL ? 'رسوم التوصيل والخدمة' : '5. Delivery Service Fees'}</option>
            <option value="lazywait_report">{isRTL ? 'مزامنة POS الكاشير المتكاملة' : '6. Lazywait POS Audit'}</option>
          </select>
        </label>
      </Card>

      {rangeError ? (
        <Card>
          <Text variant="body" tone="danger" as="p">
            {rangeError.kind === 'missing-migration'
              ? (isRTL
                ? 'تتطلب التقارير ترحيل قاعدة بيانات لم يُطبَّق بعد على هذا المشروع (admin_list_orders_for_range).'
                : 'Reports require a database migration that has not been applied to this project yet (admin_list_orders_for_range).')
              : (isRTL
                ? `تعذّر تحميل طلبات هذه الفترة: ${rangeError.message}`
                : `Could not load orders for this range: ${rangeError.message}`)}
          </Text>
        </Card>
      ) : null}

      {rangeOverflow ? (
        <Card>
          <Text variant="body" tone="warning" as="p">
            {isRTL
              ? `تحتوي هذه الفترة على ${rangeOverflow.rows} طلبًا، وهو أكثر من الحد الأقصى ${rangeOverflow.max} طلب للتقرير الواحد. لم تُحمَّل أي بيانات — يرجى تضييق الفترة أو اختيار فرع واحد.`
              : `This range holds ${rangeOverflow.rows} orders, more than the ${rangeOverflow.max}-order limit for a single report.`}
          </Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-1">
            {isRTL
              ? 'لم تُعرض نتائج جزئية عمدًا، لأن تقريرًا مبتورًا يبدو صحيحًا.'
              : 'No partial results were loaded — deliberately, because a truncated report looks correct. Narrow the date range or pick a single branch.'}
          </Text>
        </Card>
      ) : null}

      {rangeLoading ? (
        <Card>
          <Text variant="body" tone="tertiary" as="p">
            {isRTL ? 'جارٍ تحميل طلبات هذه الفترة…' : 'Loading orders for this range…'}
          </Text>
        </Card>
      ) : null}

      {!rangeIsComplete ? (
        <Card>
          <Text variant="body" tone="warning" as="p">
            {isRTL
              ? 'اختر تاريخ بداية وتاريخ نهاية صالحين (البداية قبل النهاية) لعرض التقرير.'
              : 'Choose a valid start and end date, with the start on or before the end, to run the report.'}
          </Text>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <Card>
          <Text variant="caption" tone="tertiary" as="p">
            {isRTL ? 'إجمالي المبيعات المفلترة' : 'Filtered Sales Revenue'}
          </Text>
          <Text variant="heading" as="p" className="mt-0.5"><Price amount={repGrossSales} lang={adminLang} /></Text>
          <Text variant="caption" tone="tertiary" as="p">
            {isRTL ? 'تشمل مكوّن الضريبة المسجل لكل طلب' : 'Includes each order’s stored VAT component'}
          </Text>
        </Card>

        <Card>
          <Text variant="caption" tone="tertiary" as="p">
            {isRTL ? 'عدد الطلبات المكتملة' : 'Completed Order Volume'}
          </Text>
          <Text variant="heading" numeric as="p" className="mt-0.5">
            {repOrdersCount} <Text variant="caption" tone="secondary" as="span">{isRTL ? 'طلب ناجح' : 'Orders'}</Text>
          </Text>
          <Text variant="caption" tone="tertiary" as="p">
            {isRTL ? 'خلال النطاق الزمني المحدد' : 'Within date range scope'}
          </Text>
        </Card>

        <Card>
          <Text variant="caption" tone="tertiary" as="p">
            {isRTL ? 'إجمالي خصومات الكوبونات' : 'Total Coupon Savings'}
          </Text>
          <Text variant="heading" as="p" className="mt-0.5"><Price amount={repDiscounts} lang={adminLang} /></Text>
          <Text variant="caption" tone="tertiary" as="p">
            {isRTL ? 'مستقطعة من إيراد المبيعات' : 'Deducted from gross rev'}
          </Text>
        </Card>

        <Card>
          <Text variant="caption" tone="tertiary" as="p">
            {isRTL ? 'رسوم التوصيل المحصلة' : 'Delivery Fees Collected'}
          </Text>
          <Text variant="heading" as="p" className="mt-0.5"><Price amount={repDeliveryFees} lang={adminLang} /></Text>
          <Text variant="caption" tone="tertiary" as="p">
            {isRTL ? 'من طلبات التوصيل الناجحة' : 'From completed deliveries'}
          </Text>
        </Card>
      </div>

      <Card flush className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-con-line p-3">
          <Text variant="label" as="span">
            {selectedReport === 'sales_by_day' && (isRTL ? 'تقرير حركة المبيعات اليومية' : 'Daily Sales Ledger')}
            {selectedReport === 'sales_by_branch' && (isRTL ? 'توزيع المبيعات وأداء الفروع' : 'Branch Performance Audit')}
            {selectedReport === 'sales_by_product' && (isRTL ? 'حجم مبيعات الوجبات والمنتجات' : 'Product Sales Distribution Ledger')}
            {selectedReport === 'coupon_usage' && (isRTL ? 'كشوفات استخدام كوبونات الخصم' : 'Promo Coupon Usage Ledger')}
            {selectedReport === 'delivery_fees' && (isRTL ? 'تحصيل رسوم التوصيل والمسافات' : 'Delivery Service Fees Audit')}
            {selectedReport === 'lazywait_report' && (isRTL ? 'مطابقة ومزامنة نقاط البيع (Lazywait POS)' : 'Lazywait POS Synchronization Ledger')}
          </Text>
          <Text variant="caption" tone="tertiary" numeric as="span">
            {reportStartDate} → {reportEndDate}
          </Text>
        </div>

        <div className="overflow-x-auto">
          {selectedReport === 'sales_by_day' && (
            <table className="w-full">
              {head([
                ['date', isRTL ? 'التاريخ اليومي' : 'Calendar Date'],
                ['count', isRTL ? 'عدد الطلبات' : 'Orders Count'],
                ['gross', isRTL ? 'المبيعات قبل الخصم والرسوم' : 'Sales (Gross)'],
                ['fees', isRTL ? 'رسوم التوصيل' : 'Delivery Fees'],
                ['disc', isRTL ? 'خصومات الكوبونات' : 'Coupons Deduct'],
                ['net', isRTL ? 'صافي المبيعات (شامل الضريبة)' : 'Net Revenue'],
                ['vat', isRTL ? 'قيمة الضريبة المسجلة' : 'Stored VAT'],
              ] as const)}
              <tbody>
                {dayReport.length === 0 ? emptyRow(7, isRTL ? 'لا توجد بيانات حركة مبيعات لهذا النطاق الزمني' : 'No sales ledger records for this scope.') : (
                  dayReport.map((r, i) => (
                    <tr key={i} className="border-t border-con-line">
                      <td className={TD}><Text variant="caption" numeric as="span">{r.date}</Text></td>
                      <td className={TD}><Text variant="caption" numeric as="span">{r.ordersCount}</Text></td>
                      <td className={TD}>{money(r.subtotal)}</td>
                      <td className={TD}>{money(r.deliveryFee)}</td>
                      <td className={TD}>{money(r.discount, '-')}</td>
                      <td className={TD}>{money(r.total)}</td>
                      <td className={TD}>{money(r.vat)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {selectedReport === 'sales_by_branch' && (
            <table className="w-full">
              {head([
                ['branch', isRTL ? 'الفرع المستهدف' : 'Branch Location'],
                ['vol', isRTL ? 'حجم الطلبات' : 'Order Volume'],
                ['rev', isRTL ? 'إجمالي المبيعات' : 'Revenue Gross'],
                ['fees', isRTL ? 'رسوم التوصيل المحصلة' : 'Delivery Service'],
                ['disc', isRTL ? 'الخصومات الممنوحة' : 'Promo Deduct'],
                ['avg', isRTL ? 'معدل قيمة الفاتورة' : 'Avg. Ticket Value'],
              ] as const)}
              <tbody>
                {branchReport.map((r, i) => (
                  <tr key={i} className="border-t border-con-line">
                    <td className={TD}><Text variant="label" as="span">{r.name}</Text></td>
                    <td className={TD}><Text variant="caption" numeric as="span">{r.ordersCount}</Text></td>
                    <td className={TD}>{money(r.totalRevenue)}</td>
                    <td className={TD}>{money(r.deliveryFees)}</td>
                    <td className={TD}>{money(r.discounts, '-')}</td>
                    <td className={TD}>{money(r.avgTicket)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedReport === 'sales_by_product' && (
            <table className="w-full">
              {head([
                ['name', isRTL ? 'اسم الوجبة / المنتج' : 'Menu Item Name'],
                ['cat', isRTL ? 'التصنيف' : 'Category'],
                ['qty', isRTL ? 'الكمية المباعة' : 'Units Sold'],
                ['rev', isRTL ? 'صافي المبيعات المحققة' : 'Net Sales Revenue'],
              ] as const)}
              <tbody>
                {productReport.length === 0 ? emptyRow(4, isRTL ? 'لم يتم بيع أي منتجات في النطاق الزمني المحدد' : 'No product sales recorded.') : (
                  productReport.map((r, i) => (
                    <tr key={i} className="border-t border-con-line">
                      <td className={TD}><Text variant="label" as="span">{r.name}</Text></td>
                      <td className={TD}><Text variant="caption" tone="secondary" as="span">{r.category}</Text></td>
                      <td className={TD}><Text variant="caption" numeric as="span">{r.qty}</Text></td>
                      <td className={TD}>{money(r.rev)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {selectedReport === 'coupon_usage' && (
            <table className="w-full">
              {head([
                ['code', isRTL ? 'رمز الكوبون الترويجي' : 'Promo Coupon Code'],
                ['count', isRTL ? 'مرات الاستخدام الناجحة' : 'Redemption Counts'],
                ['savings', isRTL ? 'إجمالي الخصومات الممنوحة' : 'Total Revenue Deductions'],
              ] as const)}
              <tbody>
                {couponReport.length === 0 ? emptyRow(3, isRTL ? 'لم تُستخدم أي كوبونات في هذا النطاق الزمني' : 'No coupons were used in this scope.') : (
                  couponReport.map((r, i) => (
                    <tr key={i} className="border-t border-con-line">
                      <td className={TD}>
                        <span className="inline-flex rounded-[var(--radius-ds-sm)] bg-con-surface-2 px-2.5 py-1">
                          <Text variant="caption" numeric as="span">{r.code}</Text>
                        </span>
                      </td>
                      <td className={TD}><Text variant="caption" numeric as="span">{r.count}</Text></td>
                      <td className={TD}>{money(r.savings, '−')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {selectedReport === 'delivery_fees' && (
            <table className="w-full">
              {head([
                ['branch', isRTL ? 'الفرع المستفيد' : 'Operational Branch'],
                ['count', isRTL ? 'عدد طلبات التوصيل' : 'Completed Deliveries'],
                ['total', isRTL ? 'إجمالي رسوم التوصيل المحصلة' : 'Total Delivery Revenue'],
                ['avg', isRTL ? 'معدل رسوم التوصيل للطلب' : 'Average Delivery Fee'],
              ] as const)}
              <tbody>
                {deliveryReport.map((r, i) => (
                  <tr key={i} className="border-t border-con-line">
                    <td className={TD}><Text variant="label" as="span">{r.name}</Text></td>
                    <td className={TD}><Text variant="caption" numeric as="span">{r.deliveryCount}</Text></td>
                    <td className={TD}>{money(r.totalFees)}</td>
                    <td className={TD}>{money(r.avgFee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedReport === 'lazywait_report' && (
            <table className="w-full">
              {head([
                ['num', isRTL ? 'رقم الطلب المحلي' : 'Local Order #'],
                ['date', isRTL ? 'تاريخ الطلب' : 'Order Date'],
                ['branch', isRTL ? 'الفرع' : 'Branch Scope'],
                ['total', isRTL ? 'قيمة الفاتورة' : 'Total'],
                ['sync', isRTL ? 'حالة المزامنة السحابية' : 'POS Cloud Sync'],
                ['ref', isRTL ? 'مرجع Lazywait ID' : 'Lazywait POS Ref'],
                ['log', isRTL ? 'تفاصيل سجل الأخطاء والعمليات' : 'Operation / Audit Logs'],
              ] as const)}
              <tbody>
                {lazywaitReport.length === 0 ? emptyRow(7, isRTL ? 'لا توجد طلبات في هذا النطاق الزمني لفحص المزامنة' : 'No records scheduled for cashier POS reconciliation.') : (
                  lazywaitReport.map((r, i) => (
                    <tr key={i} className="border-t border-con-line">
                      <td className={TD}><Text variant="label" numeric as="span">{r.orderNumber}</Text></td>
                      <td className={TD}><Text variant="caption" tone="secondary" numeric as="span">{r.date}</Text></td>
                      <td className={TD}><Text variant="caption" as="span">{r.branch}</Text></td>
                      <td className={TD}>{money(r.total)}</td>
                      <td className={TD}>
                        <StatusPill label={r.status.toUpperCase()} tone={SYNC_TONE[r.status] ?? 'neutral'} />
                      </td>
                      <td className={TD}>
                        <Text variant="caption" tone={r.ref ? 'secondary' : 'tertiary'} numeric as="span">{r.ref || '—'}</Text>
                      </td>
                      <td className={`${TD} max-w-[200px] truncate`} title={r.error}>
                        {r.status === 'synced' ? (
                          <Text variant="caption" tone="success" as="span">
                            {isRTL ? 'تمت مزامنة الطلب لنقاط البيع بنجاح' : 'Synced to POS'}
                          </Text>
                        ) : (
                          <Text variant="caption" tone="secondary" as="span">{r.error}</Text>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-secondary" aria-hidden="true" />
        <div>
          <Text variant="label" as="p">
            {isRTL
              ? 'ملاحظة: تقرير مبيعات إداري — وليس فاتورة ضريبية'
              : 'Note: management sales report — not a tax invoice'}
          </Text>
          <Text variant="caption" tone="secondary" as="p" className="mt-0.5 leading-relaxed">
            {isRTL
              ? 'هذه الأرقام ملخص مبيعات للاستخدام الإداري فقط، ولا تُعد فواتير ضريبية ولا سجلات معتمدة لأغراض الإقرار الضريبي. قيمة الضريبة في الفترات السابقة مأخوذة من المبلغ الذي خزّنه الخادم مع كل طلب وقت إنشائه، لذلك لا تتغير السجلات السابقة عند تغيير نسبة الضريبة لاحقاً. كما تعتمد التقارير على تحديث حالة الطلب يدوياً من قِبل الموظفين. يُرجى الرجوع إلى المحاسب لأي إقرار ضريبي رسمي.'
              : 'These figures are a management sales summary for internal use. They are not tax invoices and are not an approved record for VAT filing. Historical VAT comes from the amount the server stored with each order when it was created, so changing the configured VAT rate later does not rewrite prior periods. Reports also depend on staff updating order status by hand. Use your accountant for any official VAT return.'}
          </Text>
        </div>
      </Card>
    </div>
  );
};
