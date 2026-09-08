/**
 * Whether to tell this customer their points expire, and how to word the date.
 *
 * Framework-free and pure, so the decision can be tested without rendering a
 * screen — and because the decision is not obvious. Three cases must stay
 * SILENT, and each is silent for its own reason:
 *
 *   * expiry is off              — nothing expires, so there is no date to give;
 *   * no date is scheduled       — the server owns the schedule and has not set
 *                                  one; inventing a date would be worse than
 *                                  saying nothing;
 *   * the customer holds nothing — "your 0 points expire on 1 January" is noise
 *                                  that makes the warning meaningless for the
 *                                  customers it is actually for.
 *
 * The date is formatted here rather than with `Intl`: locale data on Hermes is
 * not dependable across platforms, and a month name is data, not copy — putting
 * twenty-four month names into `strings.ts` would bury the two sentences that
 * are really UI text.
 */
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/**
 * `YYYY-MM-DD` → "1 January 2027". Parsed by hand rather than through `Date`,
 * which would apply the device time zone and can move the day across midnight.
 * Returns null for anything that is not a plain ISO date.
 */
export function formatExpiryDate(iso: string, lang: 'en' | 'ar'): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const names = lang === 'ar' ? MONTHS_AR : MONTHS_EN;
  return `${day} ${names[month - 1]} ${year}`;
}

/**
 * The formatted date to show, or null to show nothing at all.
 */
export function expiryNotice(input: {
  /** `app_settings.loyalty_expiry_enabled`. */
  enabled: boolean;
  /** `app_settings.loyalty_expiry_next_run_on`, or null when unscheduled. */
  nextRunOn: string | null;
  /** The customer's current balance. */
  points: number;
  lang: 'en' | 'ar';
}): string | null {
  if (!input.enabled) return null;
  if (!input.nextRunOn) return null;
  if (!Number.isFinite(input.points) || input.points <= 0) return null;
  return formatExpiryDate(input.nextRunOn, input.lang);
}
