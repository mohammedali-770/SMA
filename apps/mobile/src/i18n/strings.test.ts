/**
 * The bilingual contract for `STRINGS`.
 *
 * `t()` falls back to `STRINGS.en[key]` when the Arabic table is missing a key,
 * which means a forgotten translation renders ENGLISH inside an Arabic, RTL
 * screen rather than failing anywhere a developer would notice. These cases make
 * that a test failure instead.
 */
import { describe, expect, it } from 'vitest';

import { STRINGS, type StringKey } from './strings';

const EN_KEYS = Object.keys(STRINGS.en) as StringKey[];
const AR_KEYS = Object.keys(STRINGS.ar) as StringKey[];

/**
 * Keys whose Arabic value is legitimately identical to the English one: proper
 * nouns and the language switcher's own labels, which must each be shown in the
 * language they name.
 */
const SAME_IN_BOTH = new Set<string>(['english', 'arabic']);

describe('STRINGS', () => {
  it('has the same keys in both languages', () => {
    expect([...AR_KEYS].sort()).toEqual([...EN_KEYS].sort());
  });

  it('has no empty value in either language', () => {
    for (const key of EN_KEYS) {
      expect(STRINGS.en[key], `en.${key}`).toBeTruthy();
      expect(STRINGS.ar[key], `ar.${key}`).toBeTruthy();
    }
  });

  it('never leaves the English string as the Arabic translation', () => {
    const untranslated = EN_KEYS.filter(
      (key) => !SAME_IN_BOTH.has(key) && STRINGS.ar[key] === STRINGS.en[key],
    );
    expect(untranslated).toEqual([]);
  });

  it('every Arabic value actually contains Arabic script', () => {
    const arabic = /[؀-ۿ]/;
    const missing = EN_KEYS.filter((key) => !SAME_IN_BOTH.has(key) && !arabic.test(STRINGS.ar[key]));
    expect(missing).toEqual([]);
  });
});

describe('profile address management copy', () => {
  // The screen chrome for the feature added with the address book. Field labels
  // and validation messages live beside their validators, not here.
  const ADDRESS_KEYS = [
    'addrTitle', 'addrManage', 'addrManageHint', 'addrAdd', 'addrEditTitle', 'addrNewTitle',
    'addrEmptyTitle', 'addrEmptySub', 'addrDefault', 'addrSetDefault', 'addrEdit', 'addrDelete',
    'addrDeleteTitle', 'addrDeleteBody', 'addrSave', 'addrSaved', 'addrDeleted', 'addrUnnamed',
    'addrLoading', 'addrSetAsDefault', 'addrContextReset', 'addrRetry', 'addrNotFound',
    'addrNotFoundSub',
  ] as const;

  it('exists in both languages', () => {
    for (const key of ADDRESS_KEYS) {
      expect(STRINGS.en[key], `en.${key}`).toBeTruthy();
      expect(STRINGS.ar[key], `ar.${key}`).toBeTruthy();
    }
  });

  it('no longer tells customers to add an address in the web app', () => {
    // Profile owns addresses now; the old copy sent customers somewhere the
    // mobile app cannot take them.
    expect(STRINGS.en.noSavedAddress).not.toMatch(/web app/i);
    expect(STRINGS.ar.noSavedAddress).not.toMatch(/الويب/);
  });
});

describe('the below-minimum online payment message (gap PG-05)', () => {
  // Moyasar will not invoice under 1.00 SAR, and points can leave 0.01 to 0.99.
  // Points are all or nothing: LoyaltyToggle is on or off, and CheckoutScreen
  // sends the whole balance. So "use fewer points" asked the customer for
  // something the app cannot do. Their real choices are these two.
  it('no longer tells the customer to use fewer points', () => {
    expect(STRINGS.en.payBelowMinimum).not.toMatch(/fewer/i);
    expect(STRINGS.ar.payBelowMinimum).not.toMatch(/نقاطاً أقل/);
  });

  it('says to turn points off for this order, or pay in cash, in both languages', () => {
    expect(STRINGS.en.payBelowMinimum).toMatch(/turn off points for this order/i);
    expect(STRINGS.en.payBelowMinimum).toMatch(/pay in cash/i);
    // «استبدال» is the switch's own word (`useLoyalty`), so the customer can
    // find the control the sentence names.
    expect(STRINGS.ar.payBelowMinimum).toContain('أوقف استبدال النقاط في هذا الطلب');
    expect(STRINGS.ar.useLoyalty).toContain('استبدال');
    expect(STRINGS.ar.payBelowMinimum).toContain('ادفع نقداً');
  });

  it('still states the minimum it is about', () => {
    expect(STRINGS.en.payBelowMinimum).toContain('1.00 SAR');
    expect(STRINGS.ar.payBelowMinimum).toContain('1.00 ريال');
  });
});
