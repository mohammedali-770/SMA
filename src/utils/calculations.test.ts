import { describe, it, expect } from 'vitest';
import {
  getVATBreakdown,
  formatSAR,
  calculateDistance,
  generateId,
  getCSVTemplateData,
  parseCSVMenu,
  isCalendarDate,
  formatRiyadhDateTime,
  formatRiyadhDateTimeSeconds,
  formatRiyadhTimeSeconds,
  riyadhDateOnly,
  riyadhDayStartIso,
  riyadhMonthRange,
  riyadhNextDay,
  riyadhRangeToUtc,
} from './calculations';
import { Category } from '../types';

/**
 * Run `fn` with the process in `zone`, then put the zone back. Node re-reads
 * TZ when it is assigned, so this changes what `Date` and `Intl` treat as
 * local. CI runs in UTC, which is exactly the zone that hides a device-zone
 * bug, so the zone-sensitive cases below never rely on the default.
 */
function inZone<T>(zone: string, fn: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

describe('getVATBreakdown', () => {
  it('splits a VAT-inclusive total into pre-VAT subtotal + VAT at 15% (default)', () => {
    // 115 inclusive => 100 net + 15 VAT.
    expect(getVATBreakdown(115)).toEqual({
      subtotalExcludingVat: 100,
      vatAmount: 15,
      totalInclusive: 115,
    });
  });

  it('honours a custom VAT percentage', () => {
    // 110 inclusive at 10% => 100 net + 10 VAT.
    expect(getVATBreakdown(110, 10)).toEqual({
      subtotalExcludingVat: 100,
      vatAmount: 10,
      totalInclusive: 110,
    });
  });

  it('rounds to two decimals and the parts still sum to the total', () => {
    const b = getVATBreakdown(100);
    expect(b.subtotalExcludingVat).toBe(86.96);
    expect(b.vatAmount).toBe(13.04);
    expect(b.subtotalExcludingVat + b.vatAmount).toBeCloseTo(b.totalInclusive, 2);
  });

  it('handles a zero total', () => {
    expect(getVATBreakdown(0)).toEqual({
      subtotalExcludingVat: 0,
      vatAmount: 0,
      totalInclusive: 0,
    });
  });
});

describe('formatSAR', () => {
  it('defaults to the English "SAR" label with two decimals', () => {
    expect(formatSAR(123)).toBe('123.00 SAR');
  });

  it('uses the Arabic "ر.س" abbreviation when lang is "ar"', () => {
    expect(formatSAR(123, 'ar')).toBe('123.00 ر.س');
  });

  it('always shows two decimals, including a trailing zero', () => {
    // The bug this fixed: bare numbers rendered "12.5" instead of "12.50".
    expect(formatSAR(12.5, 'en')).toBe('12.50 SAR');
    expect(formatSAR(0, 'ar')).toBe('0.00 ر.س');
  });
});

describe('calculateDistance', () => {
  it('is zero for identical coordinates', () => {
    expect(calculateDistance(24.7136, 46.6753, 24.7136, 46.6753)).toBe(0);
  });

  it('approximates one degree of longitude at the equator (~111 km)', () => {
    const d = calculateDistance(0, 0, 0, 1);
    expect(d).toBeGreaterThan(111);
    expect(d).toBeLessThan(112);
  });

  it('is symmetric between the two points', () => {
    const ab = calculateDistance(24.71, 46.67, 21.42, 39.82);
    const ba = calculateDistance(21.42, 39.82, 24.71, 46.67);
    expect(ab).toBe(ba);
  });
});

describe('generateId', () => {
  it('prefixes the id and uses base36 characters', () => {
    expect(generateId('prod')).toMatch(/^prod-[a-z0-9]+$/);
  });

  it('produces distinct ids across calls', () => {
    const a = generateId('cat');
    const b = generateId('cat');
    expect(a).not.toBe(b);
  });
});

describe('riyadhMonthRange', () => {
  it('returns the first and last day of the month containing the given date', () => {
    expect(riyadhMonthRange(new Date('2026-07-13T09:00:00Z'))).toEqual({
      start: '2026-07-01',
      end: '2026-07-31',
    });
  });

  it('handles February in a non-leap year (28 days)', () => {
    expect(riyadhMonthRange(new Date('2026-02-15T12:00:00Z'))).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
  });

  it('handles a leap-year February (29 days)', () => {
    expect(riyadhMonthRange(new Date('2028-02-10T12:00:00Z'))).toEqual({
      start: '2028-02-01',
      end: '2028-02-29',
    });
  });

  it('uses the Riyadh (UTC+3) calendar day at a UTC day boundary', () => {
    // 2026-07-31T22:30Z is 2026-08-01 01:30 in Riyadh → August, not July.
    expect(riyadhMonthRange(new Date('2026-07-31T22:30:00Z'))).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    });
  });
});

describe('parseCSVMenu', () => {
  const HEADER =
    'category_name_en,category_name_ar,product_name_en,product_name_ar,description_en,description_ar,price_sar,calories,image_url';

  it('parses a valid row into a product and creates its category', () => {
    const csv = `${HEADER}\nBurgers,برجر,Test Burger,برجر تجريبي,tasty,لذيذ,25.50,600,http://img`;
    const { products, categories, errors } = parseCSVMenu(csv, []);

    expect(errors).toEqual([]);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      nameEn: 'Test Burger',
      nameAr: 'برجر تجريبي',
      price: 25.5,
      calories: 600,
    });
    // A new "Burgers" category was created and the product points at it.
    const cat = categories.find(c => c.nameEn === 'Burgers');
    expect(cat).toBeDefined();
    expect(products[0].categoryId).toBe(cat!.id);
  });

  it('reuses an existing category instead of duplicating it', () => {
    const existing: Category[] = [
      { id: 'cat-1', nameEn: 'Burgers', nameAr: 'برجر', sortOrder: 1 },
    ];
    const csv = `${HEADER}\nBurgers,برجر,Another,آخر,d,و,10,100,http://img`;
    const { products, categories } = parseCSVMenu(csv, existing);

    expect(categories.filter(c => c.nameEn === 'Burgers')).toHaveLength(1);
    expect(products[0].categoryId).toBe('cat-1');
  });

  it('reports an error for a header-only (empty) file', () => {
    const { products, errors } = parseCSVMenu(HEADER, []);
    expect(products).toEqual([]);
    expect(errors[0]).toMatch(/empty or missing headers/i);
  });

  it('reports an error for an invalid price and skips the row', () => {
    const csv = `${HEADER}\nBurgers,برجر,X,Y,d,و,not-a-number,600,http://img`;
    const { products, errors } = parseCSVMenu(csv, []);
    expect(products).toHaveLength(0);
    expect(errors.some(e => /invalid price/i.test(e))).toBe(true);
  });

  it('reports an error for a row missing required fields', () => {
    // Empty product_name_en.
    const csv = `${HEADER}\nBurgers,برجر,,Y,d,و,25,600,http://img`;
    const { products, errors } = parseCSVMenu(csv, []);
    expect(products).toHaveLength(0);
    expect(errors.some(e => /missing required fields/i.test(e))).toBe(true);
  });
});

describe('parseCSVMenu — what spreadsheets actually write', () => {
  const HEADER =
    'category_name_en,category_name_ar,product_name_en,product_name_ar,description_en,description_ar,price_sar,calories,image_url';
  const summary = (r: ReturnType<typeof parseCSVMenu>) => ({
    errors: r.errors,
    products: r.products.map(p => ({
      nameEn: p.nameEn, nameAr: p.nameAr, descriptionEn: p.descriptionEn,
      descriptionAr: p.descriptionAr, price: p.price, calories: p.calories,
    })),
  });

  it('reads a quoted cell holding a comma as ONE cell, so the price is the price', () => {
    // The row from the 2026-11-11 assessment. Split on every comma, it came out
    // as nameAr "12 pcs", price 12 and calories 29 — with no error at all.
    const csv = `${HEADER}\nWings,أجنحة,"Wings, 12 pcs",أجنحة دجاج,Hot wings,12 قطعة حارة,29.00,450,\n`;
    expect(summary(parseCSVMenu(csv, []))).toEqual({
      errors: [],
      products: [{
        nameEn: 'Wings, 12 pcs', nameAr: 'أجنحة دجاج', descriptionEn: 'Hot wings',
        descriptionAr: '12 قطعة حارة', price: 29, calories: 450,
      }],
    });
  });

  it('reads a doubled quote inside a quoted cell as one quote', () => {
    const csv = `${HEADER}\nPizza,بيتزا,"The ""Big"" One",الكبيرة,"12"" base",قاعدة,45.00,900,`;
    const [p] = parseCSVMenu(csv, []).products;
    expect(p.nameEn).toBe('The "Big" One');
    expect(p.descriptionEn).toBe('12" base');
    expect(p.price).toBe(45);
  });

  it('keeps a line break inside a quoted description in the same row', () => {
    // Row numbers in warnings are SPREADSHEET rows: the two-line cell is row 2,
    // so the bad price after it is reported on row 3, where the admin will look.
    const csv = `${HEADER}\nSides,مقبلات,Fries,بطاطس,"Crispy\nand hot",مقرمشة,12.00,310,\nSides,مقبلات,Bad,سيئ,d,و,free,1,`;
    const r = parseCSVMenu(csv, []);
    expect(r.products).toHaveLength(1);
    expect(r.products[0].descriptionEn).toBe('Crispy\nand hot');
    expect(r.products[0].price).toBe(12);
    expect(r.errors).toEqual(['Row 3 has an invalid price: "free".']);
  });

  it('reads CRLF line endings, which Excel writes', () => {
    const csv = `${HEADER}\r\nBurgers,برجر,A,أ,d,و,10,100,\r\nBurgers,برجر,B,ب,d,و,20,200,\r\n`;
    expect(parseCSVMenu(csv, []).products.map(p => [p.nameEn, p.price])).toEqual([['A', 10], ['B', 20]]);
  });

  it('refuses text that was not UTF-8, imports nothing, and says how to save it', () => {
    // U+FFFD is what a UTF-8 decoder writes for bytes that were not UTF-8.
    const csv = `${HEADER}\nBurgers,\uFFFD\uFFFD\uFFFD,Spicy,\uFFFD\uFFFD,d,\uFFFD,29.00,710,`;
    const en = parseCSVMenu(csv, []);
    expect(en.products).toEqual([]);
    expect(en.errors).toHaveLength(1);
    expect(en.errors[0]).toMatch(/not saved as UTF-8/);
    expect(en.errors[0]).toContain('"CSV UTF-8 (Comma delimited)"');

    const ar = parseCSVMenu(csv, [], 'ar');
    expect(ar.products).toEqual([]);
    expect(ar.errors).toHaveLength(1);
    expect(ar.errors[0]).toContain('UTF-8');
    expect(ar.errors[0]).toContain('«CSV UTF-8»');
    expect(ar.errors[0]).toMatch(/[\u0600-\u06FF]/);
  });

  it('refuses an Arabic windows-1256 file read the way the console reads a file', () => {
    // What Excel's plain "CSV (Comma delimited)" writes on Arabic Windows. The
    // bytes are built from Node's own windows-1256 table, then decoded the way
    // FileReader.readAsText(file) decodes: UTF-8, invalid bytes to U+FFFD.
    const decode1256 = new TextDecoder('windows-1256');
    const byteOf = new Map<string, number>();
    for (let b = 0; b < 256; b++) byteOf.set(decode1256.decode(Uint8Array.of(b)), b);
    const encode1256 = (s: string) => Uint8Array.from([...s].map((ch) => {
      const b = byteOf.get(ch);
      if (b === undefined) throw new Error(`not in windows-1256: ${ch}`);
      return b;
    }));
    const sheet = `${HEADER}\r\nBurgers,برجر,Spicy Volcano,فولكانو دجاج,Super spicy,دجاج حار جدا,29.00,710,\r\n`;
    const bytes = encode1256(sheet);
    // The fixture is what it claims to be: it round-trips through windows-1256,
    // and it is NOT valid UTF-8.
    expect(decode1256.decode(bytes)).toBe(sheet);
    const asRead = new TextDecoder('utf-8').decode(bytes);
    expect(asRead).toContain('\uFFFD');

    const r = parseCSVMenu(asRead, []);
    expect(r.products).toEqual([]);
    expect(r.errors).toEqual([expect.stringMatching(/not saved as UTF-8/)]);
  });

  it('refuses a sheet whose Arabic became question marks, which a non-Arabic Windows writes', () => {
    // Excel's plain "CSV (Comma delimited)" on a computer whose legacy code page
    // has no Arabic (English Windows, windows-1252) replaces each Arabic letter
    // with "?". That is valid UTF-8, so there is no U+FFFD to find, and the old
    // import wrote "????" names to the live menu. Built here the way Windows
    // converts: every character outside the code page becomes "?".
    const sheet =
      `${HEADER}\r\nBurgers,برجر,Spicy Volcano,فولكانو دجاج,Super spicy,دجاج حار جدا,29.00,710,\r\n` +
      'Sides,المقبلات,Fries,بطاطس,Golden,,12.00,310,\r\n';
    const asSaved = sheet.replace(/[^\x00-\x7F]/g, '?');
    expect(asSaved).toContain('Burgers,????,Spicy Volcano,??????? ????');
    expect(asSaved).not.toContain('\uFFFD');

    const en = parseCSVMenu(asSaved, []);
    expect(en.products).toEqual([]);
    expect(en.errors).toEqual([expect.stringMatching(/^This file is not saved as UTF-8/)]);
    expect(parseCSVMenu(asSaved, [], 'ar').errors).toEqual([expect.stringContaining('«CSV UTF-8»')]);
  });

  it('does not mistake one question mark in a real Arabic sheet for that', () => {
    const csv = `${HEADER}\nBurgers,برجر,Why Not?,Why Not?,d,هل تجرّبه?,10,100,\nBurgers,برجر,B,ب,d,و,20,200,`;
    const r = parseCSVMenu(csv, []);
    expect(r.errors).toEqual([]);
    expect(r.products.map(p => p.nameAr)).toEqual(['Why Not?', 'ب']);
  });

  it('refuses a quote that never closes, and imports nothing', () => {
    const csv = `${HEADER}\nBurgers,برجر,A,أ,d,و,10,100,\nBurgers,برجر,"Wings, 12 pcs,أجنحة,d,و,29.00,450,\nBurgers,برجر,C,ج,d,و,30,300,`;
    const r = parseCSVMenu(csv, []);
    expect(r.products).toEqual([]);
    expect(r.errors).toEqual([expect.stringMatching(/^Row 3 opens a quoted cell that is never closed/)]);
    expect(parseCSVMenu(csv, [], 'ar').errors[0]).toMatch(/^في الصف 3 /);
  });

  it('refuses a row with content past the ninth column — an unquoted comma', () => {
    // Hand-typed, unquoted: every cell after "Wings" moves one column right,
    // so the image URL lands in a tenth column that the template does not have.
    const csv = `${HEADER}\nWings,أجنحة,Wings, 12 pcs,أجنحة دجاج,Hot wings,12 قطعة حارة,29.00,450,http://img`;
    const r = parseCSVMenu(csv, []);
    expect(r.products).toEqual([]);
    expect(r.errors).toEqual([
      'Row 2 has 10 columns, but the template has 9. A comma inside a cell must be inside quotes — saving from Excel as "CSV UTF-8" does this for you.',
    ]);
    expect(parseCSVMenu(csv, [], 'ar').errors[0]).toMatch(/^عدد الأعمدة في الصف 2 هو 10،/);
  });

  it('refuses the same shift when the image column was empty, because the price is not a number', () => {
    // No tenth column this time — the shifted calories fill the empty image
    // column — so the price cell holds the Arabic description. parseFloat read
    // its leading "12" and imported a 12-riyal item; the price check now refuses.
    const csv = `${HEADER}\nWings,أجنحة,Wings, 12 pcs,أجنحة دجاج,Hot wings,12 قطعة حارة,29.00,450,`;
    const r = parseCSVMenu(csv, []);
    expect(r.products).toEqual([]);
    expect(r.errors).toEqual(['Row 2 has an invalid price: "12 قطعة حارة".']);
  });

  it('refuses a price with a thousands separator rather than reading its first digits', () => {
    // A quoted "1,000.00" is one cell now, and parseFloat would have made it 1.
    const csv = `${HEADER}\nPlatters,أطباق,Feast,وليمة,d,و,"1,000.00",3000,`;
    const r = parseCSVMenu(csv, []);
    expect(r.products).toEqual([]);
    expect(r.errors).toEqual(['Row 2 has an invalid price: "1,000.00".']);
  });

  it('accepts a plain price with up to two decimals, and nothing looser', () => {
    const price = (cell: string) => parseCSVMenu(`${HEADER}\nX,س,A,أ,d,و,${cell},1,`, []).products[0]?.price;
    expect(price('29')).toBe(29);
    expect(price('29.5')).toBe(29.5);
    expect(price('29.00')).toBe(29);
    for (const bad of ['29 SAR', '29.005', '.5', '0', '0.00', 'Infinity', '1e3', '0x1A', '-5']) {
      expect(price(bad)).toBeUndefined();
    }
  });

  it('refuses a calories figure with a thousands separator rather than reading it as 1', () => {
    // Excel writes a cell formatted with separators as displayed — "1,200",
    // quoted. parseInt read that as 1, and a 1 200 kcal meal went on the menu
    // the customer reads as 1 kcal.
    const csv = `${HEADER}\nPlatters,أطباق,Feast,وليمة,d,و,99.00,"1,200",`;
    const r = parseCSVMenu(csv, []);
    expect(r.products).toEqual([]);
    expect(r.errors).toEqual([
      'Row 2 has an invalid calories value: "1,200". Write a whole number with no separators, such as 1200, or leave the cell empty.',
    ]);
    expect(parseCSVMenu(csv, [], 'ar').errors).toEqual([
      'قيمة السعرات الحرارية في الصف 2 غير صالحة: "1,200". اكتب رقماً صحيحاً بدون فواصل، مثل 1200، أو اترك الخلية فارغة.',
    ]);
  });

  it('reads calories as a plain whole number, blank as 0, and refuses anything else', () => {
    const calories = (cell: string) => parseCSVMenu(`${HEADER}\nX,س,A,أ,d,و,10,${cell},`, []).products[0]?.calories;
    expect(calories('710')).toBe(710);
    expect(calories('0')).toBe(0);
    expect(calories('')).toBe(0);
    // A seven-column row has no calories cell at all, which also means 0.
    expect(parseCSVMenu(`${HEADER}\nX,س,A,أ,d,و,10`, []).products[0]?.calories).toBe(0);
    // parseInt took the leading digits of each of these, or wrote 0 silently.
    for (const bad of ['1,200', '450 kcal', '450.5', 'abc', '-5', '١٢٠']) {
      expect(calories(`"${bad}"`)).toBeUndefined();
    }
  });

  it('accepts EMPTY cells past the ninth column, which spreadsheets add', () => {
    const csv = `${HEADER}\nBurgers,برجر,A,أ,d,و,10,100,http://img,,,`;
    expect(summary(parseCSVMenu(csv, [])).errors).toEqual([]);
  });

  it('skips a row of empty cells instead of reporting it', () => {
    const csv = `${HEADER}\n,,,,,,,,\nBurgers,برجر,A,أ,d,و,10,100,`;
    const r = parseCSVMenu(csv, []);
    expect(r.errors).toEqual([]);
    expect(r.products).toHaveLength(1);
  });

  it('calls a header with only blank rows under it empty', () => {
    expect(parseCSVMenu(`${HEADER}\n\n,,,\n`, []).errors).toEqual(['The CSV file is empty or missing headers.']);
  });
});

describe('getCSVTemplateData — the file the download link saves', () => {
  const HEADER =
    'category_name_en,category_name_ar,product_name_en,product_name_ar,description_en,description_ar,price_sar,calories,image_url';
  const PREFIX = 'data:text/csv;charset=utf-8,';

  /** The bytes a browser saves for the link: the data URL, percent-decoded. */
  function templateBytes(): Uint8Array {
    const url = getCSVTemplateData();
    expect(url.startsWith(PREFIX)).toBe(true);
    const body = url.slice(PREFIX.length);
    const out: number[] = [];
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '%') {
        out.push(parseInt(body.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        out.push(body.charCodeAt(i));
      }
    }
    return Uint8Array.from(out);
  }

  it('starts with the UTF-8 byte-order mark, so Excel reads the Arabic rows', () => {
    expect(Array.from(templateBytes().slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('keeps the nine-column header byte-for-byte after the mark', () => {
    const afterMark = templateBytes().slice(3);
    expect(new TextDecoder().decode(afterMark).split('\n')[0]).toBe(HEADER);
    expect(Array.from(afterMark.slice(0, 3))).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  it('round-trips: the downloaded template imports as its three sample products', () => {
    // Export, then import the same bytes the way the file picker does —
    // FileReader.readAsText(file) drops the mark and decodes UTF-8.
    const r = parseCSVMenu(new TextDecoder().decode(templateBytes()), []);
    expect(r.errors).toEqual([]);
    expect(r.products.map(p => [p.nameEn, p.nameAr, p.price, p.calories])).toEqual([
      ['Spicy Volcano Chicken', 'فولكانو دجاج مقرمش', 29, 710],
      ['Crispy French Fries', 'بطاطس مقلية مقرمشة', 12, 310],
      ['Ice Cold Orange Juice', 'عصير برتقال مثلج', 10, 120],
    ]);
    expect(r.categories.map(c => [c.nameEn, c.nameAr])).toEqual([
      ['Burgers', 'برجر'], ['Sides', 'المقبلات'], ['Drinks', 'المشروبات'],
    ]);
  });

  it('also imports when the text still carries the mark, as a paste can', () => {
    const withMark = decodeURIComponent(getCSVTemplateData().slice(PREFIX.length));
    expect(withMark.startsWith('\uFEFF')).toBe(true);
    const r = parseCSVMenu(withMark, []);
    expect(r.errors).toEqual([]);
    expect(r.products).toHaveLength(3);
  });
});

describe('the console clock — Riyadh time, Latin digits, any device zone', () => {
  // 2026-11-11T21:30Z is 00:30 on 12 November in Riyadh (UTC+3, no DST).
  const INSTANT = '2026-11-11T21:30:05Z';
  const ZONES = ['Europe/London', 'America/Los_Angeles', 'Asia/Riyadh', 'UTC'];

  it('formats the Riyadh wall clock with seconds, whatever the process zone', () => {
    for (const zone of ZONES) {
      inZone(zone, () => {
        expect(formatRiyadhDateTimeSeconds(INSTANT)).toBe('2026-11-12 00:30:05');
        expect(formatRiyadhTimeSeconds(INSTANT)).toBe('00:30:05');
        // The existing minute-precision sibling agrees with it.
        expect(formatRiyadhDateTime(INSTANT)).toBe('2026-11-12 00:30');
      });
    }
  });

  it('takes an epoch number or a Date as well as a string', () => {
    const ms = Date.parse(INSTANT);
    expect(formatRiyadhDateTimeSeconds(ms)).toBe('2026-11-12 00:30:05');
    expect(formatRiyadhTimeSeconds(new Date(ms))).toBe('00:30:05');
  });

  it('uses a 24-hour clock: midnight is 00, not 24 or 12', () => {
    expect(formatRiyadhDateTimeSeconds('2026-12-31T21:00:00Z')).toBe('2027-01-01 00:00:00');
    expect(formatRiyadhTimeSeconds('2026-06-15T09:00:00Z')).toBe('12:00:00');
  });

  it('renders only ASCII digits and punctuation', () => {
    inZone('Europe/London', () => {
      expect(formatRiyadhDateTimeSeconds(INSTANT)).toMatch(/^[0-9: -]+$/);
    });
  });

  it('renders an em dash for a missing or unparseable instant', () => {
    for (const bad of [null, undefined, '', 'not-a-date']) {
      expect(formatRiyadhDateTimeSeconds(bad)).toBe('—');
      expect(formatRiyadhTimeSeconds(bad)).toBe('—');
    }
  });
});

describe('riyadhDayStartIso', () => {
  it('maps a Riyadh calendar day to the UTC instant it begins at', () => {
    // Riyadh is UTC+3 with no daylight saving, so midnight local is 21:00 the
    // previous day in UTC — the whole reason the reports could not simply
    // compare date strings server-side.
    expect(riyadhDayStartIso('2026-03-10')).toBe('2026-03-09T21:00:00.000Z');
  });

  it('is the exact inverse of riyadhDateOnly at the boundary', () => {
    const startOfDay = riyadhDayStartIso('2026-03-10');
    expect(riyadhDateOnly(startOfDay)).toBe('2026-03-10');
    // One millisecond earlier is still the previous Riyadh day.
    expect(riyadhDateOnly(new Date(Date.parse(startOfDay) - 1).toISOString())).toBe('2026-03-09');
  });

  it('does not shift across the northern summer (Saudi has no DST)', () => {
    expect(riyadhDayStartIso('2026-07-10')).toBe('2026-07-09T21:00:00.000Z');
    expect(riyadhDayStartIso('2026-01-10')).toBe('2026-01-09T21:00:00.000Z');
  });
});

describe('riyadhNextDay', () => {
  it('rolls the month', () => {
    expect(riyadhNextDay('2026-03-31')).toBe('2026-04-01');
  });

  it('rolls the year', () => {
    expect(riyadhNextDay('2026-12-31')).toBe('2027-01-01');
  });

  it('handles February in a leap year', () => {
    expect(riyadhNextDay('2028-02-28')).toBe('2028-02-29');
  });
});

describe('riyadhRangeToUtc', () => {
  it('produces a HALF-OPEN window ending at the start of the day AFTER end', () => {
    expect(riyadhRangeToUtc('2026-03-01', '2026-03-31')).toEqual({
      fromIso: '2026-02-28T21:00:00.000Z',
      toIso: '2026-03-31T21:00:00.000Z',
    });
  });

  it('includes the last instant of the end day and excludes the next one', () => {
    const { fromIso, toIso } = riyadhRangeToUtc('2026-03-10', '2026-03-10');
    // 23:59:59.999 Riyadh on the 10th.
    const lastInstant = new Date(Date.parse(toIso) - 1).toISOString();
    expect(riyadhDateOnly(lastInstant)).toBe('2026-03-10');
    // A single-day range is exactly 24 hours wide.
    expect(Date.parse(toIso) - Date.parse(fromIso)).toBe(24 * 60 * 60 * 1000);
    // And `toIso` itself is already the next day — the order sitting on it
    // belongs to the NEXT range, counted once rather than twice or never.
    expect(riyadhDateOnly(toIso)).toBe('2026-03-11');
  });
});

describe('isCalendarDate — the guard in front of the converters', () => {
  it('rejects the value a CLEARED date input produces', () => {
    // This is the whole reason the guard exists. An `<input type="date">` that
    // the operator clears yields '', and '' silently passes a `end < start`
    // comparison when it is the START that was cleared.
    expect(isCalendarDate('')).toBe(false);
    expect('2026-08-31' < '').toBe(false);   // the comparison that let it through
  });

  it('rejects partial, malformed and impossible dates', () => {
    for (const bad of ['2026', '2026-08', '08-31-2026', '2026-8-1', 'today', '2026-13-01']) {
      expect(isCalendarDate(bad)).toBe(false);
    }
  });

  it('rejects a day the month does not have, which Date silently ROLLS', () => {
    // The trap: `new Date('2026-02-30T00:00:00Z')` does not fail, it returns
    // 2026-03-02. Accepting it would move a report range two days without
    // telling anyone, so the guard round-trips rather than only parsing.
    expect(new Date('2026-02-30T00:00:00Z').toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2027-02-29')).toBe(false);   // not a leap year
  });

  it('accepts a real calendar date', () => {
    expect(isCalendarDate('2026-08-31')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);   // leap day
  });
});

describe('the converters fail with a description, not RangeError', () => {
  // Unguarded, `new Date('T00:00:00+03:00').toISOString()` throws
  // "Invalid time value" — no indication of which input was empty or which
  // helper was called. That is a miserable thing to find in a stack trace.
  it('names the function and shows the offending value', () => {
    expect(() => riyadhDayStartIso('')).toThrow(/riyadhDayStartIso.*received ""/);
    expect(() => riyadhNextDay('')).toThrow(/riyadhNextDay.*received ""/);
    expect(() => riyadhRangeToUtc('', '2026-08-31')).toThrow(/expected a YYYY-MM-DD/);
  });

  it('does not throw RangeError any more', () => {
    expect(() => riyadhDayStartIso('')).not.toThrow(RangeError);
  });
});
