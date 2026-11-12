/**
 * R07#4: checked, selected and busy reach the web export.
 *
 * react-native-web 0.21 ignores `accessibilityState`, so on the web no radio,
 * checkbox, switch or chip reported whether it was on. The helpers are pure and
 * exercised directly; the call sites are pinned at source level across the
 * whole app, with comments stripped so prose cannot satisfy a check.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { selectedButtonState, selectedRadioState } from './a11yState';

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const SRC = resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

const FILES = sourceFiles(SRC).map((path) => ({
  rel: relative(SRC, path).split('\\').join('/'),
  code: strip(readFileSync(path, 'utf8')),
}));
const code = (rel: string) => FILES.find((f) => f.rel === rel)!.code;

/**
 * Left on `accessibilityState` deliberately. The payment-method picker sits on
 * the checkout path most recently changed for payments; converting it is a
 * separate change with its own on-device check (docs/RELEASE_CHECKLIST.md §7).
 */
const NOT_YET_CONVERTED = new Set(['features/checkout/view/PaymentMethodPicker.tsx']);

describe('selectedButtonState', () => {
  it('is aria-selected natively, which folds into the same selected state as before', () => {
    expect(selectedButtonState(true, 'ios')).toEqual({ 'aria-selected': true });
    expect(selectedButtonState(false, 'android')).toEqual({ 'aria-selected': false });
  });

  it('is aria-pressed on the web, because ARIA does not allow aria-selected on a button', () => {
    expect(selectedButtonState(true, 'web')).toEqual({ 'aria-pressed': true });
    expect(selectedButtonState(false, 'web')).toEqual({ 'aria-pressed': false });
  });
});

describe('selectedRadioState', () => {
  it('keeps checked and selected natively', () => {
    expect(selectedRadioState(true, 'ios')).toEqual({ 'aria-checked': true, 'aria-selected': true });
  });

  it('is aria-checked alone on the web', () => {
    expect(selectedRadioState(false, 'web')).toEqual({ 'aria-checked': false });
  });
});

describe('call sites', () => {
  it('no checked, selected or busy state is left on accessibilityState', () => {
    const offenders = FILES.filter(
      (f) =>
        !NOT_YET_CONVERTED.has(f.rel) &&
        /accessibilityState=\{\{[^}]*\b(checked|selected|busy)\s*[:,}]/.test(f.code),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('the product detail radios and checkboxes carry aria-checked', () => {
    const detail = code('features/product/ProductDetailScreen.tsx');
    expect(detail.match(/aria-checked=\{checked\}/g)).toHaveLength(2);
    expect(detail).toMatch(/accessibilityRole="radio"\s+aria-checked=\{checked\}/);
    expect(detail).toMatch(
      /accessibilityRole=\{g\.maxSelection === 1 \? 'radio' : 'checkbox'\} aria-checked=\{checked\}/,
    );
  });

  it('SelectableChip (the order-type segments, category and filter chips) reports selection', () => {
    expect(code('design-system/ui/Chip.tsx')).toMatch(
      /\{\.\.\.selectedButtonState\(selected, Platform\.OS\)\}/,
    );
  });

  it('the chosen pickup branch reports selection', () => {
    expect(code('features/order/OrderTypeSelectScreen.tsx')).toMatch(
      /\{\.\.\.selectedButtonState\(selectedBranch, Platform\.OS\)\}/,
    );
  });

  it('the remaining checked and busy sites use aria-*', () => {
    expect(code('features/checkout/view/SavedAddressList.tsx')).toMatch(
      /selectedRadioState\(active, Platform\.OS\)/,
    );
    expect(code('features/checkout/view/LoyaltyToggle.tsx')).toMatch(/aria-checked=\{on\}/);
    expect(code('features/account/DeleteAccountScreen.tsx')).toMatch(/aria-checked=\{acknowledged\}/);
    expect(code('design-system/ui/Button.tsx')).toMatch(/aria-busy=\{state\.accessibility\.busy\}/);
    expect(code('features/orders/view/Skeletons.tsx')).toMatch(/\baria-busy\b/);
  });

  it('the not-yet-converted list holds only files that still need it', () => {
    for (const rel of NOT_YET_CONVERTED) {
      expect(code(rel)).toMatch(/accessibilityState=\{\{[^}]*\b(checked|selected)\b/);
    }
  });
});
