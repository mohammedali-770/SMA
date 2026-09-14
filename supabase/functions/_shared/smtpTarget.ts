/**
 * Validate the SMTP endpoint the alert dispatcher is about to connect to.
 *
 * WHY. `operations-alert-dispatch` reads `host`, `port` and `username` out of
 * `integration_settings.public_config` and hands them straight to
 * `Deno.connect`. Writing that row needs `is_admin()` — role AND AAL2 — so this
 * is not an anonymous SSRF; it is containment for a compromised admin session
 * or a leaked service key, which bypasses RLS entirely. The same shape as the
 * Lazywait `base_url` guard in `lazywait.ts`, and deliberately written to look
 * like it: one pure function, one reason code per refusal, no network.
 *
 * WHAT IT REFUSES, and why each is not a legitimate mail relay for this
 * product: an IP literal in any of its four spellings (dotted, decimal, hex,
 * octal) and IPv6; loopback, private and link-local space — `169.254.169.254`
 * is the cloud metadata endpoint, and `10./172.16./192.168.` is the inside of
 * somebody's network; and the `.local`, `.internal` and `.home.arpa` suffixes
 * that resolve only inside one. A relay is a public hostname.
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

export const SMTP_NOT_CONFIGURED = 'smtp_not_configured';
export const SMTP_HOST_INVALID = 'smtp_host_invalid';
export const SMTP_HOST_NOT_ROUTABLE = 'smtp_host_not_routable';
export const SMTP_HOST_NOT_ALLOWED = 'smtp_host_not_allowed';
export const SMTP_PORT_INVALID = 'smtp_port_invalid';

export interface SmtpTarget {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  fromEmail: string;
  fromName: string;
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
  return { host: '', port: 0, tls: false, username: '', fromEmail: '', fromName: '', reason };
}

/** Every spelling of an IPv4 literal a resolver would still accept. */
function isIpLiteral(host: string): boolean {
  if (host.includes(':')) return true; // IPv6, bare or bracketed
  if (/^\d+$/.test(host)) return true; // 2130706433
  if (/^0[xX][0-9a-fA-F]+$/.test(host)) return true; // 0x7f000001
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true; // 127.0.0.1
  // Mixed and short forms: 127.1, 0177.0.0.1, 0x7f.1
  if (/^(0[xX][0-9a-fA-F]+|\d+)(\.(0[xX][0-9a-fA-F]+|\d+))*$/.test(host)) return true;
  return false;
}

/** Names that resolve only inside a network, never to a public relay. */
function isPrivateName(host: string): boolean {
  if (host === 'localhost') return true;
  return (
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  );
}

function isValidHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false; // a relay is never a bare label
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
  }
  // A real TLD, so `mail.spicymeal` or a typo'd suffix cannot be reached.
  return /^[a-z]{2,}$/.test(labels[labels.length - 1]);
}

/**
 * An OPTIONAL operator allowlist, for an installation that wants the endpoint
 * pinned rather than merely public. Unset means "any public hostname", which is
 * the behaviour every existing deployment already has.
 */
export function isAllowedSmtpHost(host: string, allowlist: string | null | undefined): boolean {
  const raw = (allowlist ?? '').trim();
  if (raw === '') return true;
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
    .filter((h) => h !== '')
    .some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function parseSmtpTarget(
  publicConfig: Record<string, unknown>,
  allowlist?: string | null,
): SmtpTarget {
  // Trailing dot is the fully-qualified spelling of the same name; strip it so
  // `evil.com.` cannot slip past an allowlist that holds `evil.com`.
  const host = String(publicConfig.host ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  const fromEmail = String(publicConfig.from_email ?? '').trim();
  const fromName = String(publicConfig.from_name ?? '').trim() || 'Spicy Meal';
  const username = String(publicConfig.username ?? '').trim();
  const tls = publicConfig.secure === true;

  if (!host || !fromEmail) return refuse(SMTP_NOT_CONFIGURED);

  const portRaw = String(publicConfig.port ?? '').trim() || '587';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return refuse(SMTP_PORT_INVALID);

  if (isIpLiteral(host) || isPrivateName(host)) return refuse(SMTP_HOST_NOT_ROUTABLE);
  if (!isValidHostname(host)) return refuse(SMTP_HOST_INVALID);
  if (!isAllowedSmtpHost(host, allowlist)) return refuse(SMTP_HOST_NOT_ALLOWED);

  return { host, port, tls, username, fromEmail, fromName, reason: null };
}
