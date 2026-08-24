import React, { useEffect, useState } from 'react';
import { CreditCard, Plug, RefreshCw } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { paymentGateway, PaymentGatewayStatus } from '../../lib/api';
import { canRunMoyasarAdminTestCheckout, moyasarBlockingReason } from '../../lib/moyasarAdminTest';

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
 * TWO THINGS THIS PANEL SHOWS THAT THE TAP PANEL CANNOT.
 *  - "Key matches mode". Moyasar keys are self-describing (`sk_test_` /
 *    `sk_live_`), so a live key filed under TEST is detectable rather than
 *    something you discover from a customer's statement.
 *  - "Webhook secret". Moyasar signs nothing; the token echoed in the webhook
 *    body is the only authentication a notification carries. Without it the
 *    server refuses to act on webhooks at all, which shows up as orders that
 *    are paid at Moyasar but never confirm here — so it is surfaced as a
 *    first-class readiness item, not a footnote.
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

  const isMoyasar = (status?.provider ?? '') === 'moyasar';
  const isLive = status?.mode === 'live';
  const canRunTest = canRunMoyasarAdminTestCheckout(status, disabled);
  const blocking = moyasarBlockingReason(status);

  const blockingText = (): string | null => {
    switch (blocking) {
      case 'not_moyasar':
        return isRTL ? "اضبط مزوّد الدفع على 'moyasar' في البطاقة أعلاه." : "Set the payment provider to 'moyasar' in the card above.";
      case 'disabled':
        return isRTL ? 'المزوّد غير مفعّل — لن يُعرض الدفع الإلكتروني على العملاء.' : 'The provider is disabled — online payment is not offered to customers.';
      case 'no_key':
        return isRTL ? `لم يُضبط المفتاح السري لوضع ${status?.mode ?? 'test'}.` : `No secret key is configured for ${status?.mode ?? 'test'} mode.`;
      case 'key_prefix':
        return isRTL
          ? 'المفتاح المحفوظ لا يطابق بادئة الوضع (sk_test_ / sk_live_). صحّح الحقل قبل الاستخدام.'
          : 'The stored key does not carry the prefix for its mode (sk_test_ / sk_live_). Fix the slot before using it.';
      case 'no_webhook_secret':
        return isRTL
          ? 'لم يُضبط رمز الويب هوك السري. لا يمكن التحقّق من إشعارات Moyasar، ولن تُؤكَّد الطلبات المدفوعة تلقائياً.'
          : 'No webhook secret token is set. Moyasar notifications cannot be authenticated, so paid orders will not confirm automatically.';
      default:
        return null;
    }
  };

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

      {error ? (
        <Notice title={error} tone="blocking" />
      ) : status ? (
        <>
          {blockingText() && (
            <Notice
              title={blockingText() as string}
              tone={blocking === 'no_webhook_secret' || blocking === 'key_prefix' ? 'blocking' : 'warning'}
            />
          )}

          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            <Indicator label={isRTL ? `مفتاح الوضع (${status.mode})` : `Key for mode (${status.mode})`} ok={status.active_key_set} />
            <Indicator label={isRTL ? 'بادئة المفتاح تطابق الوضع' : 'Key matches mode'} ok={status.key_prefix_ok === true} />
            <Indicator label={isRTL ? 'رمز الويب هوك السري' : 'Webhook secret'} ok={status.webhook_secret_set === true} />
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

          {!disabled && (
            <div className="space-y-2 border-t border-con-line pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text variant="caption" tone="secondary" as="span">
                  {isRTL ? 'اختبار الاتصال' : 'Test connection'}
                </Text>
                <Button
                  label={testing ? '…' : (isRTL ? 'اختبار' : 'Test')}
                  onClick={() => { void handleTest(); }}
                  disabled={testing || !status.active_key_set}
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
                  <span className="num">{coResult.amount ?? '—'} {coResult.currency ?? ''}</span>
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

          {!isMoyasar && (
            <Text variant="caption" tone="tertiary" as="p">
              {isRTL
                ? 'المزوّد النشط ليس Moyasar، لذا لا تعكس هذه القراءات ما يستخدمه العملاء فعلياً.'
                : 'Moyasar is not the active provider, so these readings do not reflect what customers actually use.'}
            </Text>
          )}
        </>
      ) : (
        <Text variant="caption" tone="tertiary" as="p">{isRTL ? 'جارٍ التحميل…' : 'Loading…'}</Text>
      )}
    </Card>
  );
};
