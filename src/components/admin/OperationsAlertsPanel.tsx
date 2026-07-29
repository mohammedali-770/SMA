import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, BellRing, CheckCircle2, ChevronDown, ChevronUp, Clock3,
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

type AdminLang = 'en' | 'ar';
type Section = 'inbox' | 'digest' | 'settings';

const SEV_TONE: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  info: 'bg-sky-100 text-sky-800 border-sky-200',
};

const STATUS_TONE: Record<string, string> = {
  open: 'bg-orange-100 text-orange-800 border-orange-200',
  recovered: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const SUBSYSTEMS = [
  'platform', 'lazywait', 'order_integrity', 'account_deletion',
  'database_jobs', 'payment', 'push', 'email', 'otp',
];

const SUBSYSTEM_TEXT: Record<string, { en: string; ar: string }> = {
  platform: { en: 'Platform', ar: 'المنصة' },
  lazywait: { en: 'Lazywait Sync', ar: 'مزامنة Lazywait' },
  order_integrity: { en: 'Order Integrity', ar: 'سلامة الطلبات' },
  account_deletion: { en: 'Account Deletion', ar: 'حذف الحسابات' },
  database_jobs: { en: 'Scheduled Jobs', ar: 'المهام المجدولة' },
  payment: { en: 'Payment / Tap', ar: 'الدفع / Tap' },
  push: { en: 'Push Notifications', ar: 'الإشعارات الفورية' },
  email: { en: 'Email / SMTP', ar: 'البريد / SMTP' },
  otp: { en: 'WhatsApp / OTP', ar: 'واتساب / رمز التحقق' },
};

const EVENT_TEXT: Record<string, { en: string; ar: string }> = {
  baseline_observed: { en: 'Baseline observed', ar: 'رُصد عند خط الأساس' },
  opened: { en: 'Opened', ar: 'فُتح' },
  escalated: { en: 'Escalated', ar: 'تم التصعيد' },
  downgraded: { en: 'Downgraded', ar: 'خُفضت الدرجة' },
  reminder: { en: 'Reminder', ar: 'تذكير' },
  recovered: { en: 'Recovered', ar: 'تعافى' },
};

const SEV_TEXT: Record<string, { en: string; ar: string }> = {
  critical: { en: 'Critical', ar: 'حرج' },
  warning: { en: 'Warning', ar: 'تحذير' },
  info: { en: 'Info', ar: 'معلومة' },
};

const STATUS_TEXT: Record<string, { en: string; ar: string }> = {
  open: { en: 'Open', ar: 'قائم' },
  recovered: { en: 'Recovered', ar: 'تعافى' },
};

function subsystemLabel(id: string, lang: AdminLang): string {
  const t = SUBSYSTEM_TEXT[id];
  return t ? t[lang] : id;
}

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

const Metric: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
  <div className={`rounded-xl border px-3 py-2 ${tone ?? 'bg-white/50 border-slate-100'}`}>
    <p className="text-[8px] uppercase font-black text-slate-600">{label}</p>
    <p className="text-sm font-black text-slate-800">{value}</p>
  </div>
);

const SevBadge: React.FC<{ severity: string; lang: AdminLang }> = ({ severity, lang }) => (
  <span className={`border rounded-full px-2 py-0.5 text-[8.5px] font-black ${SEV_TONE[severity] ?? SEV_TONE.info}`}>
    {(SEV_TEXT[severity] ?? SEV_TEXT.info)[lang]}
  </span>
);

const AlertRow: React.FC<{
  alert: OperationsAlert;
  lang: AdminLang;
  expanded: boolean;
  events: OperationsAlertEvent[] | null;
  onToggle: (id: string) => void;
}> = ({ alert, lang, expanded, events, onToggle }) => {
  const isAr = lang === 'ar';
  return (
    <div className="rounded-xl border border-slate-100 bg-white/50">
      <button
        type="button"
        onClick={() => onToggle(alert.id)}
        className="w-full text-start px-3 py-2 flex items-center gap-2"
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-black text-slate-800">
              {subsystemLabel(alert.subsystem, lang)}
            </span>
            <span className="font-mono text-[8.5px] text-slate-600">{alert.condition_code}</span>
            <SevBadge severity={alert.severity} lang={lang} />
            <span className={`border rounded-full px-2 py-0.5 text-[8.5px] font-black ${STATUS_TONE[alert.status]}`}>
              {STATUS_TEXT[alert.status][lang]}
            </span>
            {alert.baseline && (
              <span className="border rounded-full px-2 py-0.5 text-[8.5px] font-black bg-sky-50 text-sky-700 border-sky-200">
                {isAr ? 'خط الأساس' : 'Baseline'}
              </span>
            )}
          </div>
          <p className="text-[8.5px] text-slate-600 font-bold mt-0.5">
            {isAr ? 'أول رصد' : 'First seen'}: <span title={exactTime(alert.first_seen_at, lang)}>{relativeAge(alert.first_seen_at, lang)}</span>
            {' · '}
            {isAr ? 'آخر رصد' : 'Last seen'}: <span title={exactTime(alert.last_seen_at, lang)}>{relativeAge(alert.last_seen_at, lang)}</span>
            {' · '}
            {isAr ? 'مرات الرصد' : 'Occurrences'}: {alert.occurrence_count}
            {' · '}
            {isAr ? 'الجيل' : 'Generation'}: {alert.generation}
          </p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
          : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />}
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-3 py-2 space-y-1.5">
          <p className="font-mono text-[8.5px] text-slate-600 break-all">{alert.fingerprint}</p>
          {events === null ? (
            <p className="text-[9px] text-slate-600 font-bold flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              {isAr ? 'جاري تحميل الأحداث…' : 'Loading timeline…'}
            </p>
          ) : events.length === 0 ? (
            <p className="text-[9px] text-slate-600 font-bold">{isAr ? 'لا توجد أحداث.' : 'No events.'}</p>
          ) : (
            <ul className="space-y-1">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-[9px] font-bold text-slate-600">
                  <SevBadge severity={e.severity} lang={lang} />
                  <span>{(EVENT_TEXT[e.event_type] ?? { en: e.event_type, ar: e.event_type })[lang]}</span>
                  <span className="text-slate-600" title={exactTime(e.created_at, lang)}>
                    {relativeAge(e.created_at, lang)}
                  </span>
                  {e.notification_suppressed && (
                    <span className="text-[8px] text-slate-600">
                      {isAr ? '(بدون إشعار)' : '(notification suppressed)'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export const OperationsAlertsPanel: React.FC<{
  lang: AdminLang;
  isAdmin?: boolean;
}> = ({ lang, isAdmin = false }) => {
  const isAr = lang === 'ar';
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
      const filters: OperationsAlertsFilters = {
        status: fStatus,
        severity: (fSeverity || null) as OperationsAlertsFilters['severity'],
        subsystem: fSubsystem || null,
        limit: 200,
      };
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
        operationsAlerts.digestList(30),
      ]);
      setPreview(p);
      setHistory(h);
    } catch (e) {
      setDigestError(e instanceof Error ? e.message : (isAr ? 'تعذر تحميل الملخص' : 'Failed to load digest'));
    }
  }, [isAr]);

  useEffect(() => {
    if (section === 'digest') void loadDigest(digestLang);
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
    if (section === 'settings') void loadSettings();
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
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-black transition-all ${section === id ? 'glass-btn-primary text-white' : 'bg-white/50 text-slate-600 hover:bg-white/70'}`}
    >
      {icon}{isAr ? labelAr : labelEn}
    </button>
  );

  return (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <header className="glass-card rounded-2xl bg-white/45 p-4 border border-white/60 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BellRing className="w-5 h-5 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-black text-slate-800">
                {isAr ? 'تنبيهات العمليات والملخص اليومي' : 'Operations Alerts & Daily Digest'}
              </h3>
            </div>
            <p className="text-[9px] text-slate-600 font-bold mt-1">
              {isAr
                ? 'مراقبة للقراءة فقط: لا إصلاح تلقائي، لا إعادة محاولة، لا رسائل خارجية.'
                : 'Read-only observability: no auto-remediation, no retries, no external messages.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="border rounded-full px-2.5 py-1 text-[8.5px] font-black bg-slate-100 text-slate-600 border-slate-200">
              {isAr ? 'الإرسال الخارجي معطل' : 'External delivery disabled'}
            </span>
            <button
              type="button"
              onClick={() => { void load(); }}
              className="rounded-xl bg-primary text-white px-3 py-2 text-[9px] font-black inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              {isAr ? 'تحديث' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-100 text-red-700 px-3 py-2 text-[9.5px] font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Metric
            label={isAr ? 'تنبيهات حرجة قائمة' : 'Open critical'}
            value={summary?.open_critical_count ?? '—'}
            tone={summary && summary.open_critical_count > 0 ? SEV_TONE.critical : undefined}
          />
          <Metric
            label={isAr ? 'تحذيرات قائمة' : 'Open warnings'}
            value={summary?.open_warning_count ?? '—'}
            tone={summary && summary.open_warning_count > 0 ? SEV_TONE.warning : undefined}
          />
          <Metric label={isAr ? 'تعافت خلال 24س' : 'Recovered 24h'} value={summary?.recovered_last_24h ?? '—'} />
          <Metric
            label={isAr ? 'آخر تقييم' : 'Last evaluation'}
            value={relativeAge(
              (summary?.last_evaluation?.finished_at as string | undefined) ?? null, lang)}
          />
        </div>

        {summary && !summary.alert_evaluation_enabled && (
          <p className="text-[9px] font-bold text-slate-600 flex items-center gap-1.5">
            <Clock3 className="w-3.5 h-3.5" aria-hidden="true" />
            {isAr
              ? 'محرك التقييم غير مفعل بعد (الوضع الخامل). لا يتم إنشاء تنبيهات جديدة.'
              : 'The evaluator is not enabled yet (dormant mode). No new alerts are being produced.'}
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {sectionBtn('inbox', <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />, 'Alerts inbox', 'صندوق التنبيهات')}
          {sectionBtn('digest', <FileText className="w-3.5 h-3.5" aria-hidden="true" />, 'Daily digest', 'الملخص اليومي')}
          {sectionBtn('settings', <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />, 'Settings', 'الإعدادات')}
        </div>
      </header>

      {section === 'inbox' && (
        <section className="glass-card rounded-2xl bg-white/45 border border-white/60 p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value as 'open' | 'recovered' | 'all')}
              className="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[9.5px] font-bold"
              aria-label={isAr ? 'تصفية الحالة' : 'Filter status'}
            >
              <option value="open">{isAr ? 'قائمة' : 'Open'}</option>
              <option value="recovered">{isAr ? 'تعافت' : 'Recovered'}</option>
              <option value="all">{isAr ? 'الكل' : 'All'}</option>
            </select>
            <select
              value={fSeverity}
              onChange={(e) => setFSeverity(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[9.5px] font-bold"
              aria-label={isAr ? 'تصفية الخطورة' : 'Filter severity'}
            >
              <option value="">{isAr ? 'كل الدرجات' : 'All severities'}</option>
              <option value="critical">{SEV_TEXT.critical[lang]}</option>
              <option value="warning">{SEV_TEXT.warning[lang]}</option>
            </select>
            <select
              value={fSubsystem}
              onChange={(e) => setFSubsystem(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[9.5px] font-bold"
              aria-label={isAr ? 'تصفية النظام' : 'Filter subsystem'}
            >
              <option value="">{isAr ? 'كل الأنظمة' : 'All subsystems'}</option>
              {SUBSYSTEMS.map((s) => (
                <option key={s} value={s}>{subsystemLabel(s, lang)}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="text-[10px] text-slate-600 font-bold flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              {isAr ? 'جاري التحميل…' : 'Loading…'}
            </p>
          ) : alerts.length === 0 ? (
            <p className="text-[10px] text-slate-600 font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              {isAr
                ? 'لا توجد تنبيهات مطابقة للمرشحات الحالية.'
                : 'No alerts match the current filters.'}
            </p>
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
        </section>
      )}

      {section === 'digest' && (
        <section className="glass-card rounded-2xl bg-white/45 border border-white/60 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-[11px] font-black text-slate-700 uppercase">
              {isAr ? 'معاينة اليوم الحالي' : 'Live preview (today so far)'}
            </h4>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDigestLang('en')}
                className={`rounded-lg px-2.5 py-1 text-[9px] font-black ${digestLang === 'en' ? 'glass-btn-primary text-white' : 'bg-white/60 text-slate-600'}`}
              >EN</button>
              <button
                type="button"
                onClick={() => setDigestLang('ar')}
                className={`rounded-lg px-2.5 py-1 text-[9px] font-black ${digestLang === 'ar' ? 'glass-btn-primary text-white' : 'bg-white/60 text-slate-600'}`}
              >AR</button>
            </div>
          </div>
          {digestError && (
            <div className="rounded-xl bg-red-50 border border-red-100 text-red-700 px-3 py-2 text-[9.5px] font-bold">
              {digestError}
            </div>
          )}
          {preview ? (
            <div className="rounded-xl border border-slate-100 bg-white/60 p-3" dir={preview.language === 'ar' ? 'rtl' : 'ltr'}>
              <p className="text-[10px] font-black text-slate-800">{preview.rendered_subject}</p>
              <pre className="text-[9px] font-bold text-slate-600 whitespace-pre-wrap mt-2 font-sans">
                {preview.rendered_body}
              </pre>
            </div>
          ) : !digestError && (
            <p className="text-[10px] text-slate-600 font-bold flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              {isAr ? 'جاري إنشاء المعاينة…' : 'Building preview…'}
            </p>
          )}

          <h4 className="text-[11px] font-black text-slate-700 uppercase pt-2">
            {isAr ? 'الملخصات المحفوظة' : 'Generated history'}
          </h4>
          {history.length === 0 ? (
            <p className="text-[10px] text-slate-600 font-bold">
              {isAr
                ? 'لا توجد ملخصات محفوظة بعد — إنشاء الملخص اليومي غير مفعل في هذا الإصدار.'
                : 'No stored digests yet — scheduled generation is not enabled in this version.'}
            </p>
          ) : (
            <div className="space-y-2">
              {history.map((d) => {
                const key = `${d.digest_date}:${d.language}`;
                const opened = openDigest === key;
                return (
                  <div key={key} className="rounded-xl border border-slate-100 bg-white/50">
                    <button
                      type="button"
                      onClick={() => setOpenDigest(opened ? null : key)}
                      className="w-full text-start px-3 py-2 flex items-center gap-2"
                    >
                      <span className="text-[10px] font-black text-slate-800">{d.digest_date}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[8px] font-black uppercase">{d.language}</span>
                      <span className="text-[8.5px] text-slate-600 font-bold">
                        {isAr ? 'جديدة' : 'opened'}: {d.opened_count} · {isAr ? 'تعافت' : 'recovered'}: {d.recovered_count} · {isAr ? 'قائمة' : 'open'}: {d.unresolved_count}
                      </span>
                      {opened
                        ? <ChevronUp className="w-4 h-4 text-slate-500 ms-auto" aria-hidden="true" />
                        : <ChevronDown className="w-4 h-4 text-slate-500 ms-auto" aria-hidden="true" />}
                    </button>
                    {opened && (
                      <div className="border-t border-slate-100 px-3 py-2" dir={d.language === 'ar' ? 'rtl' : 'ltr'}>
                        <pre className="text-[9px] font-bold text-slate-600 whitespace-pre-wrap font-sans">
                          {d.rendered_body}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {section === 'settings' && (
        <section className="glass-card rounded-2xl bg-white/45 border border-white/60 p-4 space-y-3">
          {settingsError && (
            <div className="rounded-xl bg-red-50 border border-red-100 text-red-700 px-3 py-2 text-[9.5px] font-bold">
              {settingsError}
            </div>
          )}
          {settingsMsg && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-2 text-[9.5px] font-bold">
              {settingsMsg}
            </div>
          )}
          {!settings ? (
            !settingsError && (
              <p className="text-[10px] text-slate-600 font-bold flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                {isAr ? 'جاري التحميل…' : 'Loading…'}
              </p>
            )
          ) : (
            <div className="space-y-3">
              {!isAdmin && (
                <p className="text-[9px] font-bold text-slate-600">
                  {isAr
                    ? 'عرض للقراءة فقط — تعديل الإعدادات متاح للمشرفين فقط.'
                    : 'Read-only view — only admins can change these settings.'}
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {([
                  ['alert_evaluation_enabled', isAr ? 'تفعيل تقييم التنبيهات' : 'Alert evaluation enabled'],
                  ['digest_generation_enabled', isAr ? 'تفعيل إنشاء الملخص اليومي' : 'Digest generation enabled'],
                  ['recovery_notifications_enabled', isAr ? 'إشعارات التعافي' : 'Recovery notifications'],
                  ['optional_system_alerts_enabled', isAr ? 'تنبيهات الأنظمة الاختيارية' : 'Optional-system alerts'],
                ] as Array<[keyof OperationsAlertSettings, string]>).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white/60 px-3 py-2">
                    <span className="text-[9.5px] font-black text-slate-700">{label}</span>
                    <input
                      type="checkbox"
                      checked={settings[key] === true}
                      disabled={!isAdmin || saving}
                      onChange={(e) => { void saveSettings({ [key]: e.target.checked }); }}
                    />
                  </label>
                ))}
                <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 opacity-80">
                  <span className="text-[9.5px] font-black text-slate-600">
                    {isAr ? 'الإرسال الخارجي (معطل في هذا الإصدار)' : 'External dispatch (disabled in this version)'}
                  </span>
                  <input type="checkbox" checked={false} disabled aria-label="external dispatch disabled" />
                </label>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Metric label={isAr ? 'المنطقة الزمنية' : 'Timezone'} value={settings.timezone} />
                <Metric label={isAr ? 'وقت الملخص المحلي' : 'Digest local time'} value={settings.digest_local_time} />
                <Metric label={isAr ? 'تذكير التحذير (دقائق)' : 'Warning reminder (min)'} value={settings.warning_reminder_minutes} />
                <Metric label={isAr ? 'تذكير الحرج (دقائق)' : 'Critical reminder (min)'} value={settings.critical_reminder_minutes} />
              </div>
              <p className="text-[8.5px] text-slate-600 font-bold">
                {isAr
                  ? 'ملاحظة: لا يوجد أي مرسل خارجي في هذا الإصدار؛ لا يمكن تفعيل الإرسال الخارجي حتى مع صلاحيات المشرف.'
                  : 'Note: no external dispatcher exists in this version; external delivery cannot be enabled even by admins.'}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
