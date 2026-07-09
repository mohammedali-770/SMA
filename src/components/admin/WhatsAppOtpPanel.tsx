import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, MessageCircle, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { whatsappOtp, WhatsAppOtpStatus } from '../../lib/api';

/**
 * Admin WhatsApp OTP status + test-send panel. Reads config presence booleans
 * from the `whatsapp-test-config` Edge Function (never any secret values) and
 * lets an admin send a test code. Enable/credentials are configured in the
 * WhatsApp IntegrationCard above; this panel shows readiness + tests it.
 */
export const WhatsAppOtpPanel: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const { adminLang } = useApp();
  const isRTL = adminLang === 'ar';
  const [status, setStatus] = useState<WhatsAppOtpStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testLang, setTestLang] = useState<'ar' | 'en'>('en');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { setStatus(await whatsappOtp.status()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const handleTest = async () => {
    if (!testPhone.trim()) return;
    setTesting(true); setTestMsg(null);
    try {
      const res = await whatsappOtp.testSend(testPhone.trim(), testLang);
      setTestMsg({ ok: Boolean(res.ok), text: res.message || (res.ok ? 'Sent.' : 'Failed.') });
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setTesting(false); }
  };

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
          <MessageCircle className="w-4 h-4 text-green-600" />
          <div>
            <span className="font-black text-slate-800 text-xs block">{isRTL ? 'التحقق عبر واتساب (Meta Cloud API)' : 'WhatsApp OTP (Meta Cloud API)'}</span>
            <span className="text-[9px] text-slate-400 font-bold">{isRTL ? 'حالة الإعداد واختبار الإرسال — لا تُعرض الأسرار' : 'Readiness + test send — no secret values shown'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${status.enabled ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {status.enabled ? (isRTL ? 'مفعّل' : 'ENABLED') : (isRTL ? 'معطّل' : 'DISABLED')}
            </span>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            <Indicator label={isRTL ? 'مُعرّف رقم الهاتف' : 'Phone Number ID'} ok={status.phone_number_id_set} />
            <Indicator label={isRTL ? 'رمز الوصول' : 'Access token'} ok={status.access_token_set} />
            <Indicator label={isRTL ? 'قالب إنجليزي' : 'Template (EN)'} ok={status.template_en_set} />
            <Indicator label={isRTL ? 'قالب عربي' : 'Template (AR)'} ok={status.template_ar_set} />
            <Indicator label={isRTL ? 'رمز تحقق الويبهوك' : 'Webhook verify token'} ok={status.webhook_verify_token_set} />
            <Indicator label={isRTL ? 'سر التطبيق (توقيع الويبهوك)' : 'App secret (webhook sig)'} ok={status.app_secret_set} />
            <Indicator label={isRTL ? 'مفتاح تجزئة الرمز' : 'OTP hashing secret'} ok={status.pepper_set} />
            <Indicator label={isRTL ? `إصدار Graph (${status.graph_api_version ?? '—'})` : `Graph version (${status.graph_api_version ?? '—'})`} ok={Boolean(status.graph_api_version)} />
          </div>

          {/* Customer LOGIN (Send SMS Hook) readiness — distinct from verification. */}
          <div className="pt-2 border-t border-slate-100 space-y-1.5">
            <span className="text-[10px] font-black text-slate-500 uppercase">{isRTL ? 'تسجيل الدخول عبر واتساب' : 'WhatsApp customer login'}</span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              <Indicator label={isRTL ? 'تسجيل الدخول مُفعّل' : 'Login enabled'} ok={Boolean(status.login_enabled)} />
              <Indicator label={isRTL ? 'سر Send SMS Hook' : 'Send SMS Hook secret'} ok={Boolean(status.send_sms_hook_secret_set)} />
            </div>
            <p className="text-[9px] text-slate-400 font-semibold">
              {isRTL
                ? 'يتطلب تسجيل الدخول: تفعيل المزود + تفعيل تسجيل الدخول + سر الـHook + بيانات Meta + قالب معتمد، مع تفعيل مصادقة الهاتف في لوحة Supabase.'
                : 'Login requires: provider enabled + login enabled + hook secret + Meta creds + an approved template, plus Phone Auth turned on in the Supabase dashboard.'}
            </p>
          </div>

          {!disabled && (
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <span className="text-[10px] font-black text-slate-500 uppercase">{isRTL ? 'إرسال رمز تجريبي' : 'Send test OTP'}</span>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+9665XXXXXXXX"
                  className="glass-input flex-1 p-2 text-xs font-bold text-slate-800"
                />
                <select value={testLang} onChange={(e) => setTestLang(e.target.value as 'ar' | 'en')} className="glass-input p-2 text-xs font-bold text-slate-800">
                  <option value="en">EN</option>
                  <option value="ar">AR</option>
                </select>
                <button
                  onClick={() => void handleTest()}
                  disabled={testing || !testPhone.trim()}
                  className="bg-green-600 hover:bg-green-700 text-white text-[11px] font-black px-3 rounded-xl flex items-center gap-1 disabled:opacity-40"
                >
                  <Send className="w-3 h-3" /> {testing ? (isRTL ? '…' : '…') : (isRTL ? 'إرسال' : 'Send')}
                </button>
              </div>
              {testMsg && (
                <div className={`text-[10px] font-bold flex items-center gap-1 ${testMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                  {testMsg.ok ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />} {testMsg.text}
                </div>
              )}
              <p className="text-[9px] text-slate-400 font-semibold">
                {isRTL
                  ? 'يُرسَل الرمز عبر واتساب فقط؛ لا يُعرض الرمز هنا. لا تُخزَّن الأسرار في المتصفح.'
                  : 'The code is sent over WhatsApp only and never shown here. Secrets never reach the browser.'}
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
