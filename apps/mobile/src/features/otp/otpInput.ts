/**
 * Small OTP-flow helpers shared by the WhatsApp login screen (PhoneOtpLogin)
 * and the profile phone-verification card (VerifyPhoneWhatsApp). PURE and
 * framework-free so they are unit-tested under Node (otpInput.test.ts).
 *
 * Extracted VERBATIM from the two screens — both already used exactly these
 * rules; nothing here changes send/verify behavior, API payloads, or timing.
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
