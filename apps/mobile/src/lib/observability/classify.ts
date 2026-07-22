/**
 * Error classification — FRAMEWORK-FREE.
 *
 * Not every failure is a crash. Expected, user-facing or environmental
 * failures (offline, cancelled, validation, business declines, rate limits)
 * must NOT become Sentry events — they stay breadcrumb-only. Unexpected
 * technical failures (undefined crashes, impossible states, parsing errors,
 * startup failures) are captured.
 *
 * Disposition vocabulary used across the app:
 *   - 'capture'  -> Sentry event (exception or message)
 *   - 'expected' -> breadcrumb only, never an event
 */

export type ErrorDisposition = 'capture' | 'expected';

/**
 * Message patterns for EXPECTED failures. Deliberately conservative: anything
 * not matched is captured — silence is the failure mode we least want.
 */
const EXPECTED_PATTERNS: ReadonlyArray<RegExp> = [
  // Connectivity / environment
  /network request failed/i,
  /failed to fetch/i,
  /internet connection appears to be offline/i,
  /timeout(?:| of \d+ms) exceeded/i,
  // Cancellation (user navigated away / dismissed)
  /\babort(?:ed)?\b/i,
  /cancell?ed by (?:the )?(?:user|customer)/i,
  /user cancell?ed/i,
  // Auth lifecycle handled by the UI (re-login flows)
  /invalid login credentials/i,
  /invalid otp|otp.*(expired|invalid)/i,
  /(jwt|token)\s+(has\s+|is\s+)?expired/i,
  /refresh token/i,
  /auth session missing/i,
  // Rate limiting / retry guidance (includes OTP resend limits)
  /rate limit|too many requests|try again (in|later)/i,
  // Business rules surfaced to the customer by design
  /coupon.*(invalid|expired|not found|usage|limit)|invalid coupon/i,
  /branch.*closed|closed branch|outside (of )?working hours/i,
  /(item|product).*(unavailable|not available|out of stock)/i,
  /outside (the )?delivery (zone|area)/i,
  /minimum order/i,
  /payment.*(cancell?ed|declined by (the )?(bank|issuer))/i,
];

/** True when the failure is an expected, UI-handled outcome. */
export function isExpectedError(error: unknown): boolean {
  const message = errorMessage(error);
  if (!message) return false;
  return EXPECTED_PATTERNS.some((re) => re.test(message));
}

/** Classify an arbitrary thrown value. */
export function classifyError(error: unknown): ErrorDisposition {
  return isExpectedError(error) ? 'expected' : 'capture';
}

/** Best-effort safe message extraction (never throws). */
export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

/**
 * Error-boundary capture decision: a boundary instance reports the FIRST
 * render error it sees and stays silent until the user retries (prevents
 * infinite capture loops when the fallback itself re-renders).
 */
export function shouldCaptureBoundaryError(alreadyCaptured: boolean): boolean {
  return !alreadyCaptured;
}

/** Trim a React component stack to a safe, bounded string. */
export function formatComponentStack(stack: string | null | undefined): string {
  if (!stack) return '';
  return stack.trim().split('\n').slice(0, 20).join('\n');
}
