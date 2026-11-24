/**
 * Validate the SMTP endpoint an Edge Function is about to connect to, and say
 * what a failed connection may report.
 *
 * WHY. Two functions connect to the endpoint stored in
 * `integration_settings.public_config`: `operations-alert-dispatch`, on a
 * schedule, and `email-test-config`, when an admin presses "send test email".
 * Both hand `host` and `port` to denomailer, which calls `Deno.connect`.
 * Writing that row needs `is_admin()` — role AND AAL2 — so this is not an
 * anonymous SSRF; it is containment for a compromised admin session or a leaked
 * service key, which bypasses RLS entirely. The same shape as the Lazywait
 * `base_url` guard in `lazywait.ts`, and deliberately written to look like it:
 * pure functions, one reason code per refusal, no network.
 *
 * WHAT IT REFUSES, and why each is not a legitimate mail relay for this
 * product: an IP literal in any of its four spellings (dotted, decimal, hex,
 * octal) and IPv6, refused outright rather than range-checked — so
 * `169.254.169.254`, the cloud metadata endpoint, and `10./172.16./192.168.`,
 * the inside of somebody's network, never get as far as a range test; the
 * `.local`, `.internal` and `.home.arpa` suffixes that resolve only inside a
 * network; and, since 2026-11-11, any port that is not a mail port. A relay is
 * a public hostname on 25, 465, 587 or 2525.
 *
 * WHAT IT CANNOT SEE: where a NAME points. Every host rule is lexical and no
 * name is resolved, so `127.0.0.1.nip.io`, a well-formed public hostname that
 * wildcard DNS answers with 127.0.0.1, passes. Resolving it here would not close
 * that either: denomailer resolves the name again when it connects, and a name
 * can answer differently the second time. `SMTP_ALLOWED_HOSTS` closes it, by
 * pinning the relay's name, and it has to be set before external dispatch is
 * turned on. This header said "loopback, private and link-local space" until
 * 2026-11-11, which read as if names were checked; only literals ever were.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK: whether the connection is encrypted
 * before the password is sent. denomailer already enforces that and does it
 * better than a config flag could — it opportunistically issues STARTTLS, then
 * refuses outright ("Connection is not secure! Don't send authentication over
 * non secure connection!") if the connection is still in the clear, unless
 * `debug.allowUnsecure` is set. This function never sees that option, so a
 * config-level TLS requirement here would add nothing AND would wrongly refuse
 * a STARTTLS-on-587 relay, which is the commonest kind. `alertDispatchWiring`
 * pins the absence of `allowUnsecure` instead, which is the thing that could
 * actually regress.
 */

import { isAllowedHost, isIpLiteral, isPrivateName, isValidHostname, normalizeHost } from './publicHost.ts';

export const SMTP_NOT_CONFIGURED = 'smtp_not_configured';
export const SMTP_HOST_INVALID = 'smtp_host_invalid';
export const SMTP_HOST_NOT_ROUTABLE = 'smtp_host_not_routable';
export const SMTP_HOST_NOT_ALLOWED = 'smtp_host_not_allowed';
export const SMTP_PORT_INVALID = 'smtp_port_invalid';
export const SMTP_PORT_NOT_ALLOWED = 'smtp_port_not_allowed';
export const SMTP_SENDER_INVALID = 'smtp_sender_invalid';

/**
 * The ports a mail relay listens on: 25 (relay), 465 (submission over TLS),
 * 587 (submission with STARTTLS), and 2525, the alternate that relay providers
 * offer because so many networks block 25 and 587. Supabase's Edge runtime is
 * one of those networks — its documented limits refuse outgoing 25 and 587 —
 * which is why the live relay uses 465. The guard does not model the runtime,
 * so 25 and 587 stay admitted here and simply fail to connect there.
 *
 * Before 2026-11-11 any port from 1 to 65535 passed, so a relay entry could
 * point the test button at Redis on 6379 or a metadata service on 80.
 */
export const SMTP_PORTS: readonly number[] = [25, 465, 587, 2525];

export interface SmtpTarget {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  fromEmail: string;
  fromName: string;
  /** The `reply_to` setting, or '' when none is set. Validated like the From fields. */
  replyTo: string;
  /**
   * Non-null means REFUSED, and every other field is meaningless.
   *
   * One shape with a nullable field rather than a discriminated union: this
   * repository's tsconfig leaves `strict` off, so TypeScript will not narrow a
   * union on a boolean discriminant and `if (!r.ok)` would leave `r.reason`
   * unreachable. Same reasoning as `BranchResolution` in the web app.
   */
  reason: string | null;
}

function refuse(reason: string): SmtpTarget {
  return { host: '', port: 0, tls: false, username: '', fromEmail: '', fromName: '', replyTo: '', reason };
}

/**
 * The three sender settings are written, unencoded, into the message's header
 * block: `From: <name> <<address>>` and `Reply-To: <address>`. denomailer 1.6.0
 * does not refuse a line break in any of them (`isSingleMail` accepts `[^<>]+`
 * for the name, and ASCII CR and LF are never encoded), so a value with a line
 * break writes a new header line, for example `Bcc:`, into every alert mail.
 * That was F-EFN-03-012 for the display name, and F-X10-003 found `from_email`
 * and `reply_to` on the same route with no check at all.
 *
 * Settings are written under `is_admin()` (role and AAL2) or by a holder of the
 * service key, so this is containment, the same trust boundary as the host
 * guard above, not a defence against an anonymous caller.
 *
 * REFUSED: any control character (CR and LF included), and for the name also
 * `<` and `>`, which close or open the address part. The addresses must look
 * like one address: no whitespace, no angle brackets, no quote.
 *
 * HOW THE CLASS IS WRITTEN, and why. `\p{Cc}` is the C0 and C1 control
 * characters (U+0000 to U+001F, U+007F to U+009F), `\p{Zl}` is the Unicode line
 * separator (U+2028) and `\p{Zp}` the paragraph separator (U+2029): the same 67
 * characters this guard has always refused, checked over every code point.
 * It is spelled with property escapes rather than with a backslash-u escape for
 * each code point because the deploy tool decodes a backslash-u escape in the
 * text it is sent into the real character, and a real U+2028 inside a regular
 * expression literal ends the line, so the bundler refused this file with
 * "Unterminated regexp literal" (2026-11-24). `smtpTarget.test.ts` fails if a
 * backslash-u escape returns to this file.
 */
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const SENDER_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function senderFieldsValid(fromName: string, fromEmail: string, replyTo: string): boolean {
  if (CONTROL_CHARS.test(fromName) || /[<>]/.test(fromName)) return false;
  if (CONTROL_CHARS.test(fromEmail) || !SENDER_ADDRESS.test(fromEmail)) return false;
  if (replyTo !== '' && (CONTROL_CHARS.test(replyTo) || !SENDER_ADDRESS.test(replyTo))) return false;
  return true;
}

/**
 * The host rules moved to `publicHost.ts` on 2026-09-19, when the admin push
 * sender needed the same question answered about a push endpoint. They are
 * identical; this file keeps its own reason codes and its own port and
 * credential handling.
 */
export function isAllowedSmtpHost(host: string, allowlist: string | null | undefined): boolean {
  return isAllowedHost(host, allowlist);
}

export function parseSmtpTarget(
  publicConfig: Record<string, unknown>,
  allowlist?: string | null,
): SmtpTarget {
  // Trailing dot is the fully-qualified spelling of the same name; strip it so
  // `evil.com.` cannot slip past an allowlist that holds `evil.com`.
  const host = normalizeHost(String(publicConfig.host ?? ''));
  const fromEmail = String(publicConfig.from_email ?? '').trim();
  const fromName = String(publicConfig.from_name ?? '').trim() || 'Spicy Meal';
  const replyTo = String(publicConfig.reply_to ?? '').trim();
  const username = String(publicConfig.username ?? '').trim();
  const tls = publicConfig.secure === true;

  if (!host || !fromEmail) return refuse(SMTP_NOT_CONFIGURED);
  if (!senderFieldsValid(fromName, fromEmail, replyTo)) return refuse(SMTP_SENDER_INVALID);

  const portRaw = String(publicConfig.port ?? '').trim() || '587';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return refuse(SMTP_PORT_INVALID);
  if (!SMTP_PORTS.includes(port)) return refuse(SMTP_PORT_NOT_ALLOWED);

  if (isIpLiteral(host) || isPrivateName(host)) return refuse(SMTP_HOST_NOT_ROUTABLE);
  if (!isValidHostname(host)) return refuse(SMTP_HOST_INVALID);
  if (!isAllowedSmtpHost(host, allowlist)) return refuse(SMTP_HOST_NOT_ALLOWED);

  return { host, port, tls, username, fromEmail, fromName, replyTo, reason: null };
}

function listPorts(ports: readonly number[]): string {
  return `${ports.slice(0, -1).join(', ')} or ${ports[ports.length - 1]}`;
}

/**
 * The sentence an admin sees for each refusal. The first two are the ones the
 * console showed before this guard reached `email-test-config`, kept word for
 * word. A Map rather than an object, so no reason code can resolve to an
 * inherited property.
 */
const REFUSAL_SENTENCES = new Map<string, string>([
  [SMTP_NOT_CONFIGURED, 'Email server is not fully configured (host + from email required).'],
  [SMTP_PORT_INVALID, 'Invalid SMTP port.'],
  [SMTP_PORT_NOT_ALLOWED, `The SMTP port must be a mail port: ${listPorts(SMTP_PORTS)}.`],
  [SMTP_HOST_INVALID, 'The SMTP host is not a valid hostname.'],
  [SMTP_HOST_NOT_ROUTABLE, 'The SMTP host must be a public hostname, not an IP address or an internal name.'],
  [SMTP_HOST_NOT_ALLOWED, 'The SMTP host is not on this deployment’s SMTP_ALLOWED_HOSTS list.'],
  [
    SMTP_SENDER_INVALID,
    'The from name, from email or reply-to is not valid: each must be a single line, and the emails must be plain addresses.',
  ],
]);

export function describeSmtpRefusal(reason: string): string {
  return REFUSAL_SENTENCES.get(reason) ?? 'The SMTP settings were refused.';
}

export const SMTP_CONNECT_FAILED = 'smtp_connect_failed';
export const SMTP_TLS_FAILED = 'smtp_tls_failed';
export const SMTP_NOT_SECURE = 'smtp_not_secure';
export const SMTP_AUTH_FAILED = 'smtp_auth_failed';
export const SMTP_REJECTED = 'smtp_rejected';
export const SMTP_NOT_SMTP = 'smtp_not_smtp';
export const SMTP_SEND_FAILED = 'smtp_send_failed';

export interface SmtpFailure {
  reason: string;
  /** A fixed sentence. Nothing in it is taken from the error. */
  message: string;
}

/** Deno's error classes for a connection that never became a conversation. */
const CONNECT_ERROR_NAMES = new Set([
  'AddrNotAvailable',
  'BrokenPipe',
  'ConnectionAborted',
  'ConnectionRefused',
  'ConnectionReset',
  'NetworkUnreachable',
  'NotCapable',
  'NotConnected',
  'PermissionDenied',
  'TimedOut',
]);

/**
 * Deno's error classes for a TLS handshake that failed. Both measured on
 * 2026-11-11: `InvalidData` for a certificate that does not fit, and
 * `UnexpectedEof` for TLS spoken to a listener that does not speak it.
 */
const TLS_ERROR_NAMES = new Set(['InvalidData', 'UnexpectedEof']);

/** Reply codes that mean the credentials were the problem (RFC 4954). */
const AUTH_REPLY_CODES = new Set([530, 534, 535]);

/** Outgoing ports Supabase's Edge runtime refuses, from its documented limits. */
const RUNTIME_BLOCKED_PORTS = new Set([25, 587]);

const CONNECT_SENTENCE = 'Could not connect to the SMTP server. Check the host and port.';
const BLOCKED_PORT_HINT = ' Supabase Edge Functions cannot open connections to ports 25 or 587; use 465.';

function failure(reason: string, message: string): SmtpFailure {
  return { reason, message };
}

/**
 * What a failed send may tell the person who asked for it: a reason code and
 * a fixed sentence, never the error's own text.
 *
 * WHY NOT THE TEXT. denomailer builds its errors out of whatever the far end
 * said — `assertCode` throws `"<code>: <reply>"`, and a reply that is not SMTP
 * at all comes out as `"NaN: <first line>"`. Against a listener that sends an
 * SSH banner, denomailer throws `NaN: 2.0-OpenSSH_9.6 internal-host,` (measured
 * 2026-11-11), and the test button passed up to 300 characters of such text to
 * the browser. With no guard in front of it, that made the button a banner
 * grabber for any address it could reach.
 *
 * WHAT IS LEFT, stated rather than claimed away: the category itself still says
 * whether something answered, and so does the time a send takes. The guard is
 * what limits where a send can go; this only stops the far end's words coming
 * back. A refused connection and a timeout share one category on purpose,
 * because telling them apart is the classic open-versus-filtered port signal.
 * An SMTP reply code is kept, because it is a number from a fixed vocabulary
 * and is what an admin needs to look up a real relay's refusal.
 */
export function classifySmtpFailure(error: unknown, port?: number): SmtpFailure {
  const name = error instanceof Error ? error.name : '';
  const text = error instanceof Error ? error.message : '';

  if (text.startsWith('Connection is not secure')) {
    return failure(
      SMTP_NOT_SECURE,
      'The SMTP server did not offer an encrypted connection, so the password was not sent. ' +
        'Turn on TLS/SSL, or use a server that supports STARTTLS.',
    );
  }

  const reply = /^(\d{3}):/.exec(text);
  if (reply) {
    const code = Number(reply[1]);
    if (AUTH_REPLY_CODES.has(code)) {
      return failure(SMTP_AUTH_FAILED, 'The SMTP server refused the username or password.');
    }
    if (code >= 400 && code <= 599) {
      return failure(SMTP_REJECTED, `The SMTP server refused the message (reply ${code}).`);
    }
  }
  if (reply || text.startsWith('NaN:') || text === 'invalid cmd' || text === 'Unexpected empty response') {
    return failure(
      SMTP_NOT_SMTP,
      'The server at this host and port did not answer as an SMTP server. Check the port.',
    );
  }

  if (CONNECT_ERROR_NAMES.has(name) || /failed to lookup address|dns error/i.test(text)) {
    const hint = port !== undefined && RUNTIME_BLOCKED_PORTS.has(port) ? BLOCKED_PORT_HINT : '';
    return failure(SMTP_CONNECT_FAILED, CONNECT_SENTENCE + hint);
  }

  if (TLS_ERROR_NAMES.has(name) || /certificate|handshake/i.test(text)) {
    return failure(
      SMTP_TLS_FAILED,
      'The secure connection to the SMTP server failed. Check that the port matches the TLS/SSL ' +
        'setting, and that the server’s certificate is valid for this host name.',
    );
  }

  return failure(SMTP_SEND_FAILED, 'The email could not be sent.');
}
