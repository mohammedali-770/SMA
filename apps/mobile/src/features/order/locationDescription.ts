/**
 * The location-description rule — FRAMEWORK-FREE and fully unit-tested.
 *
 * One meaning, one label, one validator for every surface that creates, edits,
 * selects or confirms a delivery address (the blocking order-type gate and
 * Checkout). Previously the field was labelled "Building / street / apartment
 * (optional)" in Checkout and "Location description / nearby landmark" in the
 * address gate, was never required, and Checkout dropped it entirely when it
 * created the address — so a driver could receive an order with no landmark.
 *
 * A courier cannot find a Saudi address from coordinates alone, so this is a
 * delivery requirement rather than a nicety. The rule lives here (not in a
 * component) because the vitest suite may not import React Native or Expo.
 *
 * The backend mirrors this: see
 * supabase/migrations/20260724170000_require_address_description.sql.
 */

/** Minimum useful landmark length. "x" is not an address. */
export const DESCRIPTION_MIN_LENGTH = 5;

/** Column width in `public.addresses.description`. */
export const DESCRIPTION_MAX_LENGTH = 500;

export type DescriptionProblem = 'empty' | 'too_short' | 'too_long';

export interface DescriptionCheck {
  /** True only when the trimmed value may be submitted. */
  valid: boolean;
  /** The value to send — always trimmed, never the raw input. */
  value: string;
  problem: DescriptionProblem | null;
}

/**
 * Validate a location description. Whitespace-only input is `empty`, not
 * `too_short`: a field holding only spaces has not been filled in, and saying
 * "too short" would imply adding more spaces could help.
 */
export function checkDescription(raw: string | null | undefined): DescriptionCheck {
  const value = (raw ?? '').trim();
  if (value.length === 0) return { valid: false, value, problem: 'empty' };
  if (value.length < DESCRIPTION_MIN_LENGTH) return { valid: false, value, problem: 'too_short' };
  if (value.length > DESCRIPTION_MAX_LENGTH) return { valid: false, value, problem: 'too_long' };
  return { valid: true, value, problem: null };
}

/** Convenience predicate for gating a Confirm/Place button. */
export function isDescriptionValid(raw: string | null | undefined): boolean {
  return checkDescription(raw).valid;
}

/**
 * Trim for submission. Returns null only when the value is unusable, so callers
 * can never persist `""` or `"   "` — the states that made the field look
 * present while carrying nothing.
 */
export function normalizeDescription(raw: string | null | undefined): string | null {
  const { valid, value } = checkDescription(raw);
  return valid ? value : null;
}

/**
 * Copy for the one shared field, both languages. Kept beside the validator so a
 * new problem case cannot be added without its message. Short by design — see
 * the information-hierarchy rule: the inline message states the fix, not an
 * explanation of why addresses matter.
 */
export const descriptionCopy = {
  en: {
    label: 'Location description / nearest landmark',
    placeholder: 'Example: near Al Salam grocery, beside the mosque',
    empty: 'Add a nearby landmark so the driver can find you',
    too_short: 'Add a little more detail',
    too_long: `Keep it under ${DESCRIPTION_MAX_LENGTH} characters`,
  },
  ar: {
    label: 'وصف الموقع / أقرب معلم',
    placeholder: 'مثال: قرب بقالة السلام، بجانب المسجد',
    empty: 'أضف أقرب معلم حتى يتمكن المندوب من الوصول إليك',
    too_short: 'أضف تفاصيل أكثر قليلاً',
    too_long: `اجعل الوصف أقل من ${DESCRIPTION_MAX_LENGTH} حرفاً`,
  },
} as const;

export type DescriptionLang = keyof typeof descriptionCopy;

/** The inline validation message for a problem, or null when valid. */
export function descriptionMessage(
  problem: DescriptionProblem | null,
  lang: DescriptionLang,
): string | null {
  if (!problem) return null;
  return descriptionCopy[lang][problem];
}
