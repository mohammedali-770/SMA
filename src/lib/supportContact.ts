/**
 * Contact & Support channel policy — PURE and framework-free so the
 * sanitization + visibility rules are unit-tested under Node
 * (supportContact.test.ts). WEB MIRROR of apps/mobile/src/lib/supportContact.ts.
 * The admin panel uses these validators to warn when a value would be hidden in
 * the app.
 *
 * THE MIRROR IS ENFORCED, not requested. src/lib/mirrorParity.test.ts fails if
 * the two copies diverge by so much as a line of code. Change one, change the
 * other. This header used to say "keep the two in sync" and rely on somebody
 * reading it; the identical test file that used to sit beside the mobile copy is
 * gone, because running the same 114 assertions twice against identical code
 * bought nothing that the parity check does not.
 *
 * Security/UX rules this encodes:
 *  - Links are CONSTRUCTED here from validated fragments (digits, a vetted
 *    email) — an admin-stored value can never inject an arbitrary URL or
 *    scheme into the app. Allowed schemes are exactly: tel:, mailto:, and
 *    https://wa.me/<digits>.
 *  - A channel renders ONLY when it is enabled AND its value survives
 *    sanitization — unconfigured or invalid channels are hidden, never shown
 *    broken.
 *  - PLACEHOLDER GUARD: seeded/template values (e.g. "+966 5X XXX XXXX",
 *    "support@example.com", "edit in Admin") are rejected as unconfigured, so
 *    placeholder contact details can never reach a customer.
 */

export interface SupportSettings {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  hoursEn: string | null;
  hoursAr: string | null;
  descEn: string | null;
  descAr: string | null;
  phoneEnabled: boolean;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
}

/** True when a stored value is template/placeholder text, not a real contact. */
export function isPlaceholderValue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return true;
  if (v.includes('example.com') || v.includes('example.org')) return true;
  if (v.includes('edit in admin') || v.includes('placeholder')) return true;
  // Masked digits like "+966 5X XXX XXXX" / "05XXXXXXXX".
  if (/\d\s*x/i.test(raw) || /x{2,}/i.test(raw)) return true;
  return false;
}

/** "+966 55 123-4567" → "tel:+966551234567"; null when not a plausible phone. */
export function telLink(raw: string | null | undefined): string | null {
  if (!raw || isPlaceholderValue(raw)) return null;
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${plus ? '+' : ''}${digits}`;
}

/**
 * Normalize a SAUDI MOBILE number to canonical international digits
 * (9665XXXXXXXX), or null when the value must be hidden. Accepted input
 * formats (separators/spaces allowed):
 *   05XXXXXXXX · 5XXXXXXXX · +9665XXXXXXXX · 009665XXXXXXXX
 * Rejected: wrong lengths, landlines (011…/+96611…), non-Saudi international
 * numbers, arbitrary text, URLs/schemes, placeholder values.
 */
export function normalizeSaudiMobile(raw: string | null | undefined): string | null {
  if (!raw || isPlaceholderValue(raw)) return null;
  const compact = raw.trim().replace(/[\s()-]/g, '');
  // Digits with at most one leading '+' — kills text, URLs, and schemes.
  if (!/^\+?\d+$/.test(compact)) return null;

  const hasPlus = compact.startsWith('+');
  let digits = hasPlus ? compact.slice(1) : compact;
  const hasIntlPrefix = hasPlus || digits.startsWith('00');
  if (!hasPlus && digits.startsWith('00')) digits = digits.slice(2);

  if (hasIntlPrefix) {
    // Explicitly international input must ALREADY be the full Saudi mobile
    // number — never rewrite it (review finding: 00551234567 / +551234567
    // must hide, not morph into a fabricated 9665… number).
    return /^9665\d{8}$/.test(digits) ? digits : null;
  }
  // Local rewriting applies ONLY to prefix-free input.
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`; // 05XXXXXXXX
  if (/^5\d{8}$/.test(digits)) return `966${digits}`;           // 5XXXXXXXX
  // Bare international digits (9665XXXXXXXX) are unambiguous — accept.
  return /^9665\d{8}$/.test(digits) ? digits : null;
}

/**
 * WhatsApp deep link for a Saudi mobile: https://wa.me/9665XXXXXXXX.
 * Built from the normalized digits ONLY — an admin-stored value can never
 * become a wrong-country target (review finding: 0551234567 must map to
 * 966551234567, never wa.me/551234567) or inject a URL.
 */
export function whatsappLink(raw: string | null | undefined): string | null {
  const normalized = normalizeSaudiMobile(raw);
  return normalized ? `https://wa.me/${normalized}` : null;
}

/** "support@spicymeal.sa" → "mailto:support@spicymeal.sa"; null when invalid. */
export function mailtoLink(raw: string | null | undefined): string | null {
  if (!raw || isPlaceholderValue(raw)) return null;
  const v = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return null;
  return `mailto:${v}`;
}

export type SupportChannelKind = 'phone' | 'whatsapp' | 'email';

export interface SupportChannel {
  kind: SupportChannelKind;
  /** Human-readable value shown next to the action (e.g. the number/email). */
  display: string;
  /** The ONLY url the row may open — constructed, never stored. */
  url: string;
}

/**
 * The channels the customer may see: enabled AND valid AND non-placeholder.
 * Order is fixed: call → whatsapp → email.
 */
export function visibleSupportChannels(s: SupportSettings | null | undefined): SupportChannel[] {
  if (!s) return [];
  const out: SupportChannel[] = [];
  const tel = s.phoneEnabled ? telLink(s.phone) : null;
  if (tel && s.phone) out.push({ kind: 'phone', display: s.phone.trim(), url: tel });
  const waDigits = s.whatsappEnabled ? normalizeSaudiMobile(s.whatsapp) : null;
  if (waDigits) out.push({ kind: 'whatsapp', display: `+${waDigits}`, url: `https://wa.me/${waDigits}` });
  const mail = s.emailEnabled ? mailtoLink(s.email) : null;
  if (mail && s.email) out.push({ kind: 'email', display: s.email.trim(), url: mail });
  return out;
}

/** Working hours for the active language; null hides the row. */
export function workingHoursText(s: SupportSettings | null | undefined, lang: 'en' | 'ar'): string | null {
  if (!s) return null;
  const v = (lang === 'ar' ? s.hoursAr : s.hoursEn)?.trim();
  return v && !isPlaceholderValue(v) ? v : null;
}

/** Support description for the active language; null hides the row. */
export function supportDescription(s: SupportSettings | null | undefined, lang: 'en' | 'ar'): string | null {
  if (!s) return null;
  const v = (lang === 'ar' ? s.descAr : s.descEn)?.trim();
  return v && !isPlaceholderValue(v) ? v : null;
}
