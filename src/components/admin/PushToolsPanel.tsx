import React, { useEffect, useState } from 'react';
import { Bell, Megaphone, Send } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
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
 *
 * The broadcast keeps its two-step confirm, and the confirm line still names
 * the live opt-in count: this send is immediate and cannot be recalled, so the
 * number of phones it will reach belongs in the sentence you click.
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

  const resultText = result && (result.status === 'ok'
    ? (isRTL
      ? `النتيجة: مستهدف ${result.targeted ?? 0} · أُرسل ${result.sent ?? 0} · فشل ${result.failed ?? 0} · عُطّل ${result.deactivated ?? 0}`
      : `Result: targeted ${result.targeted ?? 0} · sent ${result.sent ?? 0} · failed ${result.failed ?? 0} · deactivated ${result.deactivated ?? 0}`)
    : `${result.status}${result.hint ? ` — ${result.hint}` : ''}${result.reason ? ` — ${result.reason}` : ''}`);

  return (
    <Card className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-con-line pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bell className="size-4 shrink-0 text-ember" aria-hidden="true" />
          <div className="min-w-0">
            <Text variant="label" as="p">{isRTL ? 'أدوات الإشعارات' : 'Push tools'}</Text>
            <Text variant="caption" tone="tertiary" as="p">
              {isRTL
                ? 'إشعار تجريبي وبثّ ترويجي فوري للمشتركين فقط. يتطلب تفعيل التكامل أعلاه.'
                : 'Test notification + immediate promo broadcast to opted-in devices only. Requires the integration above to be enabled.'}
            </Text>
          </div>
        </div>
        {counts ? (
          <div className="shrink-0 text-end">
            <Text variant="caption" tone="secondary" numeric as="p">
              {isRTL ? `الأجهزة النشطة: ${counts.activeDevices}` : `Active devices: ${counts.activeDevices}`}
            </Text>
            <Text variant="caption" tone="secondary" numeric as="p">
              {isRTL ? `مشتركو العروض: ${counts.promoOptIns}` : `Promo opt-ins: ${counts.promoOptIns}`}
            </Text>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          label={busy === 'test'
            ? (isRTL ? 'جارٍ الإرسال…' : 'Sending…')
            : (isRTL ? 'إرسال إشعار تجريبي' : 'Send test notification')}
          onClick={runTest}
          disabled={disabled || busy !== null}
          loading={busy === 'test'}
          variant="secondary"
          leading={<Send className="size-3.5" aria-hidden="true" />}
        />
        <Text variant="caption" tone="tertiary" as="span">
          {isRTL ? 'يُرسل إلى أجهزتك المسجّلة بنفس حساب المشرف.' : 'Goes to YOUR devices registered with this admin account.'}
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Field
          label={isRTL ? 'العنوان (إنجليزي)' : 'Title (English)'}
          value={form.titleEn}
          onValueChange={(v) => setForm((f) => ({ ...f, titleEn: v }))}
          disabled={disabled}
        />
        <Field
          label={isRTL ? 'العنوان (عربي)' : 'Title (Arabic)'}
          value={form.titleAr}
          onValueChange={(v) => setForm((f) => ({ ...f, titleAr: v }))}
          disabled={disabled}
          dir="rtl"
        />
        <Field
          label={isRTL ? 'النص (إنجليزي)' : 'Body (English)'}
          value={form.bodyEn}
          onValueChange={(v) => setForm((f) => ({ ...f, bodyEn: v }))}
          disabled={disabled}
        />
        <Field
          label={isRTL ? 'النص (عربي)' : 'Body (Arabic)'}
          value={form.bodyAr}
          onValueChange={(v) => setForm((f) => ({ ...f, bodyAr: v }))}
          disabled={disabled}
          dir="rtl"
        />
      </div>

      {!confirmBroadcast ? (
        <Button
          label={isRTL ? 'بثّ ترويجي فوري…' : 'Broadcast promotion…'}
          onClick={() => setConfirmBroadcast(true)}
          disabled={disabled || busy !== null || !formComplete}
          variant="secondary"
          leading={<Megaphone className="size-3.5" aria-hidden="true" />}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-ds-md)] border border-warn-line bg-warn-tint p-2.5">
          <Text variant="label" tone="warning" as="span">
            {isRTL
              ? `إرسال الآن إلى ${counts?.promoOptIns ?? '؟'} جهاز مشترك؟`
              : `Send now to ${counts?.promoOptIns ?? '?'} opted-in device(s)?`}
          </Text>
          <Button
            label={busy === 'broadcast'
              ? (isRTL ? 'جارٍ البث…' : 'Broadcasting…')
              : (isRTL ? 'تأكيد الإرسال' : 'Confirm send')}
            onClick={runBroadcast}
            disabled={busy !== null}
            loading={busy === 'broadcast'}
            variant="danger"
          />
          <Button
            label={isRTL ? 'إلغاء' : 'Cancel'}
            onClick={() => setConfirmBroadcast(false)}
            variant="ghost"
          />
        </div>
      )}

      {resultText && <Notice title={resultText} tone={result?.status === 'ok' ? 'success' : 'warning'} />}
      {error && <Notice title={error} tone="blocking" />}
    </Card>
  );
};
