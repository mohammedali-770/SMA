/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WeekdayIndex, WorkingHoursDay } from '../../../../lib/branchConfigApi';

/**
 * Pure logic for the branch working-hours editor, kept out of the component so
 * it can be tested directly — the same split as
 * `src/components/admin/branchDeletion.ts`.
 *
 * THE RULE THAT SURPRISES PEOPLE: a closing time at or before the opening time
 * is VALID and means the window crosses midnight (12:00 → 02:00). A late-night
 * branch is the normal case here, not an error. Validation must not "helpfully"
 * reject it, and a reader of the stored row must not treat it as inverted data.
 */

export const WEEKDAYS: { index: WeekdayIndex; en: string; ar: string }[] = [
  { index: 0, en: 'Sunday',    ar: 'الأحد' },
  { index: 1, en: 'Monday',    ar: 'الاثنين' },
  { index: 2, en: 'Tuesday',   ar: 'الثلاثاء' },
  { index: 3, en: 'Wednesday', ar: 'الأربعاء' },
  { index: 4, en: 'Thursday',  ar: 'الخميس' },
  { index: 5, en: 'Friday',    ar: 'الجمعة' },
  { index: 6, en: 'Saturday',  ar: 'السبت' },
];

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A full week, defaulting any day the branch has never configured to closed. */
export function weekFrom(stored: WorkingHoursDay[]): WorkingHoursDay[] {
  const byDay = new Map(stored.map((d) => [d.dayOfWeek, d]));
  return WEEKDAYS.map(({ index }) =>
    byDay.get(index) ?? { dayOfWeek: index, isClosed: true, opensAt: null, closesAt: null });
}

/** True when this window runs past midnight into the next day. */
export function crossesMidnight(day: Pick<WorkingHoursDay, 'opensAt' | 'closesAt'>): boolean {
  if (!day.opensAt || !day.closesAt) return false;
  return day.closesAt <= day.opensAt;
}

/**
 * Returns a human-readable problem with the week, or null when it is worth
 * sending. The server re-validates all of this; failing to catch it here
 * produces a clear error rather than bad data.
 */
export function validateWeek(week: WorkingHoursDay[], isRTL: boolean): string | null {
  for (const day of week) {
    if (day.isClosed) continue;
    const name = WEEKDAYS.find((w) => w.index === day.dayOfWeek);
    const label = isRTL ? name?.ar : name?.en;
    if (!day.opensAt || !day.closesAt) {
      return isRTL
        ? `${label}: أدخل وقت الفتح والإغلاق أو علّم اليوم كمغلق.`
        : `${label}: enter both an opening and a closing time, or mark the day closed.`;
    }
    if (!HM.test(day.opensAt) || !HM.test(day.closesAt)) {
      return isRTL ? `${label}: صيغة الوقت غير صحيحة.` : `${label}: invalid time.`;
    }
    // Deliberately NO check that closesAt > opensAt — see the module docblock.
  }
  return null;
}

/** `12:00 – 02:00 (+1)` — the marker is what stops the row reading as a typo. */
export function formatWindow(day: WorkingHoursDay, isRTL: boolean): string {
  if (day.isClosed || !day.opensAt || !day.closesAt) return isRTL ? 'مغلق' : 'Closed';
  const next = crossesMidnight(day) ? (isRTL ? ' (اليوم التالي)' : ' (+1)') : '';
  return `${day.opensAt} – ${day.closesAt}${next}`;
}

/**
 * Move an item within an ordered list and renumber from 1.
 *
 * Renumbering the whole list rather than swapping two values keeps the sequence
 * dense, so a list that has been reordered many times cannot drift into
 * collisions or gaps that make the next move ambiguous.
 */
export function reorder<T>(items: T[], index: number, delta: number): { item: T; sortOrder: number }[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return items.map((item, i) => ({ item, sortOrder: i + 1 }));
  }
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next.map((item, i) => ({ item, sortOrder: i + 1 }));
}
