import React, { useState, useEffect } from 'react';
import { Eye, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useApp, canTransitionOrder } from '../../context/AppContext';
import { Order, OrderStatus } from '../../types';
import { getVATBreakdown } from '../../utils/calculations';
import { Price } from '../Price';
import { ADMIN_LOCALES } from './adminLocales';
import { paymentDisplayState, paymentMethodLabel } from '../../lib/payment';
import { orderDisplayNumber } from '../../lib/mappers';
import { paymentGateway, DbPaymentRecord, orders as ordersApi, PosConfirmationRequired } from '../../lib/api';

// Statuses an order should not reach while an ONLINE payment is still unverified.
// "Received" is always allowed and "Cancelled" needs no payment. Cash orders are
// legitimately unpaid until collected, so they are warned (banner) but not gated
// by a confirm here — only online-pending / unknown-method orders are.
const ONLINE_GUARDED_STATUSES: OrderStatus[] = ['preparing', 'ready', 'out_for_delivery', 'delivered'];

/** Authoritative Lazywait POS sync state (falls back to the legacy sync field). */
function syncStateOf(o: Order): string {
  return o.lazywaitSyncState ?? o.orderSyncStatus ?? 'not_synced';
}

/**
 * Human label for a POS sync state.
 *
 * The chips previously rendered the raw enum — an operator saw `pending_sync`
 * and `dead_letter` mid-rush. The states themselves are unchanged; only their
 * presentation is. `dead_letter` deliberately reads as "needs verification"
 * rather than "failed": that state means the outcome is ambiguous and a ticket
 * may already exist at the branch, which is not the same as a clean failure.
 */
function syncLabel(state: string, isRTL: boolean): string {
  const en: Record<string, string> = {
    synced: 'Synced',
    syncing: 'Sending',
    pending_sync: 'Queued',
    not_synced: 'Not sent',
    failed: 'Send failed',
    sync_failed: 'Send failed',
    blocked: 'Blocked',
    dead_letter: 'Needs verification',
    skipped: 'Skipped',
  };
  const ar: Record<string, string> = {
    synced: 'تمت المزامنة',
    syncing: 'جارٍ الإرسال',
    pending_sync: 'في الانتظار',
    not_synced: 'لم يُرسل',
    failed: 'فشل الإرسال',
    sync_failed: 'فشل الإرسال',
    blocked: 'محظور',
    dead_letter: 'يحتاج تحققاً',
    skipped: 'تم التخطي',
  };
  return (isRTL ? ar : en)[state] ?? state.replace(/_/g, ' ');
}

/** Colour tone for a POS sync state so failures/blocks read as problems. */
function syncTone(state: string): string {
  switch (state) {
    case 'synced':
      return 'bg-green-50 text-green-600';
    case 'blocked':
    case 'failed':
    case 'dead_letter':
    case 'sync_failed':
      return 'bg-red-50 text-red-600';
    case 'not_synced':
    case 'skipped':
      return 'bg-slate-100 text-slate-500';
    default: // pending / syncing / pending_sync
      return 'bg-yellow-50 text-yellow-600';
  }
}

/**
 * Tap payment details for an online order in the receipt modal: provider, charge
 * id, test/live badge, card brand + last four, sanitized failure. Admin (not
 * accountant) gets a "Verify" action that re-checks the charge via Tap Retrieve
 * Charge (only a genuine CAPTURED confirms — it can never force paid). Reads only
 * the safe payment_records columns (RLS: staff read); no raw payload, no secrets.
 */
const TapPaymentDetails: React.FC<{ order: Order; isAccountant: boolean; isRTL: boolean }> = ({ order, isAccountant, isRTL }) => {
  const [rec, setRec] = useState<DbPaymentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setRec(await paymentGateway.record(order.id)); } catch { setRec(null); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [order.id]);

  if (order.paymentMethod !== 'online') return null;
  if (loading) return <div className="p-2.5 bg-gray-50 rounded-lg text-[9px] text-gray-500 font-bold animate-pulse">{isRTL ? 'جاري تحميل تفاصيل الدفع…' : 'Loading payment details…'}</div>;
  if (!rec || rec.provider !== 'tap') return null;

  const isLive = rec.mode === 'live';
  const paid = rec.status === 'paid';
  const verify = async () => {
    setVerifying(true); setResult(null);
    try { const r = await paymentGateway.adminVerify(order.id); setResult(r.status); await load(); }
    catch (e) { setResult(e instanceof Error ? e.message : 'error'); }
    finally { setVerifying(false); }
  };

  return (
    <div className="p-2.5 bg-gray-50 rounded-lg text-[9.5px] space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-gray-600">Payment provider:</span>
        <span className="font-black text-slate-700 flex items-center gap-1">
          Tap
          <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-black ${isLive ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{isLive ? 'LIVE' : 'TEST'}</span>
        </span>
      </div>
      {rec.provider_ref && (
        <div className="flex justify-between items-center gap-2">
          <span className="text-gray-600">Charge ID:</span>
          <span className="font-mono text-[8.5px] text-slate-600 truncate">{rec.provider_ref}</span>
        </div>
      )}
      <div className="flex justify-between items-center">
        <span className="text-gray-600">Provider status:</span>
        <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase ${paid ? 'bg-green-100 text-green-700' : rec.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-yellow-50 text-yellow-700'}`}>{rec.status}</span>
      </div>
      {(rec.card_scheme || rec.card_last_four) && (
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Card:</span>
          <span className="font-semibold text-slate-600">{[rec.card_scheme, rec.card_last_four ? `•••• ${rec.card_last_four}` : ''].filter(Boolean).join(' ')}</span>
        </div>
      )}
      {rec.failure_message_safe && (
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Note:</span>
          <span className="font-semibold text-red-700">{rec.failure_message_safe}</span>
        </div>
      )}
      {!isAccountant && !paid && (
        <div className="pt-1.5 border-t border-gray-100 flex items-center justify-between gap-2">
          <span className="text-[8.5px] text-gray-600 font-bold">{isRTL ? 'إعادة التحقق من الدفع عبر Tap' : 'Re-verify via Tap'}</span>
          <button onClick={() => void verify()} disabled={verifying} className="bg-primary text-white text-[9px] font-black px-2.5 py-1 rounded-lg disabled:opacity-40">
            {verifying ? '…' : (isRTL ? 'تحقق' : 'Verify')}
          </button>
        </div>
      )}
      {result && <div className="text-[8.5px] font-bold text-slate-600">{isRTL ? 'النتيجة' : 'Result'}: {result}</div>}
    </div>
  );
};

/**
 * Read-only "Orders Requiring Verification" card. Lists ambiguous POS outcomes
 * (state 'confirmation_required') oldest-first with a count badge and safe
 * fields only. NO resend / resolve / refund / cancel actions — a "View" link
 * opens the existing read-only receipt modal. Data comes from the is_admin()-
 * gated list_pos_confirmation_required RPC; it self-hides when the queue is
 * empty. Refreshes on mount and every 60s (no aggressive polling).
 */
const OrdersRequiringVerificationCard: React.FC<{ onView: (id: string) => void }> = ({ onView }) => {
  const { adminLang } = useApp();
  const t = ADMIN_LOCALES[adminLang];
  const [data, setData] = useState<PosConfirmationRequired | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const d = await ordersApi.posConfirmationRequired(10); if (alive) setData(d); }
      catch { if (alive) setData(null); }
      finally { if (alive) setLoading(false); }
    };
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const reasonText = (r: string): string => {
    switch (r) {
      case 'timeout': return t.verify_reason_timeout;
      case 'connection': return t.verify_reason_connection;
      case 'missing_ref': return t.verify_reason_missing_ref;
      case 'provider_5xx': return t.verify_reason_provider_5xx;
      default: return t.verify_reason_ambiguous_response;
    }
  };
  const whenText = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleString(adminLang === 'ar' ? 'ar' : 'en', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  const total = data?.total ?? 0;
  // Hide entirely once nothing needs verification (no empty clutter on the busy
  // live-orders view).
  if (!loading && total === 0) return null;

  return (
    <div className="glass-card rounded-2xl p-4 border border-amber-200/60 bg-amber-50/40">
      <div className="flex items-center gap-2 mb-1">
        <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
        <h3 className="text-sm font-bold text-amber-900">{t.verify_title}</h3>
        {total > 0 && (
          <span className="text-[9px] px-2 py-0.5 rounded-full sm-fill-warning font-black">{total}</span>
        )}
      </div>
      <p className="text-[10px] text-amber-700/80 font-medium mb-3">{t.verify_sub}</p>
      {loading ? (
        <div className="text-[11px] text-amber-700 font-bold animate-pulse">…</div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-1.5">
          {data.items.map(it => (
            <div key={it.id} className="flex items-center justify-between gap-2 bg-white/70 border border-amber-100 rounded-xl px-3 py-2">
              <div className="min-w-0">
                <div className="font-black text-primary text-xs truncate">{it.order_number}</div>
                <div className="text-[9.5px] text-gray-600 font-semibold truncate">
                  {reasonText(it.reason)} · {t.verify_since} {whenText(it.first_pos_sync_failure_at ?? it.created_at)}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="font-bold text-slate-900 text-[11px] tabular-nums"><Price amount={it.total} /></span>
                <button
                  onClick={() => onView(it.id)}
                  className="bg-primary/5 hover:bg-primary hover:text-white border border-primary/10 text-primary py-1 px-2.5 rounded text-[10px] font-bold transition-colors flex items-center gap-1"
                >
                  <Eye className="w-3 h-3" />
                  <span>{t.view_details}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-amber-700 font-bold">{t.verify_empty}</div>
      )}
    </div>
  );
};

export const LiveOrdersPanel: React.FC = () => {
  const { orders, branches, updateOrderStatus, brandSettings, currentUser, adminLang } = useApp();
  const t = ADMIN_LOCALES[adminLang];
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

  // Derived payment status pill (paid / pending online / cash required / unpaid).
  const paymentBadge = (o: Order): { text: string; tone: string } => {
    switch (paymentDisplayState(o)) {
      case 'paid': return { text: 'PAID', tone: 'bg-green-100 text-green-700' };
      case 'pending_online': return { text: isRTL ? 'بانتظار الدفع الإلكتروني' : 'PENDING ONLINE PAYMENT', tone: 'bg-amber-100 text-amber-800' };
      case 'cash_required': return { text: isRTL ? 'مطلوب تحصيل نقدي' : 'CASH PAYMENT REQUIRED', tone: 'bg-blue-100 text-blue-800' };
      default: return { text: isRTL ? 'غير مدفوع' : 'UNPAID', tone: 'bg-slate-200 text-slate-600' };
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

  // "View" from the verification card opens the same read-only receipt modal by
  // resolving the full order from the in-memory (realtime) list.
  const viewById = (id: string) => {
    const match = orders.find(o => o.id === id);
    if (match) setActiveReceiptOrder(match);
  };

  const handleUpdateStatus = (orderId: string, status: OrderStatus) => {
    if (isAccountant) return; // accountant is view-only (also enforced by RLS server-side)
    const target = orders.find(o => o.id === orderId) ?? activeReceiptOrder ?? undefined;
    // Cash orders are legitimately unpaid until collected — keep the banner but
    // don't block. Only confirm when an ONLINE payment (or unknown method) has
    // not completed before advancing past "Received".
    const st = target ? paymentDisplayState(target) : 'paid';
    const needsConfirm = (st === 'pending_online' || st === 'unpaid') && ONLINE_GUARDED_STATUSES.includes(status);
    if (target && needsConfirm) {
      const proceed = window.confirm(
        isRTL
          ? 'لم يكتمل الدفع الإلكتروني لهذا الطلب بعد. هل أنت متأكد من تغيير حالته؟'
          : 'Online payment for this order has not completed. Are you sure you want to advance its status?'
      );
      if (!proceed) return;
    }
    updateOrderStatus(orderId, status);
    if (activeReceiptOrder?.id === orderId) {
      const match = orders.find(o => o.id === orderId);
      if (match) setActiveReceiptOrder({ ...match, status });
    }
  };

  const filteredOrders = orders.filter(o => {
    const q = orderSearch.toLowerCase();
    const matchesSearch = o.orderNumber.toLowerCase().includes(q) ||
                          (o.lazywaitOrderNumber ?? '').toLowerCase().includes(q) ||
                          o.customerName.toLowerCase().includes(q) ||
                          o.customerPhone.includes(orderSearch);
    const matchesFilter = orderFilter === 'all' || o.status === orderFilter;
    return matchesSearch && matchesFilter;
  });

  return (
    <>
            <div className="space-y-4 animate-fade-in">

              {/* Orders Requiring Verification — read-only ambiguous-POS feed */}
              <OrdersRequiringVerificationCard onView={viewById} />

              {/* Filter controls bar */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                {/* "Live Incoming Orders Stream" used to sit here; the shell
                    header already says Live Orders. The count of what the
                    current filter actually shows is the useful thing. */}
                <span className="text-xs font-bold text-slate-600 tabular-nums">
                  {filteredOrders.length}{' '}
                  {isRTL
                    ? (filteredOrders.length === 1 ? 'طلب' : 'طلبات')
                    : (filteredOrders.length === 1 ? 'order' : 'orders')}
                </span>

                {/* Filter chips carry the same localized status labels the
                    cards use. They previously rendered the raw enum, so an
                    operator read "OUT_FOR_DELIVERY" in an Arabic console. */}
                <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl">
                  {(['all', 'received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'] as const).map(st => (
                    <button
                      key={st}
                      onClick={() => setOrderFilter(st)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors ${orderFilter === st ? 'glass-btn-primary text-white' : 'text-slate-600 hover:bg-white'}`}
                    >
                      {st === 'all'
                        ? (isRTL ? 'الكل' : 'All')
                        : (t[`status_${st}` as keyof typeof t] as string | undefined) ?? st.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live search input */}
              <div className="relative">
                <input 
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder={isRTL ? 'ابحث برقم الطلب، اسم العميل، جوال العميل...' : 'Search by order#, client, phone...'}
                  className="glass-input w-full text-xs rounded-xl py-2.5 px-4 outline-none text-slate-800"
                />
              </div>

              {/* Order cards.
                  The design replaces the data table with a card per order. A
                  table forces every order into the same seven columns; during a
                  rush what an operator needs is the ONE thing wrong with this
                  order, which is why each card carries a severity stripe and
                  states its payment problem in words rather than a status cell. */}
              <div className="flex flex-col gap-2.5">
                {filteredOrders.map(order => {
                  const d = orderDisplayNumber(order);
                  const badge = paymentBadge(order);
                  const sync = syncStateOf(order);
                  const paid = order.paymentStatus === 'paid';
                  const blocked = Boolean(order.syncBlockedReason) || sync === 'failed';
                  // Stripe = the order's most urgent fact, read left to right at
                  // a glance: unpaid or blocked first, then anything not yet
                  // through to the POS, then healthy.
                  const stripe = blocked || (!paid && order.paymentMethod === 'online') ? 'bg-red-600'
                    : sync !== 'synced' || !paid ? 'bg-amber-500'
                    : 'bg-green-600';
                  return (
                    <div key={order.id} className="glass-card rounded-xl overflow-hidden">
                      <div className="flex">
                        <div className={`w-1 flex-none ${stripe}`} aria-hidden="true" />
                        <div className="flex-1 min-w-0 p-3.5">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="font-black text-slate-900 text-[13px]">{d.primary}</span>
                              <span className="text-[10px] font-black px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                                {(isRTL ? order.branchNameAr : order.branchNameEn)} · {order.orderType === 'delivery' ? (isRTL ? 'توصيل' : 'Delivery') : (isRTL ? 'استلام' : 'Pickup')}
                              </span>
                              {d.secondary && (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded bg-green-100 text-green-800">{d.secondary}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded ${badge.tone}`}>{badge.text}</span>
                              <span className="text-[11px] text-slate-600 font-bold tabular-nums">
                                {new Date(order.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-600 mt-1.5">
                            <span className="font-bold text-slate-800">{order.customerName}</span>
                            <span className={order.customerPhone && order.customerPhone.trim() ? '' : 'text-amber-700 italic'}>
                              {' · '}{phoneLabel(order.customerPhone)}
                            </span>
                            {' · '}
                            <span className="font-bold text-slate-800"><Price amount={order.total} /></span>
                            {' · '}{methodLabelText(order)}
                          </div>

                          {order.items?.length ? (
                            <div className="text-[11px] text-slate-700 mt-1.5 truncate">
                              {order.items.map(i => `${i.quantity}× ${isRTL ? i.nameAr : i.nameEn}`).join(' · ')}
                            </div>
                          ) : null}

                          {order.syncBlockedReason && (
                            <div className="text-[11px] font-bold text-red-700 mt-1.5">{order.syncBlockedReason}</div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                order.status === 'delivered' ? 'bg-green-100 text-green-800'
                                : order.status === 'cancelled' ? 'bg-red-100 text-red-800'
                                : order.status === 'received' ? 'bg-blue-100 text-blue-800'
                                : 'bg-amber-100 text-amber-800'
                              }`}>
                                {t[`status_${order.status}` as keyof typeof t] ?? order.status}
                              </span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${syncTone(sync)}`}>{syncLabel(sync, isRTL)}</span>
                            </div>
                            <button
                              onClick={() => setActiveReceiptOrder(order)}
                              className="glass-btn-outline text-[11px] py-1.5 px-3 rounded-lg flex items-center gap-1.5"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>{t.view_details}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredOrders.length === 0 && (
                  <div className="glass-card rounded-xl text-center py-12 text-slate-600 font-bold">
                    {t.no_orders}
                  </div>
                )}
              </div>

            </div>

      {activeReceiptOrder && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md overflow-hidden rounded-[2rem] shadow-2xl animate-scale-up" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
            <div className="p-5 bg-white/20 border-b border-white/10 flex justify-between items-center">
              <div>
                <h4 className="text-xs font-black text-gray-600">{isRTL ? 'تعديل حالة الكاشير الموحدة' : 'Live POS Status Controller'}</h4>
                {(() => { const d = orderDisplayNumber(activeReceiptOrder); return (
                  <p className="text-sm font-bold text-primary">
                    {d.primary}{d.secondary && <span className="text-[10px] text-gray-600 font-semibold ml-1">· {d.secondary}</span>}
                  </p>
                ); })()}
              </div>
              <button 
                onClick={() => setActiveReceiptOrder(null)}
                className="w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center font-bold text-gray-500 hover:bg-gray-100 transition-all"
                aria-label={isRTL ? 'إغلاق' : 'Close'}
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[480px] overflow-y-auto text-xs text-gray-700">

              {/* Payment warning — method-aware (collect cash / online not done) */}
              {paymentWarning(activeReceiptOrder) && (
                <div className={`flex items-center gap-2 border rounded-xl p-2.5 text-[11px] font-black ${
                  paymentDisplayState(activeReceiptOrder) === 'cash_required'
                    ? 'bg-blue-50 border-blue-200 text-blue-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {paymentWarning(activeReceiptOrder)}
                </div>
              )}

              {/* Order Status Controller dropdown selector */}
              <div className="bg-purple-50/30 border border-purple-100 p-3 rounded-xl space-y-2">
                <label className="block text-[10px] font-black text-primary">{isRTL ? 'تعديل حالة الطلب الحالية:' : 'SET REALTIME ORDER STATUS:'}</label>
                <div className="flex gap-2">
                  <select 
                    disabled={isAccountant}
                    value={activeReceiptOrder.status}
                    onChange={(e) => handleUpdateStatus(activeReceiptOrder.id, e.target.value as OrderStatus)}
                    className="flex-1 bg-white border border-gray-200 rounded-lg p-2 font-bold outline-none text-xs text-gray-800 disabled:opacity-50"
                  >
                    <option value="received" disabled={!canTransitionOrder(activeReceiptOrder.status, 'received')}>Received</option>
                    <option value="preparing" disabled={!canTransitionOrder(activeReceiptOrder.status, 'preparing')}>Preparing</option>
                    <option value="ready" disabled={!canTransitionOrder(activeReceiptOrder.status, 'ready')}>Ready (POS Buzzer)</option>
                    <option value="out_for_delivery" disabled={!canTransitionOrder(activeReceiptOrder.status, 'out_for_delivery')}>Out for Delivery</option>
                    <option value="delivered" disabled={!canTransitionOrder(activeReceiptOrder.status, 'delivered')}>Delivered</option>
                    <option value="cancelled" disabled={!canTransitionOrder(activeReceiptOrder.status, 'cancelled')}>Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Invoice Breakdown Details */}
              <div className="border border-gray-100 rounded-2xl p-3 space-y-2 bg-gray-50/50">
                <div className="flex justify-between">
                  <span className="text-gray-600">Customer:</span>
                  <span className="font-bold text-gray-800">{activeReceiptOrder.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Phone:</span>
                  <span className={`font-bold ${activeReceiptOrder.customerPhone && activeReceiptOrder.customerPhone.trim() ? 'text-gray-800' : 'text-amber-600 italic'}`}>
                    {phoneLabel(activeReceiptOrder.customerPhone)}
                  </span>
                </div>
                {activeReceiptOrder.address && (
                  <div className="pt-1.5 border-t border-gray-100">
                    <span className="text-gray-600 block text-[10px] mb-0.5">Delivery Short Address:</span>
                    <span className="font-bold text-gray-800 bg-white p-1.5 border border-gray-100 rounded-lg block leading-relaxed">
                      {activeReceiptOrder.address.label} • {activeReceiptOrder.address.description} <br/>
                      <span className="text-primary font-black text-[10px]">{activeReceiptOrder.address.nationalShortAddress}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Items Table inside Dialog */}
              <div className="space-y-2">
                <span className="block text-xs font-bold text-slate-700">Ordered items</span>
                <div className="space-y-1.5">
                  {activeReceiptOrder.items.map(item => (
                    <div key={item.id} className="flex justify-between items-center p-2 bg-white border border-gray-100 rounded-xl">
                      <div>
                        <div className="flex items-center gap-1 font-bold text-gray-900">
                          <span>{item.quantity}x</span>
                          <span>{isRTL ? item.nameAr : item.nameEn}</span>
                        </div>
                        {item.selectedModifiers.length > 0 && (
                          <p className="text-[9.5px] text-gray-600 pl-4 mt-0.5">
                            + {item.selectedModifiers.map(m => isRTL ? m.nameAr : m.nameEn).join(', ')}
                          </p>
                        )}
                      </div>
                      <span className="font-bold text-slate-900 tabular-nums"><Price amount={item.price * item.quantity} /></span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Simple billing table */}
              <div className="pt-2 border-t border-gray-100 space-y-1">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal:</span>
                  <span><Price amount={activeReceiptOrder.subtotal} /></span>
                </div>
                {activeReceiptOrder.deliveryFee > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Delivery Fee:</span>
                    <span><Price amount={activeReceiptOrder.deliveryFee} prefix="+" /></span>
                  </div>
                )}
                {(activeReceiptOrder.discountAmount ?? 0) > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>{isRTL ? 'خصم القسيمة' : 'Coupon Discount'}:</span>
                    <span><Price amount={activeReceiptOrder.discountAmount ?? 0} prefix="−" /></span>
                  </div>
                )}
                {(activeReceiptOrder.loyaltyDiscountAmount ?? 0) > 0 && (
                  <div className="flex justify-between text-purple-600">
                    <span>{isRTL ? 'خصم نقاط الولاء' : 'Loyalty Discount'}:</span>
                    <span><Price amount={activeReceiptOrder.loyaltyDiscountAmount ?? 0} prefix="−" /></span>
                  </div>
                )}
                <div className="flex justify-between font-black text-gray-900 text-sm pt-1 border-t border-gray-50">
                  <span>Grand Total (VAT Inclusive):</span>
                  <span><Price amount={activeReceiptOrder.total} /></span>
                </div>
              </div>

              {/* Mandatory VAT details stamp */}
              <div className="p-2 bg-gray-50 rounded-lg text-[9.5px] text-gray-500 flex justify-between">
                <span>{brandSettings?.vatPercentage || 15}% Saudi VAT component:</span>
                <span className="font-semibold"><Price amount={getVATBreakdown(activeReceiptOrder.total, brandSettings?.vatPercentage || 15).vatAmount} /></span>
              </div>

              {/* Payment — actual chosen method + derived status (method-aware) */}
              <div className="p-2.5 bg-gray-50 rounded-lg text-[9.5px] space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Payment method:</span>
                  <span className="font-semibold text-gray-600">{methodLabelText(activeReceiptOrder)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Payment status:</span>
                  {(() => {
                    const badge = paymentBadge(activeReceiptOrder);
                    return <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase ${badge.tone}`}>{badge.text}</span>;
                  })()}
                </div>
              </div>

              {/* Tap payment details (online orders) — provider/charge/mode/card + admin verify */}
              <TapPaymentDetails order={activeReceiptOrder} isAccountant={isAccountant} isRTL={isRTL} />

              {/* POS (Lazywait) sync status — visibility only; nothing is synced from here */}
              {(() => {
                const state = syncStateOf(activeReceiptOrder);
                const branch = branches.find(b => b.id === activeReceiptOrder.branchId);
                const branchMapped = !!branch?.lazywaitBranchId;
                return (
                  <div className="p-2.5 bg-gray-50 rounded-lg text-[9.5px] space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">POS sync status:</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-black ${syncTone(state)}`}>{state}</span>
                    </div>
                    {activeReceiptOrder.syncBlockedReason && (
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Reason:</span>
                        <span className="font-semibold text-red-700">{activeReceiptOrder.syncBlockedReason}</span>
                      </div>
                    )}
                    {activeReceiptOrder.syncBlockedReason === 'delivery_schema_unconfirmed' && (
                      <div className="flex items-start gap-1.5 text-amber-700 font-bold pt-1.5 border-t border-gray-100">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span>{isRTL
                          ? 'مزامنة طلبات التوصيل مع Lazywait موقوفة بانتظار تأكيد صيغة طلب التوصيل من Lazywait.'
                          : 'Delivery Lazywait sync is blocked pending Lazywait delivery payload confirmation.'}</span>
                      </div>
                    )}
                    {!branchMapped && (
                      <div className="flex items-start gap-1.5 text-amber-700 font-bold pt-1.5 border-t border-gray-100">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span>{isRTL ? 'غير مؤهل لمزامنة Lazywait: الفرع غير مربوط.' : 'Not eligible for Lazywait sync: branch is not mapped.'}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>
          </div>
        </div>
      )}
    </>
  );
};
