/**
 * "Get a copy of my data" — the pure parts.
 *
 * WHY A SEPARATE MODULE. The screen does three things that are worth testing
 * without a renderer: it decides whether a second tap should be ignored, it
 * turns the server's JSON into a sentence the customer can check at a glance,
 * and it maps a failure onto something other than a stack trace. The share
 * itself is one line of React Native and needs no test.
 *
 * WHY REACT NATIVE'S OWN `Share` AND NOT A FILE. `expo-file-system` and
 * `expo-sharing` are not installed, and adding either is a new native module —
 * which means the feature could not ship until the next EAS build. `Share` is
 * part of React Native core, so this works in the build the customer already
 * has. The trade is that the export travels as text rather than as a `.json`
 * attachment; for a customer exercising a PDPL access request that is the same
 * information, and it can be pasted anywhere.
 */

export type ExportState = 'idle' | 'working' | 'shared' | 'error';

/**
 * A second tap while a request is in flight must do nothing. Not cosmetic: each
 * call is a full read of the customer's order history, and a double tap on a
 * slow connection would run it twice and share the first result twice.
 */
export function shouldStartExport(state: ExportState): boolean {
  return state !== 'working';
}

export interface ExportSummary {
  orders: number;
  addresses: number;
  loyaltyEntries: number;
  devices: number;
}

/**
 * Count what came back, defensively. The server always sends arrays — the
 * migration coalesces every collection to `[]` — but this is the boundary
 * between two systems, and a summary that throws on unexpected input would
 * lose the customer their export for a cosmetic reason.
 */
export function summarizeExport(payload: unknown): ExportSummary {
  const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  const p = (payload ?? {}) as Record<string, unknown>;
  return {
    orders: len(p.orders),
    addresses: len(p.saved_addresses),
    loyaltyEntries: len(p.loyalty_history),
    devices: len(p.notification_devices),
  };
}

/** One line the customer can sanity-check before they send the file anywhere. */
export function summaryLine(s: ExportSummary, lang: 'en' | 'ar'): string {
  return lang === 'ar'
    ? `${s.orders} طلب · ${s.addresses} عنوان · ${s.loyaltyEntries} حركة نقاط · ${s.devices} جهاز`
    : `${s.orders} orders · ${s.addresses} addresses · ${s.loyaltyEntries} loyalty entries · ${s.devices} devices`;
}

/**
 * Title for the share sheet. Dated so a customer who exports twice can tell the
 * copies apart, and formatted by hand rather than through `Intl` for the reason
 * `loyaltyExpiry.ts` documents: `new Date('2026-09-08')` is UTC midnight, which
 * is the PREVIOUS day west of Greenwich.
 */
export function exportTitle(now: Date, lang: 'en' | 'ar'): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return lang === 'ar' ? `بيانات سبايسي ميل ${y}-${m}-${d}` : `Spicy Meal data ${y}-${m}-${d}`;
}

/**
 * A failed export must say something a person can act on. The distinction that
 * matters is offline versus everything else: one is worth retrying immediately,
 * the other is worth contacting support about.
 */
export function exportErrorMessage(err: unknown, lang: 'en' | 'ar'): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const offline = /network|fetch|timeout|offline/i.test(raw);
  if (offline) {
    return lang === 'ar'
      ? 'تعذّر الاتصال. تحقّق من الشبكة وحاول مرة أخرى.'
      : 'Could not connect. Check your connection and try again.';
  }
  return lang === 'ar'
    ? 'تعذّر تجهيز نسختك الآن. تواصل معنا إذا تكرر ذلك.'
    : 'We could not prepare your copy just now. Contact us if it keeps happening.';
}
