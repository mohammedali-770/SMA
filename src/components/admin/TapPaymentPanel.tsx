import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, CreditCard, RefreshCw, Plug } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { paymentGateway, PaymentGatewayStatus } from '../../lib/api';

/**
 * Admin Tap Payments readiness + connection test. Reads config-presence booleans
 * from the `payment-test-config` Edge Function (never any secret key) and lets an
 * admin validate the selected-mode key against Tap WITHOUT creating a charge.
 * Keys are entered in the Tap IntegrationCard above. Accountant = view-only.
 */
export const TapPaymentPanel: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const { adminLang } = useApp();
  const isRTL = adminLang === 'ar';
  const [status, setStatus] = useState<PaymentGatewayStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { setStatus(await paymentGateway.status()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const handleTest = async () => {
    setTesting(true); setTestMsg(null);
    try {
      const res = await paymentGateway.testConnection();
      setTestMsg({ ok: Boolean(res.ok), text: res.message || (res.ok ? 'OK' : 'Failed') });
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setTesting(false); }
  };

  const isTap = (status?.provider ?? '') === 'tap';
  const isLive = status?.mode === 'live';

  const Indicator: React.FC<{ label: string; ok: boolean }> = ({ label, ok }) => (
    <div className="flex items-center justify-between bg-white/70 border border-slate-100 rounded-lg px-2.5 py-1.5">
      <span className="text-[10px] font-bold text-slate-600">{label}</span>
      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${ok ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
        {ok ? (isRTL ? 'مُهيّأ' : 'Yes') : (isRTL ? 'غير مُهيّأ' : 'No')}
      </span>
    </div>
  );

  return (
    <div className="bg-white/50 border border-slate-200/60 rounded-2xl p-3.5 space-y-3">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-primary" />
          <div>
            <span className="font-black text-slate-800 text-xs block">{isRTL ? 'مدفوعات Tap' : 'Tap Payments'}</span>
            <span className="text-[9px] text-slate-400 font-bold">{isRTL ? 'الجاهزية واختبار الاتصال — لا يُعرض المفتاح السري' : 'Readiness + connection test — secret key never shown'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <>
              <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${isLive ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                {isLive ? (isRTL ? 'مباشر' : 'LIVE') : (isRTL ? 'تجريبي' : 'TEST')}
              </span>
              <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${status.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {status.enabled ? (isRTL ? 'مفعّل' : 'ENABLED') : (isRTL ? 'معطّل' : 'DISABLED')}
              </span>
            </>
          )}
          <button onClick={() => void load()} disabled={loading} className="text-slate-400 hover:text-primary disabled:opacity-40" aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="p-2.5 bg-red-50 border border-red-100 rounded-xl text-red-800 text-[10px] font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" /> {error}
        </div>
      ) : status ? (
        <>
          {!isTap && (
            <div className="p-2 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 text-[10px] font-bold">
              {isRTL ? "اضبط مزوّد الدفع على 'tap' في البطاقة أعلاه." : "Set the payment provider to 'tap' in the card above."}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            <Indicator label={isRTL ? 'معرّف التاجر' : 'Merchant ID'} ok={status.merchant_id_set} />
            <Indicator label={isRTL ? `مفتاح الوضع (${status.mode})` : `Key for mode (${status.mode})`} ok={status.active_key_set} />
            <Indicator label={isRTL ? 'مفتاح تجريبي' : 'Test key'} ok={status.test_key_set} />
            <Indicator label={isRTL ? 'مفتاح مباشر' : 'Live key'} ok={status.live_key_set} />
          </div>
          <div className="flex items-center gap-3 text-[10px] text-slate-500 font-bold px-1">
            <span>{isRTL ? 'العملة' : 'Currency'}: <b className="text-slate-700">{status.currency}</b></span>
            <span>Source: <b className="text-slate-700">{status.source_id}</b></span>
            <span>{isRTL ? 'انتهاء' : 'Expiry'}: <b className="text-slate-700">{status.expiry_minutes}m</b></span>
          </div>

          {!disabled && (
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black text-slate-500 uppercase">{isRTL ? 'اختبار الاتصال' : 'Test connection'}</span>
                <button
                  onClick={() => void handleTest()}
                  disabled={testing || !status.active_key_set}
                  className="bg-primary hover:opacity-90 text-white text-[11px] font-black px-3 py-1.5 rounded-xl flex items-center gap-1 disabled:opacity-40"
                >
                  <Plug className="w-3 h-3" /> {testing ? '…' : (isRTL ? 'اختبار' : 'Test')}
                </button>
              </div>
              {testMsg && (
                <div className={`text-[10px] font-bold flex items-center gap-1 ${testMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                  {testMsg.ok ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />} {testMsg.text}
                </div>
              )}
              <p className="text-[9px] text-slate-400 font-semibold">
                {isRTL
                  ? 'يتحقق من المفتاح السري للوضع المحدد لدى Tap دون إنشاء أي عملية دفع.'
                  : 'Validates the selected-mode secret key against Tap without creating any charge.'}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="py-4 text-center text-slate-400 text-[10px] font-bold animate-pulse">{isRTL ? 'جاري التحميل…' : 'Loading…'}</div>
      )}
    </div>
  );
};
