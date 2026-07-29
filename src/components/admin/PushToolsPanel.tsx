import React, { useEffect, useState } from 'react';
import { AlertCircle, Bell, Check, Megaphone, Send } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { pushAdmin, type PushSendResult } from '../../lib/api';

/**
 * Admin push tools (below the push credentials card):
 *  - device / promo-opt-in counts (admin-only RLS reads),
 *  - "Send test" → the calling admin's OWN devices,
 *  - immediate promotional broadcast (EN+AR title/body) to OPTED-IN devices
 *    only, with delivery result counts.
 * Everything is server-enforced by push-dispatch (admin JWT re-verified,
 * master flag gated); accountants see a read-only card.
 * No scheduling, segmentation, analytics, topics, or custom sounds.
 */
export const PushToolsPanel: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const { adminLang } = useApp();
  const isRTL = adminLang === 'ar';

  const [counts, setCounts] = useState<{ activeDevices: number; promoOptIns: number } | null>(null);
  const [busy, setBusy] = useState<'test' | 'broadcast' | null>(null);
  const [result, setResult] = useState<PushSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' });
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);

  useEffect(() => {
    void pushAdmin.deviceCounts().then(setCounts).catch(() => setCounts(null));
  }, []);

  const runTest = () => {
    setBusy('test'); setError(null); setResult(null);
    void pushAdmin.test()
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  const runBroadcast = () => {
    setConfirmBroadcast(false);
    setBusy('broadcast'); setError(null); setResult(null);
    void pushAdmin.broadcast(form)
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  const formComplete = Boolean(form.titleEn.trim() && form.titleAr.trim() && form.bodyEn.trim() && form.bodyAr.trim());

  return (
    <div className="glass-card p-4 rounded-2xl bg-white/40 space-y-3 text-xs" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <div>
            <span className="font-black text-slate-800 uppercase block">{isRTL ? 'أدوات الإشعارات' : 'Push tools'}</span>
            <span className="text-[9.5px] text-slate-600 font-bold">
              {isRTL
                ? 'إشعار تجريبي وبثّ ترويجي فوري للمشتركين فقط. يتطلب تفعيل التكامل أعلاه.'
                : 'Test notification + immediate promo broadcast to opted-in devices only. Requires the integration above to be enabled.'}
            </span>
          </div>
        </div>
        {counts ? (
          <div className="text-[9px] font-black text-slate-600 text-end">
            <div>{isRTL ? `الأجهزة النشطة: ${counts.activeDevices}` : `Active devices: ${counts.activeDevices}`}</div>
            <div>{isRTL ? `مشتركو العروض: ${counts.promoOptIns}` : `Promo opt-ins: ${counts.promoOptIns}`}</div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={runTest}
          disabled={disabled || busy !== null}
          className="bg-primary/10 text-primary border border-primary/20 font-black px-3 py-1.5 rounded-xl flex items-center gap-1.5 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" /> {busy === 'test' ? (isRTL ? 'جارٍ الإرسال…' : 'Sending…') : (isRTL ? 'إرسال إشعار تجريبي' : 'Send test notification')}
        </button>
        <span className="text-[9px] text-slate-600 font-bold">
          {isRTL ? 'يُرسل إلى أجهزتك المسجّلة بنفس حساب المشرف.' : 'Goes to YOUR devices registered with this admin account.'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input value={form.titleEn} onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))} disabled={disabled}
          placeholder={isRTL ? 'العنوان (إنجليزي)' : 'Title (English)'} className="border border-slate-200 rounded-lg px-2 py-1.5 font-bold" />
        <input dir="rtl" value={form.titleAr} onChange={(e) => setForm((f) => ({ ...f, titleAr: e.target.value }))} disabled={disabled}
          placeholder={isRTL ? 'العنوان (عربي)' : 'Title (Arabic)'} className="border border-slate-200 rounded-lg px-2 py-1.5 font-bold" />
        <input value={form.bodyEn} onChange={(e) => setForm((f) => ({ ...f, bodyEn: e.target.value }))} disabled={disabled}
          placeholder={isRTL ? 'النص (إنجليزي)' : 'Body (English)'} className="border border-slate-200 rounded-lg px-2 py-1.5 font-bold" />
        <input dir="rtl" value={form.bodyAr} onChange={(e) => setForm((f) => ({ ...f, bodyAr: e.target.value }))} disabled={disabled}
          placeholder={isRTL ? 'النص (عربي)' : 'Body (Arabic)'} className="border border-slate-200 rounded-lg px-2 py-1.5 font-bold" />
      </div>

      {!confirmBroadcast ? (
        <button
          onClick={() => setConfirmBroadcast(true)}
          disabled={disabled || busy !== null || !formComplete}
          className="bg-secondary/10 text-secondary border border-secondary/20 font-black px-3 py-1.5 rounded-xl flex items-center gap-1.5 disabled:opacity-50"
        >
          <Megaphone className="w-3.5 h-3.5" /> {isRTL ? 'بثّ ترويجي فوري…' : 'Broadcast promotion…'}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-600">
            {isRTL ? `إرسال الآن إلى ${counts?.promoOptIns ?? '؟'} جهاز مشترك؟` : `Send now to ${counts?.promoOptIns ?? '?'} opted-in device(s)?`}
          </span>
          <button onClick={runBroadcast} disabled={busy !== null}
            className="bg-secondary text-white font-black px-3 py-1.5 rounded-xl disabled:opacity-50">
            {busy === 'broadcast' ? (isRTL ? 'جارٍ البث…' : 'Broadcasting…') : (isRTL ? 'تأكيد الإرسال' : 'Confirm send')}
          </button>
          <button onClick={() => setConfirmBroadcast(false)} className="text-slate-600 font-black px-2 py-1.5">
            {isRTL ? 'إلغاء' : 'Cancel'}
          </button>
        </div>
      )}

      {result ? (
        <p className="text-[10px] font-black flex items-center gap-1.5 text-slate-700">
          <Check className="w-3.5 h-3.5 text-green-700" />
          {result.status === 'ok'
            ? (isRTL
              ? `النتيجة: مستهدف ${result.targeted ?? 0} · أُرسل ${result.sent ?? 0} · فشل ${result.failed ?? 0} · عُطّل ${result.deactivated ?? 0}`
              : `Result: targeted ${result.targeted ?? 0} · sent ${result.sent ?? 0} · failed ${result.failed ?? 0} · deactivated ${result.deactivated ?? 0}`)
            : `${result.status}${result.hint ? ` — ${result.hint}` : ''}${result.reason ? ` — ${result.reason}` : ''}`}
        </p>
      ) : null}
      {error ? (
        <p className="text-[10px] font-black text-red-700 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      ) : null}
    </div>
  );
};
