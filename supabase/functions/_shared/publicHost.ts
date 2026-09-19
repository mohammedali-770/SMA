/**
 * Is this hostname one a public service could legitimately live on?
 *
 * EXTRACTED FROM `smtpTarget.ts` ON 2026-09-19, when a second caller needed the
 * same rules. The admin push sender POSTs to an endpoint that an administrator
 * supplied, exactly as the alert dispatcher connects to an SMTP host an
 * administrator supplied — the same question, and duplicating forty lines of
 * security-critical host parsing is how two copies of a rule drift apart. The
 * SMTP suite covers the behaviour, so the extraction is verified rather than
 * assumed.
 *
 * WHAT IT REFUSES, and why none of them is a legitimate public service: an IP
 * literal in any of its four spellings (dotted, decimal, hex, octal) and IPv6;
 * the `.local`, `.internal`, `.localhost` and `.home.arpa` suffixes that resolve
 * only inside one network; and anything that is not a well-formed dotted name
 * with a real TLD. `169.254.169.254` is the cloud metadata endpoint and
 * `10./172.16./192.168.` is the inside of somebody's network, so an IP literal
 * is refused outright rather than range-checked: no push service and no mail
 * relay this product uses is ever addressed by one.
 */

/** Every spelling of an IPv4 literal a resolver would still accept. */
export function isIpLiteral(host: string): boolean {
  if (host.includes(':')) return true; // IPv6, bare or bracketed
  if (/^\d+$/.test(host)) return true; // 2130706433
  if (/^0[xX][0-9a-fA-F]+$/.test(host)) return true; // 0x7f000001
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true; // 127.0.0.1
  // Mixed and short forms: 127.1, 0177.0.0.1, 0x7f.1
  if (/^(0[xX][0-9a-fA-F]+|\d+)(\.(0[xX][0-9a-fA-F]+|\d+))*$/.test(host)) return true;
  return false;
}

/** Names that resolve only inside a network, never to a public service. */
export function isPrivateName(host: string): boolean {
  if (host === 'localhost') return true;
  return (
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  );
}

export function isValidHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false; // a public service is never a bare label
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
  }
  // A real TLD, so `mail.spicymeal` or a typo'd suffix cannot be reached.
  return /^[a-z]{2,}$/.test(labels[labels.length - 1]);
}

/** Both refusals in one question: routable, and a well-formed public name. */
export function isPublicHostname(host: string): boolean {
  return !isIpLiteral(host) && !isPrivateName(host) && isValidHostname(host);
}

/**
 * An OPTIONAL operator allowlist, for an installation that wants an endpoint
 * pinned rather than merely public. Unset means "any public hostname", which is
 * the behaviour every existing deployment already has.
 */
export function isAllowedHost(host: string, allowlist: string | null | undefined): boolean {
  const raw = (allowlist ?? '').trim();
  if (raw === '') return true;
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
    .filter((h) => h !== '')
    .some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Normalise a hostname for comparison. The trailing dot is the fully-qualified
 * spelling of the same name, so `evil.com.` must not slip past an allowlist
 * holding `evil.com`.
 */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}
