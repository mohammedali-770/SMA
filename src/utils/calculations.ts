/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
 */
export function formatSAR(amount: number, lang: 'en' | 'ar' = 'en'): string {
  return `${amount.toFixed(2)} ${lang === 'ar' ? 'ر.س' : 'SAR'}`;
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
