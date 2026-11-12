/**
 * Shared time formatting for the admin console.
 *
 * `relativeAge` and `exactTime` existed character-for-character in BOTH the
 * Operations Health and Operations Alerts panels. Two copies of a threshold is
 * two places for it to drift, and a drifted staleness window is invisible in
 * review — one panel would quietly start calling something "1h ago" that the
 * other still called "59m ago".
 *
 * `relativeAge` is that implementation, lifted once and unchanged. `exactTime`
 * moved to the Riyadh clock on 2026-11-12; see its comment.
 */
import { formatRiyadhDateTimeSeconds } from '../../../utils/calculations';

export type AdminLang = 'en' | 'ar';

/**
 * Relative age, coarsest useful unit, localized.
 *
 * `now` is injectable ONLY for testing; production passes nothing and gets
 * Date.now(). An unparseable timestamp reads as an em dash rather than
 * "NaN ago" — a broken reading must not look like a fresh one.
 */
export function relativeAge(
  iso: string | null | undefined,
  lang: AdminLang,
  now: number = Date.now(),
): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '—';
  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (seconds < 60) return lang === 'ar' ? `قبل ${seconds} ث` : `${seconds}s ago`;
  if (seconds < 3600) return lang === 'ar' ? `قبل ${Math.floor(seconds / 60)} د` : `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return lang === 'ar' ? `قبل ${Math.floor(seconds / 3600)} س` : `${Math.floor(seconds / 3600)}h ago`;
  return lang === 'ar' ? `قبل ${Math.floor(seconds / 86400)} يوم` : `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Absolute timestamp for a hover title or an audit row: Riyadh time,
 * "YYYY-MM-DD HH:mm:ss", Latin digits.
 *
 * It used to be `toLocaleString('ar-SA' | 'en-GB')`, which is the DEVICE's
 * zone: an owner abroad read 21:30 for a 00:30 Riyadh event, and Arabic got
 * Arabic-Indic digits and a 12-hour clock. Reports and receipts were already on
 * the Riyadh clock; this puts the console's audit trails on it too.
 *
 * The output is the same in both languages on purpose. `lang` stays in the
 * signature because every caller passes it, not because it changes anything.
 */
export function exactTime(iso: string | null | undefined, lang: AdminLang): string {
  return formatRiyadhDateTimeSeconds(iso);
}
