import React, { useEffect, useState } from 'react';
import { Mail, RefreshCw, Send } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Card } from '../../design-system/ui/Card';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { emailServer, EmailServerStatus } from '../../lib/api';

/**
 * Admin Email/SMTP status + test-send panel. Reads config-presence booleans from
 * the `email-test-config` Edge Function (never the SMTP password) and lets an
 * admin send a test email. Credentials are entered in the Email IntegrationCard
 * above; this panel shows readiness + verifies delivery. Accountant = view-only.
 *
 * The readiness grid shows PRESENCE, not values — `host_set`, `password_set` and
 * friends are booleans the function returns precisely so the browser never has
 * to hold a credential in order to report whether one exists.
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
          <Mail className="size-4 shrink-0 text-sky" aria-hidden="true" />
          <div className="min-w-0">
            <Text variant="label" as="p">{isRTL ? 'خادم البريد (SMTP)' : 'Email Server (SMTP)'}</Text>
            <Text variant="caption" tone="tertiary" as="p">
              {isRTL ? 'حالة الإعداد واختبار الإرسال — لا تُعرض كلمة المرور' : 'Readiness + test send — password never shown'}
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
            <Indicator label={isRTL ? 'الخادم (Host)' : 'SMTP host'} ok={status.host_set} />
            <Indicator label={isRTL ? `المنفذ (${status.port ?? '—'})` : `Port (${status.port ?? '—'})`} ok={Boolean(status.port)} />
            <Indicator label={isRTL ? 'TLS/SSL' : 'TLS/SSL'} ok={status.secure} />
            <Indicator label={isRTL ? 'اسم المستخدم' : 'Username'} ok={status.username_set} />
            <Indicator label={isRTL ? 'بريد المُرسِل' : 'From email'} ok={status.from_email_set} />
            <Indicator label={isRTL ? 'كلمة مرور SMTP' : 'SMTP password'} ok={status.password_set} />
          </div>

          {!disabled && (
            <div className="space-y-2 border-t border-con-line pt-3">
              <Text variant="caption" tone="secondary" as="p">
                {isRTL ? 'إرسال بريد تجريبي' : 'Send test email'}
              </Text>
              <div className="flex items-end gap-2">
                <Field
                  label={isRTL ? 'إلى' : 'To'}
                  type="email"
                  numeric
                  value={testTo}
                  onValueChange={setTestTo}
                  placeholder="you@example.com"
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => void handleTest()}
                  disabled={testing || !testTo.trim()}
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
                  ? 'تُرسَل رسالة تجريبية عبر إعدادات SMTP المحفوظة. لا تُعرض كلمة المرور ولا تصل للمتصفح.'
                  : 'Sends a test message through the saved SMTP settings. The password is never shown and never reaches the browser.'}
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
