/**
 * Pure view-state for Operations Alerts.
 *
 * IMPORTANT CONTEXT — the current contract, verified before migrating:
 * this panel has NO realtime subscription, NO polling timer and NO
 * acknowledgement action. It is a load-on-mount read surface; an operator sees
 * new alerts only by changing a filter or switching sections. That absence is
 * part of the contract this migration preserves, and
 * `OperationsAlertsPanel.states.test.tsx` asserts none of them appear.
 *
 * Everything here is a total function of its inputs. These were inline
 * expressions inside the panel, checkable only by rendering it.
 */
import type { PillTone } from '../../../../design-system/ui/StatusPill';
import type { AdminLang } from '../adminTime';

export type { AdminLang };
export type Section = 'inbox' | 'digest' | 'settings';

/** Rows fetched per load. Named so a silent change is a visible diff. */
export const ALERTS_LIST_LIMIT = 200;

/** Digest history depth. */
export const DIGEST_HISTORY_LIMIT = 30;

export const SUBSYSTEMS = [
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

/**
 * Subsystem name, falling back to the raw id.
 *
 * The fallback must stay: a NEW subsystem the UI has not learned yet still has
 * to be identifiable, or its alerts would appear attributed to nothing.
 */
export function subsystemLabel(id: string, lang: AdminLang): string {
  return SUBSYSTEM_TEXT[id]?.[lang] ?? id;
}

const EVENT_TEXT: Record<string, { en: string; ar: string }> = {
  baseline_observed: { en: 'Baseline observed', ar: 'رُصد عند خط الأساس' },
  opened: { en: 'Opened', ar: 'فُتح' },
  escalated: { en: 'Escalated', ar: 'تم التصعيد' },
  downgraded: { en: 'Downgraded', ar: 'خُفضت الدرجة' },
  reminder: { en: 'Reminder', ar: 'تذكير' },
  recovered: { en: 'Recovered', ar: 'تعافى' },
};

/** Timeline event name, falling back to the raw event type. */
export function eventLabel(eventType: string, lang: AdminLang): string {
  return EVENT_TEXT[eventType]?.[lang] ?? eventType;
}

const SEV_TEXT: Record<string, { en: string; ar: string }> = {
  critical: { en: 'Critical', ar: 'حرج' },
  warning: { en: 'Warning', ar: 'تحذير' },
  info: { en: 'Info', ar: 'معلومة' },
};

/**
 * Severity label. An UNKNOWN severity falls back to `info`, matching the
 * original: an unrecognised level must not be silently promoted to critical,
 * and must not disappear either.
 */
export function severityLabel(severity: string, lang: AdminLang): string {
  return (SEV_TEXT[severity] ?? SEV_TEXT.info)[lang];
}

const STATUS_TEXT: Record<string, { en: string; ar: string }> = {
  open: { en: 'Open', ar: 'قائم' },
  recovered: { en: 'Recovered', ar: 'تعافى' },
};

export function statusLabel(status: string, lang: AdminLang): string {
  return STATUS_TEXT[status]?.[lang] ?? status;
}

/** Severity → pill tone. Unknown severities read as info, matching the label. */
export function severityTone(severity: string): PillTone {
  switch (severity) {
    case 'critical': return 'danger';
    case 'warning': return 'warning';
    case 'info':
    default: return 'info';
  }
}

/**
 * Status → pill tone.
 *
 * `open` is WARNING, not danger: severity already carries how bad the alert is,
 * and painting every open alert red would make a critical one indistinguishable
 * from an open info-level one.
 */
export function statusTone(status: string): PillTone {
  return status === 'recovered' ? 'success' : 'warning';
}

/**
 * The exact filter payload sent to `list()`.
 *
 * Extracted so the empty-string-to-null coercion and the limit are assertable.
 * An empty select value means "no filter" and MUST become null, not ''.
 */
export function buildAlertsFilters(input: {
  status: string;
  severity: string;
  subsystem: string;
}): { status: string; severity: string | null; subsystem: string | null; limit: number } {
  return {
    status: input.status,
    severity: (input.severity || null) as string | null,
    subsystem: input.subsystem || null,
    limit: ALERTS_LIST_LIMIT,
  };
}

/**
 * Whether a section's data should be fetched.
 *
 * The digest and settings sections load ONLY when opened. That is deliberate:
 * `digestPreview` renders a full daily summary server-side, and fetching it for
 * an operator who never opens the tab is work nobody asked for.
 */
export function shouldLoadSection(active: Section, target: Section): boolean {
  return active === target;
}

/**
 * Timeline cache state for one alert.
 *
 * `undefined` = never fetched · `null` = fetching · `[]` = fetched and empty OR
 * fetch failed. The last conflation is the ORIGINAL behaviour and is preserved:
 * a failed timeline caches an empty array, so it renders "No events" rather
 * than spinning forever.
 */
export function timelineState(
  cache: Record<string, unknown[]>,
  id: string,
  expandedId: string | null,
): 'closed' | 'loading' | 'loaded' {
  if (expandedId !== id) return 'closed';
  return cache[id] === undefined ? 'loading' : 'loaded';
}
