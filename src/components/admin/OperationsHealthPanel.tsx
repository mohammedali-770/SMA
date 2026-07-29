import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, Clock3, Database,
  ExternalLink, HeartPulse, Loader2, RefreshCw, ShieldAlert,
} from 'lucide-react';
import {
  operationsHealth,
  OperationsHealthAttention,
  OperationsHealthJob,
  OperationsHealthState,
  OperationsHealthSummary,
  OperationsHealthSystem,
  pushFailureMetrics,
} from '../../lib/operationsHealthApi';

type AdminLang = 'en' | 'ar';
type TargetTab = 'integrity' | 'integrations';

const STATE_TONE: Record<OperationsHealthState, string> = {
  healthy: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  idle: 'bg-sky-100 text-sky-800 border-sky-200',
  degraded: 'bg-amber-100 text-amber-800 border-amber-200',
  failing: 'bg-red-100 text-red-800 border-red-200',
  configuration_error: 'bg-red-200 text-red-900 border-red-300',
  disabled: 'bg-slate-100 text-slate-600 border-slate-200',
  not_configured: 'bg-orange-100 text-orange-800 border-orange-200',
  not_monitored: 'bg-violet-100 text-violet-800 border-violet-200',
  unavailable: 'bg-gray-200 text-gray-700 border-gray-300',
};

const STATE_LABELS: Record<OperationsHealthState, { en: string; ar: string }> = {
  healthy: { en: 'Healthy', ar: 'سليم' },
  idle: { en: 'Idle', ar: 'لا توجد أعمال معلّقة' },
  degraded: { en: 'Degraded', ar: 'متدهور جزئيًا' },
  failing: { en: 'Failing', ar: 'متعطل' },
  configuration_error: { en: 'Configuration Error', ar: 'خطأ في الإعدادات' },
  disabled: { en: 'Disabled', ar: 'معطل' },
  not_configured: { en: 'Not Configured', ar: 'غير مهيأ' },
  not_monitored: { en: 'Not Monitored', ar: 'غير مراقب خارجيًا' },
  unavailable: { en: 'Unavailable', ar: 'غير متاح' },
};

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

const ATTENTION_TEXT: Record<string, { en: string; ar: string }> = {
  PAYMENT_INTEGRITY_INCIDENTS: {
    en: 'Payment integrity incidents require investigation.',
    ar: 'توجد حوادث في سلامة الدفع تحتاج إلى مراجعة.',
  },
  STALE_PAYMENT_INITIATIONS: {
    en: 'Payment attempts remained initiated for more than 30 minutes.',
    ar: 'عمليات دفع بقيت في حالة البدء لأكثر من 30 دقيقة.',
  },
  PUSH_SEND_FAILURES_24H: {
    en: 'Push send failures were recorded in the last 24 hours.',
    ar: 'تم تسجيل إخفاقات في إرسال الإشعارات خلال آخر 24 ساعة.',
  },
  OPERATIONS_AUTOMATION_JOBS_FAILING: {
    en: 'An internal automation job (alerts evaluator / daily digest) has stopped running on schedule.',
    ar: 'توقفت إحدى مهام الأتمتة الداخلية (مقيّم التنبيهات / الملخص اليومي) عن العمل في موعدها.',
  },
  OPERATIONS_AUTOMATION_JOBS_DEGRADED: {
    en: 'An internal automation job (alerts evaluator / daily digest) needs attention.',
    ar: 'تحتاج إحدى مهام الأتمتة الداخلية (مقيّم التنبيهات / الملخص اليومي) إلى المتابعة.',
  },
};

function relativeAge(iso: string | null | undefined, lang: AdminLang): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return lang === 'ar' ? `قبل ${seconds} ث` : `${seconds}s ago`;
  if (seconds < 3600) return lang === 'ar' ? `قبل ${Math.floor(seconds / 60)} د` : `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return lang === 'ar' ? `قبل ${Math.floor(seconds / 3600)} س` : `${Math.floor(seconds / 3600)}h ago`;
  return lang === 'ar' ? `قبل ${Math.floor(seconds / 86400)} يوم` : `${Math.floor(seconds / 86400)}d ago`;
}

function exactTime(iso: string | null | undefined, lang: AdminLang): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB');
}

function numberValue(details: Record<string, unknown>, key: string): number {
  const value = details[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringValue(details: Record<string, unknown>, key: string): string | null {
  const value = details[key];
  return typeof value === 'string' && value ? value : null;
}

function booleanValue(details: Record<string, unknown>, key: string): boolean | null {
  const value = details[key];
  return typeof value === 'boolean' ? value : null;
}

function statusIcon(state: OperationsHealthState) {
  if (state === 'healthy' || state === 'idle') return <CheckCircle2 className="w-4 h-4" aria-hidden="true" />;
  if (state === 'failing' || state === 'configuration_error') return <ShieldAlert className="w-4 h-4" aria-hidden="true" />;
  return <AlertTriangle className="w-4 h-4" aria-hidden="true" />;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white/50 border border-slate-100 px-2 py-1.5">
      <p className="text-[8px] uppercase font-black text-slate-600">{label}</p>
      <p className="text-[10px] font-black text-slate-700 break-words">{value}</p>
    </div>
  );
}

function SystemMetrics({ system, lang }: { system: OperationsHealthSystem; lang: AdminLang }) {
  const d = system.details ?? {};
  const isAr = lang === 'ar';

  if (system.id === 'lazywait') {
    return (
      <>
        <Metric label={isAr ? 'Cron' : 'Cron'} value={booleanValue(d, 'cron_active') ? (isAr ? 'فعال' : 'Active') : (isAr ? 'غير فعال' : 'Inactive')} />
        <Metric label={isAr ? 'آخر نجاح' : 'Last success'} value={relativeAge(
          typeof d.latest_success === 'object' && d.latest_success !== null
            ? stringValue(d.latest_success as Record<string, unknown>, 'responded_at')
            : null,
          lang,
        )} />
        <Metric label={isAr ? 'طلبات مستحقة' : 'Due orders'} value={numberValue(d, 'due_pending_failed_orders')} />
      </>
    );
  }

  if (system.id === 'order_integrity') {
    return (
      <>
        <Metric label={isAr ? 'حرج' : 'Critical'} value={numberValue(d, 'open_critical_count')} />
        <Metric label={isAr ? 'تحذيرات' : 'Warnings'} value={numberValue(d, 'open_warning_count')} />
        <Metric label={isAr ? 'آخر فحص' : 'Last scan'} value={relativeAge(stringValue(d, 'latest_successful_run_at'), lang)} />
      </>
    );
  }

  if (system.id === 'account_deletion') {
    return (
      <>
        <Metric label={isAr ? 'مستحقة' : 'Due'} value={numberValue(d, 'due_count')} />
        <Metric label={isAr ? 'مراجعة يدوية' : 'Manual review'} value={numberValue(d, 'manual_review_count')} />
        <Metric label={isAr ? 'آخر نجاح' : 'Last success'} value={relativeAge(stringValue(d, 'latest_success_at'), lang)} />
      </>
    );
  }

  if (system.id === 'payment') {
    return (
      <>
        <Metric label={isAr ? 'المزود' : 'Provider'} value={stringValue(d, 'provider') ?? '—'} />
        <Metric label={isAr ? 'الوضع' : 'Mode'} value={stringValue(d, 'mode') ?? '—'} />
        <Metric label={isAr ? 'عمليات عالقة 24س' : 'Stale 24h'} value={numberValue(d, 'stale_initiated_24h')} />
      </>
    );
  }

  if (system.id === 'push') {
    // Two distinct units, shown separately (never summed): actual failed device
    // deliveries and failed send-lifecycle events. Falls back to the legacy
    // `failed_sends_24h` alias for deliveries; missing event field reads 0. The
    // card's state stays backend-authoritative.
    const { failedDeliveries, failedSendEvents } = pushFailureMetrics(d);
    return (
      <>
        <Metric label={isAr ? 'أجهزة فعالة' : 'Active devices'} value={numberValue(d, 'active_devices')} />
        <Metric label={isAr ? 'إخفاقات التسليم 24س' : 'Failed deliveries 24h'} value={failedDeliveries} />
        <Metric label={isAr ? 'إخفاقات الإرسال 24س' : 'Failed send events 24h'} value={failedSendEvents} />
      </>
    );
  }

  if (system.id === 'email' || system.id === 'otp') {
    return (
      <>
        <Metric label={isAr ? 'المزود' : 'Provider'} value={stringValue(d, 'provider') ?? '—'} />
        <Metric label={isAr ? 'مفعل' : 'Enabled'} value={booleanValue(d, 'enabled') ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No')} />
        <Metric label={isAr ? 'مهيأ' : 'Configured'} value={booleanValue(d, 'configured') ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No')} />
      </>
    );
  }

  return (
    <>
      <Metric label={isAr ? 'المهام المتوقعة' : 'Expected jobs'} value={numberValue(d, 'expected_jobs')} />
      <Metric label={isAr ? 'المصدر' : 'Source'} value="pg_cron" />
      <Metric label={isAr ? 'الوضع' : 'Mode'} value={isAr ? 'قراءة فقط' : 'Read-only'} />
    </>
  );
}

const SystemCard: React.FC<{
  system: OperationsHealthSystem;
  lang: AdminLang;
  onNavigate?: (tab: TargetTab) => void;
}> = ({ system, lang, onNavigate }) => {
  const isAr = lang === 'ar';
  const text = SYSTEM_TEXT[system.id];
  const target: TargetTab | null =
    system.id === 'order_integrity' ? 'integrity'
      : ['lazywait', 'payment', 'push', 'email', 'otp'].includes(system.id) ? 'integrations'
        : null;

  return (
    <section className="glass-card rounded-2xl bg-white/45 border border-white/60 p-3.5 space-y-3" aria-label={isAr ? text.ar : text.en}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <h5 className="text-[11px] font-black text-slate-800">{isAr ? text.ar : text.en}</h5>
            {system.critical && (
              <span className="text-[7px] font-black uppercase bg-slate-800 text-white px-1.5 py-0.5 rounded-full">
                {isAr ? 'حرج' : 'Critical'}
              </span>
            )}
          </div>
          <p className="text-[8.5px] text-slate-600 font-bold mt-1 leading-relaxed">
            {isAr ? text.descAr : text.descEn}
          </p>
        </div>
        <span
          className={`border rounded-full px-2 py-1 text-[8.5px] font-black inline-flex items-center gap-1 ${STATE_TONE[system.state]}`}
          aria-label={`${isAr ? text.ar : text.en}: ${STATE_LABELS[system.state][lang]}`}
        >
          {statusIcon(system.state)}
          {STATE_LABELS[system.state][lang]}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <SystemMetrics system={system} lang={lang} />
      </div>

      <div className="flex justify-between items-center gap-2 border-t border-slate-100 pt-2">
        <span className="text-[8px] font-bold text-slate-600">
          {isAr ? 'مصدر القياس:' : 'Telemetry:'} {system.source.replaceAll('_', ' ')}
        </span>
        {target && onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate(target)}
            className="text-[8.5px] font-black text-primary inline-flex items-center gap-1 hover:underline"
          >
            {isAr ? 'فتح اللوحة' : 'Open panel'} <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
};

function JobsTable({ jobs, lang }: { jobs: OperationsHealthJob[]; lang: AdminLang }) {
  const isAr = lang === 'ar';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-[9.5px]">
        <thead>
          <tr className="text-slate-600 font-black uppercase text-[8px] text-start">
            <th className="py-2 px-2">{isAr ? 'المهمة' : 'Job'}</th>
            <th className="py-2 px-2">{isAr ? 'الجدولة' : 'Cadence'}</th>
            <th className="py-2 px-2">{isAr ? 'الحالة' : 'State'}</th>
            <th className="py-2 px-2">{isAr ? 'آخر نتيجة' : 'Latest result'}</th>
            <th className="py-2 px-2">{isAr ? 'آخر نجاح' : 'Last success'}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.job_name} className="border-t border-slate-100">
              <td className="py-2 px-2 font-mono font-bold text-slate-700">{job.job_name}</td>
              <td className="py-2 px-2 font-mono text-slate-600">{job.schedule ?? '—'}</td>
              <td className="py-2 px-2">
                <span className={`rounded-full border px-2 py-0.5 font-black text-[8px] ${STATE_TONE[job.state]}`}>
                  {STATE_LABELS[job.state][lang]}
                </span>
              </td>
              <td className="py-2 px-2 text-slate-600">{job.latest_status ?? '—'}</td>
              <td className="py-2 px-2 text-slate-600" title={exactTime(job.latest_success_at, lang)}>
                {relativeAge(job.latest_success_at, lang)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const AttentionRow: React.FC<{ item: OperationsHealthAttention; lang: AdminLang }> = ({ item, lang }) => {
  const isAr = lang === 'ar';
  const fallback = `${item.subsystem}: ${item.code.replaceAll('_', ' ')}`;
  const text = ATTENTION_TEXT[item.code]?.[lang] ?? fallback;

  return (
    <div className={`rounded-xl border px-3 py-2 flex items-start gap-2 ${
      item.severity === 'critical' ? 'bg-red-50 border-red-100 text-red-800' : 'bg-amber-50 border-amber-100 text-amber-800'
    }`}>
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p className="text-[10px] font-black">{text}</p>
        <p className="text-[8.5px] font-bold opacity-75 mt-0.5">
          {isAr ? 'العدد' : 'Count'}: {item.count}
          {item.oldest_at ? ` · ${relativeAge(item.oldest_at, lang)}` : ''}
        </p>
      </div>
    </div>
  );
};

export const OperationsHealthPanel: React.FC<{
  lang: AdminLang;
  onNavigate?: (tab: TargetTab) => void;
}> = ({ lang, onNavigate }) => {
  const isAr = lang === 'ar';
  const [summary, setSummary] = useState<OperationsHealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const result = await operationsHealth.summary();
      setSummary(result);
      setLastRefreshAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : (isAr ? 'تعذر تحميل حالة الأنظمة' : 'Failed to load operations health'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAr]);

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => { void load(false); }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const systems = useMemo(() => summary?.systems ?? [], [summary]);
  const overall = summary?.overall_state ?? 'healthy';

  if (loading && !summary) {
    return (
      <div className="glass-card rounded-2xl bg-white/40 p-8 flex items-center justify-center gap-2 text-slate-600">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
        <span className="text-xs font-black">{isAr ? 'جاري تحميل مركز صحة العمليات…' : 'Loading Operations Health Center…'}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <header className="glass-card rounded-2xl bg-white/45 p-4 border border-white/60">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <HeartPulse className="w-5 h-5 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-black text-slate-800">
                {isAr ? 'مركز صحة العمليات' : 'Operations Health Center'}
              </h3>
              <span className={`border rounded-full px-2 py-1 text-[9px] font-black inline-flex items-center gap-1 ${STATE_TONE[overall]}`}>
                {statusIcon(overall)}
                {STATE_LABELS[overall][lang]}
              </span>
            </div>
            <p className="text-[9px] text-slate-600 font-bold mt-1">
              {isAr
                ? 'مراقبة للقراءة فقط. لا توجد إعادة محاولة أو استرداد أو إصلاح تلقائي أو رسائل اختبار.'
                : 'Read-only observability. No retries, refunds, auto-fixes or test messages.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[8.5px] text-slate-600 font-bold">
              <p>{isAr ? 'تم إنشاء البيانات' : 'Generated'}: {relativeAge(summary?.generated_at, lang)}</p>
              <p title={exactTime(lastRefreshAt, lang)}>{isAr ? 'آخر تحديث للصفحة' : 'Page refreshed'}: {relativeAge(lastRefreshAt, lang)}</p>
            </div>
            <button
              type="button"
              onClick={() => { void load(false); }}
              disabled={refreshing}
              className="rounded-xl bg-primary text-white px-3 py-2 text-[9px] font-black inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              {isAr ? 'تحديث' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-xl bg-red-50 border border-red-100 text-red-700 px-3 py-2 text-[9.5px] font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
          <Metric label={isAr ? 'حوادث حرجة' : 'Critical attention'} value={summary?.critical_attention_count ?? 0} />
          <Metric label={isAr ? 'تحذيرات' : 'Warnings'} value={summary?.warning_attention_count ?? 0} />
          <Metric label={isAr ? 'غير متاحة' : 'Unavailable'} value={summary?.systems_unavailable_count ?? 0} />
          <Metric label={isAr ? 'معطلة' : 'Disabled'} value={summary?.systems_disabled_count ?? 0} />
          <Metric label={isAr ? 'غير مهيأة' : 'Not configured'} value={summary?.systems_not_configured_count ?? 0} />
        </div>
      </header>

      <section>
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-primary" aria-hidden="true" />
          <h4 className="text-[11px] font-black text-slate-700 uppercase">
            {isAr ? 'حالة الأنظمة' : 'System Health'}
          </h4>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {systems.map((system) => (
            <SystemCard key={system.id} system={system} lang={lang} onNavigate={onNavigate} />
          ))}
        </div>
      </section>

      <section className="glass-card rounded-2xl bg-white/45 border border-white/60 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-4 h-4 text-primary" aria-hidden="true" />
          <div>
            <h4 className="text-[11px] font-black text-slate-700 uppercase">
              {isAr ? 'المهام المجدولة' : 'Scheduled Jobs'}
            </h4>
            <p className="text-[8px] text-slate-600 font-bold mt-0.5">
              {isAr ? 'لا يتم عرض أوامر Cron أو الأسرار.' : 'Cron commands and secrets are never exposed.'}
            </p>
          </div>
        </div>
        <JobsTable jobs={summary?.jobs ?? []} lang={lang} />
      </section>

      <section className="glass-card rounded-2xl bg-white/45 border border-white/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock3 className="w-4 h-4 text-primary" aria-hidden="true" />
          <h4 className="text-[11px] font-black text-slate-700 uppercase">
            {isAr ? 'يتطلب الانتباه' : 'Attention Required'}
          </h4>
        </div>
        {(summary?.attention ?? []).length === 0 ? (
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            <p className="text-[10px] font-black">
              {isAr ? 'لا توجد حوادث تشغيلية تحتاج إلى إجراء حاليًا.' : 'No current operational incidents require action.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {(summary?.attention ?? []).map((item, index) => (
              <AttentionRow key={`${item.code}-${index}`} item={item} lang={lang} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
