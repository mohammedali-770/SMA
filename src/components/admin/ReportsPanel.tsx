import React, { useMemo, useState } from 'react';
import { Check, Download } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getVATBreakdown, riyadhDateOnly, riyadhMonthRange } from '../../utils/calculations';
import { Price } from '../Price';
import { buildCouponUsage, lazywaitRefOf } from '../../lib/reports';
import { ADMIN_LOCALES } from './adminLocales';

export const ReportsPanel: React.FC = () => {
  const { orders, branches, brandSettings, products, categories, adminLang } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const [selectedReport, setSelectedReport] = useState<'sales_by_day' | 'sales_by_branch' | 'sales_by_product' | 'coupon_usage' | 'delivery_fees' | 'lazywait_report'>('sales_by_day');
  const [reportBranchId, setReportBranchId] = useState<string>('all');
  // Default the range to the CURRENT month (Riyadh local), computed once, instead
  // of a hardcoded window that silently goes stale after July 2026.
  const defaultRange = useMemo(() => riyadhMonthRange(), []);
  const [reportStartDate, setReportStartDate] = useState<string>(defaultRange.start);
  const [reportEndDate, setReportEndDate] = useState<string>(defaultRange.end);

            // 1. Filtered orders for reporting (delivered within date range and branch)
            const filteredOrders = orders.filter(o => {
              if (reportBranchId !== 'all' && o.branchId !== reportBranchId) return false;
              const oDate = riyadhDateOnly(o.createdAt);
              return oDate >= reportStartDate && oDate <= reportEndDate;
            });

            const deliveredOrders = filteredOrders.filter(o => o.status === 'delivered');

            // 2. Aggregations
            const repGrossSales = deliveredOrders.reduce((sum, o) => sum + o.total, 0);
            const repDiscounts = deliveredOrders.reduce((sum, o) => sum + Math.max(0, (o.subtotal + o.deliveryFee) - o.total), 0);
            const repDeliveryFees = deliveredOrders.reduce((sum, o) => sum + o.deliveryFee, 0);
            const repOrdersCount = deliveredOrders.length;

            // 3. Sales By Day Memo
            const dayReport = (() => {
              const map: { [date: string]: { subtotal: number; deliveryFee: number; discount: number; total: number; vat: number; ordersCount: number } } = {};
              deliveredOrders.forEach(o => {
                const date = riyadhDateOnly(o.createdAt);
                const disc = Math.max(0, (o.subtotal + o.deliveryFee) - o.total);
                // Extract VAT from the VAT-inclusive grand total actually charged,
                // consistent with the customer and admin receipts (not the
                // pre-discount, delivery-excluded subtotal).
                const { vatAmount } = getVATBreakdown(o.total, brandSettings?.vatPercentage || 15);
                if (!map[date]) map[date] = { subtotal: 0, deliveryFee: 0, discount: 0, total: 0, vat: 0, ordersCount: 0 };
                map[date].subtotal += o.subtotal;
                map[date].deliveryFee += o.deliveryFee;
                map[date].discount += disc;
                map[date].total += o.total;
                map[date].vat += vatAmount;
                map[date].ordersCount += 1;
              });
              return Object.keys(map).sort().map(date => ({ date, ...map[date] }));
            })();

            // 4. Sales By Branch Memo
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

            // 5. Sales By Product Memo
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

            // 6. Coupon Usage Memo — grouped by the order's REAL coupon_code and the
            // real coupon discount (no inferring codes from discount amounts).
            const couponReport = buildCouponUsage(deliveredOrders);

            // 7. Delivery Fees Memo
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

            // 8. Lazywait Sync Memo — the POS reference and error come straight from
            // the order (real lazywait_order_number / lazywait_ref + sync_last_error).
            // For a not-yet-failed order with no server error we show a neutral,
            // truthful status label rather than a fabricated failure message.
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

            // Handle Export CSV
            const triggerCSVExport = () => {
              let csv = '';
              if (selectedReport === 'sales_by_day') {
                csv = "Date,Orders Count,Subtotal (SAR),Delivery Fees (SAR),Discounts (SAR),Net Sales (SAR),VAT Amount (SAR)\n" +
                  dayReport.map(r => `${r.date},${r.ordersCount},${r.subtotal.toFixed(2)},${r.deliveryFee.toFixed(2)},${r.discount.toFixed(2)},${r.total.toFixed(2)},${r.vat.toFixed(2)}`).join("\n");
              } else if (selectedReport === 'sales_by_branch') {
                csv = "Branch,Orders Count,Total Revenue (SAR),Delivery Fees (SAR),Average Ticket (SAR),Discounts (SAR)\n" +
                  branchReport.map(r => `"${r.name}",${r.ordersCount},${r.totalRevenue.toFixed(2)},${r.deliveryFees.toFixed(2)},${r.avgTicket.toFixed(2)},${r.discounts.toFixed(2)}`).join("\n");
              } else if (selectedReport === 'sales_by_product') {
                csv = "Product,Category,Quantity Sold,Total Revenue (SAR)\n" +
                  productReport.map(r => `"${r.name}","${r.category}",${r.qty},${r.rev.toFixed(2)}`).join("\n");
              } else if (selectedReport === 'coupon_usage') {
                csv = "Coupon Code,Usage Count,Total Discounts Saved (SAR)\n" +
                  couponReport.map(r => `${r.code},${r.count},${r.savings.toFixed(2)}`).join("\n");
              } else if (selectedReport === 'delivery_fees') {
                csv = "Branch,Delivery Count,Total Delivery Fees Collected (SAR),Average Delivery Fee (SAR)\n" +
                  deliveryReport.map(r => `"${r.name}",${r.deliveryCount},${r.totalFees.toFixed(2)},${r.avgFee.toFixed(2)}`).join("\n");
              } else if (selectedReport === 'lazywait_report') {
                csv = "Order Number,Date,Branch,Total (SAR),Sync Status,Lazywait Reference,Error Log\n" +
                  lazywaitReport.map(r => `${r.orderNumber},${r.date},"${r.branch}",${r.total.toFixed(2)},${r.status},${r.ref || 'N/A'},"${r.error || ''}"`).join("\n");
              }

              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `spicymeal_${selectedReport}_${reportStartDate}_to_${reportEndDate}.csv`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            };

            return (
              <div className="space-y-5 animate-fade-in text-xs" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
                {/* Title comes from the shell header; the ZATCA note stays. */}
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <p className="text-[11px] text-slate-600 font-medium leading-relaxed max-w-2xl">{isRTL ? 'تقارير فورية ودقيقة متوافقة مع متطلبات الهيئة العامة للزكاة والضريبة والجمارك' : 'Realtime financial audits and cashier reconciliation logs'}</p>
                  </div>
                  <button 
                    onClick={triggerCSVExport}
                    className="glass-btn-primary py-2 px-3.5 rounded-xl flex items-center gap-1.5 text-[10px]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'تصدير التقرير كـ Excel/CSV' : 'Export Active Audit CSV'}</span>
                  </button>
                </div>

                {/* FILTERS PANEL */}
                <div className="glass-card p-4 rounded-2xl grid grid-cols-1 md:grid-cols-4 gap-4 bg-white/20">
                  <div>
                    <label className="block text-[10px] font-black text-slate-600 mb-1">{isRTL ? 'فرع المبيعات المستهدف' : 'Branch Scope'}</label>
                    <select
                      value={reportBranchId}
                      onChange={(e) => setReportBranchId(e.target.value)}
                      className="glass-input w-full text-xs p-2 outline-none font-bold text-slate-800"
                    >
                      <option value="all">{isRTL ? 'جميع الفروع والسياسات' : 'All Branches'}</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{isRTL ? b.nameAr : b.nameEn}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 mb-1">{isRTL ? 'تاريخ البداية (من)' : 'Start Date (From)'}</label>
                    <input 
                      type="date"
                      value={reportStartDate}
                      onChange={(e) => setReportStartDate(e.target.value)}
                      className="glass-input w-full text-xs p-2 outline-none font-bold text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 mb-1">{isRTL ? 'تاريخ النهاية (إلى)' : 'End Date (To)'}</label>
                    <input 
                      type="date"
                      value={reportEndDate}
                      onChange={(e) => setReportEndDate(e.target.value)}
                      className="glass-input w-full text-xs p-2 outline-none font-bold text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 mb-1">{isRTL ? 'نوع التقرير المالي' : 'Reporting Metric'}</label>
                    <select
                      value={selectedReport}
                      onChange={(e) => setSelectedReport(e.target.value as any)}
                      className="glass-input w-full text-xs p-2 outline-none font-black text-primary"
                    >
                      <option value="sales_by_day">{isRTL ? 'المبيعات اليومية التفصيلية' : '1. Sales by Day'}</option>
                      <option value="sales_by_branch">{isRTL ? 'المبيعات حسب الفروع' : '2. Sales by Branch'}</option>
                      <option value="sales_by_product">{isRTL ? 'تحليل مبيعات المنتجات' : '3. Sales by Product'}</option>
                      <option value="coupon_usage">{isRTL ? 'تقرير استخدام الكوبونات' : '4. Coupon Usage'}</option>
                      <option value="delivery_fees">{isRTL ? 'رسوم التوصيل والخدمة' : '5. Delivery Service Fees'}</option>
                      <option value="lazywait_report">{isRTL ? 'مزامنة POS الكاشير المتكاملة' : '6. Lazywait POS Audit'}</option>
                    </select>
                  </div>
                </div>

                {/* AUDIT SUMMARY CARDS */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                  <div className="glass-card p-3 rounded-2xl">
                    <span className="text-[9px] font-bold text-gray-600">{isRTL ? 'إجمالي المبيعات المفلترة' : 'Filtered Sales Revenue'}</span>
                    <p className="text-xl font-black text-slate-900 mt-0.5 tracking-tight tabular-nums"><Price amount={repGrossSales} /></p>
                    <span className="text-[8px] text-gray-600">{isRTL ? 'شامل ضريبة القيمة المضافة ١٥٪' : 'Includes 15% VAT'}</span>
                  </div>

                  <div className="glass-card p-3 rounded-2xl">
                    <span className="text-[9px] font-bold text-gray-600">{isRTL ? 'عدد الطلبات المكتملة' : 'Completed Order Volume'}</span>
                    <p className="text-xl font-black text-slate-900 mt-0.5 tracking-tight tabular-nums">{repOrdersCount} {isRTL ? 'طلب ناجح' : 'Orders'}</p>
                    <span className="text-[8px] text-gray-600">{isRTL ? 'خلال النطاق الزمني المحدد' : 'Within date range scope'}</span>
                  </div>

                  <div className="glass-card p-3 rounded-2xl">
                    <span className="text-[9px] font-bold text-gray-600">{isRTL ? 'إجمالي خصومات الكوبونات' : 'Total Coupon Savings'}</span>
                    <p className="text-xl font-black text-slate-900 mt-0.5 tracking-tight tabular-nums"><Price amount={repDiscounts} /></p>
                    <span className="text-[8px] text-slate-600 font-bold">{isRTL ? 'مستقطعة من إيراد المبيعات' : 'Deducted from gross rev'}</span>
                  </div>

                  <div className="glass-card p-3 rounded-2xl">
                    <span className="text-[9px] font-bold text-gray-600">{isRTL ? 'رسوم التوصيل المحصلة' : 'Delivery Fees Collected'}</span>
                    <p className="text-xl font-black text-slate-900 mt-0.5 tracking-tight tabular-nums"><Price amount={repDeliveryFees} /></p>
                    <span className="text-[8px] text-gray-600">{isRTL ? 'من طلبات التوصيل الناجحة' : 'From completed deliveries'}</span>
                  </div>
                </div>

                {/* THE SELECTED TABULAR REPORT VIEWPORT */}
                <div className="glass-card rounded-[1.5rem] overflow-hidden bg-white/40">
                  <div className="p-3 border-b border-slate-200/50 bg-white/30 flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-700">
                      {selectedReport === 'sales_by_day' && (isRTL ? 'تقرير حركة المبيعات اليومية' : 'Daily Sales Ledger')}
                      {selectedReport === 'sales_by_branch' && (isRTL ? 'توزيع المبيعات وأداء الفروع' : 'Branch Performance Audit')}
                      {selectedReport === 'sales_by_product' && (isRTL ? 'حجم مبيعات الوجبات والمنتجات' : 'Product Sales Distribution Ledger')}
                      {selectedReport === 'coupon_usage' && (isRTL ? 'كشوفات استخدام كوبونات الخصم' : 'Promo Coupon Usage Ledger')}
                      {selectedReport === 'delivery_fees' && (isRTL ? 'تحصيل رسوم التوصيل والمسافات' : 'Delivery Service Fees Audit')}
                      {selectedReport === 'lazywait_report' && (isRTL ? 'مطابقة ومزامنة نقاط البيع (Lazywait POS)' : 'Lazywait POS Synchronization Ledger')}
                    </span>
                    <span className="text-[9px] font-bold text-slate-600 font-mono">
                      {reportStartDate} → {reportEndDate}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    {/* 1. SALES BY DAY */}
                    {selectedReport === 'sales_by_day' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-[var(--sm-surface-alt)] text-xs text-slate-600 font-bold">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'التاريخ اليومي' : 'Calendar Date'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'عدد الطلبات' : 'Orders Count'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'المبيعات قبل الخصم والرسوم' : 'Sales (Gross)'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'رسوم التوصيل' : 'Delivery Fees'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'خصومات الكوبونات' : 'Coupons Deduct'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'صافي المبيعات (شامل الضريبة)' : 'Net Revenue (SAR)'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'قيمة الضريبة ١٥٪' : 'VAT (15% Amount)'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {dayReport.length === 0 ? (
                            <tr><td colSpan={7} className="text-center py-8 text-gray-600">{isRTL ? 'لا توجد بيانات حركة مبيعات لهذا النطاق الزمني' : 'No sales ledger records for this scope.'}</td></tr>
                          ) : (
                            dayReport.map((r, i) => (
                              <tr key={i} className="hover:bg-white/50">
                                <td className="py-2.5 px-4 font-mono">{r.date}</td>
                                <td className="py-2.5 px-4 text-center">{r.ordersCount}</td>
                                <td className="py-2.5 px-4 text-right">{r.subtotal.toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-right">{r.deliveryFee.toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-right text-red-700 font-semibold tabular-nums">-{r.discount.toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-right font-black text-slate-900 tabular-nums">{r.total.toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-right text-slate-700 tabular-nums">{r.vat.toFixed(2)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    )}

                    {/* 2. SALES BY BRANCH */}
                    {selectedReport === 'sales_by_branch' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-[var(--sm-surface-alt)] text-xs text-slate-600 font-bold">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'الفرع المستهدف' : 'Branch Location'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'حجم الطلبات' : 'Order Volume'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'إجمالي المبيعات' : 'Revenue Gross (SAR)'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'رسوم التوصيل المحصلة' : 'Delivery Service'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'الخصومات الممنوحة' : 'Promo Deduct'}</th>
                            <th className="py-2.5 px-4 text-right text-slate-900">{isRTL ? 'معدل قيمة الفاتورة' : 'Avg. Ticket Value'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {branchReport.map((r, i) => (
                            <tr key={i} className="hover:bg-white/50">
                              <td className="py-3 px-4 text-xs font-black text-slate-800">{r.name}</td>
                              <td className="py-3 px-4 text-center">{r.ordersCount}</td>
                              <td className="py-3 px-4 text-right font-black text-slate-900 tabular-nums">{r.totalRevenue.toFixed(2)}</td>
                              <td className="py-3 px-4 text-right">{r.deliveryFees.toFixed(2)}</td>
                              <td className="py-3 px-4 text-right text-red-700">-{r.discounts.toFixed(2)}</td>
                              <td className="py-3 px-4 text-right font-mono text-xs"><Price amount={r.avgTicket} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* 3. SALES BY PRODUCT */}
                    {selectedReport === 'sales_by_product' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-[var(--sm-surface-alt)] text-xs text-slate-600 font-bold">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'اسم الوجبة / المنتج' : 'Menu Item Name'}</th>
                            <th className="py-2.5 px-4">{isRTL ? 'التصنيف' : 'Category'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'الكمية المباعة' : 'Units Sold'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'صافي المبيعات المحققة' : 'Net Sales Revenue (SAR)'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {productReport.length === 0 ? (
                            <tr><td colSpan={4} className="text-center py-8 text-gray-600">{isRTL ? 'لم يتم بيع أي منتجات في النطاق الزمني المحدد' : 'No product sales recorded.'}</td></tr>
                          ) : (
                            productReport.map((r, i) => (
                              <tr key={i} className="hover:bg-white/50">
                                <td className="py-2.5 px-4 font-black text-slate-800 text-xs">{r.name}</td>
                                <td className="py-2.5 px-4 font-semibold text-slate-600">{r.category}</td>
                                <td className="py-2.5 px-4 text-center text-slate-900 font-black">{r.qty}</td>
                                <td className="py-2.5 px-4 text-right font-black text-slate-900 tabular-nums"><Price amount={r.rev} /></td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    )}

                    {/* 4. COUPON USAGE */}
                    {selectedReport === 'coupon_usage' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-[var(--sm-surface-alt)] text-xs text-slate-600 font-bold">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'رمز الكوبون الترويجي' : 'Promo Coupon Code'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'مرات الاستخدام الناجحة' : 'Redemption Counts'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'إجمالي الخصومات الممنوحة' : 'Total Revenue Deductions (SAR)'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {couponReport.length === 0 ? (
                            <tr><td colSpan={3} className="text-center py-8 text-gray-600">{isRTL ? 'لم تُستخدم أي كوبونات في هذا النطاق الزمني' : 'No coupons were used in this scope.'}</td></tr>
                          ) : (
                            couponReport.map((r, i) => (
                              <tr key={i} className="hover:bg-white/50">
                                <td className="py-3 px-4 font-black"><span className="bg-purple-100 text-primary px-2.5 py-1 rounded-lg font-mono text-xs">{r.code}</span></td>
                                <td className="py-3 px-4 text-center font-bold text-slate-800 text-sm">{r.count}</td>
                                <td className="py-3 px-4 text-right text-secondary font-black text-sm"><Price amount={r.savings} prefix="−" /></td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    )}

                    {/* 5. DELIVERY SERVICE FEES */}
                    {selectedReport === 'delivery_fees' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-[var(--sm-surface-alt)] text-xs text-slate-600 font-bold">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'الفرع المستفيد' : 'Operational Branch'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'عدد طلبات التوصيل' : 'Completed Deliveries'}</th>
                            <th className="py-2.5 px-4 text-right text-green-700">{isRTL ? 'إجمالي رسوم التوصيل المحصلة' : 'Total Delivery Revenue (SAR)'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'معدل رسوم التوصيل للطلب' : 'Average Delivery Fee'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {deliveryReport.map((r, i) => (
                            <tr key={i} className="hover:bg-white/50">
                              <td className="py-3 px-4 font-black text-slate-800 text-xs">{r.name}</td>
                              <td className="py-3 px-4 text-center">{r.deliveryCount}</td>
                              <td className="py-3 px-4 text-right text-green-700 font-black"><Price amount={r.totalFees} /></td>
                              <td className="py-3 px-4 text-right font-mono"><Price amount={r.avgFee} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* 6. LAZYWAIT POS AUDIT */}
                    {selectedReport === 'lazywait_report' && (
                      <table className="w-full text-left font-bold text-slate-700">
                        <thead className="bg-[var(--sm-surface-alt)] text-xs text-slate-600 font-bold">
                          <tr>
                            <th className="py-2.5 px-4">{isRTL ? 'رقم الطلب المحلي' : 'Local Order #'}</th>
                            <th className="py-2.5 px-4">{isRTL ? 'تاريخ الطلب' : 'Order Date'}</th>
                            <th className="py-2.5 px-4">{isRTL ? 'الفرع' : 'Branch Scope'}</th>
                            <th className="py-2.5 px-4 text-right">{isRTL ? 'قيمة الفاتورة' : 'Total (SAR)'}</th>
                            <th className="py-2.5 px-4 text-center">{isRTL ? 'حالة المزامنة السحابية' : 'POS Cloud Sync'}</th>
                            <th className="py-2.5 px-4">{isRTL ? 'مرجع Lazywait ID' : 'Lazywait POS Ref'}</th>
                            <th className="py-2.5 px-4">{isRTL ? 'تفاصيل سجل الأخطاء والعمليات' : 'Operation / Audit Logs'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          {lazywaitReport.length === 0 ? (
                            <tr><td colSpan={7} className="text-center py-8 text-gray-600">{isRTL ? 'لا توجد طلبات في هذا النطاق الزمني لفحص المزامنة' : 'No records scheduled for cashier POS reconciliation.'}</td></tr>
                          ) : (
                            lazywaitReport.map((r, i) => (
                              <tr key={i} className="hover:bg-white/50 text-[10.5px]">
                                <td className="py-3 px-4 font-black text-slate-800">{r.orderNumber}</td>
                                <td className="py-3 px-4 font-semibold text-slate-600 font-mono">{r.date}</td>
                                <td className="py-3 px-4 font-bold text-slate-700">{r.branch}</td>
                                <td className="py-3 px-4 text-right font-black text-slate-900">{r.total.toFixed(2)}</td>
                                <td className="py-3 px-4 text-center">
                                  <span className={`text-[8.5px] font-black px-2 py-0.5 rounded-full ${
                                    r.status === 'synced' ? 'bg-green-100 text-green-700' :
                                    r.status === 'sync_failed' ? 'bg-red-100 text-red-700' :
                                    r.status === 'pending_sync' ? 'bg-amber-100 text-amber-700' :
                                    'bg-slate-100 text-slate-500'
                                  }`}>
                                    {r.status.toUpperCase()}
                                  </span>
                                </td>
                                <td className="py-3 px-4 font-mono font-bold text-primary">{r.ref || <span className="text-gray-600">-</span>}</td>
                                <td className="py-3 px-4 text-slate-600 text-[10px] leading-tight truncate max-w-[200px]" title={r.error}>
                                  {r.status === 'synced' ? (
                                    <span className="text-green-700 font-bold">✓ {isRTL ? 'تمت مزامنة الطلب لنقاط البيع بنجاح' : 'تمت المزامنة'}</span>
                                  ) : (
                                    <span className="text-slate-600">⚠ {r.error}</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* HELPERS NOTES */}
                <div className="bg-primary/5 border border-primary/10 p-3 rounded-2xl flex items-start gap-2 text-slate-600 text-[10px] leading-relaxed">
                  <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold text-primary block mb-0.5">{isRTL ? 'إقرار ومطابقة الهيئة العامة للزكاة والضريبة والجمارك (Saudi VAT Audit Compliance)' : 'ZATCA Tax Invoice Audit Note:'}</span>
                    {isRTL ? (
                      'تعتبر هذه التقارير والتحليلات كشوف مبيعات فورية متوافقة بالكامل مع اللائحة التنفيذية لضريبة القيمة المضافة بالمملكة العربية السعودية بنسبة ١٥٪. جميع الأسعار الظاهرة شاملة الضريبة، ويتم استخلاص الوعاء الضريبي تلقائياً بناءً على العمليات الناجحة.'
                    ) : (
                      'All generated digital invoices and daily registers are fully compliant with the ZATCA Saudi Arabia 15% VAT directives. Tax components are extracted in real-time from gross sales at standard math: VAT = Total - (Total / 1.15).'
                    )}
                  </div>
                </div>
              </div>
            );
};
