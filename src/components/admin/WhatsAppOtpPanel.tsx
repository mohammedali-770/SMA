import React, { useEffect, useState } from 'react';
import { MessageCircle, RefreshCw, Send } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Card } from '../../design-system/ui/Card';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { useDsFontClass } from '../../design-system/ui/useDsLang';
import { whatsappOtp, WhatsAppOtpStatus } from '../../lib/api';

/**
 * Admin WhatsApp OTP status + test-send panel. Reads config presence booleans
 * from the `whatsapp-test-config` Edge Function (never any secret values) and
 * lets an admin send a test code. Enable/credentials are configured in the
 * WhatsApp IntegrationCard above; this panel shows readiness + tests it.
 *
 * The login block stays SEPARATE from the verification block on purpose: they
 * share credentials but not prerequisites, and an admin who sees "enabled" on
 * one and assumes the other is live has a broken sign-in they cannot explain.
 */
export const WhatsAppOtpPanel: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const { adminLang } = useApp();
  const isRTL = adminLang === 'ar';
  const family = useDsFontClass();
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
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-2.5 py-1.5">
      <Text variant="caption" tone="secondary" as="span">{label}</Text>
      <StatusPill
        label={ok ? (isRTL ? 'مُهيّأ' : 'Yes') : (isRTL ? 'غير مُهيّأ' : 'No')}
        tone={ok ? 'success' : 'neutral'}
      />
    </div>
  );

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircle className="size-4 shrink-0 text-mint" aria-hidden="true" />
          <div className="min-w-0">
            <Text variant="label" as="p">
              {isRTL ? 'التحقق عبر واتساب (Meta Cloud API)' : 'WhatsApp OTP (Meta Cloud API)'}
            </Text>
            <Text variant="caption" tone="tertiary" as="p">
              {isRTL ? 'حالة الإعداد واختبار الإرسال — لا تُعرض الأسرار' : 'Readiness + test send — no secret values shown'}
            </Text>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status && (
            <StatusPill
              label={status.enabled ? (isRTL ? 'مفعّل' : 'ENABLED') : (isRTL ? 'معطّل' : 'DISABLED')}
              tone={status.enabled ? 'success' : 'warning'}
            />
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label={isRTL ? 'تحديث' : 'Refresh'}
            className="ds-motion inline-flex size-8 items-center justify-center rounded-[var(--radius-ds-sm)] transition-colors duration-150 hover:bg-con-surface-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <RefreshCw className={`size-3.5 text-con-text-2 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? (
        <Notice title={error} tone="blocking" />
      ) : status ? (
        <>
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            <Indicator label={isRTL ? 'مُعرّف رقم الهاتف' : 'Phone Number ID'} ok={status.phone_number_id_set} />
            <Indicator label={isRTL ? 'رمز الوصول' : 'Access token'} ok={status.access_token_set} />
            <Indicator label={isRTL ? 'قالب إنجليزي' : 'Template (EN)'} ok={status.template_en_set} />
            <Indicator label={isRTL ? 'قالب عربي' : 'Template (AR)'} ok={status.template_ar_set} />
            <Indicator label={isRTL ? 'رمز تحقق الويبهوك' : 'Webhook verify token'} ok={status.webhook_verify_token_set} />
            <Indicator label={isRTL ? 'سر التطبيق (توقيع الويبهوك)' : 'App secret (webhook sig)'} ok={status.app_secret_set} />
            <Indicator label={isRTL ? 'مفتاح تجزئة الرمز' : 'OTP hashing secret'} ok={status.pepper_set} />
            <Indicator
              label={isRTL ? `إصدار Graph (${status.graph_api_version ?? '—'})` : `Graph version (${status.graph_api_version ?? '—'})`}
              ok={Boolean(status.graph_api_version)}
            />
          </div>

          {/* Customer LOGIN (Send SMS Hook) readiness — distinct from verification. */}
          <div className="space-y-1.5 border-t border-con-line pt-3">
            <Text variant="caption" tone="secondary" as="p">
              {isRTL ? 'تسجيل الدخول عبر واتساب' : 'WhatsApp customer login'}
            </Text>
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              <Indicator label={isRTL ? 'تسجيل الدخول مُفعّل' : 'Login enabled'} ok={Boolean(status.login_enabled)} />
              <Indicator label={isRTL ? 'سر Send SMS Hook' : 'Send SMS Hook secret'} ok={Boolean(status.send_sms_hook_secret_set)} />
            </div>
            <Text variant="caption" tone="tertiary" as="p">
              {isRTL
                ? 'يتطلب تسجيل الدخول: تفعيل المزود + تفعيل تسجيل الدخول + سر الـHook + بيانات Meta + قالب معتمد، مع تفعيل مصادقة الهاتف في لوحة Supabase.'
                : 'Login requires: provider enabled + login enabled + hook secret + Meta creds + an approved template, plus Phone Auth turned on in the Supabase dashboard.'}
            </Text>
          </div>

          {!disabled && (
            <div className="space-y-2 border-t border-con-line pt-3">
              <Text variant="caption" tone="secondary" as="p">
                {isRTL ? 'إرسال رمز تجريبي' : 'Send test OTP'}
              </Text>
              <div className="flex items-end gap-2">
                <Field
                  label={isRTL ? 'رقم الجوال' : 'Phone'}
                  type="tel"
                  numeric
                  value={testPhone}
                  onValueChange={setTestPhone}
                  placeholder="+9665XXXXXXXX"
                  className="flex-1"
                />
                <label className="flex shrink-0 flex-col gap-2">
                  <span className="text-start text-[13px] font-semibold text-con-text-2">
                    {isRTL ? 'اللغة' : 'Lang'}
                  </span>
                  <select
                    value={testLang}
                    onChange={(e) => setTestLang(e.target.value as 'ar' | 'en')}
                    aria-label={isRTL ? 'لغة الرمز' : 'OTP language'}
                    className={`ds-motion min-h-11 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 ${family}`}
                  >
                    <option value="en">EN</option>
                    <option value="ar">AR</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void handleTest()}
                  disabled={testing || !testPhone.trim()}
                  className="ds-motion inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[var(--radius-ds-md)] bg-ember px-3 transition-opacity duration-150 hover:opacity-90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <Send className="size-3 text-on-ember" aria-hidden="true" />
                  <Text variant="label" tone="onEmber" as="span">
                    {testing ? '…' : (isRTL ? 'إرسال' : 'Send')}
                  </Text>
                </button>
              </div>
              {testMsg && <Notice title={testMsg.text} tone={testMsg.ok ? 'success' : 'blocking'} />}
              <Text variant="caption" tone="tertiary" as="p">
                {isRTL
                  ? 'يُرسَل الرمز عبر واتساب فقط؛ لا يُعرض الرمز هنا. لا تُخزَّن الأسرار في المتصفح.'
                  : 'The code is sent over WhatsApp only and never shown here. Secrets never reach the browser.'}
              </Text>
            </div>
          )}
        </>
      ) : (
        <Text variant="caption" tone="tertiary" as="p" className="py-4 text-center">
          {isRTL ? 'جاري التحميل…' : 'Loading…'}
        </Text>
      )}
    </Card>
  );
};
