import React, { useCallback, useEffect, useState } from 'react';
import {
  BellRing, CheckCircle2, ChevronDown, ChevronUp, Clock3,
  FileText, Loader2, RefreshCw, Settings2, ShieldAlert,
} from 'lucide-react';

import {
  operationsAlerts,
  OperationsAlert,
  OperationsAlertEvent,
  OperationsAlertSettings,
  OperationsAlertsFilters,
  OperationsAlertsSummary,
  OperationsDigest,
} from '../../lib/operationsAlertsApi';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { useDsFontClass } from '../../design-system/ui/useDsLang';
import { relativeAge } from './view/adminTime';
import { AlertRow } from './view/alerts/AlertRow';
import {
  DIGEST_HISTORY_LIMIT, SUBSYSTEMS, buildAlertsFilters, severityLabel,
  shouldLoadSection, subsystemLabel,
  type AdminLang, type Section,
} from './view/alerts/alertsView';

/**
 * The three filter selects. Native <select> is deliberate — it gives the OS
 * picker on a phone and keyboard type-ahead on a desktop, neither of which a
 * custom dropdown gets for free. It sits outside <Text>, so it takes the
 * language font class explicitly.
 */
const SELECT = [
  'ds-motion min-h-9 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface',
  'px-2 text-[13px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

/**
 * Operations Alerts & Daily Digest — READ-ONLY observability.
 *
 * THE CURRENT CONTRACT, verified before this migration and preserved by it:
 * there is NO realtime subscription, NO polling timer and NO acknowledgement
 * action. `operationsAlertsApi` exposes only probeAvailability (called by the
 * shell, not here), summary, list, timeline, digestList, digestPreview,
 * settingsGet and settingsUpdate. An operator sees new alerts by changing a
 * filter, switching sections, or pressing Refresh — nothing arrives on its own.
 *
 * That absence is preserved deliberately, not by omission, and
 * `OperationsAlertsPanel.states.test.tsx` asserts it: ten minutes of fake
 * timers produce no second fetch, and an expanded alert offers no acknowledge
 * control.
 *
 * This file owns FETCHING, SECTION STATE AND PERMISSION HANDLING. Layout is in
 * `./view/alerts/*`; derived state is in `alertsView.ts`.
 *
 * PERMISSION NOTE — this panel intentionally differs from Order Integrity.
 * There, triage controls are HIDDEN without permission, because the RPCs are
 * is_admin() gated and a greyed-out button would advertise an impossible
 * action. Here the settings are visible FACTS a non-admin should still be able
 * to read, so they render disabled with an explanation. Do not harmonise these.
 */
export const OperationsAlertsPanel: React.FC<{
  lang: AdminLang;
  isAdmin?: boolean;
}> = ({ lang, isAdmin = false }) => {
  const isAr = lang === 'ar';
  const family = useDsFontClass();
  const [section, setSection] = useState<Section>('inbox');
  const [summary, setSummary] = useState<OperationsAlertsSummary | null>(null);
  const [alerts, setAlerts] = useState<OperationsAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fStatus, setFStatus] = useState<'open' | 'recovered' | 'all'>('open');
  const [fSeverity, setFSeverity] = useState<string>('');
  const [fSubsystem, setFSubsystem] = useState<string>('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Record<string, OperationsAlertEvent[]>>({});

  const [digestLang, setDigestLang] = useState<AdminLang>(lang);
  const [preview, setPreview] = useState<OperationsDigest | null>(null);
  const [history, setHistory] = useState<OperationsDigest[]>([]);
  const [digestError, setDigestError] = useState<string | null>(null);
  const [openDigest, setOpenDigest] = useState<string | null>(null);

  const [settings, setSettings] = useState<OperationsAlertSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = buildAlertsFilters({
        status: fStatus,
        severity: fSeverity,
        subsystem: fSubsystem,
      }) as OperationsAlertsFilters;
      const [s, list] = await Promise.all([
        operationsAlerts.summary(),
        operationsAlerts.list(filters),
      ]);
      setSummary(s);
      setAlerts(list);
    } catch (e) {
      // Fail visibly — never render a false healthy state.
      setError(e instanceof Error ? e.message : (isAr ? 'تعذر تحميل التنبيهات' : 'Failed to load alerts'));
      setSummary(null);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [fStatus, fSeverity, fSubsystem, isAr]);

  useEffect(() => { void load(); }, [load]);

  const loadDigest = useCallback(async (language: AdminLang) => {
    setDigestError(null);
    setPreview(null);
    try {
      const [p, h] = await Promise.all([
        operationsAlerts.digestPreview(language),
        operationsAlerts.digestList(DIGEST_HISTORY_LIMIT),
      ]);
      setPreview(p);
      setHistory(h);
    } catch (e) {
      setDigestError(e instanceof Error ? e.message : (isAr ? 'تعذر تحميل الملخص' : 'Failed to load digest'));
    }
  }, [isAr]);

  useEffect(() => {
    if (shouldLoadSection(section, 'digest')) void loadDigest(digestLang);
  }, [section, digestLang, loadDigest]);

  const loadSettings = useCallback(async () => {
    setSettingsError(null);
    try {
      const bundle = await operationsAlerts.settingsGet();
      setSettings(bundle.settings);
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : (isAr ? 'تعذر تحميل الإعدادات' : 'Failed to load settings'));
    }
  }, [isAr]);

  useEffect(() => {
    if (shouldLoadSection(section, 'settings')) void loadSettings();
  }, [section, loadSettings]);

  const toggleTimeline = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!timelines[id]) {
      try {
        const t = await operationsAlerts.timeline(id);
        setTimelines((prev) => ({ ...prev, [id]: t.events }));
      } catch {
        // Cache an empty array on failure so the row reads "No events" instead
        // of spinning forever. Preserved verbatim.
        setTimelines((prev) => ({ ...prev, [id]: [] }));
      }
    }
  }, [expandedId, timelines]);

  const saveSettings = useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true);
    setSettingsMsg(null);
    setSettingsError(null);
    try {
      const updated = await operationsAlerts.settingsUpdate(patch);
      setSettings(updated);
      setSettingsMsg(isAr ? 'تم حفظ الإعدادات.' : 'Settings saved.');
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : (isAr ? 'فشل الحفظ' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  }, [isAr]);

  const sectionBtn = (id: Section, icon: React.ReactNode, labelEn: string, labelAr: string) => (
    <button
      type="button"
      onClick={() => setSection(id)}
      aria-current={section === id ? 'page' : undefined}
      className={[
        'ds-motion inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-ds-md)] px-3',
        'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
        section === id ? 'bg-ember' : 'bg-con-surface-2 hover:bg-con-surface',
      ].join(' ')}
    >
      {icon}
      <Text variant="label" tone={section === id ? 'onEmber' : 'secondary'} as="span">
        {isAr ? labelAr : labelEn}
      </Text>
    </button>
  );

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <Card className="space-y-3">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BellRing className="size-5 shrink-0 text-ember" aria-hidden="true" />
              <Text variant="title" as="h3">
                {isAr ? 'تنبيهات العمليات والملخص اليومي' : 'Operations Alerts & Daily Digest'}
              </Text>
            </div>
            <Text variant="caption" tone="tertiary" as="p" className="mt-1">
              {isAr
                ? 'مراقبة للقراءة فقط: لا إصلاح تلقائي، لا إعادة محاولة، لا رسائل خارجية.'
                : 'Read-only observability: no auto-remediation, no retries, no external messages.'}
            </Text>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusPill
              label={isAr ? 'الإرسال الخارجي معطل' : 'External delivery disabled'}
              tone="neutral"
            />
            <button
              type="button"
              onClick={() => { void load(); }}
              className="ds-motion inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-ds-md)] bg-ember px-3 text-on-ember transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              <Text variant="label" tone="onEmber" as="span">{isAr ? 'تحديث' : 'Refresh'}</Text>
            </button>
          </div>
        </div>

        {/* Fail-visible: summary and alerts were reset to null/[] on failure, so
            the operator must be told why the inbox looks empty. */}
        {error && <Notice title={error} tone="blocking" />}

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <AlertMetric
            label={isAr ? 'تنبيهات حرجة قائمة' : 'Open critical'}
            value={summary?.open_critical_count ?? '—'}
            tone={summary && summary.open_critical_count > 0 ? 'danger' : undefined}
          />
          <AlertMetric
            label={isAr ? 'تحذيرات قائمة' : 'Open warnings'}
            value={summary?.open_warning_count ?? '—'}
            tone={summary && summary.open_warning_count > 0 ? 'warning' : undefined}
          />
          <AlertMetric label={isAr ? 'تعافت خلال 24س' : 'Recovered 24h'} value={summary?.recovered_last_24h ?? '—'} />
          <AlertMetric
            label={isAr ? 'آخر تقييم' : 'Last evaluation'}
            value={relativeAge((summary?.last_evaluation?.finished_at as string | undefined) ?? null, lang)}
          />
        </div>

        {summary && !summary.alert_evaluation_enabled && (
          <Text variant="caption" tone="tertiary" as="p" className="flex items-center gap-1.5">
            <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
            {isAr
              ? 'محرك التقييم غير مفعل بعد (الوضع الخامل). لا يتم إنشاء تنبيهات جديدة.'
              : 'The evaluator is not enabled yet (dormant mode). No new alerts are being produced.'}
          </Text>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {sectionBtn('inbox', <ShieldAlert className="size-3.5" aria-hidden="true" />, 'Alerts inbox', 'صندوق التنبيهات')}
          {sectionBtn('digest', <FileText className="size-3.5" aria-hidden="true" />, 'Daily digest', 'الملخص اليومي')}
          {sectionBtn('settings', <Settings2 className="size-3.5" aria-hidden="true" />, 'Settings', 'الإعدادات')}
        </div>
      </Card>

      {section === 'inbox' && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value as 'open' | 'recovered' | 'all')}
              className={`${SELECT} ${family}`}
              aria-label={isAr ? 'تصفية الحالة' : 'Filter status'}
            >
              <option value="open">{isAr ? 'قائمة' : 'Open'}</option>
              <option value="recovered">{isAr ? 'تعافت' : 'Recovered'}</option>
              <option value="all">{isAr ? 'الكل' : 'All'}</option>
            </select>
            <select
              value={fSeverity}
              onChange={(e) => setFSeverity(e.target.value)}
              className={`${SELECT} ${family}`}
              aria-label={isAr ? 'تصفية الخطورة' : 'Filter severity'}
            >
              <option value="">{isAr ? 'كل الدرجات' : 'All severities'}</option>
              <option value="critical">{severityLabel('critical', lang)}</option>
              <option value="warning">{severityLabel('warning', lang)}</option>
            </select>
            <select
              value={fSubsystem}
              onChange={(e) => setFSubsystem(e.target.value)}
              className={`${SELECT} ${family}`}
              aria-label={isAr ? 'تصفية النظام' : 'Filter subsystem'}
            >
              <option value="">{isAr ? 'كل الأنظمة' : 'All subsystems'}</option>
              {SUBSYSTEMS.map((s) => (
                <option key={s} value={s}>{subsystemLabel(s, lang)}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <Text variant="body" tone="tertiary" as="p" className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {isAr ? 'جاري التحميل…' : 'Loading…'}
            </Text>
          ) : alerts.length === 0 ? (
            <Text variant="body" tone="secondary" as="p" className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-mint" aria-hidden="true" />
              {isAr
                ? 'لا توجد تنبيهات مطابقة للمرشحات الحالية.'
                : 'No alerts match the current filters.'}
            </Text>
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => (
                <AlertRow
                  key={a.id}
                  alert={a}
                  lang={lang}
                  expanded={expandedId === a.id}
                  events={expandedId === a.id ? (timelines[a.id] ?? null) : null}
                  onToggle={(id) => { void toggleTimeline(id); }}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      {section === 'digest' && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Text variant="heading" as="h4">
              {isAr ? 'معاينة اليوم الحالي' : 'Live preview (today so far)'}
            </Text>
            <div className="flex items-center gap-1">
              {(['en', 'ar'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setDigestLang(code)}
                  aria-pressed={digestLang === code}
                  className={[
                    'ds-motion min-h-9 rounded-[var(--radius-ds-md)] px-2.5 transition-colors duration-150',
                    'focus-visible:outline-2 focus-visible:outline-offset-2',
                    digestLang === code ? 'bg-ember' : 'bg-con-surface-2 hover:bg-con-surface',
                  ].join(' ')}
                >
                  <Text variant="label" tone={digestLang === code ? 'onEmber' : 'secondary'} as="span">
                    {code.toUpperCase()}
                  </Text>
                </button>
              ))}
            </div>
          </div>

          {digestError && <Notice title={digestError} tone="blocking" />}

          {preview ? (
            <div
              className="rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface-2 p-3"
              dir={preview.language === 'ar' ? 'rtl' : 'ltr'}
            >
              <Text variant="label" as="p">{preview.rendered_subject}</Text>
              <Text variant="caption" tone="secondary" as="p" className="mt-2 whitespace-pre-wrap">
                {preview.rendered_body}
              </Text>
            </div>
          ) : !digestError && (
            <Text variant="body" tone="tertiary" as="p" className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {isAr ? 'جاري إنشاء المعاينة…' : 'Building preview…'}
            </Text>
          )}

          <Text variant="heading" as="h4" className="pt-2">
            {isAr ? 'الملخصات المحفوظة' : 'Generated history'}
          </Text>

          {history.length === 0 ? (
            <Text variant="body" tone="tertiary" as="p">
              {isAr
                ? 'لا توجد ملخصات محفوظة بعد — إنشاء الملخص اليومي غير مفعل في هذا الإصدار.'
                : 'No stored digests yet — scheduled generation is not enabled in this version.'}
            </Text>
          ) : (
            <div className="space-y-2">
              {history.map((d) => {
                const key = `${d.digest_date}:${d.language}`;
                const opened = openDigest === key;
                return (
                  <div key={key} className="rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface">
                    <button
                      type="button"
                      onClick={() => setOpenDigest(opened ? null : key)}
                      aria-expanded={opened}
                      className="ds-motion flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <Text variant="label" numeric as="span">{d.digest_date}</Text>
                      <StatusPill label={d.language.toUpperCase()} tone="neutral" />
                      <Text variant="caption" tone="tertiary" as="span">
                        {isAr ? 'جديدة' : 'opened'}: {d.opened_count} · {isAr ? 'تعافت' : 'recovered'}: {d.recovered_count} · {isAr ? 'قائمة' : 'open'}: {d.unresolved_count}
                      </Text>
                      {opened
                        ? <ChevronUp className="ms-auto size-4 shrink-0 text-con-text-3" aria-hidden="true" />
                        : <ChevronDown className="ms-auto size-4 shrink-0 text-con-text-3" aria-hidden="true" />}
                    </button>
                    {opened && (
                      <div
                        className="border-t border-con-line px-3 py-2"
                        dir={d.language === 'ar' ? 'rtl' : 'ltr'}
                      >
                        <Text variant="caption" tone="secondary" as="p" className="whitespace-pre-wrap">
                          {d.rendered_body}
                        </Text>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {section === 'settings' && (
        <Card className="space-y-3">
          {settingsError && <Notice title={settingsError} tone="blocking" />}
          {settingsMsg && <Notice title={settingsMsg} tone="success" />}

          {!settings ? (
            !settingsError && (
              <Text variant="body" tone="tertiary" as="p" className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {isAr ? 'جاري التحميل…' : 'Loading…'}
              </Text>
            )
          ) : (
            <div className="space-y-3">
              {/* Read-only EXPLANATION, not a hidden section. A non-admin should
                  still see WHAT the settings are; they simply cannot change
                  them. This differs from Order Integrity on purpose. */}
              {!isAdmin && (
                <Text variant="caption" tone="secondary" as="p">
                  {isAr
                    ? 'عرض للقراءة فقط — تعديل الإعدادات متاح للمشرفين فقط.'
                    : 'Read-only view — only admins can change these settings.'}
                </Text>
              )}

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {([
                  ['alert_evaluation_enabled', isAr ? 'تفعيل تقييم التنبيهات' : 'Alert evaluation enabled'],
                  ['digest_generation_enabled', isAr ? 'تفعيل إنشاء الملخص اليومي' : 'Digest generation enabled'],
                  ['recovery_notifications_enabled', isAr ? 'إشعارات التعافي' : 'Recovery notifications'],
                  ['optional_system_alerts_enabled', isAr ? 'تنبيهات الأنظمة الاختيارية' : 'Optional-system alerts'],
                ] as Array<[keyof OperationsAlertSettings, string]>).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 py-2"
                  >
                    <Text variant="label" as="span">{label}</Text>
                    <input
                      type="checkbox"
                      checked={settings[key] === true}
                      disabled={!isAdmin || saving}
                      onChange={(e) => { void saveSettings({ [key]: e.target.checked }); }}
                    />
                  </label>
                ))}

                <label className="flex items-center justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface-2 px-3 py-2 opacity-80">
                  <Text variant="label" tone="secondary" as="span">
                    {isAr ? 'الإرسال الخارجي (معطل في هذا الإصدار)' : 'External dispatch (disabled in this version)'}
                  </Text>
                  <input type="checkbox" checked={false} disabled aria-label="external dispatch disabled" />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <AlertMetric label={isAr ? 'المنطقة الزمنية' : 'Timezone'} value={settings.timezone} />
                <AlertMetric label={isAr ? 'وقت الملخص المحلي' : 'Digest local time'} value={settings.digest_local_time} />
                <AlertMetric label={isAr ? 'تذكير التحذير (دقائق)' : 'Warning reminder (min)'} value={settings.warning_reminder_minutes} />
                <AlertMetric label={isAr ? 'تذكير الحرج (دقائق)' : 'Critical reminder (min)'} value={settings.critical_reminder_minutes} />
              </div>

              <Text variant="caption" tone="tertiary" as="p">
                {isAr
                  ? 'ملاحظة: لا يوجد أي مرسل خارجي في هذا الإصدار؛ لا يمكن تفعيل الإرسال الخارجي حتى مع صلاحيات المشرف.'
                  : 'Note: no external dispatcher exists in this version; external delivery cannot be enabled even by admins.'}
              </Text>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

/**
 * One labelled figure. Values render mono — every one is a count, a duration or
 * a timestamp. The optional tone tints the tile only when the count is non-zero,
 * so a quiet board stays quiet.
 */
function AlertMetric({
  label, value, tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'danger' | 'warning';
}) {
  const box =
    tone === 'danger' ? 'bg-danger-tint border-danger-line'
    : tone === 'warning' ? 'bg-warn-tint border-warn-line'
    : 'bg-con-surface-2 border-con-line';
  return (
    <div className={`rounded-[var(--radius-ds-md)] border px-3 py-2 ${box}`}>
      <Text variant="caption" tone="tertiary" as="p">{label}</Text>
      <Text variant="title" numeric as="p">{value}</Text>
    </div>
  );
}
