/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  resolveBranch, parseTime, parseDayCell, splitRows,
  parseHours, parseAreas, hoursTemplate, areasTemplate,
  WEEKDAY_KEYS,
  type ImportBranch,
} from './branchImport';

/**
 * The fixture mirrors the shape of the live table rather than an idealised one:
 * `dup-a` and `dup-b` share an English name, which is the case that actually
 * exists in Production (the same branch with and without a Lazywait id) and the
 * one an import must refuse rather than guess at.
 */
const BRANCHES: ImportBranch[] = [
  { id: 'b-olaya', nameEn: 'Olaya', nameAr: 'العليا' },
  { id: 'b-malaz', nameEn: 'Malaz', nameAr: 'الملز' },
  { id: 'dup-a', nameEn: 'Takhassusi', nameAr: 'التخصصي أ' },
  { id: 'dup-b', nameEn: 'Takhassusi', nameAr: 'التخصصي ب' },
];

const HOURS_HEADER = 'branch\tsun\tmon\ttue\twed\tthu\tfri\tsat';

describe('splitRows', () => {
  it('uses tabs when the document contains any, commas otherwise', () => {
    expect(splitRows('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(splitRows('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('does not switch delimiter per line', () => {
    // One tabbed line makes the whole document tab-separated, so the comma line
    // stays a single cell instead of being silently re-split.
    expect(splitRows('a\tb\nc,d')).toEqual([['a', 'b'], ['c,d']]);
  });

  it('trims each cell and tolerates CRLF', () => {
    expect(splitRows(' a \t b \r\n c \t d ')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('resolveBranch', () => {
  it('resolves by id, English name and Arabic name', () => {
    expect(resolveBranch('b-olaya', BRANCHES).branch?.id).toBe('b-olaya');
    expect(resolveBranch('Olaya', BRANCHES).branch?.id).toBe('b-olaya');
    expect(resolveBranch('العليا', BRANCHES).branch?.id).toBe('b-olaya');
  });

  it('is case-insensitive and tolerates surrounding space on the English name', () => {
    expect(resolveBranch('  oLaYa  ', BRANCHES).branch?.id).toBe('b-olaya');
  });

  it('REFUSES an ambiguous name rather than picking the first match', () => {
    const r = resolveBranch('Takhassusi', BRANCHES);
    expect(r.branch).toBeNull();
    expect(r.message).toContain('matches 2 branches');
  });

  it('still resolves an ambiguous branch by its id', () => {
    expect(resolveBranch('dup-b', BRANCHES).branch?.id).toBe('dup-b');
  });

  it('reports an unknown name and an empty cell distinctly', () => {
    expect(resolveBranch('Nowhere', BRANCHES).message).toContain('no branch matches');
    expect(resolveBranch('   ', BRANCHES).message).toContain('empty');
  });
});

describe('parseTime', () => {
  it('accepts H:MM and HH:MM and pads the hour', () => {
    expect(parseTime('9:05')).toBe('09:05');
    expect(parseTime('23:59')).toBe('23:59');
    expect(parseTime(' 00:00 ')).toBe('00:00');
  });

  it('rejects out-of-range and malformed values', () => {
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('12:60')).toBeNull();
    expect(parseTime('1200')).toBeNull();
    expect(parseTime('12:0')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});

describe('parseDayCell', () => {
  it('treats an empty cell and every closed marker as closed', () => {
    for (const token of ['', 'closed', 'CLOSED', 'off', '-', 'x', 'مغلق']) {
      const r = parseDayCell(token);
      expect(r.message).toBeNull();
      expect(r.isClosed).toBe(true);
      expect(r.opensAt).toBeNull();
    }
  });

  it('parses a normal window', () => {
    expect(parseDayCell('11:00-23:00')).toEqual({
      isClosed: false, opensAt: '11:00', closesAt: '23:00', message: null,
    });
  });

  it('ACCEPTS a window that crosses midnight, which is the normal case here', () => {
    // 11:00-02:00 is what most branches actually trade; rejecting a close that
    // is not after its open would have made the import useless.
    const r = parseDayCell('11:00-02:00');
    expect(r.message).toBeNull();
    expect(r).toMatchObject({ isClosed: false, opensAt: '11:00', closesAt: '02:00' });
  });

  it('accepts an en dash and spaces around the separator', () => {
    expect(parseDayCell('11:00 – 23:00')).toMatchObject({ opensAt: '11:00', closesAt: '23:00' });
  });

  it('rejects a cell that is not a window', () => {
    expect(parseDayCell('11:00').message).toContain('not a time window');
    expect(parseDayCell('11:00-12:00-13:00').message).toContain('not a time window');
  });

  it('rejects a window whose times are not HH:MM', () => {
    expect(parseDayCell('11-23').message).toContain('not HH:MM');
    expect(parseDayCell('25:00-02:00').message).toContain('not HH:MM');
  });
});

describe('parseHours', () => {
  it('returns nothing for an empty paste rather than an error', () => {
    expect(parseHours('   \n  \n', BRANCHES)).toEqual({ rows: [], errors: [] });
  });

  it('parses a row into seven days indexed Sunday-first', () => {
    const plan = parseHours(
      `${HOURS_HEADER}\nOlaya\t11:00-23:00\t11:00-23:00\t11:00-23:00\t11:00-23:00\t11:00-23:00\t13:00-02:00\t11:00-23:00`,
      BRANCHES,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].branch.id).toBe('b-olaya');
    expect(plan.rows[0].days).toHaveLength(7);
    expect(plan.rows[0].days.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // dayOfWeek 5 is Friday, which is the column headed `fri`.
    expect(plan.rows[0].days[5]).toEqual({
      dayOfWeek: 5, isClosed: false, opensAt: '13:00', closesAt: '02:00',
    });
    expect(plan.rows[0].closedCount).toBe(0);
  });

  it('REQUIRES a header and names what is wrong with it', () => {
    const noHeader = parseHours(
      'Olaya\t11:00-23:00\t11:00-23:00\t11:00-23:00\t11:00-23:00\t11:00-23:00\t11:00-23:00\t11:00-23:00',
      BRANCHES,
    );
    expect(noHeader.rows).toEqual([]);
    expect(noHeader.errors[0].message).toContain('must be "branch"');
  });

  it('rejects a header that is missing weekdays, listing them', () => {
    const plan = parseHours('branch\tsun\tmon\ttue\nOlaya\tclosed\tclosed\tclosed', BRANCHES);
    expect(plan.rows).toEqual([]);
    expect(plan.errors[0].message).toContain('wed, thu, fri, sat');
  });

  it('follows the header rather than column position', () => {
    // Days deliberately out of order: Saturday first. A positional parser would
    // write Saturday's window onto Sunday.
    const plan = parseHours(
      'branch\tsat\tsun\tmon\ttue\twed\tthu\tfri\nOlaya\t10:00-11:00\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed',
      BRANCHES,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0].days[6]).toMatchObject({ opensAt: '10:00', closesAt: '11:00' });
    expect(plan.rows[0].days[0].isClosed).toBe(true);
  });

  it('accepts long weekday spellings in the header', () => {
    const plan = parseHours(
      'Branch\tSunday\tMonday\tTuesday\tWednesday\tThursday\tFriday\tSaturday\nOlaya\t11:00-23:00\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed',
      BRANCHES,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0].days[0]).toMatchObject({ opensAt: '11:00' });
  });

  it('ignores an unrecognised trailing column such as the template note', () => {
    const plan = parseHours(
      `${HOURS_HEADER}\tnote\nOlaya\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed\tOlaya branch`,
      BRANCHES,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].closedCount).toBe(7);
  });

  it('reports the pasted line number for an unresolved branch and keeps going', () => {
    const plan = parseHours(
      [
        HOURS_HEADER,
        'Nowhere\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed',
        'Malaz\t11:00-23:00\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed',
      ].join('\n'),
      BRANCHES,
    );
    expect(plan.errors).toEqual([{ line: 2, message: 'no branch matches "Nowhere"' }]);
    expect(plan.rows.map((r) => r.branch.id)).toEqual(['b-malaz']);
  });

  it('refuses the same branch twice and names the earlier line', () => {
    const row = 'Olaya\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed';
    const plan = parseHours([HOURS_HEADER, row, row].join('\n'), BRANCHES);
    expect(plan.rows).toHaveLength(1);
    expect(plan.errors).toEqual([{ line: 3, message: 'Olaya is already set on line 2' }]);
  });

  it('rejects a whole row when one of its cells is malformed', () => {
    const plan = parseHours(
      `${HOURS_HEADER}\nOlaya\t11:00-23:00\tnonsense\tclosed\tclosed\tclosed\tclosed\tclosed`,
      BRANCHES,
    );
    expect(plan.rows).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatchObject({ line: 2 });
    expect(plan.errors[0].message).toContain('mon:');
  });

  it('skips blank lines in the middle of a paste without shifting line numbers', () => {
    const plan = parseHours(
      [
        HOURS_HEADER,
        '',
        'Nowhere\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed',
      ].join('\n'),
      BRANCHES,
    );
    expect(plan.errors[0].line).toBe(3);
  });

  it('refuses an ambiguous branch name in a data row', () => {
    const plan = parseHours(
      `${HOURS_HEADER}\nTakhassusi\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed`,
      BRANCHES,
    );
    expect(plan.rows).toEqual([]);
    expect(plan.errors[0].message).toContain('use the branch id instead');
  });
});

describe('parseAreas', () => {
  const AREAS_HEADER = 'branch\tname_ar\tname_en';

  it('parses rows and carries an optional English name', () => {
    const plan = parseAreas(`${AREAS_HEADER}\nOlaya\tالسليمانية\tSulaimaniyah`, BRANCHES);
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toEqual([
      { branch: BRANCHES[0], nameAr: 'السليمانية', nameEn: 'Sulaimaniyah', duplicate: false },
    ]);
  });

  it('accepts a header without name_en and leaves it null', () => {
    const plan = parseAreas('branch\tname_ar\nOlaya\tالسليمانية', BRANCHES);
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0].nameEn).toBeNull();
  });

  it('treats an empty name_en cell as null rather than an empty string', () => {
    const plan = parseAreas(`${AREAS_HEADER}\nOlaya\tالسليمانية\t`, BRANCHES);
    expect(plan.rows[0].nameEn).toBeNull();
  });

  it('requires the header', () => {
    const plan = parseAreas('Olaya\tالسليمانية', BRANCHES);
    expect(plan.rows).toEqual([]);
    expect(plan.errors[0].message).toContain('name_ar');
  });

  it('requires name_ar on each row', () => {
    const plan = parseAreas(`${AREAS_HEADER}\nOlaya\t\tSulaimaniyah`, BRANCHES);
    expect(plan.rows).toEqual([]);
    expect(plan.errors).toEqual([{ line: 2, message: 'name_ar is required' }]);
  });

  it('MARKS a duplicate of an existing area, because addArea always inserts', () => {
    const plan = parseAreas(
      `${AREAS_HEADER}\nOlaya\tالسليمانية\tSulaimaniyah`,
      BRANCHES,
      [{ branchId: 'b-olaya', nameAr: 'السليمانية' }],
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0].duplicate).toBe(true);
  });

  it('scopes the duplicate check to the branch', () => {
    const plan = parseAreas(
      `${AREAS_HEADER}\nMalaz\tالسليمانية\tSulaimaniyah`,
      BRANCHES,
      [{ branchId: 'b-olaya', nameAr: 'السليمانية' }],
    );
    expect(plan.rows[0].duplicate).toBe(false);
  });

  it('marks the SECOND occurrence within one paste as a duplicate, keeping the first', () => {
    const plan = parseAreas(
      [AREAS_HEADER, 'Olaya\tالسليمانية\t', 'Olaya\tالسليمانية\t'].join('\n'),
      BRANCHES,
    );
    expect(plan.rows.map((r) => r.duplicate)).toEqual([false, true]);
  });

  it('reports an unresolved branch by pasted line and keeps the rest', () => {
    const plan = parseAreas(
      [AREAS_HEADER, 'Nowhere\tحي\t', 'Malaz\tحي\t'].join('\n'),
      BRANCHES,
    );
    expect(plan.errors).toEqual([{ line: 2, message: 'no branch matches "Nowhere"' }]);
    expect(plan.rows).toHaveLength(1);
  });

  it('finds name_ar and name_en wherever the header puts them', () => {
    const plan = parseAreas('branch\tname_en\tname_ar\nOlaya\tSulaimaniyah\tالسليمانية', BRANCHES);
    expect(plan.rows[0]).toMatchObject({ nameAr: 'السليمانية', nameEn: 'Sulaimaniyah' });
  });
});

describe('templates', () => {
  it('produces an hours sheet that parses back with no errors', () => {
    const plan = parseHours(hoursTemplate(BRANCHES), BRANCHES);
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(BRANCHES.length);
    expect(plan.rows.every((r) => r.closedCount === 7)).toBe(true);
    expect(plan.rows.map((r) => r.branch.id).sort()).toEqual(
      BRANCHES.map((b) => b.id).sort(),
    );
  });

  it('uses the id for a branch whose name is not unique, so its own sheet imports', () => {
    // Emitting "Takhassusi" twice would hand the administrator a template that
    // fails on exactly the rows they most need help with.
    const lines = hoursTemplate(BRANCHES).split('\n');
    const dup = lines.filter((l) => l.startsWith('dup-'));
    expect(dup).toHaveLength(2);
    expect(lines[1].startsWith('Olaya\t')).toBe(true);
  });

  it('carries a note column so two identically named branches stay distinguishable', () => {
    const lines = hoursTemplate(BRANCHES).split('\n');
    expect(lines[0].split('\t')).toEqual(['branch', ...WEEKDAY_KEYS, 'note']);
    expect(lines.find((l) => l.startsWith('dup-a'))?.endsWith('\tTakhassusi')).toBe(true);
  });

  it('produces an areas sheet whose header parses, with every row awaiting a name', () => {
    const plan = parseAreas(areasTemplate(BRANCHES), BRANCHES);
    expect(plan.rows).toEqual([]);
    // Every row is rejected for the same reason: the administrator must fill in
    // the area names. That is the template doing its job, not a parse failure.
    expect(plan.errors).toHaveLength(BRANCHES.length);
    expect(plan.errors.every((e) => e.message === 'name_ar is required')).toBe(true);
  });

  it('fills an areas template and parses it back', () => {
    const filled = areasTemplate(BRANCHES)
      .split('\n')
      .map((l, i) => (i === 1 ? l.replace('\t\t\t', '\tالسليمانية\tSulaimaniyah\t') : l))
      .join('\n');
    const plan = parseAreas(filled, BRANCHES);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ nameAr: 'السليمانية', nameEn: 'Sulaimaniyah' });
  });
});
