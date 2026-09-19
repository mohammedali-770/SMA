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

import { isAllowedHost, isIpLiteral, isPrivateName, isValidHostname, normalizeHost } from './publicHost.ts';

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
