import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, CheckCircle2, Clock3, Database, HeartPulse, Loader2, RefreshCw,
} from 'lucide-react';

import {
  operationsHealth,
  OperationsHealthSummary,
} from '../../lib/operationsHealthApi';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { HealthJobsTable } from './view/health/HealthJobsTable';
import { HealthMetric } from './view/health/HealthMetric';
import { HealthSystemCard, StateIcon } from './view/health/HealthSystemCard';
import {
  HEALTH_POLL_INTERVAL_MS, STATE_LABELS, attentionText, attentionTone,
  exactTime, healthStateTone, relativeAge,
  type AdminLang, type TargetTab,
} from './view/health/healthView';

/**
 * Operations Health Center — READ-ONLY observability.
 *
 * No retries, refunds, auto-fixes or test messages exist here; the panel only
 * reads `operationsHealth.summary()` and renders it.
 *
 * This file owns FETCHING, POLLING AND ERROR STATE. Layout lives in
 * `./view/health/*`, and the derived values — relative age, exact time, the
 * typed `details` readers, state tones, navigation targets and attention copy —
 * moved to `healthView.ts` so they can be tested directly. Each was lifted
 * verbatim; none changed.
 *
 * Two behaviours are load-bearing and easy to lose in a restyle:
 *
 *   The full-screen loader appears ONLY on `loading && !summary`. Once data has
 *   arrived, a background refresh never blanks the page — an operator watching
 *   a failing subsystem must not have it disappear every sixty seconds.
 *
 *   `load(initial)` drives two different flags. The initial call sets
 *   `loading`; every later call sets `refreshing`, which only dims the refresh
 *   button. Collapsing them would reintroduce the blanking above.
 */
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
    const id = window.setInterval(() => { void load(false); }, HEALTH_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const systems = useMemo(() => summary?.systems ?? [], [summary]);
  const overall = summary?.overall_state ?? 'healthy';

  if (loading && !summary) {
    return (
      <Card className="flex items-center justify-center gap-2 p-8">
        <Loader2 className="size-5 animate-spin text-ember" aria-hidden="true" />
        <Text variant="label" tone="secondary" as="span">
          {isAr ? 'جاري تحميل مركز صحة العمليات…' : 'Loading Operations Health Center…'}
        </Text>
      </Card>
    );
  }

  const attention = summary?.attention ?? [];

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <Card>
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <HeartPulse className="size-5 shrink-0 text-ember" aria-hidden="true" />
              <Text variant="title" as="h3">
                {isAr ? 'مركز صحة العمليات' : 'Operations Health Center'}
              </Text>
              <span className="inline-flex items-center gap-1">
                <StateIcon state={overall} />
                <StatusPill label={STATE_LABELS[overall][lang]} tone={healthStateTone(overall)} />
              </span>
            </div>
            <Text variant="caption" tone="tertiary" as="p" className="mt-1">
              {isAr
                ? 'مراقبة للقراءة فقط. لا توجد إعادة محاولة أو استرداد أو إصلاح تلقائي أو رسائل اختبار.'
                : 'Read-only observability. No retries, refunds, auto-fixes or test messages.'}
            </Text>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <div>
              <Text variant="caption" tone="tertiary" as="p">
                {isAr ? 'تم إنشاء البيانات' : 'Generated'}: {relativeAge(summary?.generated_at, lang)}
              </Text>
              <Text variant="caption" tone="tertiary" as="p" title={exactTime(lastRefreshAt, lang)}>
                {isAr ? 'آخر تحديث للصفحة' : 'Page refreshed'}: {relativeAge(lastRefreshAt, lang)}
              </Text>
            </div>
            <button
              type="button"
              onClick={() => { void load(false); }}
              disabled={refreshing}
              className="ds-motion inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-ds-md)] bg-ember px-3 text-on-ember transition-opacity duration-150 hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              <Text variant="label" tone="onEmber" as="span">{isAr ? 'تحديث' : 'Refresh'}</Text>
            </button>
          </div>
        </div>

        {/* Fail-visible: a failed poll is shown, never swallowed. The cards below
            may still hold the last good reading, so the operator has to be told
            it is no longer being updated. */}
        {error && <Notice title={error} tone="blocking" className="mt-3" />}

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          <HealthMetric label={isAr ? 'حوادث حرجة' : 'Critical attention'} value={summary?.critical_attention_count ?? 0} />
          <HealthMetric label={isAr ? 'تحذيرات' : 'Warnings'} value={summary?.warning_attention_count ?? 0} />
          <HealthMetric label={isAr ? 'غير متاحة' : 'Unavailable'} value={summary?.systems_unavailable_count ?? 0} />
          <HealthMetric label={isAr ? 'معطلة' : 'Disabled'} value={summary?.systems_disabled_count ?? 0} />
          <HealthMetric label={isAr ? 'غير مهيأة' : 'Not configured'} value={summary?.systems_not_configured_count ?? 0} />
        </div>
      </Card>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Activity className="size-4 text-ember" aria-hidden="true" />
          <Text variant="heading" as="h4">{isAr ? 'حالة الأنظمة' : 'System Health'}</Text>
        </div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {systems.map((system) => (
            <HealthSystemCard key={system.id} system={system} lang={lang} onNavigate={onNavigate} />
          ))}
        </div>
      </section>

      <Card>
        <div className="mb-2 flex items-center gap-2">
          <Database className="size-4 shrink-0 text-ember" aria-hidden="true" />
          <div>
            <Text variant="heading" as="h4">{isAr ? 'المهام المجدولة' : 'Scheduled Jobs'}</Text>
            <Text variant="caption" tone="tertiary" as="p">
              {isAr ? 'لا يتم عرض أوامر Cron أو الأسرار.' : 'Cron commands and secrets are never exposed.'}
            </Text>
          </div>
        </div>
        <HealthJobsTable jobs={summary?.jobs ?? []} lang={lang} />
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Clock3 className="size-4 text-ember" aria-hidden="true" />
          <Text variant="heading" as="h4">{isAr ? 'يتطلب الانتباه' : 'Attention Required'}</Text>
        </div>
        {attention.length === 0 ? (
          <div className="flex items-center gap-2 rounded-[var(--radius-ds-md)] border border-mint-line bg-mint-tint px-3 py-3">
            <CheckCircle2 className="size-4 shrink-0 text-mint" aria-hidden="true" />
            <Text variant="label" tone="success" as="p">
              {isAr ? 'لا توجد حوادث تشغيلية تحتاج إلى إجراء حاليًا.' : 'No current operational incidents require action.'}
            </Text>
          </div>
        ) : (
          <div className="space-y-2">
            {attention.map((item, index) => (
              <Notice
                key={`${item.code}-${index}`}
                title={attentionText(item, lang)}
                action={`${isAr ? 'العدد' : 'Count'}: ${item.count}${item.oldest_at ? ` · ${relativeAge(item.oldest_at, lang)}` : ''}`}
                tone={attentionTone(item.severity)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
