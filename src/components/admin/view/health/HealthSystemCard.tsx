/**
 * One subsystem card — PRESENTATION ONLY.
 *
 * The per-system metric rows are the same reads as before, including the one
 * that matters most: push failures are TWO DISTINCT UNITS — failed device
 * deliveries and failed send-lifecycle events — shown separately and never
 * summed. `pushFailureMetrics` still owns that, including its legacy-alias
 * fallback; this component only places what it returns.
 *
 * The state pill is a StatusPill, never a button. A subsystem's health is
 * something that happened, not something you can press — the only pressable
 * thing on the card is the link to the panel that can actually tell you more.
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, ShieldAlert } from 'lucide-react';

import { Card } from '../../../../design-system/ui/Card';
import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import {
  type OperationsHealthState,
  type OperationsHealthSystem,
  pushFailureMetrics,
} from '../../../../lib/operationsHealthApi';
import { HealthMetric } from './HealthMetric';
import {
  STATE_LABELS, booleanValue, healthStateTone, navTargetFor, numberValue,
  relativeAge, sourceLabel, stringValue,
  type AdminLang, type TargetTab,
} from './healthView';

/**
 * This is intentionally a total Record keyed by the wire-level system id. When a
 * backend card is added, TypeScript now forces this map to be updated before the
 * frontend can compile. The 20260807 `order_flow` backend rollout was the reason:
 * the old map lacked it and `text.ar/text.en` could dereference undefined at
 * runtime as soon as staff opened the Health Center.
 */
const SYSTEM_TEXT: Record<OperationsHealthSystem['id'], {
  en: string; ar: string; descEn: string; descAr: string;
}> = {
  lazywait: {
    en: 'Lazywait Sync',
    ar: 'مزامنة Lazywait',
    descEn: 'POS synchronization scheduler and retry health.',
    descAr: 'حالة جدولة مزامنة نقاط البيع والمحاولات.',
  },
  order_integrity: {
    en: 'Order Integrity',
    ar: 'سلامة الطلبات',
    descEn: 'Observe-only order, payment and POS consistency watchdog.',
    descAr: 'مراقبة سلامة الطلبات والدفع ونقاط البيع دون تعديل تلقائي.',
  },
  order_flow: {
    en: 'Order Flow',
    ar: 'تدفق الطلبات',
    descEn: 'Recent ordering activity compared with active branches and a trailing same-hour baseline.',
    descAr: 'نشاط الطلبات الحديث مقارنة بالفروع النشطة وخط أساس لنفس الساعة.',
  },
  account_deletion: {
    en: 'Account Deletion',
    ar: 'حذف الحسابات',
    descEn: 'Deletion processor schedule, due queue and manual-review backlog.',
    descAr: 'جدولة معالجة الحذف والطلبات المستحقة والمراجعة اليدوية.',
  },
  payment: {
    en: 'Payment / Tap',
    ar: 'الدفع / Tap',
    descEn: 'Database evidence only; no live provider availability probe in v1.',
    descAr: 'بيانات قاعدة البيانات فقط؛ لا يوجد فحص مباشر لمزود الدفع في الإصدار الأول.',
  },
  push: {
    en: 'Push Notifications',
    ar: 'الإشعارات الفورية',
    descEn: 'Master flag, device registry and safe send-ledger aggregates.',
    descAr: 'حالة التفعيل وعدد الأجهزة وملخص سجل الإرسال الآمن.',
  },
  email: {
    en: 'Email / SMTP',
    ar: 'البريد / SMTP',
    descEn: 'Configuration status only; no test email is sent.',
    descAr: 'حالة الإعداد فقط؛ لا يتم إرسال رسالة اختبار.',
  },
  otp: {
    en: 'WhatsApp / OTP',
    ar: 'واتساب / رمز التحقق',
    descEn: 'Configuration status only; no OTP or test message is sent.',
    descAr: 'حالة الإعداد فقط؛ لا يتم إرسال رمز أو رسالة اختبار.',
  },
  database_jobs: {
    en: 'Database & Scheduled Jobs',
    ar: 'قاعدة البيانات والمهام المجدولة',
    descEn: 'Allowlisted pg_cron jobs (critical + internal automation) with per-cadence staleness windows.',
    descAr: 'مهام pg_cron المسموحة (الحرجة والأتمتة الداخلية) بنوافذ تقادم حسب وتيرة كل مهمة.',
  },
};

/** Icon by state. Only healthy/idle get a tick; a fault gets the shield. */
export function StateIcon({ state }: { state: OperationsHealthState }) {
  if (state === 'healthy' || state === 'idle') return <CheckCircle2 className="size-4" aria-hidden="true" />;
  if (state === 'failing' || state === 'configuration_error') return <ShieldAlert className="size-4" aria-hidden="true" />;
  return <AlertTriangle className="size-4" aria-hidden="true" />;
}

function SystemMetrics({ system, lang }: { system: OperationsHealthSystem; lang: AdminLang }) {
  const d = system.details ?? {};
  const isAr = lang === 'ar';

  if (system.id === 'lazywait') {
    return (
      <>
        <HealthMetric label="Cron" value={booleanValue(d, 'cron_active') ? (isAr ? 'فعال' : 'Active') : (isAr ? 'غير فعال' : 'Inactive')} />
        <HealthMetric label={isAr ? 'آخر نجاح' : 'Last success'} value={relativeAge(
          typeof d.latest_success === 'object' && d.latest_success !== null
            ? stringValue(d.latest_success as Record<string, unknown>, 'responded_at')
            : null,
          lang,
        )} />
        <HealthMetric label={isAr ? 'طلبات مستحقة' : 'Due orders'} value={numberValue(d, 'due_pending_failed_orders')} />
      </>
    );
  }

  if (system.id === 'order_integrity') {
    return (
      <>
        <HealthMetric label={isAr ? 'حرج' : 'Critical'} value={numberValue(d, 'open_critical_count')} />
        <HealthMetric label={isAr ? 'تحذيرات' : 'Warnings'} value={numberValue(d, 'open_warning_count')} />
        <HealthMetric label={isAr ? 'آخر فحص' : 'Last scan'} value={relativeAge(stringValue(d, 'latest_successful_run_at'), lang)} />
      </>
    );
  }

  if (system.id === 'order_flow') {
    // These names are the exact wire keys emitted by
    // 20260807150000_order_flow_health_card.sql. Keep them coupled to the
    // backend contract; numberValue intentionally returns 0 for a missing key,
    // which would otherwise make a typo look like a real zero-activity reading.
    return (
      <>
        <HealthMetric label={isAr ? 'طلبات حديثة' : 'Recent orders'} value={numberValue(d, 'orders_in_window')} />
        <HealthMetric label={isAr ? 'فروع نشطة' : 'Active branches'} value={numberValue(d, 'open_branches')} />
        <HealthMetric label={isAr ? 'متوسط خط الأساس' : 'Baseline avg'} value={numberValue(d, 'baseline_orders')} />
      </>
    );
  }

  if (system.id === 'account_deletion') {
    return (
      <>
        <HealthMetric label={isAr ? 'مستحقة' : 'Due'} value={numberValue(d, 'due_count')} />
        <HealthMetric label={isAr ? 'مراجعة يدوية' : 'Manual review'} value={numberValue(d, 'manual_review_count')} />
        <HealthMetric label={isAr ? 'آخر نجاح' : 'Last success'} value={relativeAge(stringValue(d, 'latest_success_at'), lang)} />
      </>
    );
  }

  if (system.id === 'payment') {
    return (
      <>
        <HealthMetric label={isAr ? 'المزود' : 'Provider'} value={stringValue(d, 'provider') ?? '—'} />
        <HealthMetric label={isAr ? 'الوضع' : 'Mode'} value={stringValue(d, 'mode') ?? '—'} />
        <HealthMetric label={isAr ? 'عمليات عالقة 24س' : 'Stale 24h'} value={numberValue(d, 'stale_initiated_24h')} />
      </>
    );
  }

  if (system.id === 'push') {
    const { failedDeliveries, failedSendEvents } = pushFailureMetrics(d);
    return (
      <>
        <HealthMetric label={isAr ? 'أجهزة فعالة' : 'Active devices'} value={numberValue(d, 'active_devices')} />
        <HealthMetric label={isAr ? 'إخفاقات التسليم 24س' : 'Failed deliveries 24h'} value={failedDeliveries} />
        <HealthMetric label={isAr ? 'إخفاقات الإرسال 24س' : 'Failed send events 24h'} value={failedSendEvents} />
      </>
    );
  }

  if (system.id === 'email' || system.id === 'otp') {
    return (
      <>
        <HealthMetric label={isAr ? 'المزود' : 'Provider'} value={stringValue(d, 'provider') ?? '—'} />
        <HealthMetric label={isAr ? 'مفعل' : 'Enabled'} value={booleanValue(d, 'enabled') ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No')} />
        <HealthMetric label={isAr ? 'مهيأ' : 'Configured'} value={booleanValue(d, 'configured') ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No')} />
      </>
    );
  }

  return (
    <>
      <HealthMetric label={isAr ? 'المهام المتوقعة' : 'Expected jobs'} value={numberValue(d, 'expected_jobs')} />
      <HealthMetric label={isAr ? 'المصدر' : 'Source'} value="pg_cron" />
      <HealthMetric label={isAr ? 'الوضع' : 'Mode'} value={isAr ? 'قراءة فقط' : 'Read-only'} />
    </>
  );
}

export function HealthSystemCard({
  system,
  lang,
  onNavigate,
}: {
  system: OperationsHealthSystem;
  lang: AdminLang;
  onNavigate?: (tab: TargetTab) => void;
}) {
  const isAr = lang === 'ar';
  const text = SYSTEM_TEXT[system.id];
  const target = navTargetFor(system.id);

  return (
    <Card
      className="space-y-3"
      aria-label={isAr ? text.ar : text.en}
      role="region"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Text variant="heading" as="h5">{isAr ? text.ar : text.en}</Text>
            {system.critical && (
              <StatusPill label={isAr ? 'حرج' : 'Critical'} tone="danger" />
            )}
          </div>
          <Text variant="caption" tone="tertiary" as="p" className="mt-1">
            {isAr ? text.descAr : text.descEn}
          </Text>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1"
          aria-label={`${isAr ? text.ar : text.en}: ${STATE_LABELS[system.state][lang]}`}
        >
          <StatusPill label={STATE_LABELS[system.state][lang]} tone={healthStateTone(system.state)} />
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <SystemMetrics system={system} lang={lang} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-con-line pt-2">
        <Text variant="caption" tone="tertiary" as="span">
          {isAr ? 'مصدر القياس:' : 'Telemetry:'} {sourceLabel(system.source)}
        </Text>
        {target && onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate(target)}
            className="ds-motion inline-flex min-h-8 items-center gap-1 rounded-[var(--radius-ds-sm)] px-2 hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Text variant="caption" tone="ember" as="span">{isAr ? 'فتح اللوحة' : 'Open panel'}</Text>
            <ExternalLink className="size-3 text-ember" aria-hidden="true" />
          </button>
        )}
      </div>
    </Card>
  );
}
