/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Source of truth: design-system/fieldState.ts
// Regenerate with: npm run design-system:sync
// CI fails if this file drifts from its source (design-system:check).
// ---------------------------------------------------------------------------
/**
 * CANONICAL SOURCE — Field behaviour and accessibility wiring, framework-free.
 * Mirrored by `scripts/sync-design-system.mjs`.
 *
 * Voice rule (design system, "Say less"): a field NEVER carries instructional
 * helper text explaining what to type. The keyboard, the prefix and the label
 * already say it. Text appears only when something is wrong, and an error is
 * three to five words. `resolveFieldState` enforces that an error suppresses
 * any hint rather than stacking two lines of prose under one input.
 */

export type FieldTone = 'idle' | 'focus' | 'error';

export interface FieldInput {
  id: string;
  /** Shown only when there is no error. Keep it a fragment, not a sentence. */
  hint?: string;
  error?: string | null;
  focused?: boolean;
  disabled?: boolean;
  required?: boolean;
}

export interface FieldState {
  tone: FieldTone;
  /** The single line rendered under the control, or null for none. */
  message: string | null;
  messageIsError: boolean;
  disabled: boolean;
  /** id of the element that `aria-describedby` / RN a11y should point at. */
  describedById: string | null;
  labelId: string;
  errorId: string;
  hintId: string;
  accessibility: {
    invalid: boolean;
    required: boolean;
    disabled: boolean;
    /** Errors must be announced when they appear, not silently rendered. */
    liveRegion: 'polite' | 'none';
  };
}

export function resolveFieldState(input: FieldInput): FieldState {
  const error = input.error?.trim() ? input.error.trim() : null;
  const hint = input.hint?.trim() ? input.hint.trim() : null;
  const disabled = Boolean(input.disabled);
  const hasError = Boolean(error);

  const labelId = `${input.id}-label`;
  const errorId = `${input.id}-error`;
  const hintId = `${input.id}-hint`;

  return {
    tone: hasError ? 'error' : input.focused ? 'focus' : 'idle',
    // An error REPLACES the hint. Never both.
    message: error ?? hint,
    messageIsError: hasError,
    disabled,
    describedById: hasError ? errorId : hint ? hintId : null,
    labelId,
    errorId,
    hintId,
    accessibility: {
      invalid: hasError,
      required: Boolean(input.required),
      disabled,
      liveRegion: hasError ? 'polite' : 'none',
    },
  };
}

/* ── Validators ─────────────────────────────────────────────────────────── */

export interface ValidationResult {
  valid: boolean;
  /** Three-to-five-word message, or null when valid. */
  error: string | null;
}

const OK: ValidationResult = { valid: true, error: null };

export function validateRequired(
  value: string,
  lang: 'en' | 'ar' = 'en',
): ValidationResult {
  if (value.trim().length > 0) return OK;
  return { valid: false, error: lang === 'ar' ? 'حقل مطلوب' : 'Required' };
}

/**
 * Saudi national short address: 4 letters + 4 digits (e.g. RRBB1234).
 * Case-insensitive on input; callers should upper-case for display.
 */
const SHORT_ADDRESS = /^[A-Za-z]{4}\d{4}$/;

export function validateShortAddress(
  value: string,
  lang: 'en' | 'ar' = 'en',
): ValidationResult {
  const v = value.trim();
  if (!v) return OK; // emptiness is `required`'s job, not format's
  if (SHORT_ADDRESS.test(v)) return OK;
  return { valid: false, error: lang === 'ar' ? 'رمز غير صحيح' : 'Invalid code' };
}

/**
 * Runs validators in order and stops at the first failure, so the user is
 * never shown two errors for one field.
 */
export function firstError(
  results: ValidationResult[],
): string | null {
  for (const r of results) {
    if (!r.valid && r.error) return r.error;
  }
  return null;
}
