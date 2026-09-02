/**
 * Small OTP-flow helpers for the WhatsApp login screen (PhoneOtpLogin). PURE
 * and framework-free so they are unit-tested under Node (otpInput.test.ts).
 *
 * Extracted VERBATIM from the screens that used them; nothing here changes
 * send/verify behavior, API payloads, or timing. They were shared with the
 * profile phone-verification card until that surface was deleted on 2026-09-02
 * (its entry point had been gone since 99dc6dd) — login is the only caller now.
 */

/** Seconds the resend button stays disabled after a code is sent (both flows). */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Digits only, capped at `maxLen` — the shared code-input sanitizer. */
export function sanitizeOtpDigits(raw: string, maxLen: number): string {
  return raw.replace(/\D/g, '').slice(0, maxLen);
}

/** One 1-second tick of the resend countdown (0 is the floor, never negative). */
export function tickCooldown(secondsLeft: number): number {
  return secondsLeft <= 1 ? 0 : secondsLeft - 1;
}
