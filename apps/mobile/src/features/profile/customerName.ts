/**
 * The customer-name rule — FRAMEWORK-FREE and fully unit-tested.
 *
 * `profiles.full_name` is seeded at signup from the auth metadata and was
 * read-only in the app afterwards, so a customer who signed up with a typo (or
 * with nothing) was stuck with it forever. This is the single validator and the
 * single save orchestration for the one place that can now change it.
 *
 * Two decisions worth stating, because both were bugs in the obvious version:
 *
 * 1. The value is NORMALIZED, not merely trimmed. "  Mohammed   Ali  " is one
 *    person's name typed carelessly, not a different name from "Mohammed Ali";
 *    storing the raw string makes the same customer look like two.
 *
 * 2. A save that succeeds and then fails to REFRESH is still a save. Reporting
 *    it as a failure would invite the customer to press Save again, which is
 *    how a UI ends up claiming a write did not happen when it did.
 *
 * The rule lives here (not in the screen) because the vitest suite may not
 * import React Native or Expo.
 */

/** Shortest plausible name. Single letters are initials, not a name. */
export const NAME_MIN_LENGTH = 2;

/** Comfortably longer than any real name; guards the text column and the UI. */
export const NAME_MAX_LENGTH = 80;

export type NameProblem = 'empty' | 'too_short' | 'too_long' | 'invalid_characters';

/**
 * Letters (any script — Arabic and Latin both qualify), combining marks so
 * Arabic diacritics survive, plus the separators real names use: space, hyphen,
 * apostrophe (straight and typographic) and a period for initials.
 */
const NAME_ALLOWED = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
const HAS_LETTER = /\p{L}/u;

/**
 * Trim the ends and collapse runs of internal whitespace to one space. Also
 * folds tabs/newlines pasted in from another app, which otherwise reach the
 * database as literal control characters inside a name.
 */
export function normalizeCustomerName(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/gu, ' ').trim();
}

export interface NameCheck {
  /** True only when the normalized value may be saved. */
  valid: boolean;
  /** The value to send — always normalized, never the raw input. */
  value: string;
  problem: NameProblem | null;
}

/**
 * Validate a customer name. Whitespace-only input is `empty`, not `too_short`:
 * a field holding only spaces has not been filled in, and "too short" would
 * imply that adding more spaces could help.
 */
export function checkCustomerName(raw: string | null | undefined): NameCheck {
  const value = normalizeCustomerName(raw);
  if (value.length === 0) return { valid: false, value, problem: 'empty' };
  if (value.length < NAME_MIN_LENGTH) return { valid: false, value, problem: 'too_short' };
  if (value.length > NAME_MAX_LENGTH) return { valid: false, value, problem: 'too_long' };
  if (!NAME_ALLOWED.test(value) || !HAS_LETTER.test(value)) {
    return { valid: false, value, problem: 'invalid_characters' };
  }
  return { valid: true, value, problem: null };
}

/** Convenience predicate for gating a Save button. */
export function isCustomerNameValid(raw: string | null | undefined): boolean {
  return checkCustomerName(raw).valid;
}

/**
 * Copy for the one field, both languages. Kept beside the validator so a new
 * problem case cannot be added without its message.
 */
export const nameCopy = {
  en: {
    label: 'Your name',
    placeholder: 'The name the driver will ask for',
    edit: 'Edit name',
    save: 'Save',
    cancel: 'Cancel',
    saved: 'Name updated',
    empty: 'Enter your name',
    too_short: 'That looks too short',
    too_long: `Keep it under ${NAME_MAX_LENGTH} characters`,
    invalid_characters: 'Use letters only — no numbers or symbols',
    failed: "That didn't save. Please try again.",
  },
  ar: {
    label: 'اسمك',
    placeholder: 'الاسم الذي سيسأل عنه المندوب',
    edit: 'تعديل الاسم',
    save: 'حفظ',
    cancel: 'إلغاء',
    saved: 'تم تحديث الاسم',
    empty: 'أدخل اسمك',
    too_short: 'الاسم قصير جداً',
    too_long: `اجعل الاسم أقل من ${NAME_MAX_LENGTH} حرفاً`,
    invalid_characters: 'استخدم الحروف فقط — بدون أرقام أو رموز',
    failed: 'لم يتم الحفظ. حاول مرة أخرى.',
  },
} as const;

export type NameLang = keyof typeof nameCopy;

/** The inline validation message for a problem, or null when valid. */
export function nameMessage(problem: NameProblem | null, lang: NameLang): string | null {
  if (!problem) return null;
  return nameCopy[lang][problem];
}

export interface SaveNameDeps {
  /** Persists the normalized name. Rejects on any write failure. */
  update: (fullName: string) => Promise<unknown>;
  /**
   * Re-reads the profile so every screen already showing the name picks up the
   * new one without a sign-out or restart. Its failure is not the save's
   * failure — see the docblock.
   */
  refresh: () => Promise<unknown>;
}

export type SaveNameOutcome =
  /** Written and the cached profile was asked to refresh. */
  | { status: 'saved'; value: string }
  /** Identical to the stored name — no write was issued. */
  | { status: 'unchanged'; value: string }
  /** Rejected before any write. */
  | { status: 'invalid'; problem: NameProblem; value: string }
  /** The write itself failed; nothing changed. */
  | { status: 'failed'; error: unknown; value: string };

/**
 * Validate → write → refresh, in that order, with the whole decision table in
 * one tested place rather than spread across a component's handlers.
 */
export async function saveCustomerName(
  raw: string | null | undefined,
  current: string | null | undefined,
  deps: SaveNameDeps,
): Promise<SaveNameOutcome> {
  const check = checkCustomerName(raw);
  if (!check.valid) {
    return { status: 'invalid', problem: check.problem as NameProblem, value: check.value };
  }

  // The stored name is normalized the same way before comparing, so re-saving
  // an unchanged name (or one that differs only in spacing) is a no-op rather
  // than a pointless round-trip that could fail for no reason.
  if (check.value === normalizeCustomerName(current)) {
    return { status: 'unchanged', value: check.value };
  }

  try {
    await deps.update(check.value);
  } catch (error) {
    return { status: 'failed', error, value: check.value };
  }

  // The write landed. A refresh failure leaves stale UI, not a lost name, and
  // the next profile fetch repairs it — so this never downgrades to 'failed'.
  try {
    await deps.refresh();
  } catch {
    /* keep 'saved' — see the docblock */
  }

  return { status: 'saved', value: check.value };
}
