/**
 * Parsing for admin numeric fields that write money or operating policy.
 *
 * WHY THIS EXISTS
 * The branch policy card and the VAT field both used the shape
 *
 *     onChange={(e) => onUpdate({ deliveryFee: parseFloat(e.target.value) || 0 })}
 *
 * which has two independent defects. `parseFloat('') || 0` is `0`, so CLEARING
 * the field to retype it persists a real value of zero — free delivery, or 0%
 * VAT — rather than "no change". And because the branch card wrote on every
 * keystroke with no debounce, typing `25` persisted `2` first, so an operator
 * who was interrupted mid-keystroke left a live fee of 2 SAR.
 *
 * The rule this module encodes: an admin numeric field commits a value only
 * when that value is a real, in-range number. Anything else is not a write.
 * Empty is a distinct, explicit outcome, not a synonym for zero.
 */

export type NumericCommitOk = { ok: true; value: number | null };
export type NumericCommitError = {
  ok: false;
  reason: 'empty' | 'not-a-number' | 'below-min' | 'above-max';
};
export type NumericCommitResult = NumericCommitOk | NumericCommitError;

export interface NumericCommitOptions {
  /** Inclusive lower bound. Defaults to 0 — none of these fields may go negative. */
  min?: number;
  /** Inclusive upper bound. */
  max?: number;
  /**
   * When true, a blank field commits `null` ("not set") instead of being
   * rejected. Used by optional fields such as the delivery ETA. Money and tax
   * fields leave this false so blank can never reach the database.
   */
  allowEmpty?: boolean;
  /** When true, reject values that are not whole numbers (e.g. minutes). */
  integer?: boolean;
}

/**
 * Parse a raw input string into a value that is safe to persist.
 *
 * Never returns `{ ok: true, value: 0 }` for a blank input — that coercion is
 * the bug this module exists to prevent. Callers treat `ok: false` as "leave
 * the stored value alone and restore the displayed one".
 */
export function parseNumericCommit(
  raw: string,
  options: NumericCommitOptions = {},
): NumericCommitResult {
  const { min = 0, max, allowEmpty = false, integer = false } = options;

  const trimmed = raw.trim();
  if (trimmed === '') {
    return allowEmpty ? { ok: true, value: null } : { ok: false, reason: 'empty' };
  }

  // Number() rather than parseFloat(): parseFloat('12abc') is 12, which would
  // silently persist a number the operator never typed.
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { ok: false, reason: 'not-a-number' };
  if (integer && !Number.isInteger(parsed)) return { ok: false, reason: 'not-a-number' };
  if (parsed < min) return { ok: false, reason: 'below-min' };
  if (max !== undefined && parsed > max) return { ok: false, reason: 'above-max' };

  return { ok: true, value: parsed };
}

/** The string a field should display for a stored value. `null`/`undefined` → blank. */
export function numericFieldDisplay(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '' : String(value);
}
