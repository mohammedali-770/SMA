/**
 * "Can the customer log in?" — pure, framework-free decision logic.
 *
 * WhatsApp is the ONLY customer login path, so the readiness flag has **three**
 * answers, not two:
 *
 *   'enabled'  — the flag was read and is genuinely ON.
 *   'disabled' — the flag was read and is genuinely OFF.
 *   'unknown'  — the flag could NOT be read (network / RPC / RLS error, or an
 *                unexpected payload). We learned nothing.
 *
 * Collapsing 'unknown' into 'disabled' would be a lockout bug: with no email
 * fallback, one transient status-RPC failure would show every customer the
 * "login unavailable" card even though login works fine. So only a **confirmed**
 * `false` may hide the form. On an unreadable flag we show the phone form and
 * let the server decide — `auth-send-sms-whatsapp` fails closed and rejects the
 * send if login really is off, which is the authoritative answer anyway. The
 * flag is a UI hint; the hook is the gate.
 *
 * Framework-free on purpose (no React Native / Expo / Supabase imports) so the
 * mobile unit suite can exercise it directly.
 */

export type WhatsAppLoginAvailability = 'enabled' | 'disabled' | 'unknown';

/** The shape of a PostgREST/Supabase RPC result, narrowed to what we read. */
export interface FlagReadResult {
  data?: unknown;
  error?: unknown;
}

/**
 * Classify a raw flag-read result. Anything that isn't an explicit boolean —
 * an error, a null, a missing/!boolean payload — is 'unknown', never 'disabled'.
 */
export function classifyLoginFlag(result: FlagReadResult | null | undefined): WhatsAppLoginAvailability {
  if (!result) return 'unknown';
  if (result.error) return 'unknown';
  if (result.data === true) return 'enabled';
  if (result.data === false) return 'disabled';
  return 'unknown';
}

/**
 * Read the flag through the supplied invoker. A rejected invoker (network
 * failure, thrown client error) is 'unknown' — this function never rejects, so
 * callers can't accidentally reintroduce a fail-closed branch.
 */
export async function readLoginFlag(
  rpc: () => PromiseLike<FlagReadResult>,
): Promise<WhatsAppLoginAvailability> {
  try {
    return classifyLoginFlag(await rpc());
  } catch {
    return 'unknown';
  }
}

/** Only a CONFIRMED disabled flag may hide the login form. */
export function showsUnavailableCard(availability: WhatsAppLoginAvailability): boolean {
  return availability === 'disabled';
}

/** The phone form shows when login is enabled *or* when we couldn't tell. */
export function showsLoginForm(availability: WhatsAppLoginAvailability): boolean {
  return availability === 'enabled' || availability === 'unknown';
}

// ---------------------------------------------------------------------------
// Requesting the code — the server is the final authority
// ---------------------------------------------------------------------------

export type SendCodeOutcome =
  | { status: 'sent' }
  /** `message` is the server's reason when it gave one, else null. */
  | { status: 'failed'; message: string | null };

/**
 * Ask the server to send a login code. A rejection — including the Send SMS
 * hook's "WhatsApp login is temporarily unavailable" when login is genuinely
 * off — becomes `failed`, never `sent`. That is what keeps an optimistic
 * 'unknown' render honest: the client may show the form, but only the server
 * can advance the customer to the code step.
 */
export async function requestLoginCode(
  signIn: (phone: string) => PromiseLike<unknown>,
  phone: string,
): Promise<SendCodeOutcome> {
  try {
    await signIn(phone);
    return { status: 'sent' };
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : null;
    return { status: 'failed', message };
  }
}
