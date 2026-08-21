/**
 * The order-note rule — FRAMEWORK-FREE and fully unit-tested.
 *
 * One limit for the free-text note a customer attaches to an order. The field
 * has existed in Checkout since the screen was written, but nothing bounded it:
 * not the input, not `place_order`, not the column. A note is read by a cashier
 * and printed on a ticket, so an unbounded one is both an operational problem
 * and an abuse vector.
 *
 * The rule lives here (not in a component) because the vitest suite may not
 * import React Native or Expo, and because Checkout is not the only surface
 * that will need it once per-item notes arrive.
 *
 * The backend mirrors this: see
 * supabase/migrations/20260819120000_order_note_length_limit.sql.
 */

/**
 * Maximum stored length of an order note, after trimming.
 *
 * A kitchen note is an instruction, not a message. This is NOT derived from any
 * POS capability — whether Lazywait accepts an order note at all is still open
 * question Q5 in docs/lazywait-delivery-open-questions.md. If Lazywait confirms
 * a shorter maximum this narrows; it should never silently widen.
 */
export const ORDER_NOTE_MAX_LENGTH = 280;

/**
 * Maximum stored length of a PER-ITEM note, after trimming.
 *
 * Half the order note, and that is not arbitrary. An order note is one
 * instruction for the whole ticket; a line note is read by a cook glancing at a
 * single row while assembling it. Ten lines each carrying 280 characters is not
 * a ticket anybody can work from — the limit protects the kitchen's ability to
 * read the order at all, not the database.
 *
 * The backend mirrors this in `order_item_note_is_acceptable`
 * (supabase/migrations/20260821170000_order_item_notes.sql) — change both
 * together, and never widen this one alone.
 */
export const ITEM_NOTE_MAX_LENGTH = 140;

/**
 * Show the remaining-character counter only once the customer is close to the
 * limit. A counter that is visible from the first keystroke reads as a target
 * to fill rather than a bound to respect.
 */
export const ORDER_NOTE_COUNTER_THRESHOLD = 40;

export type OrderNoteProblem = 'too_long';

export interface OrderNoteCheck {
  /** True when the trimmed value may be submitted. An empty note is valid. */
  valid: boolean;
  /** The value to send — always trimmed, never the raw input. */
  value: string;
  problem: OrderNoteProblem | null;
}

/**
 * Validate an order note.
 *
 * Unlike the location description, an order note is OPTIONAL: empty and
 * whitespace-only both mean "no note", which is valid and submits as null.
 * The only way to be invalid is to be too long.
 */
export function checkOrderNote(raw: string | null | undefined): OrderNoteCheck {
  const value = (raw ?? '').trim();
  if (value.length > ORDER_NOTE_MAX_LENGTH) {
    return { valid: false, value, problem: 'too_long' };
  }
  return { valid: true, value, problem: null };
}

/** Convenience predicate for gating a Place-order button. */
export function isOrderNoteValid(raw: string | null | undefined): boolean {
  return checkOrderNote(raw).valid;
}

/**
 * Trim for submission. Returns null when there is no usable note, so callers
 * can never persist `""` or `"   "` — the states that make the field look
 * present while carrying nothing. The server normalizes identically.
 */
export function normalizeOrderNote(raw: string | null | undefined): string | null {
  const { valid, value } = checkOrderNote(raw);
  if (!valid) return null;
  return value.length > 0 ? value : null;
}

/** Characters still available. Negative once the limit is passed. */
export function orderNoteRemaining(raw: string | null | undefined): number {
  return ORDER_NOTE_MAX_LENGTH - (raw ?? '').trim().length;
}

/**
 * Copy for the field, both languages. Kept beside the validator so a new
 * problem case cannot be added without its message.
 */
export const orderNoteCopy = {
  en: {
    too_long: `Keep the note under ${ORDER_NOTE_MAX_LENGTH} characters`,
    /**
     * Rendered with {n} replaced by the remaining count. Two forms, because the
     * counter reaches exactly 1 on the way to the limit and "1 characters left"
     * is the one value a customer is guaranteed to see up close.
     */
    remaining_one: '1 character left',
    remaining_other: '{n} characters left',
  },
  ar: {
    too_long: `اجعل الملاحظة أقل من ${ORDER_NOTE_MAX_LENGTH} حرفاً`,
    remaining_one: 'بقي حرف واحد',
    remaining_other: 'بقي {n} حرفاً',
  },
} as const;

export type OrderNoteLang = keyof typeof orderNoteCopy;

/** The inline validation message for a problem, or null when valid. */
export function orderNoteMessage(
  problem: OrderNoteProblem | null,
  lang: OrderNoteLang,
): string | null {
  if (!problem) return null;
  return orderNoteCopy[lang][problem];
}

/** The remaining-characters hint, or null when the customer is not near the limit. */
export function orderNoteRemainingMessage(
  raw: string | null | undefined,
  lang: OrderNoteLang,
): string | null {
  const remaining = orderNoteRemaining(raw);
  if (remaining > ORDER_NOTE_COUNTER_THRESHOLD) return null;
  const n = Math.max(remaining, 0);
  if (n === 1) return orderNoteCopy[lang].remaining_one;
  return orderNoteCopy[lang].remaining_other.replace('{n}', String(n));
}
