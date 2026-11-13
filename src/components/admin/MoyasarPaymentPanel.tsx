import React, { useEffect, useState } from 'react';
import { CreditCard, Plug, RefreshCw } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice, type NoticeTone } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { paymentGateway, PaymentGatewayStatus } from '../../lib/api';
import {
  canRunMoyasarAdminTestCheckout, formatMoyasarMinorAmount, isMoyasarShapedStatus, moyasarBlockingReason,
} from '../../lib/moyasarAdminTest';
import { webhookVerificationNotice, type WebhookVerificationNotice } from '../../lib/moyasarWebhookVerification';
import { formatRiyadhTimeSeconds } from '../../utils/calculations';

/**
 * Admin Moyasar readiness + connection test. Reads config-presence booleans from
 * the `payment-test-config` Edge Function (never any secret key) and lets an
 * admin validate the selected-mode key against Moyasar WITHOUT creating a
 * payment. Keys are entered in the payment IntegrationCard above. Accountant =
 * view-only.
 *
 * LIVE is DANGER, TEST is WARNING. Reading a live gateway as a sandbox is the
 * mistake that charges real cards, so it gets the louder tone — and the sandbox
 * checkout below is gated by `canRunMoyasarAdminTestCheckout`, which refuses to
 * run in live mode at all.
 *
 * TWO READINESS ITEMS WORTH THEIR OWN ROWS.
 *  - "Key prefix". Moyasar keys are self-describing (`sk_test_` /
 *    `sk_live_`), so a live key filed under TEST is detectable rather than
 *    something you discover from a customer's statement.
 *  - "Webhook secret". Moyasar signs nothing; the token echoed in the webhook
 *    body is the only authentication a notification carries. Without it the
 *    server refuses to act on webhooks at all, which shows up as orders that
 *    are paid at Moyasar but never confirm here — so it is surfaced as a
 *    first-class readiness item, not a footnote.
 *
 * A SERVER THAT PREDATES MOYASAR. The console deploys on merge; the payment
 * functions only on a separate deploy. Until then payment-test-config can be a
 * bundle written before any Moyasar code, whose status describes another
 * gateway's keys (`isMoyasarShapedStatus`). The panel then says to deploy, hides
 * those readings and disables the connection test, which would not test Moyasar.
 *
 * THE WEBHOOK VERIFICATION CODE. Moyasar may send a one-time six-digit code when
 * a webhook is registered, to be entered in its dashboard within 30 minutes;
 * until it is, Moyasar delivers no events to that webhook. payment-webhook
 * records it, and the panel shows it for exactly that window.
 */
export const MoyasarPaymentPanel: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const { adminLang } = useApp();
  const isRTL = adminLang === 'ar';
  const [status, setStatus] = useState<PaymentGatewayStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Isolated admin TEST checkout (1 SAR sandbox invoice; no order created).
  const [coRunning, setCoRunning] = useState(false);
  const [coInvoiceId, setCoInvoiceId] = useState<string | null>(null);
  const [coChecking, setCoChecking] = useState(false);
  const [coMsg, setCoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Sanitized Moyasar rejection detail (type + message only — never secret/auth).
  const [coErr, setCoErr] = useState<{ code?: string | null; description?: string | null; httpStatus?: number } | null>(null);
  const [coResult, setCoResult] = useState<{ invoiceId?: string; status?: string; amount?: number; currency?: string; mode?: string } | null>(null);
  const [verification, setVerification] = useState<WebhookVerificationNotice | null>(null);

  const loadVerification = async () => {
    // A failed read shows nothing: the code is a convenience, and an error here
    // must not crowd out the readiness below.
    try { setVerification(webhookVerificationNotice(await paymentGateway.latestWebhookVerification(), Date.now())); }
    catch { setVerification(null); }
  };
  const load = async () => {
    setLoading(true); setError(null);
    void loadVerification();
    try { setStatus(await paymentGateway.status()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  // Moyasar refuses the code once its window closes, so it goes away then.
  useEffect(() => {
    if (!verification) return undefined;
    const timer = window.setTimeout(() => setVerification(null), Math.max(0, verification.expiresAtMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [verification]);

  const handleTest = async () => {
    setTesting(true); setTestMsg(null);
    try {
      const res = await paymentGateway.testConnection();
      setTestMsg({ ok: Boolean(res.ok), text: res.message || (res.ok ? 'OK' : 'Failed') });
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setTesting(false); }
  };

  const isLive = status?.mode === 'live';
  // False against a payment-test-config deployed before Moyasar: its readings
  // describe another gateway's keys, so none of them is shown.
  const shaped = isMoyasarShapedStatus(status);
  const canRunTest = canRunMoyasarAdminTestCheckout(status, disabled);
  const blocking = moyasarBlockingReason(status);
  const keyPrefix = isLive ? 'sk_live_' : 'sk_test_';
  // The console's clock (Riyadh, Latin digits, 24-hour) in both languages, like
  // every other console time (adminTime.test.ts).
  const clock = (ms: number) => formatRiyadhTimeSeconds(ms);

  const blockingNotice = (): { title: string; action?: string; tone: NoticeTone } | null => {
    switch (blocking) {
      case 'not_moyasar':
        return {
          tone: 'warning',
          title: isRTL
            ? "مزوّد الدفع المحفوظ ليس 'moyasar'. احفظ بطاقة الدفع أعلاه لتخزينه."
            : "The stored payment provider is not 'moyasar'. Save the payment card above to store it.",
        };
      case 'server_predates_moyasar':
        return {
          tone: 'blocking',
          title: isRTL ? 'انشر دوال الدفع الخاصة بـ Moyasar أولاً.' : 'Deploy the Moyasar payment functions first.',
          action: isRTL
            ? 'دالة payment-test-config على الخادم أقدم من Moyasar. قراءاتها تخص بوابة الدفع السابقة فلا تُعرض هنا، واختبار الاتصال فيها لا يختبر Moyasar.'
            : 'The payment-test-config function on the server predates Moyasar. Its readings describe the previous gateway, so they are not shown here, and its connection test does not test Moyasar.',
        };
      case 'disabled':
        return { tone: 'warning', title: isRTL ? 'المزوّد غير مفعّل — لن يُعرض الدفع الإلكتروني على العملاء.' : 'The provider is disabled — online payment is not offered to customers.' };
      case 'no_key':
        return { tone: 'warning', title: isRTL ? `لم يُضبط المفتاح السري لوضع ${status?.mode ?? 'test'}.` : `No secret key is configured for ${status?.mode ?? 'test'} mode.` };
      case 'key_prefix':
        return {
          tone: 'blocking',
          title: isRTL
            ? 'المفتاح المحفوظ لا يطابق بادئة الوضع (sk_test_ / sk_live_). صحّح الحقل قبل الاستخدام.'
            : 'The stored key does not carry the prefix for its mode (sk_test_ / sk_live_). Fix the slot before using it.',
        };
      case 'no_webhook_secret':
        return {
          tone: 'blocking',
          title: isRTL
            ? 'لم يُضبط رمز الويب هوك السري. لا يمكن التحقّق من إشعارات Moyasar، ولن تُؤكَّد الطلبات المدفوعة تلقائياً.'
            : 'No webhook secret token is set. Moyasar notifications cannot be authenticated, so paid orders will not confirm automatically.',
        };
      case 'server_not_ready': {
        // A reason this console does not know yet: say what the server said
        // rather than calling the gateway ready.
        const reason = status?.config_reason ? ` (${status.config_reason})` : '';
        return {
          tone: 'warning',
          title: isRTL ? `يفيد الخادم بأن Moyasar غير جاهز${reason}.` : `The server reports Moyasar is not ready${reason}.`,
        };
      }
      default:
        return null;
    }
  };
  const notice = blockingNotice();

  const runTestCheckout = async () => {
    setCoRunning(true); setCoMsg(null); setCoResult(null); setCoErr(null);
    try {
      const res = await paymentGateway.testCheckout();
      if (res.ok && res.checkoutUrl) {
        setCoInvoiceId(res.invoiceId ?? res.chargeId ?? null);
        window.open(res.checkoutUrl, '_blank', 'noopener,noreferrer');
        setCoMsg({ ok: true, text: isRTL ? 'فُتحت صفحة الدفع في نافذة جديدة. أكمل الدفع ثم عُد وتحقق من النتيجة.' : 'Opened the sandbox checkout in a new tab. Complete it, then return and check the result.' });
      } else {
        setCoMsg({ ok: false, text: res.message || (isRTL ? 'تعذّر بدء التجربة.' : 'Could not start the test.') });
        if (res.providerErrorCode || res.providerErrorDescription) {
          setCoErr({ code: res.providerErrorCode, description: res.providerErrorDescription, httpStatus: res.httpStatus });
        }
      }
    } catch (e) {
      setCoMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setCoRunning(false); }
  };

  const checkTestResult = async () => {
    if (!coInvoiceId) return;
    setCoChecking(true); setCoMsg(null);
    try {
      const res = await paymentGateway.testCheckoutResult(coInvoiceId);
      if (res.ok) setCoResult({ invoiceId: res.invoiceId ?? res.chargeId, status: res.status, amount: res.amount, currency: res.currency, mode: res.mode });
      else setCoMsg({ ok: false, text: res.message || (isRTL ? 'تعذّر التحقق.' : 'Could not verify.') });
    } catch (e) {
      setCoMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setCoChecking(false); }
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
          <CreditCard className="size-4 shrink-0 text-ember" aria-hidden="true" />
          <div className="min-w-0">
            <Text variant="label" as="p">{isRTL ? 'مدفوعات Moyasar' : 'Moyasar Payments'}</Text>
            <Text variant="caption" tone="tertiary" as="p">
              {isRTL ? 'الجاهزية واختبار الاتصال — لا يُعرض المفتاح السري' : 'Readiness + connection test — secret key never shown'}
            </Text>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status && (
            <>
              <StatusPill
                label={isLive ? (isRTL ? 'مباشر' : 'LIVE') : (isRTL ? 'تجريبي' : 'TEST')}
                tone={isLive ? 'danger' : 'warning'}
              />
              <StatusPill
                label={status.enabled ? (isRTL ? 'مفعّل' : 'ENABLED') : (isRTL ? 'معطّل' : 'DISABLED')}
                tone={status.enabled ? 'success' : 'neutral'}
              />
            </>
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

      {verification && (
        <Notice
          tone="warning"
          title={isRTL ? `رمز التحقق من الويب هوك: ${verification.code}` : `Webhook verification code: ${verification.code}`}
          action={isRTL
            ? `أرسله Moyasar الساعة ${clock(Date.parse(verification.receivedAt))}. أدخله في Moyasar ← الإعدادات ← Webhooks خلال 30 دقيقة من وصوله، أي قبل ${clock(verification.expiresAtMs)}. لا يرسل Moyasar أي أحداث إلى الويب هوك قبل إدخاله.`
            : `Moyasar sent it at ${clock(Date.parse(verification.receivedAt))}. Enter it in Moyasar → Settings → Webhooks within 30 minutes of its arrival, before ${clock(verification.expiresAtMs)}. Moyasar delivers no events to the webhook until it is entered.`}
        />
      )}

      {error ? (
        <Notice title={error} tone="blocking" />
      ) : status ? (
        <>
          {notice && <Notice title={notice.title} action={notice.action} tone={notice.tone} />}

          {shaped && (
            <>
              <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                <Indicator label={isRTL ? `مفتاح الوضع (${status.mode})` : `Key for mode (${status.mode})`} ok={status.active_key_set} />
                <Indicator label={isRTL ? `بادئة المفتاح (${keyPrefix})` : `Key prefix (${keyPrefix})`} ok={status.key_prefix_ok === true} />
                <Indicator label={isRTL ? `رمز الويب هوك السري (${status.mode})` : `Webhook secret (${status.mode})`} ok={status.webhook_secret_set === true} />
                <Indicator label={isRTL ? 'مفتاح تجريبي' : 'Test key'} ok={status.test_key_set} />
                <Indicator label={isRTL ? 'مفتاح مباشر' : 'Live key'} ok={status.live_key_set} />
              </div>

              <div className="flex flex-wrap items-center gap-3 px-1">
                <Text variant="caption" tone="secondary" as="span">
                  {isRTL ? 'العملة' : 'Currency'}: <span className="num">{status.currency}</span>
                </Text>
                <Text variant="caption" tone="secondary" as="span">
                  {isRTL ? 'الطريقة' : 'Flow'}: <span className="num">invoice</span>
                </Text>
                <Text variant="caption" tone="secondary" as="span">
                  {isRTL ? 'انتهاء' : 'Expiry'}: <span className="num">{status.expiry_minutes}m</span>
                </Text>
              </div>
            </>
          )}

          {!disabled && (
            <div className="space-y-2 border-t border-con-line pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text variant="caption" tone="secondary" as="span">
                  {isRTL ? 'اختبار الاتصال' : 'Test connection'}
                </Text>
                <Button
                  label={testing ? '…' : (isRTL ? 'اختبار' : 'Test')}
                  onClick={() => { void handleTest(); }}
                  disabled={testing || !shaped || !status.active_key_set}
                  loading={testing}
                  variant="secondary"
                  leading={<Plug className="size-3" aria-hidden="true" />}
                />
              </div>
              {testMsg && <Notice title={testMsg.text} tone={testMsg.ok ? 'success' : 'blocking'} />}
              <Text variant="caption" tone="tertiary" as="p">
                {isRTL
                  ? 'يتحقق من المفتاح السري للوضع المحدد لدى Moyasar دون إنشاء أي عملية دفع.'
                  : 'Validates the selected-mode secret key against Moyasar without creating any payment.'}
              </Text>
            </div>
          )}

          {!disabled && (
            <div className="space-y-2 border-t border-con-line pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text variant="caption" tone="secondary" as="span">
                  {isRTL ? 'دفعة تجريبية بقيمة ١ ريال' : 'Sandbox 1 SAR checkout'}
                </Text>
                <div className="flex items-center gap-2">
                  <Button
                    label={coRunning ? '…' : (isRTL ? 'ابدأ' : 'Run')}
                    onClick={() => { void runTestCheckout(); }}
                    disabled={!canRunTest || coRunning}
                    loading={coRunning}
                    variant="secondary"
                  />
                  <Button
                    label={coChecking ? '…' : (isRTL ? 'تحقق' : 'Check')}
                    onClick={() => { void checkTestResult(); }}
                    disabled={!coInvoiceId || coChecking}
                    loading={coChecking}
                    variant="secondary"
                  />
                </div>
              </div>
              {coMsg && <Notice title={coMsg.text} tone={coMsg.ok ? 'success' : 'blocking'} />}
              {coErr && (
                <Text variant="caption" tone="tertiary" as="p">
                  {isRTL ? 'رد Moyasar' : 'Moyasar replied'}: <span className="num">{coErr.code ?? '—'}</span>
                  {coErr.description ? ` — ${coErr.description}` : ''}
                  {coErr.httpStatus ? ` (HTTP ${coErr.httpStatus})` : ''}
                </Text>
              )}
              {coResult && (
                <Text variant="caption" tone="secondary" as="p">
                  {isRTL ? 'الحالة' : 'Status'}: <span className="num">{coResult.status ?? '—'}</span>
                  {' · '}
                  <span className="num">{formatMoyasarMinorAmount(coResult.amount, coResult.currency)}</span>
                  {' · '}
                  <span className="num">{coResult.mode ?? ''}</span>
                </Text>
              )}
              <Text variant="caption" tone="tertiary" as="p">
                {isRTL
                  ? 'فاتورة تجريبية معزولة لا ترتبط بأي طلب، ولا تتوفر إلا في الوضع التجريبي.'
                  : 'An isolated sandbox invoice linked to no order. Available in TEST mode only.'}
              </Text>
            </div>
          )}
        </>
      ) : (
        <Text variant="caption" tone="tertiary" as="p">{isRTL ? 'جارٍ التحميل…' : 'Loading…'}</Text>
      )}
    </Card>
  );
};
