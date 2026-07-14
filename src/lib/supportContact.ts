/**
 * Contact & Support channel policy — PURE and framework-free so the
 * sanitization + visibility rules are unit-tested under Node
 * (supportContact.test.ts). WEB MIRROR of apps/mobile/src/lib/supportContact.ts —
 * keep the two in sync (same pattern as legal.ts). The admin panel uses these
 * validators to warn when a value would be hidden in the app.
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

/** WhatsApp deep link built from DIGITS ONLY: https://wa.me/9665XXXXXXXX. */
export function whatsappLink(raw: string | null | undefined): string | null {
  if (!raw || isPlaceholderValue(raw)) return null;
  // wa.me requires the international number without + or leading zeros.
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `https://wa.me/${digits}`;
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
  const wa = s.whatsappEnabled ? whatsappLink(s.whatsapp) : null;
  if (wa && s.whatsapp) out.push({ kind: 'whatsapp', display: s.whatsapp.trim(), url: wa });
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
