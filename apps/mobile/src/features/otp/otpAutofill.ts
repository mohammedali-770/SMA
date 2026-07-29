/**
 * PURE, framework-free helpers for OTP autofill + the multi-box code input.
 *
 * Everything here is deliberately free of React / React Native / Expo / Supabase
 * so it runs under the Node unit suite (otpAutofill.test.ts) exactly like the
 * sibling otpInput.ts. The React hook (useOtpAutofill.ts) and the visual
 * component (OtpCodeInput.tsx) wire these rules to the platform; the *logic*
 * lives here so it can be tested without a device or a DOM.
 *
 * Scope: this module only ever READS/normalizes an incoming code and computes
 * box state. It never sends anything, never generates a code, and never talks to
 * a provider — the existing verify path (auth.verifyPhone / whatsappOtp.verify)
 * stays the sole authority.
 */
import { toAsciiDigits } from '../../lib/phone';

/** Default OTP length. Supabase Phone Auth issues a 6-digit token by default. */
export const DEFAULT_OTP_LENGTH = 6;

/** Digits only (Arabic-Indic folded to ASCII), capped at `maxLen`. */
export function normalizeCode(raw: string, maxLen: number): string {
  return toAsciiDigits(raw).replace(/\D/g, '').slice(0, Math.max(0, maxLen));
}

/**
 * Extract an OTP of the expected length from an arbitrary incoming string — an
 * SMS body ("Your code is 123456"), a WebOTP result, or a pasted blob. Arabic
 * digits are folded first. Returns the code, or null when no run of digits is
 * long enough (an incomplete/absent code must not silently half-fill boxes).
 */
export function extractOtp(raw: string, length: number): string | null {
  if (length <= 0) return null;
  const ascii = toAsciiDigits(raw);
  const runs = ascii.match(/\d+/g);
  if (!runs) return null;
  const exact = runs.find((r) => r.length === length);
  if (exact) return exact;
  const longer = runs.find((r) => r.length > length);
  if (longer) return longer.slice(0, length);
  return null;
}

/** Split a code string into exactly `length` single-digit boxes ('' when empty). */
export function splitCodeToBoxes(code: string, length: number): string[] {
  const digits = normalizeCode(code, length);
  return Array.from({ length }, (_, i) => digits[i] ?? '');
}

/** Join boxes back into the canonical code string. */
export function joinBoxes(boxes: string[]): string {
  return boxes.join('');
}

/** Result of a box edit: the new box array + which box should hold focus next. */
export interface BoxEdit {
  boxes: string[];
  focusIndex: number;
}

/**
 * Apply raw text typed/pasted into box `index`.
 *
 * - empty / non-digit input clears the box and stays put;
 * - a single digit fills the box and auto-advances;
 * - "old digit + one new digit" (what a controlled input reports when you type
 *   into an already-filled box) replaces the box with the new digit and advances;
 * - anything longer is treated as a paste/autofill and distributed across the
 *   remaining boxes from `index` onward, clamped to the field length.
 */
export function applyBoxInput(boxes: string[], index: number, incoming: string, length: number): BoxEdit {
  const prev = boxes[index] ?? '';
  const digits = toAsciiDigits(incoming).replace(/\D/g, '');

  if (digits.length === 0) {
    const next = [...boxes];
    next[index] = '';
    return { boxes: next, focusIndex: index };
  }

  if (digits.length === 1) {
    const next = [...boxes];
    next[index] = digits;
    return { boxes: next, focusIndex: Math.min(index + 1, length - 1) };
  }

  // Typing a digit into a box that already held one: keep only the new digit.
  if (prev && digits.length === prev.length + 1 && digits.startsWith(prev)) {
    const appended = digits.slice(prev.length);
    const next = [...boxes];
    next[index] = appended.charAt(appended.length - 1);
    return { boxes: next, focusIndex: Math.min(index + 1, length - 1) };
  }

  // Paste / autofill: fill from `index` onward.
  const next = [...boxes];
  let cursor = index;
  for (const d of digits) {
    if (cursor >= length) break;
    next[cursor] = d;
    cursor += 1;
  }
  return { boxes: next, focusIndex: Math.min(cursor, length - 1) };
}

/**
 * Apply a Backspace keypress at box `index`. Deleting a filled box clears it in
 * place; pressing Backspace on an already-empty box steps back and clears the
 * previous box (the expected "go back and erase" behavior).
 */
export function applyBackspace(boxes: string[], index: number): BoxEdit {
  const next = [...boxes];
  if (next[index]) {
    next[index] = '';
    return { boxes: next, focusIndex: index };
  }
  const prevIndex = Math.max(index - 1, 0);
  next[prevIndex] = '';
  return { boxes: next, focusIndex: prevIndex };
}

// ---------------------------------------------------------------------------
// WebOTP capability guard + read (dependency-injected so it is DOM-lib-free and
// unit-testable with a plain mock navigator).
// ---------------------------------------------------------------------------

/** Minimal shape of an AbortSignal — avoids a hard dependency on the DOM lib. */
export interface AbortSignalLike {
  readonly aborted: boolean;
}

/** The single WebOTP credential we care about. */
export interface OtpCredentialLike {
  code?: string | null;
}

/** The slice of `navigator.credentials` used by WebOTP. */
export interface CredentialsGetter {
  get(options: { otp: { transport: string[] }; signal?: AbortSignalLike }): Promise<OtpCredentialLike | null>;
}

/** The slice of `navigator` used by WebOTP. */
export interface NavigatorLike {
  credentials?: CredentialsGetter;
}

/**
 * Is the WebOTP API usable? Requires BOTH the `OTPCredential` global (feature
 * detection) and a `navigator.credentials.get`. `otpCredentialGlobal` is passed
 * in (the caller checks `'OTPCredential' in window`) so this stays DOM-free.
 */
export function isWebOtpSupported(nav: NavigatorLike | null | undefined, otpCredentialGlobal: boolean): boolean {
  return (
    otpCredentialGlobal === true &&
    !!nav &&
    !!nav.credentials &&
    typeof nav.credentials.get === 'function'
  );
}

/**
 * Ask the browser for an incoming SMS OTP via WebOTP. Resolves to the digits, or
 * null on any failure — an abort (component unmounted / user navigated away), an
 * unsupported browser, or the user declining. Never throws: callers fall back
 * silently to manual entry.
 */
export async function requestWebOtp(
  nav: NavigatorLike,
  signal: AbortSignalLike,
  length: number,
  transport: string[] = ['sms'],
): Promise<string | null> {
  if (!nav.credentials || typeof nav.credentials.get !== 'function') return null;
  try {
    const cred = await nav.credentials.get({ otp: { transport }, signal });
    const raw = cred?.code ?? '';
    if (!raw) return null;
    const parsed = extractOtp(raw, length) ?? normalizeCode(raw, length);
    return parsed || null;
  } catch {
    return null;
  }
}
