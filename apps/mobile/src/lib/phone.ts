/**
 * Saudi (KSA) phone handling for the customer app.
 *
 * Login is **WhatsApp-only and Saudi-only**: every number handed to Supabase
 * Auth must be a KSA mobile in E.164 form — `+9665XXXXXXXX`. This module accepts
 * every way a Saudi customer might write that number (local `05…`, bare `5…`,
 * `966…`, `00966…`, `+966…`, with spaces / dashes / parentheses, in Arabic-Indic
 * digits, with the trunk `0` left in after the country code) and rejects
 * everything else — foreign numbers included. Fail closed: never pass junk, or a
 * non-Saudi number, to auth.
 *
 * `signInWithOtp` and `verifyOtp` must be called with the SAME canonical string,
 * and it must match what the Send SMS hook derives from Supabase's payload — so
 * normalization happens once, here, before either call. The server mirrors this
 * in `_shared/whatsapp.ts` (`normalizeSaudiPhoneE164`); keep the two in sync.
 */

/** KSA country calling code. */
export const KSA_DIAL_CODE = '+966';

/** A KSA mobile national number is always 9 digits: `5X XXX XXXX`. */
export const KSA_NATIONAL_LENGTH = 9;

/** Zero-width and bidi control marks that RTL keyboards wrap around numbers. */
function isInvisibleMark(c: number): boolean {
  return (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e)
    || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
}

/**
 * Fold Arabic-Indic digits to ASCII and drop invisible marks. Arabic keyboards
 * emit U+0660–0669, Persian ones U+06F0–06F9, and both survive a copy/paste out
 * of WhatsApp — a number typed in Arabic must normalize like any other.
 */
export function toAsciiDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const c = ch.charCodeAt(0);
    if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660);
    else if (c >= 0x06f0 && c <= 0x06f9) out += String(c - 0x06f0);
    else if (!isInvisibleMark(c)) out += ch;
  }
  return out;
}

/**
 * The 9-digit national part (`5XXXXXXXX`) behind any Saudi input form, or `null`
 * when the input is not a Saudi mobile number.
 */
export function toSaudiNational(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = toAsciiDigits(String(input)).trim();
  // Only phone punctuation is allowed (anti-injection; matches the server).
  if (!raw || !/^[\d+\s().-]+$/.test(raw)) return null;
  let d = raw.replace(/[^\d+]/g, '');
  // '+' is a leading sign, never an interior character.
  if (d.lastIndexOf('+') > 0) return null;
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);  // IDD prefix
  if (d.startsWith('966')) d = d.slice(3);      // country code
  if (d.startsWith('0')) d = d.slice(1);        // national trunk prefix
  // Every KSA mobile is 5 + 8 digits. Deliberately NOT narrowed to today's
  // operator prefixes (050/053/054/055/056/057/058/059…): CITC keeps allocating
  // new 5X ranges and a stale allow-list would lock out real customers.
  return /^5\d{8}$/.test(d) ? d : null;
}

/** Normalize any Saudi input to E.164 (`+9665XXXXXXXX`); `null` if it isn't one. */
export function toSaudiE164(input: string | null | undefined): string | null {
  const national = toSaudiNational(input);
  return national ? KSA_DIAL_CODE + national : null;
}

/** True when the input resolves to a Saudi mobile number. */
export function isSaudiMobile(input: string | null | undefined): boolean {
  return toSaudiNational(input) !== null;
}

/**
 * Keystroke sanitizer for a national-part field: digits only, absorbing a pasted
 * `+966` / `00966` / trunk `0`, capped at 9 digits. Lets a customer paste ANY
 * Saudi form into the field and still land on a clean `5XXXXXXXX`.
 */
export function sanitizeSaudiNationalInput(input: string): string {
  let d = toAsciiDigits(input).replace(/\D/g, '');
  if (d.startsWith('00966')) d = d.slice(5);
  else if (d.startsWith('966')) d = d.slice(3);
  while (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, KSA_NATIONAL_LENGTH);
}

/** Group a national part the way Saudi numbers are read: `50 123 4567`. */
export function formatSaudiNational(national: string): string {
  const d = national.slice(0, KSA_NATIONAL_LENGTH);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5)].filter(Boolean).join(' ');
}

/** Human-readable form of a canonical number: `+966 50 123 4567`. */
export function formatSaudiE164(e164: string): string {
  const national = toSaudiNational(e164);
  return national ? `${KSA_DIAL_CODE} ${formatSaudiNational(national)}` : e164;
}
