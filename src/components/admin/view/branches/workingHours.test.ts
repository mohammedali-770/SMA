import { describe, expect, it } from 'vitest';
import {
  WEEKDAYS, crossesMidnight, formatWindow, reorder, validateWeek, weekFrom,
} from './workingHours';
import type { WorkingHoursDay } from '../../../../lib/branchConfigApi';

const day = (over: Partial<WorkingHoursDay> = {}): WorkingHoursDay => ({
  dayOfWeek: 0, isClosed: false, opensAt: '12:00', closesAt: '23:00', ...over,
});

describe('WEEKDAYS', () => {
  it('covers all seven days starting at Sunday, matching day_of_week 0..6', () => {
    expect(WEEKDAYS.map((w) => w.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(WEEKDAYS[0].en).toBe('Sunday');
  });
});

describe('weekFrom', () => {
  it('defaults an unconfigured branch to closed every day', () => {
    const week = weekFrom([]);
    expect(week).toHaveLength(7);
    expect(week.every((d) => d.isClosed)).toBe(true);
  });

  it('keeps stored days and fills only the gaps', () => {
    const week = weekFrom([day({ dayOfWeek: 3 })]);
    expect(week[3].isClosed).toBe(false);
    expect(week[3].opensAt).toBe('12:00');
    expect(week[0].isClosed).toBe(true);
  });
});

describe('crossesMidnight', () => {
  it('detects a late-night window', () => {
    expect(crossesMidnight({ opensAt: '12:00', closesAt: '02:00' })).toBe(true);
  });

  it('treats an equal pair as crossing, i.e. a full 24 hours', () => {
    expect(crossesMidnight({ opensAt: '00:00', closesAt: '00:00' })).toBe(true);
  });

  it('is false for an ordinary same-day window', () => {
    expect(crossesMidnight({ opensAt: '08:00', closesAt: '23:00' })).toBe(false);
  });

  it('is false when either bound is missing', () => {
    expect(crossesMidnight({ opensAt: null, closesAt: '02:00' })).toBe(false);
  });
});

describe('validateWeek', () => {
  it('accepts a normal week', () => {
    expect(validateWeek(weekFrom([day()]), false)).toBeNull();
  });

  it('ACCEPTS a window that crosses midnight', () => {
    // The rule people expect — "closing must be after opening" — is wrong here.
    // A branch trading 12:00 to 02:00 is the normal late-night case, and
    // rejecting it would make those branches unconfigurable.
    const week = weekFrom([day({ opensAt: '12:00', closesAt: '02:00' })]);
    expect(validateWeek(week, false)).toBeNull();
  });

  it('rejects an open day missing a bound', () => {
    const week = weekFrom([day({ closesAt: null })]);
    expect(validateWeek(week, false)).toMatch(/opening and a closing time/i);
  });

  it('rejects a malformed time', () => {
    expect(validateWeek(weekFrom([day({ opensAt: '25:00' })]), false)).toMatch(/invalid time/i);
    expect(validateWeek(weekFrom([day({ opensAt: '9:00' })]), false)).toMatch(/invalid time/i);
  });

  it('ignores closed days entirely', () => {
    const week = weekFrom([day({ isClosed: true, opensAt: null, closesAt: null })]);
    expect(validateWeek(week, false)).toBeNull();
  });

  it('returns Arabic copy when the console is in Arabic', () => {
    const msg = validateWeek(weekFrom([day({ closesAt: null })]), true);
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/[a-z]/i);
  });
});

describe('formatWindow', () => {
  it('marks a midnight-crossing window so it does not read as a typo', () => {
    expect(formatWindow(day({ opensAt: '12:00', closesAt: '02:00' }), false)).toBe('12:00 – 02:00 (+1)');
  });

  it('leaves an ordinary window unmarked', () => {
    expect(formatWindow(day({ opensAt: '08:00', closesAt: '23:00' }), false)).toBe('08:00 – 23:00');
  });

  it('says closed for a closed day, in either language', () => {
    const d = day({ isClosed: true, opensAt: null, closesAt: null });
    expect(formatWindow(d, false)).toBe('Closed');
    expect(formatWindow(d, true)).toBe('مغلق');
  });
});

describe('reorder', () => {
  const items = ['a', 'b', 'c'];

  it('moves an item down and renumbers densely from 1', () => {
    expect(reorder(items, 0, 1)).toEqual([
      { item: 'b', sortOrder: 1 }, { item: 'a', sortOrder: 2 }, { item: 'c', sortOrder: 3 },
    ]);
  });

  it('moves an item up', () => {
    expect(reorder(items, 2, -1).map((r) => r.item)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op at either edge rather than dropping the item', () => {
    expect(reorder(items, 0, -1).map((r) => r.item)).toEqual(items);
    expect(reorder(items, 2, 1).map((r) => r.item)).toEqual(items);
  });

  it('always renumbers densely, so repeated moves cannot drift into gaps', () => {
    const out = reorder(['a', 'b', 'c', 'd'], 3, -2);
    expect(out.map((r) => r.sortOrder)).toEqual([1, 2, 3, 4]);
  });
});
