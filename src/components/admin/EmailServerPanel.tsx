import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Mail, RefreshCw, Send } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { emailServer, EmailServerStatus } from '../../lib/api';

/**
 * Admin Email/SMTP status + test-send panel. Reads config-presence booleans from
 * the `email-test-config` Edge Function (never the SMTP password) and lets an
 * admin send a test email. Credentials are entered in the Email IntegrationCard
 * above; this panel shows readiness + verifies delivery. Accountant = view-only.
 */
export const EmailServerPanel: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const { adminLang } = useApp();
  const isRTL = adminLang === 'ar';
  const [status, setStatus] = useState<EmailServerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { setStatus(await emailServer.status()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const handleTest = async () => {
    if (!testTo.trim()) return;
    setTesting(true); setTestMsg(null);
    try {
      const res = await emailServer.testSend(testTo.trim());
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
          <Mail className="w-4 h-4 text-blue-600" />
          <div>
            <span className="font-black text-slate-800 text-xs block">{isRTL ? 'خادم البريد (SMTP)' : 'Email Server (SMTP)'}</span>
            <span className="text-[9px] text-slate-600 font-bold">{isRTL ? 'حالة الإعداد واختبار الإرسال — لا تُعرض كلمة المرور' : 'Readiness + test send — password never shown'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${status.enabled ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {status.enabled ? (isRTL ? 'مفعّل' : 'ENABLED') : (isRTL ? 'معطّل' : 'DISABLED')}
            </span>
          )}
          <button onClick={() => void load()} disabled={loading} className="text-slate-600 hover:text-primary disabled:opacity-40" aria-label="Refresh">
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
            <Indicator label={isRTL ? 'الخادم (Host)' : 'SMTP host'} ok={status.host_set} />
            <Indicator label={isRTL ? `المنفذ (${status.port ?? '—'})` : `Port (${status.port ?? '—'})`} ok={Boolean(status.port)} />
            <Indicator label={isRTL ? 'TLS/SSL' : 'TLS/SSL'} ok={status.secure} />
            <Indicator label={isRTL ? 'اسم المستخدم' : 'Username'} ok={status.username_set} />
            <Indicator label={isRTL ? 'بريد المُرسِل' : 'From email'} ok={status.from_email_set} />
            <Indicator label={isRTL ? 'كلمة مرور SMTP' : 'SMTP password'} ok={status.password_set} />
          </div>

          {!disabled && (
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <span className="text-[10px] font-black text-slate-600 uppercase">{isRTL ? 'إرسال بريد تجريبي' : 'Send test email'}</span>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="you@example.com"
                  className="glass-input flex-1 p-2 text-xs font-bold text-slate-800"
                />
                <button
                  onClick={() => void handleTest()}
                  disabled={testing || !testTo.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black px-3 rounded-xl flex items-center gap-1 disabled:opacity-40"
                >
                  <Send className="w-3 h-3" /> {testing ? '…' : (isRTL ? 'إرسال' : 'Send')}
                </button>
              </div>
              {testMsg && (
                <div className={`text-[10px] font-bold flex items-center gap-1 ${testMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                  {testMsg.ok ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />} {testMsg.text}
                </div>
              )}
              <p className="text-[9px] text-slate-600 font-semibold">
                {isRTL
                  ? 'تُرسَل رسالة تجريبية عبر إعدادات SMTP المحفوظة. لا تُعرض كلمة المرور ولا تصل للمتصفح.'
                  : 'Sends a test message through the saved SMTP settings. The password is never shown and never reaches the browser.'}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="py-4 text-center text-slate-600 text-[10px] font-bold animate-pulse">{isRTL ? 'جاري التحميل…' : 'Loading…'}</div>
      )}
    </div>
  );
};
