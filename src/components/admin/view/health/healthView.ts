/**
 * Pure view-state for the Operations Health Center.
 *
 * Everything here is a total function of its inputs — no React, no fetch, no
 * clock except one that is injectable. These were inline expressions inside the
 * panel, checkable only by looking at a rendered card. They are now checkable
 * directly, which matters most for the two things an operator's trust rests on:
 * how stale a reading is, and which panel a card sends them to.
 *
 * NOTHING here changes behaviour. Each function is the expression that was
 * already there, lifted verbatim.
 */
import type { PillTone } from '../../../../design-system/ui/StatusPill';
import type {
  OperationsHealthAttention,
  OperationsHealthState,
  OperationsHealthSystem,
} from '../../../../lib/operationsHealthApi';

export type AdminLang = 'en' | 'ar';
export type TargetTab = 'integrity' | 'integrations';

/**
 * Background refresh cadence.
 *
 * Named rather than inline so it can be asserted: a silent change here would
 * alter how quickly an operator learns a subsystem has failed, and nothing else
 * in the code would look different.
 */
export const HEALTH_POLL_INTERVAL_MS = 60_000;

/**
 * State → pill tone.
 *
 * Nine backend states collapse onto five tones. Two groupings are deliberate
 * and worth stating:
 *
 *   `idle` is INFO, not success. "No pending work" is not the same claim as
 *   "working correctly", and colouring them alike would let a stalled queue
 *   read as healthy.
 *
 *   `not_configured`, `not_monitored`, `disabled` and `unavailable` are all
 *   NEUTRAL. None of them is a fault — they mean the console has nothing to
 *   say — and tinting them amber would fill the page with warnings nobody can
 *   act on, which is how real warnings stop being read.
 */
export function healthStateTone(state: OperationsHealthState): PillTone {
  switch (state) {
    case 'healthy': return 'success';
    case 'idle': return 'info';
    case 'degraded': return 'warning';
    case 'failing':
    case 'configuration_error': return 'danger';
    case 'disabled':
    case 'not_configured':
    case 'not_monitored':
    case 'unavailable':
    default: return 'neutral';
  }
}

export const STATE_LABELS: Record<OperationsHealthState, { en: string; ar: string }> = {
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

/**
 * Time formatting is SHARED with Operations Alerts — both panels had a
 * character-identical copy, and two copies of a staleness threshold is two
 * places for it to drift. Re-exported so this module stays the one import
 * site for health view-state.
 */
export { relativeAge, exactTime } from '../adminTime';

/**
 * Typed reads out of the backend's untyped `details` bag.
 *
 * Each returns a safe default rather than throwing: this panel is the thing an
 * operator opens WHEN something is wrong, so a malformed field must degrade to
 * a zero or a dash, never to a blank screen.
 */
export function numberValue(details: Record<string, unknown>, key: string): number {
  const value = details[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function stringValue(details: Record<string, unknown>, key: string): string | null {
  const value = details[key];
  return typeof value === 'string' && value ? value : null;
}

export function booleanValue(details: Record<string, unknown>, key: string): boolean | null {
  const value = details[key];
  return typeof value === 'boolean' ? value : null;
}

/**
 * Which console tab a system card links to, or null when it has no panel.
 *
 * The membership list is exact and load-bearing: adding a system here would
 * send an operator to a panel that shows them nothing about it.
 */
const INTEGRATION_SYSTEMS = ['lazywait', 'payment', 'push', 'email', 'otp'];

export function navTargetFor(systemId: OperationsHealthSystem['id']): TargetTab | null {
  if (systemId === 'order_integrity') return 'integrity';
  if (INTEGRATION_SYSTEMS.includes(systemId)) return 'integrations';
  return null;
}

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
  BRANCH_AVAILABILITY_FAILING: {
    en: 'Closed items or paused delivery have stopped reopening on time.',
    ar: 'توقفت الأصناف الموقوفة أو التوصيل المتوقف عن العودة في موعدها.',
  },
  BRANCH_AVAILABILITY_DEGRADED: {
    en: 'Some closures are past their reopening time, or the last availability sweep failed.',
    ar: 'تجاوزت بعض الإيقافات موعد عودتها، أو أخفقت آخر عملية مراجعة للإتاحة.',
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

/**
 * Copy for an attention item, falling back to the raw code.
 *
 * The fallback is deliberate and must stay: a NEW backend code the UI has not
 * learned yet still has to appear. Silently dropping unknown codes would hide
 * exactly the incidents nobody has seen before.
 */
export function attentionText(item: OperationsHealthAttention, lang: AdminLang): string {
  return ATTENTION_TEXT[item.code]?.[lang]
    ?? `${item.subsystem}: ${item.code.replaceAll('_', ' ')}`;
}

/** Attention severity → tone. Anything not critical is a warning. */
export function attentionTone(severity: string): 'blocking' | 'warning' {
  return severity === 'critical' ? 'blocking' : 'warning';
}

/** Telemetry source, humanised. */
export function sourceLabel(source: string): string {
  return source.replaceAll('_', ' ');
}
