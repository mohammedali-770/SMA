/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Source of truth: design-system/money.ts
// Regenerate with: npm run design-system:sync
// CI fails if this file drifts from its source (design-system:check).
// ---------------------------------------------------------------------------
/**
 * CANONICAL SOURCE — money formatting. Mirrored by
 * `scripts/sync-design-system.mjs`; edit here, then `npm run design-system:sync`.
 *
 * DISPLAY ONLY. Authoritative currency maths stays server-side and the
 * machine-readable code stays "SAR". The visible currency mark is the official
 * SAMA riyal SVG (`SaudiRiyalSymbol`), never the letters "SAR" and never the
 * U+20C0 codepoint — font coverage for that codepoint is still unreliable.
 *
 * Framework-free: no React, React Native, Expo, DOM or Supabase imports.
 */

export type Lang = 'en' | 'ar';

/** Prices are VAT-inclusive at 15% (see docs); this is the display rate. */
export const VAT_RATE = 0.15;

/**
 * Saudi Arabia locale. `en-SA` is deliberate over `ar-SA`: it yields Latin
 * (Western) digits and a Gregorian-neutral number shape, which is what both
 * the Arabic and English UIs show for money. Arabic-Indic digits are NOT used
 * for prices — the brief and every existing screen use Western digits so a
 * number is copyable, dialable and comparable across languages.
 */
export const MONEY_LOCALE = 'en-SA';

const FRACTION_DIGITS = 2;

export interface FormatOptions {
  locale?: string;
  /**
   * Thousands separators.
   *
   * DEFAULTS TO FALSE, and that is a compatibility decision, not a style one.
   * Every shipped screen previously rendered `amount.toFixed(2)`, so enabling
   * grouping here would silently change every price at or above 1000 across
   * the admin dashboard, reports and receipts (`48200.00` → `48,200.00`) in a
   * PR whose entire premise is that no shipped screen changes appearance.
   *
   * This is the migration switch: the screen-port PR turns it on deliberately,
   * with a visual pass, rather than it arriving unreviewed underneath a token
   * refactor.
   */
  grouping?: boolean;
}

/**
 * Format a number for display next to the riyal symbol.
 * Always Latin digits, always two decimals, never a currency code or symbol
 * (the SVG supplies the mark).
 */
export function formatAmount(amount: number, options: FormatOptions = {}): string {
  const { locale = MONEY_LOCALE, grouping = false } = options;
  if (!Number.isFinite(amount)) return (0).toFixed(FRACTION_DIGITS);
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: FRACTION_DIGITS,
      maximumFractionDigits: FRACTION_DIGITS,
      // Guarantee Latin digits even if a locale/ICU build would otherwise
      // pick an Arabic-Indic numbering system.
      numberingSystem: 'latn',
      useGrouping: grouping,
    }).format(amount);
  } catch {
    // Environments without full ICU still render a correct amount.
    return amount.toFixed(FRACTION_DIGITS);
  }
}

/** Localised currency name for screen readers. */
export function currencyName(lang: Lang): string {
  return lang === 'ar' ? 'ريال سعودي' : 'Saudi Riyal';
}

/**
 * Accessible label for a price. Screen readers get the amount and the currency
 * spelled out, because the visible mark is an SVG with no text equivalent.
 */
export function priceAccessibilityLabel(
  amount: number,
  lang: Lang,
  prefix?: string,
  options: FormatOptions = {},
): string {
  const head = prefix ? `${prefix} ` : '';
  return `${head}${formatAmount(amount, options)} ${currencyName(lang)}`;
}

/**
 * Money is a NUMBER, so it reads left-to-right even inside Arabic copy, with
 * the riyal mark always on the left. Returns the direction attributes a price
 * container must carry so the browser's bidi algorithm cannot reorder it.
 *
 * `isolate` (not `embed`/`override`) is required: it stops the price from
 * changing the bidi resolution of the surrounding sentence.
 */
export function moneyDirection(): {
  dir: 'ltr';
  unicodeBidi: 'isolate';
} {
  return { dir: 'ltr', unicodeBidi: 'isolate' };
}

/**
 * React Native has no `unicode-bidi`, so isolation is achieved with Unicode
 * bidi control characters instead.
 *
 * LRI (U+2066) — not FSI (U+2068) — because a price starts with a digit, and
 * digits are bidi-neutral: FSI would inherit the paragraph direction and let
 * an Arabic sentence flip the amount. LRI forces the run left-to-right; the
 * matching PDI (U+2069) pops it so the surrounding sentence is unaffected.
 *
 * Written as escapes on purpose: these characters are invisible and a literal
 * would be silently destroyed by an editor or a bad merge.
 */
const LRI = '⁦';
const PDI = '⁩';

export function isolateLtr(value: string): string {
  return `${LRI}${value}${PDI}`;
}

/** Strip bidi isolates — for tests and for anything that must compare raw text. */
export function stripBidi(value: string): string {
  return value.replace(/[⁦-⁩]/g, '');
}
