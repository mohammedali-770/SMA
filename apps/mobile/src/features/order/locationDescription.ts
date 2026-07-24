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

export type DescriptionProblem = 'empty' | 'too_short' | 'too_long' | 'echoes_address';

/**
 * Normalize for comparison only: fold case, strip Arabic tatweel and diacritics,
 * collapse punctuation/whitespace. Used to tell "the customer wrote guidance"
 * apart from "the map's own address text was pasted back in".
 */
function comparable(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ـ]/g, '')            // tatweel
    .replace(/[ً-ْ]/g, '')      // Arabic diacritics
    .replace(/[^\p{L}\p{N}]+/gu, ' ')     // punctuation → space
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * True when the description is really just the selected address echoed back.
 *
 * The picker reverse-geocodes the pin, and an earlier revision of this feature
 * prefilled the description field with that text — which meant the mandatory
 * "delivery guidance" requirement could be satisfied without the customer
 * typing anything, defeating the entire point. The reverse-geocoded address is
 * now shown as read-only context and this check refuses it as guidance.
 *
 * Compared by token containment rather than equality so trivial edits
 * ("King Fahd Rd" -> "King Fahd Rd.") do not slip through, while a genuine
 * addition ("King Fahd Rd, blue gate next to the pharmacy") passes.
 */
export function echoesAddress(description: string, resolvedAddress: string | null | undefined): boolean {
  const addr = comparable(resolvedAddress ?? '');
  if (!addr) return false;
  const desc = comparable(description);
  if (!desc) return false;
  if (desc === addr) return true;
  // Tokens the customer added beyond the address text.
  const addrTokens = new Set(addr.split(' '));
  const extra = desc.split(' ').filter((w) => !addrTokens.has(w));
  // Fewer than two new words is a reformatting of the address, not guidance.
  return extra.length < 2;
}

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
export function checkDescription(
  raw: string | null | undefined,
  /**
   * The reverse-geocoded address for the current pin, when known. Supplying it
   * enables the `echoes_address` rule; omitting it only skips that one check.
   */
  resolvedAddress?: string | null,
): DescriptionCheck {
  const value = (raw ?? '').trim();
  if (value.length === 0) return { valid: false, value, problem: 'empty' };
  if (value.length < DESCRIPTION_MIN_LENGTH) return { valid: false, value, problem: 'too_short' };
  if (value.length > DESCRIPTION_MAX_LENGTH) return { valid: false, value, problem: 'too_long' };
  if (echoesAddress(value, resolvedAddress)) return { valid: false, value, problem: 'echoes_address' };
  return { valid: true, value, problem: null };
}

/** Convenience predicate for gating a Confirm/Place button. */
export function isDescriptionValid(
  raw: string | null | undefined,
  resolvedAddress?: string | null,
): boolean {
  return checkDescription(raw, resolvedAddress).valid;
}

/**
 * Trim for submission. Returns null only when the value is unusable, so callers
 * can never persist `""` or `"   "` — the states that made the field look
 * present while carrying nothing.
 */
export function normalizeDescription(
  raw: string | null | undefined,
  resolvedAddress?: string | null,
): string | null {
  const { valid, value } = checkDescription(raw, resolvedAddress);
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
    label: 'Delivery guidance (building, entrance, apartment or landmark)',
    placeholder: 'Example: blue building, second entrance, flat 12 — beside the mosque',
    /** Read-only context line above the field showing the pin's own address. */
    addressPrefix: 'Selected location',
    empty: 'Add a nearby landmark so the driver can find you',
    too_short: 'Add a little more detail',
    too_long: `Keep it under ${DESCRIPTION_MAX_LENGTH} characters`,
    echoes_address: 'We already have the address. Add the building, entrance or a landmark.',
  },
  ar: {
    label: 'إرشادات التوصيل (المبنى أو المدخل أو الشقة أو أقرب معلم)',
    placeholder: 'مثال: المبنى الأزرق، المدخل الثاني، شقة ١٢ — بجانب المسجد',
    addressPrefix: 'الموقع المحدد',
    empty: 'أضف أقرب معلم حتى يتمكن المندوب من الوصول إليك',
    too_short: 'أضف تفاصيل أكثر قليلاً',
    too_long: `اجعل الوصف أقل من ${DESCRIPTION_MAX_LENGTH} حرفاً`,
    echoes_address: 'لدينا العنوان بالفعل. أضف المبنى أو المدخل أو أقرب معلم.',
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
