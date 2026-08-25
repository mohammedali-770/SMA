/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatAmount } from '../design-system/generated/money';
import { Product, Category } from '../types';

/**
 * Calculates distance in kilometers between two coordinates using the Haversine formula.
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return Number(d.toFixed(1));
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Saudi Arabia VAT calculation helper.
 * Since prices must be displayed VAT-inclusive, we can extract the VAT portion
 * and the subtotal pre-VAT.
 */
export function getVATBreakdown(totalInclusive: number, vatPercentage: number = 15) {
  const vatRate = vatPercentage / 100;
  // totalInclusive = subtotalExcludingVat * (1 + vatRate)
  const subtotalExcludingVat = totalInclusive / (1 + vatRate);
  const vatAmount = totalInclusive - subtotalExcludingVat;
  return {
    subtotalExcludingVat: Number(subtotalExcludingVat.toFixed(2)),
    vatAmount: Number(vatAmount.toFixed(2)),
    totalInclusive: Number(totalInclusive.toFixed(2))
  };
}

/** Generate a short unique-enough id of the form "<prefix>-<9 base36 chars>". */
export function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Formats a numeric amount as a Saudi-Riyal currency string with the locale's
 * currency label — "123.00 SAR" (en) / "123.00 ر.س" (ar).
 *
 * Centralises the `amount.toFixed(2)` + label pattern that was duplicated across
 * the mobile and admin views. The admin views previously hardcoded " SAR" even
 * in Arabic; routing them through here makes the label follow the active
 * language ("ر.س" is the abbreviation used everywhere else in the app).
 *
 * STRING CONTEXTS ONLY. Where the amount is rendered as JSX, use the `Price`
 * component instead — it draws the official SAMA riyal symbol rather than a
 * text code. A textual label is unavoidable here because the remaining call
 * sites interpolate the amount into a sentence, where an element cannot go.
 *
 * The number comes from the shared design-system money module, so decimals and
 * grouping are identical to `Price`: one implementation of "how much" in the
 * product, differing only in the label.
 */
export function formatSAR(amount: number, lang: 'en' | 'ar' = 'en'): string {
  return `${formatAmount(amount)} ${lang === 'ar' ? 'ر.س' : 'SAR'}`;
}

const RIYADH_TZ = 'Asia/Riyadh';

/**
 * Formats an ISO timestamp as "YYYY-MM-DD HH:mm" in Saudi (Riyadh, UTC+3) local
 * time. Receipts and history previously rendered raw UTC via toISOString(),
 * which showed the wrong wall-clock time to Saudi users.
 */
export function formatRiyadhDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-CA', { timeZone: RIYADH_TZ }); // YYYY-MM-DD
  const time = d.toLocaleTimeString('en-GB', { timeZone: RIYADH_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}

/**
 * Returns the "YYYY-MM-DD" calendar date of an ISO timestamp in Riyadh local
 * time, for date-range filtering that must agree with the branch's local day
 * (slicing the UTC string put late-evening orders on the wrong day).
 */
export function riyadhDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: RIYADH_TZ });
}

/**
 * First and last calendar day ("YYYY-MM-DD", Riyadh local) of the month that
 * contains `now` (defaults to the current instant). Used to default report date
 * ranges to the current month instead of a hardcoded window that never rolls
 * over. Kept in Riyadh time so the boundaries agree with riyadhDateOnly().
 */
export function riyadhMonthRange(now: Date = new Date()): { start: string; end: string } {
  const today = now.toLocaleDateString('en-CA', { timeZone: RIYADH_TZ }); // YYYY-MM-DD
  const [year, month] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  // Day 0 of the *next* month is the last day of this month (handles 28–31).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay)}` };
}

/**
 * Saudi Arabia is UTC+3 year-round — it has no daylight saving — so a Riyadh
 * calendar day maps to a fixed UTC instant with no seasonal correction. Written
 * as a literal offset rather than derived from `Intl`, because the derivation
 * would only ever return this value and the constant is checkable by eye.
 */
const RIYADH_UTC_OFFSET = '+03:00';

/**
 * The UTC instant at which a Riyadh calendar day ("YYYY-MM-DD") begins.
 *
 * The inverse of `riyadhDateOnly`, and the reason the reports can now filter
 * server-side: the database stores `created_at` as an instant, while the report
 * form collects Riyadh calendar dates.
 */
export function riyadhDayStartIso(date: string): string {
  assertCalendarDate(date, 'riyadhDayStartIso');
  return new Date(`${date}T00:00:00${RIYADH_UTC_OFFSET}`).toISOString();
}

/** The next Riyadh calendar day ("YYYY-MM-DD"), rolling month and year. */
export function riyadhNextDay(date: string): string {
  assertCalendarDate(date, 'riyadhNextDay');
  const [year, month, day] = date.split('-').map(Number);
  // Date.UTC normalises an out-of-range day, so day+1 past the month end rolls.
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD", the shape an `<input type="date">` produces when it has a value. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a string is a usable calendar date for the helpers below.
 *
 * Exported because callers need to CHECK before converting rather than catch
 * afterwards: a cleared `<input type="date">` yields `''`, and these helpers are
 * called synchronously inside effects where a throw takes the panel down instead
 * of landing in a `.catch()`.
 */
export function isCalendarDate(date: string): boolean {
  if (!CALENDAR_DATE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // ROUND-TRIP, not just "does it parse". Date silently ROLLS an impossible day:
  // '2026-02-30' parses happily and comes back as 2026-03-02, which would move a
  // report range by two days without telling anyone. Comparing the normalised
  // value against the input is what catches that.
  return parsed.toISOString().slice(0, 10) === date;
}

/**
 * Fail with a description instead of a bare `RangeError: Invalid time value`.
 *
 * `new Date('T00:00:00+03:00').toISOString()` throws that message with no
 * indication of which input was empty or which helper was called, which is a
 * miserable thing to find in a production stack trace.
 */
function assertCalendarDate(date: string, fn: string): void {
  if (!isCalendarDate(date)) {
    throw new Error(`${fn}: expected a YYYY-MM-DD calendar date, received ${JSON.stringify(date)}`);
  }
}

/**
 * A Riyadh calendar date range as the HALF-OPEN UTC instant window
 * `[from, to)` the ranged order feed expects.
 *
 * Half-open, and the upper bound is the start of the day AFTER `end`, so an
 * order placed at 23:59:59.7 Riyadh on the last day is included while one at
 * 00:00:00.0 the next day is not. A closed `<= end 23:59:59` bound would drop
 * the first and, at the next range's lower edge, count the second twice.
 */
export function riyadhRangeToUtc(start: string, end: string): { fromIso: string; toIso: string } {
  return {
    fromIso: riyadhDayStartIso(start),
    toIso: riyadhDayStartIso(riyadhNextDay(end)),
  };
}

/**
 * Creates a sample CSV data URL for menu import.
 */
export function getCSVTemplateData(): string {
  const headers = 'category_name_en,category_name_ar,product_name_en,product_name_ar,description_en,description_ar,price_sar,calories,image_url\n';
  const row1 = 'Burgers,برجر,Spicy Volcano Chicken,فولكانو دجاج مقرمش,Super spicy hand-breaded chicken,دجاج مقرمش حار جدا,29.00,710,https://images.unsplash.com/photo-1627662236973-4f8259149f71?auto=format&fit=crop&w=600&h=400&q=80\n';
  const row2 = 'Sides,المقبلات,Crispy French Fries,بطاطس مقلية مقرمشة,Classic golden fries,بطاطس ذهبية كلاسيكية,12.00,310,https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=600&h=400&q=80\n';
  const row3 = 'Drinks,المشروبات,Ice Cold Orange Juice,عصير برتقال مثلج,Fresh squeezed orange juice,عصير برتقال طازج معصور,10.00,120,\n';
  
  return 'data:text/csv;charset=utf-8,' + encodeURIComponent(headers + row1 + row2 + row3);
}

/**
 * Parses a CSV string and returns new categories and products.
 */
export function parseCSVMenu(csvText: string, existingCategories: Category[]): {
  categories: Category[];
  products: Product[];
  errors: string[];
} {
  const lines = csvText.split('\n');
  const products: Product[] = [];
  const newCategories: Category[] = [...existingCategories];
  const errors: string[] = [];

  if (lines.length <= 1) {
    errors.push('The CSV file is empty or missing headers.');
    return { categories: newCategories, products, errors };
  }

  // Parse headers
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Basic CSV cell parsing (simple split by comma, ignoring nested commas for safety in mockup)
    // For a robust simulation, split by comma or match comma-separated-values pattern
    const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    
    if (cells.length < 7) {
      errors.push(`Row ${i + 1} has insufficient columns (expected at least 7 columns).`);
      continue;
    }

    const catNameEn = cells[0];
    const catNameAr = cells[1];
    const prodNameEn = cells[2];
    const prodNameAr = cells[3];
    const descEn = cells[4];
    const descAr = cells[5];
    const priceRaw = cells[6];
    const caloriesRaw = cells[7] || '0';
    const imageUrl = cells[8] || 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&h=400&q=80';

    if (!catNameEn || !catNameAr || !prodNameEn || !prodNameAr || !priceRaw) {
      errors.push(`Row ${i + 1} contains missing required fields.`);
      continue;
    }

    const price = parseFloat(priceRaw);
    if (isNaN(price) || price <= 0) {
      errors.push(`Row ${i + 1} has an invalid price: "${priceRaw}".`);
      continue;
    }

    const calories = parseInt(caloriesRaw);

    // Find or create category
    let category = newCategories.find(c => c.nameEn.toLowerCase() === catNameEn.toLowerCase());
    if (!category) {
      const newCatId = generateId('cat-csv');
      category = {
        id: newCatId,
        nameEn: catNameEn,
        nameAr: catNameAr,
        sortOrder: newCategories.length + 1
      };
      newCategories.push(category);
    }

    const prodId = generateId('prod-csv');
    const newProduct: Product = {
      // CSV import carries a single price per row, so no tiers.
      variants: [],
      id: prodId,
      categoryId: category.id,
      nameEn: prodNameEn,
      nameAr: prodNameAr,
      descriptionEn: descEn,
      descriptionAr: descAr,
      price,
      calories: isNaN(calories) ? 0 : calories,
      imageUrl: imageUrl || 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&h=400&q=80',
      isActive: true,
      modifierGroupIds: ['mg-heat-level'] // default heat level modifier group assigned
    };

    products.push(newProduct);
  }

  return { categories: newCategories, products, errors };
}
