/**
 * The console's absolute times are Riyadh time with Latin digits.
 *
 * Audit trails and hover times were `toLocaleString()` in the DEVICE zone with
 * no label, so an owner abroad read 21:30 for an event at 00:30 Riyadh, while
 * the reports and receipts beside them were in Riyadh time. In Arabic, `ar-SA`
 * also gave Arabic-Indic digits and a 12-hour clock next to Latin-digit prices
 * (assessment, 2026-11-11, measured in Chromium).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { exactTime } from './adminTime';

/** Run `fn` with the process in `zone`; Node re-reads TZ when it is assigned. */
function inZone(zone: string, fn: () => void): void {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

// 00:30 on 12 November 2026 in Riyadh (UTC+3, no daylight saving).
const INSTANT = '2026-11-11T21:30:00Z';

describe('exactTime', () => {
  it('gives the Riyadh time in Latin digits to an Arabic console in London', () => {
    inZone('Europe/London', () => {
      const shown = exactTime(INSTANT, 'ar');
      expect(shown).toContain('00:30');
      expect(shown).toMatch(/^[0-9: -]+$/);
      expect(shown).toBe('2026-11-12 00:30:00');
    });
  });

  it('reads the same in both languages and in every device zone', () => {
    for (const zone of ['Europe/London', 'America/Los_Angeles', 'Asia/Riyadh', 'UTC']) {
      inZone(zone, () => {
        expect(exactTime(INSTANT, 'en')).toBe('2026-11-12 00:30:00');
        expect(exactTime(INSTANT, 'ar')).toBe('2026-11-12 00:30:00');
      });
    }
  });

  it('renders an em dash for a missing or unparseable time', () => {
    expect(exactTime(null, 'ar')).toBe('—');
    expect(exactTime(undefined, 'en')).toBe('—');
    expect(exactTime('nonsense', 'en')).toBe('—');
  });
});

describe('no console screen formats a time in the device locale or zone', () => {
  // A source guard, because every one of the sites fixed on 2026-11-12 was a
  // one-line `new Date(x).toLocaleString()` that rendered fine in review. The
  // helpers live in `src/utils/calculations.ts`; console code calls them.
  const ROOTS = [
    fileURLToPath(new URL('../', import.meta.url)),
    fileURLToPath(new URL('../../ops/', import.meta.url)),
  ];

  // A NUMBER, not a time: the customers' loyalty-points total. Its digits do
  // follow the browser locale, which is the same digits question in another
  // place; it was not part of the timestamp change.
  const ALLOWED = [
    /SettingsPanel\.tsx: .*\.reduce\(\(sum, p\) => sum \+ \(p\.loyaltyPoints \|\| 0\), 0\)\.toLocaleString\(\)/,
  ];

  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  const withoutComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('finds no toLocale*String or Intl.DateTimeFormat call outside the helpers', () => {
    const files = ROOTS.flatMap(sources);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap((file) =>
      withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .filter((line) => /\.toLocale(?:Date|Time)?String\(|Intl\.DateTimeFormat\(/.test(line))
        .map((line) => `${file.split('/').pop()}: ${line.trim()}`)
        .filter((hit) => !ALLOWED.some((ok) => ok.test(hit))),
    );
    expect(offenders).toEqual([]);
  });
});
