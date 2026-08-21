import { describe, expect, it } from 'vitest';
import { OPS_STRINGS, opsT } from './opsStrings';

describe('ops console copy', () => {
  it('defines every key in both languages', () => {
    // The failure this guards against is silent: a key added to English only
    // renders English text inside an otherwise Arabic screen, which nobody
    // notices until a cashier does.
    const en = Object.keys(OPS_STRINGS.en).sort();
    const ar = Object.keys(OPS_STRINGS.ar).sort();
    expect(ar).toEqual(en);
  });

  it('has no blank or placeholder copy', () => {
    for (const lang of ['ar', 'en'] as const) {
      for (const [key, value] of Object.entries(OPS_STRINGS[lang])) {
        expect(value.trim(), `${lang}.${key} is blank`).not.toBe('');
        expect(value, `${lang}.${key} looks like a TODO`).not.toMatch(/TODO|FIXME|xxx/i);
      }
    }
  });

  it('actually returns Arabic for Arabic', () => {
    // Guards against a copy-paste that leaves English text in the Arabic table.
    const arabic = /[؀-ۿ]/;
    const untranslated = (['closedNow', 'allItems', 'reopen', 'reason_out_of_stock'] as const)
      .filter((k) => !arabic.test(opsT('ar', k)));
    expect(untranslated).toEqual([]);
  });

  it('reads the requested language', () => {
    expect(opsT('en', 'reopen')).toBe('Reopen');
    expect(opsT('ar', 'reopen')).toBe('إتاحة');
  });
});
