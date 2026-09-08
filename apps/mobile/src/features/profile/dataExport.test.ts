import { describe, expect, it } from 'vitest';

import {
  exportErrorMessage,
  exportTitle,
  shouldStartExport,
  summarizeExport,
  summaryLine,
} from './dataExport';

describe('shouldStartExport', () => {
  it('ignores a second tap while a request is in flight', () => {
    // Each call reads the whole order history; a double tap would run it twice.
    expect(shouldStartExport('working')).toBe(false);
  });

  it('allows a retry after a failure, and a second export after a success', () => {
    expect(shouldStartExport('idle')).toBe(true);
    expect(shouldStartExport('error')).toBe(true);
    expect(shouldStartExport('shared')).toBe(true);
  });
});

describe('summarizeExport', () => {
  it('counts each collection', () => {
    expect(
      summarizeExport({
        orders: [1, 2, 3],
        saved_addresses: [1],
        loyalty_history: [1, 2],
        notification_devices: [],
      }),
    ).toEqual({ orders: 3, addresses: 1, loyaltyEntries: 2, devices: 0 });
  });

  it('never throws on unexpected input', () => {
    // The boundary between two systems. Losing the customer's export because the
    // summary line could not be computed would be a cosmetic failure with a real
    // cost, so every shape degrades to zero instead.
    for (const bad of [null, undefined, {}, { orders: 'nope' }, 42, 'string']) {
      expect(() => summarizeExport(bad)).not.toThrow();
    }
    expect(summarizeExport(null)).toEqual({
      orders: 0,
      addresses: 0,
      loyaltyEntries: 0,
      devices: 0,
    });
  });
});

describe('summaryLine', () => {
  it('reads as a sentence in both languages', () => {
    const s = { orders: 2, addresses: 1, loyaltyEntries: 5, devices: 1 };
    expect(summaryLine(s, 'en')).toBe('2 orders · 1 addresses · 5 loyalty entries · 1 devices');
    // Arabic carries the same four counts, in Arabic, and is not the English
    // string with the words swapped out.
    const ar = summaryLine(s, 'ar');
    expect(ar).toContain('طلب');
    expect(ar).toContain('عنوان');
    for (const n of ['2', '1', '5']) expect(ar).toContain(n);
    expect(ar).not.toBe(summaryLine(s, 'en'));
  });
});

describe('exportTitle', () => {
  it('uses LOCAL calendar parts, not a UTC-shifted date', () => {
    // Same trap as loyaltyExpiry.ts: a UTC-derived date reads as the previous
    // day west of Greenwich, so two exports on one day could carry two dates.
    const late = new Date(2026, 8, 8, 23, 30); // 8 Sep, local
    expect(exportTitle(late, 'en')).toBe('Spicy Meal data 2026-09-08');
  });

  it('zero-pads so titles sort', () => {
    expect(exportTitle(new Date(2026, 0, 5), 'en')).toBe('Spicy Meal data 2026-01-05');
  });
});

describe('exportErrorMessage', () => {
  it('tells an offline customer to retry, and anyone else to contact support', () => {
    expect(exportErrorMessage(new Error('Network request failed'), 'en')).toMatch(/connection/i);
    expect(exportErrorMessage(new Error('permission denied'), 'en')).toMatch(/contact us/i);
  });

  it('never surfaces the raw error to the customer', () => {
    const leaky = new Error('permission denied for function export_my_data');
    for (const lang of ['en', 'ar'] as const) {
      expect(exportErrorMessage(leaky, lang)).not.toContain('export_my_data');
    }
  });
});
