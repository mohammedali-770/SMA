/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WeekdayIndex, WorkingHoursDay } from './branchConfigApi';

/**
 * Parsing and planning for the branch reference-data import.
 *
 * WHY THIS EXISTS. Working hours and delivery areas are fully built, tested and
 * RLS'd — and completely empty: across 40 branches there are zero working-hours
 * rows and zero delivery areas, so every screen that answers "when is this
 * branch open" or "where does it deliver" renders a dash. Filling that in one
 * branch at a time through a form is forty visits; this takes a paste from a
 * spreadsheet.
 *
 * IT WRITES THROUGH THE EXISTING ADMIN RPCs and adds no new ones, so there is
 * no migration and no new authorization surface. Everything here is parsing,
 * validation and planning; the apply step calls `branchConfig.saveWorkingHours`
 * and `branchConfig.addArea`, which already check `is_admin()`.
 *
 * THE DESIGN RULE THROUGHOUT: refuse rather than guess. An import that silently
 * picks a branch, or silently skips a malformed row, is worse than one that
 * fails — a wrong trading hour is invisible until a customer is turned away.
 */

/** The subset of a branch this module needs. */
export interface ImportBranch {
  id: string;
  nameEn: string;
  nameAr: string;
}

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** Longer spellings people actually paste, mapped to the canonical key. */
const WEEKDAY_ALIASES: Record<string, WeekdayKey> = {
  sun: 'sun',
  sunday: 'sun',
  mon: 'mon',
  monday: 'mon',
  tue: 'tue',
  tues: 'tue',
  tuesday: 'tue',
  wed: 'wed',
  weds: 'wed',
  wednesday: 'wed',
  thu: 'thu',
  thur: 'thu',
  thurs: 'thu',
  thursday: 'thu',
  fri: 'fri',
  friday: 'fri',
  sat: 'sat',
  saturday: 'sat',
};

export interface RowError {
  /** 1-based line number AS PASTED, so the message points at what the user sees. */
  line: number;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Shared parsing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Split a pasted document into cells.
 *
 * Delimiter is decided ONCE for the whole document rather than per line: a
 * spreadsheet paste is tab-separated throughout, and switching per line would
 * make one stray tab silently re-interpret every other row.
 */
export function splitRows(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  const delimiter = text.includes('\t') ? '\t' : ',';
  return lines.map((line) => line.split(delimiter).map((c) => c.trim()));
}

function isBlank(cells: string[]): boolean {
  return cells.every((c) => c === '');
}

/**
 * Resolve a branch by id, English name or Arabic name.
 *
 * AMBIGUITY IS AN ERROR, NOT A COIN FLIP. This database currently holds 40
 * branch rows including visible duplicates — the same branch with and without a
 * `lazywait_branch_id`. Picking the first match would write trading hours onto
 * whichever row happened to sort first, and nothing downstream would notice.
 */
/**
 * A result carrying BOTH fields rather than a discriminated union.
 *
 * This project's tsconfig does not enable `strict`, so `strictNullChecks` is
 * off — and without it TypeScript will not narrow a union on a BOOLEAN literal
 * discriminant, so `if (!result.ok)` leaves `result.message` unreachable. One
 * shape with nullable fields needs no narrowing at all and cannot regress if
 * strictness changes later.
 */
export interface BranchResolution {
  branch: ImportBranch | null;
  message: string | null;
}

export function resolveBranch(token: string, branches: readonly ImportBranch[]): BranchResolution {
  const needle = token.trim();
  if (!needle) return { branch: null, message: 'the branch column is empty' };

  const byId = branches.filter((b) => b.id === needle);
  if (byId.length === 1) return { branch: byId[0], message: null };

  const lower = needle.toLocaleLowerCase();
  const matches = branches.filter(
    (b) => b.nameEn.trim().toLocaleLowerCase() === lower || b.nameAr.trim() === needle,
  );
  if (matches.length === 1) return { branch: matches[0], message: null };
  if (matches.length === 0) return { branch: null, message: `no branch matches "${needle}"` };
  return {
    branch: null,
    message: `"${needle}" matches ${matches.length} branches — use the branch id instead`,
  };
}

/** 'HH:MM' with a real hour and minute, or null. */
export function parseTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

const CLOSED_TOKENS = new Set(['closed', 'close', 'off', '-', '—', 'x', 'مغلق']);

/**
 * One day cell: `11:00-02:00`, or a closed marker.
 *
 * A window whose close is at or before its open is VALID and means it crosses
 * midnight — `admin_upsert_branch_working_hours` says so explicitly, and a
 * restaurant open 11:00–02:00 is the normal case here rather than the exception.
 * Rejecting it would have made the import useless for most branches.
 */
export interface DayCellResult {
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
  /** Non-null means the cell was rejected; the other fields are meaningless. */
  message: string | null;
}

export function parseDayCell(raw: string): DayCellResult {
  const cell = raw.trim();
  if (cell === '' || CLOSED_TOKENS.has(cell.toLocaleLowerCase())) {
    return { isClosed: true, opensAt: null, closesAt: null, message: null };
  }
  const parts = cell.split(/\s*[-–]\s*/);
  if (parts.length !== 2) {
    return {
      isClosed: false,
      opensAt: null,
      closesAt: null,
      message: `"${cell}" is not a time window (expected 11:00-23:00 or "closed")`,
    };
  }
  const opensAt = parseTime(parts[0]);
  const closesAt = parseTime(parts[1]);
  if (!opensAt || !closesAt) {
    return {
      isClosed: false,
      opensAt: null,
      closesAt: null,
      message: `"${cell}" has a time that is not HH:MM`,
    };
  }
  return { isClosed: false, opensAt, closesAt, message: null };
}

/* -------------------------------------------------------------------------- */
/* Working hours                                                              */
/* -------------------------------------------------------------------------- */

export interface HoursPlanRow {
  branch: ImportBranch;
  days: WorkingHoursDay[];
  /** How many of the seven days this row marks closed — shown in the preview. */
  closedCount: number;
}

export interface HoursPlan {
  rows: HoursPlanRow[];
  errors: RowError[];
}

/**
 * Parse the WIDE hours format: one row per branch, seven day columns.
 *
 * Wide rather than long (branch, day, open, close) because the source is a
 * spreadsheet a human maintains: 40 rows they can read at a glance beats 280
 * they cannot. A header is REQUIRED so column order is explicit — a positional
 * format silently writes Tuesday's hours onto Monday when someone reorders.
 */
export function parseHours(text: string, branches: readonly ImportBranch[]): HoursPlan {
  const rows = splitRows(text);
  const errors: RowError[] = [];
  const out: HoursPlanRow[] = [];

  const firstIdx = rows.findIndex((r) => !isBlank(r));
  if (firstIdx === -1) return { rows: [], errors: [] };

  const header = rows[firstIdx].map((c) => c.toLocaleLowerCase());
  if (header[0] !== 'branch') {
    errors.push({
      line: firstIdx + 1,
      message: 'the first column of the header must be "branch"',
    });
    return { rows: [], errors };
  }

  // Map each weekday to its column, so order in the sheet does not matter.
  const columnFor = new Map<WeekdayKey, number>();
  header.forEach((name, index) => {
    if (index === 0) return;
    const key = WEEKDAY_ALIASES[name];
    if (key && !columnFor.has(key)) columnFor.set(key, index);
  });
  const missing = WEEKDAY_KEYS.filter((k) => !columnFor.has(k));
  if (missing.length > 0) {
    errors.push({
      line: firstIdx + 1,
      message: `the header is missing ${missing.join(', ')}`,
    });
    return { rows: [], errors };
  }

  const seen = new Map<string, number>();

  for (let i = firstIdx + 1; i < rows.length; i += 1) {
    const cells = rows[i];
    if (isBlank(cells)) continue;
    const line = i + 1;

    const resolved = resolveBranch(cells[0] ?? '', branches);
    if (!resolved.branch) {
      errors.push({ line, message: resolved.message ?? 'branch could not be resolved' });
      continue;
    }

    // A branch listed twice would apply whichever row came last, silently.
    const prior = seen.get(resolved.branch.id);
    if (prior !== undefined) {
      errors.push({
        line,
        message: `${resolved.branch.nameEn} is already set on line ${prior}`,
      });
      continue;
    }

    const days: WorkingHoursDay[] = [];
    let rowFailed = false;
    WEEKDAY_KEYS.forEach((key, dayIndex) => {
      if (rowFailed) return;
      const cell = cells[columnFor.get(key) as number] ?? '';
      const parsed = parseDayCell(cell);
      if (parsed.message) {
        errors.push({ line, message: `${key}: ${parsed.message}` });
        rowFailed = true;
        return;
      }
      days.push({
        dayOfWeek: dayIndex as WeekdayIndex,
        isClosed: parsed.isClosed,
        opensAt: parsed.opensAt,
        closesAt: parsed.closesAt,
      });
    });
    if (rowFailed) continue;

    seen.set(resolved.branch.id, line);
    out.push({
      branch: resolved.branch,
      days,
      closedCount: days.filter((d) => d.isClosed).length,
    });
  }

  return { rows: out, errors };
}

/* -------------------------------------------------------------------------- */
/* Delivery areas                                                             */
/* -------------------------------------------------------------------------- */

export interface AreaPlanRow {
  branch: ImportBranch;
  nameAr: string;
  nameEn: string | null;
  /**
   * True when this branch already has an area of the same Arabic name.
   *
   * `admin_add_delivery_area` always INSERTS, so re-running an import without
   * this check would duplicate every area. Skipping is the right default: the
   * import is for filling a gap, not for reconciling a list, and deleting rows
   * an operator may have disabled is not something a paste box should decide.
   */
  duplicate: boolean;
}

export interface AreaPlan {
  rows: AreaPlanRow[];
  errors: RowError[];
}

/** Existing areas, keyed by branch, so the plan can mark duplicates. */
export interface ExistingArea {
  branchId: string;
  nameAr: string;
}

export function parseAreas(
  text: string,
  branches: readonly ImportBranch[],
  existing: readonly ExistingArea[] = [],
): AreaPlan {
  const rows = splitRows(text);
  const errors: RowError[] = [];
  const out: AreaPlanRow[] = [];

  const firstIdx = rows.findIndex((r) => !isBlank(r));
  if (firstIdx === -1) return { rows: [], errors: [] };

  const header = rows[firstIdx].map((c) => c.toLocaleLowerCase());
  const arIdx = header.indexOf('name_ar');
  const enIdx = header.indexOf('name_en');
  if (header[0] !== 'branch' || arIdx === -1) {
    errors.push({
      line: firstIdx + 1,
      message: 'the header must be: branch, name_ar and optionally name_en',
    });
    return { rows: [], errors };
  }

  const already = new Set(existing.map((a) => `${a.branchId}::${a.nameAr.trim()}`));
  // Duplicates WITHIN the paste count too, or one run inserts the same area twice.
  const inPaste = new Set<string>();

  for (let i = firstIdx + 1; i < rows.length; i += 1) {
    const cells = rows[i];
    if (isBlank(cells)) continue;
    const line = i + 1;

    const resolved = resolveBranch(cells[0] ?? '', branches);
    if (!resolved.branch) {
      errors.push({ line, message: resolved.message ?? 'branch could not be resolved' });
      continue;
    }

    const nameAr = (cells[arIdx] ?? '').trim();
    if (!nameAr) {
      errors.push({ line, message: 'name_ar is required' });
      continue;
    }
    const nameEn = enIdx === -1 ? null : (cells[enIdx] ?? '').trim() || null;

    const key = `${resolved.branch.id}::${nameAr}`;
    const duplicate = already.has(key) || inPaste.has(key);
    inPaste.add(key);

    out.push({ branch: resolved.branch, nameAr, nameEn, duplicate });
  }

  return { rows: out, errors };
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The token to put in a template's branch column.
 *
 * A NAME THIS DATABASE HOLDS TWICE WOULD MAKE ITS OWN TEMPLATE UNIMPORTABLE:
 * `resolveBranch` refuses an ambiguous name by design, so emitting the name
 * blindly would hand the administrator a sheet that fails on the rows it is
 * most needed for. Those rows carry the id instead, and every template gains a
 * trailing `note` column — ignored by both parsers, since neither recognises it
 * as a weekday or as `name_ar`/`name_en` — so a human can still tell two
 * identically named branches apart.
 */
function templateToken(branch: ImportBranch, branches: readonly ImportBranch[]): string {
  const name = branch.nameEn.trim();
  if (!name) return branch.id;
  const resolved = resolveBranch(name, branches);
  return resolved.branch && resolved.branch.id === branch.id ? name : branch.id;
}

/**
 * A ready-to-edit sheet listing every branch, so nobody has to type names or
 * discover the format. Pre-filled as closed, which is the honest default: an
 * invented 09:00-22:00 would look like data.
 */
export function hoursTemplate(branches: readonly ImportBranch[]): string {
  const header = ['branch', ...WEEKDAY_KEYS, 'note'].join('\t');
  const body = branches.map((b) =>
    [templateToken(b, branches), ...WEEKDAY_KEYS.map(() => 'closed'), b.nameEn].join('\t'),
  );
  return [header, ...body].join('\n');
}

export function areasTemplate(branches: readonly ImportBranch[]): string {
  const header = ['branch', 'name_ar', 'name_en', 'note'].join('\t');
  const body = branches.map((b) => [templateToken(b, branches), '', '', b.nameEn].join('\t'));
  return [header, ...body].join('\n');
}
