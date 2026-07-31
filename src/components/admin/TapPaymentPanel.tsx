import React, { useEffect, useState } from 'react';
import { CreditCard, Plug, RefreshCw } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { paymentGateway, PaymentGatewayStatus } from '../../lib/api';
import { canRunAdminTestCheckout } from '../../lib/tapAdminTest';

/**
 * Admin Tap Payments readiness + connection test. Reads config-presence booleans
 * from the `payment-test-config` Edge Function (never any secret key) and lets an
 * admin validate the selected-mode key against Tap WITHOUT creating a charge.
 * Keys are entered in the Tap IntegrationCard above. Accountant = view-only.
 *
 * LIVE is DANGER, TEST is WARNING. Reading a live gateway as a sandbox is the
 * mistake that charges real cards, so it gets the louder tone — and the sandbox
 * checkout below is gated by `canRunAdminTestCheckout`, which refuses to run in
 * live mode at all.
 */
export const TapPaymentPanel: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const { adminLang } = useApp();
  const isRTL = adminLang === 'ar';
  const [status, setStatus] = useState<PaymentGatewayStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Isolated admin TEST checkout (1 SAR sandbox; no order created).
  const [coRunning, setCoRunning] = useState(false);
  const [coChargeId, setCoChargeId] = useState<string | null>(null);
  const [coChecking, setCoChecking] = useState(false);
  const [coMsg, setCoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Sanitized Tap rejection detail (code + description only — never secret/auth).
  const [coErr, setCoErr] = useState<{ code?: string | null; description?: string | null; httpStatus?: number } | null>(null);
  const [coResult, setCoResult] = useState<{ chargeId?: string; status?: string; amount?: number; currency?: string; mode?: string } | null>(null);

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
  const canRunTest = canRunAdminTestCheckout(status, disabled);

  const runTestCheckout = async () => {
    setCoRunning(true); setCoMsg(null); setCoResult(null); setCoErr(null);
    try {
      const res = await paymentGateway.testCheckout();
      if (res.ok && res.checkoutUrl) {
        setCoChargeId(res.chargeId ?? null);
        window.open(res.checkoutUrl, '_blank', 'noopener,noreferrer');
        setCoMsg({ ok: true, text: isRTL ? 'فُتحت صفحة الدفع في نافذة جديدة. أكمل الدفع ثم عُد وتحقق من النتيجة.' : 'Opened the sandbox checkout in a new tab. Complete it, then return and check the result.' });
      } else {
        setCoMsg({ ok: false, text: res.message || (isRTL ? 'تعذّر بدء التجربة.' : 'Could not start the test.') });
        if (res.tapErrorCode || res.tapErrorDescription) {
          setCoErr({ code: res.tapErrorCode, description: res.tapErrorDescription, httpStatus: res.httpStatus });
        }
      }
    } catch (e) {
      setCoMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setCoRunning(false); }
  };

  const checkTestResult = async () => {
    if (!coChargeId) return;
    setCoChecking(true); setCoMsg(null);
    try {
      const res = await paymentGateway.testCheckoutResult(coChargeId);
      if (res.ok) setCoResult({ chargeId: res.chargeId, status: res.status, amount: res.amount, currency: res.currency, mode: res.mode });
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

  const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-center justify-between gap-2">
      <Text variant="caption" tone="tertiary" as="span">{label}</Text>
      {children}
    </div>
  );

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CreditCard className="size-4 shrink-0 text-ember" aria-hidden="true" />
          <div className="min-w-0">
            <Text variant="label" as="p">{isRTL ? 'مدفوعات Tap' : 'Tap Payments'}</Text>
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
          {!isTap && (
            <Notice
              title={isRTL ? "اضبط مزوّد الدفع على 'tap' في البطاقة أعلاه." : "Set the payment provider to 'tap' in the card above."}
              tone="warning"
            />
          )}

          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            <Indicator label={isRTL ? 'معرّف التاجر' : 'Merchant ID'} ok={status.merchant_id_set} />
            <Indicator label={isRTL ? `مفتاح الوضع (${status.mode})` : `Key for mode (${status.mode})`} ok={status.active_key_set} />
            <Indicator label={isRTL ? 'مفتاح تجريبي' : 'Test key'} ok={status.test_key_set} />
            <Indicator label={isRTL ? 'مفتاح مباشر' : 'Live key'} ok={status.live_key_set} />
          </div>

          <div className="flex flex-wrap items-center gap-3 px-1">
            <Text variant="caption" tone="secondary" as="span">
              {isRTL ? 'العملة' : 'Currency'}: <span className="num">{status.currency}</span>
            </Text>
            <Text variant="caption" tone="secondary" as="span">
              Source: <span className="num">{status.source_id}</span>
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
                  ? 'يتحقق من المفتاح السري للوضع المحدد لدى Tap دون إنشاء أي عملية دفع.'
                  : 'Validates the selected-mode secret key against Tap without creating any charge.'}
              </Text>
            </div>
          )}

          {/* Isolated admin TEST checkout — 1 SAR sandbox, no Spicy Meal order created */}
          {!disabled && (
            <div className="space-y-2 border-t border-con-line pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text variant="caption" tone="secondary" as="span">
                  {isRTL ? 'تجربة الدفع عبر Tap' : 'Run Tap test checkout'}
                </Text>
                <Button
                  label={coRunning ? '…' : (isRTL ? 'ابدأ' : 'Run')}
                  onClick={() => { void runTestCheckout(); }}
                  disabled={coRunning || !canRunTest}
                  loading={coRunning}
                  leading={<CreditCard className="size-3" aria-hidden="true" />}
                />
              </div>
              <Text variant="caption" tone="tertiary" as="p">
                {isRTL
                  ? 'ينشئ عملية دفع تجريبية بقيمة ١ ريال عبر Tap (Sandbox) لاختبار صفحة الدفع. لا يُنشئ أو يدفع أي طلب في Spicy Meal.'
                  : 'Creates a 1 SAR Tap sandbox checkout to test the hosted payment page. It does not create or pay any Spicy Meal order.'}
              </Text>
              {!canRunTest && (
                <Text variant="caption" tone="warning" as="p">
                  {isRTL
                    ? 'متاح فقط عندما يكون Tap مفعّلاً في وضع الاختبار مع معرّف التاجر ومفتاح الاختبار.'
                    : 'Available only when Tap is enabled in TEST mode with a merchant id + test key.'}
                </Text>
              )}
              {coChargeId && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <Text variant="caption" tone="secondary" as="span">
                    {isRTL ? 'بعد إتمام الدفع في النافذة:' : 'After paying in the new tab:'}
                  </Text>
                  <Button
                    label={coChecking ? '…' : (isRTL ? 'تحقق من النتيجة' : 'Check test result')}
                    onClick={() => { void checkTestResult(); }}
                    disabled={coChecking}
                    loading={coChecking}
                    variant="secondary"
                  />
                </div>
              )}
              {coMsg && <Notice title={coMsg.text} tone={coMsg.ok ? 'success' : 'blocking'} />}
              {coErr && (coErr.code || coErr.description) && (
                <div className="space-y-1 rounded-[var(--radius-ds-md)] border border-danger-line bg-danger-tint p-2">
                  <Row label={isRTL ? 'رمز خطأ Tap' : 'Tap error code'}>
                    <Text variant="caption" tone="danger" numeric as="span">
                      {coErr.code ?? '—'}{coErr.httpStatus ? ` · HTTP ${coErr.httpStatus}` : ''}
                    </Text>
                  </Row>
                  {coErr.description && (
                    <Row label={isRTL ? 'الوصف' : 'Description'}>
                      <Text variant="caption" tone="danger" as="span" className="text-end">{coErr.description}</Text>
                    </Row>
                  )}
                </div>
              )}
              {coResult && (
                <div className="space-y-1 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface-2 p-2">
                  <Row label={isRTL ? 'رقم العملية' : 'Charge ID'}>
                    <Text variant="caption" tone="secondary" numeric as="span" className="truncate">{coResult.chargeId}</Text>
                  </Row>
                  <Row label={isRTL ? 'الحالة' : 'Status'}>
                    <Text variant="caption" as="span">{coResult.status}</Text>
                  </Row>
                  <Row label={isRTL ? 'المبلغ' : 'Amount'}>
                    <Text variant="caption" numeric as="span">{coResult.amount} {coResult.currency}</Text>
                  </Row>
                  <Row label={isRTL ? 'الوضع' : 'Mode'}>
                    <StatusPill label={String(coResult.mode ?? 'test').toUpperCase()} tone="warning" />
                  </Row>
                </div>
              )}
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
