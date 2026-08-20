import { describe, expect, it } from 'vitest';

import { availabilityLookup, validateCartForBranch } from './cartValidation';
import type { CartItem, Modifier, Product } from '../../types/models';

function product(id: string, isActive = true): Product {
  return {
    id, categoryId: 'c1', nameEn: id, nameAr: id, descriptionEn: '', descriptionAr: '',
    price: 10, imageUrl: '', calories: 0, isActive, modifierGroupIds: [],
  };
}
function line(id: string, isActive = true): CartItem {
  return { cartItemId: `ci-${id}`, product: product(id, isActive), selectedModifiers: {}, quantity: 1, unitPrice: 10 };
}

// availability matrix: product 'a' available at 'b1' only; 'b' available nowhere.
const isAvailable = (pid: string, bid: string) => pid === 'a' && bid === 'b1';

describe('validateCartForBranch', () => {
  it('all items valid → allValid true, none invalid', () => {
    const r = validateCartForBranch([line('a')], 'b1', isAvailable);
    expect(r.allValid).toBe(true);
    expect(r.invalid).toHaveLength(0);
    expect(r.valid.map((i) => i.product.id)).toEqual(['a']);
  });
  it('unavailable-at-branch item is invalid', () => {
    const r = validateCartForBranch([line('a'), line('b')], 'b1', isAvailable);
    expect(r.allValid).toBe(false);
    expect(r.invalid.map((i) => i.product.id)).toEqual(['b']);
    expect(r.valid.map((i) => i.product.id)).toEqual(['a']);
  });
  it('inactive product is invalid even if the matrix says available', () => {
    const r = validateCartForBranch([line('a', false)], 'b1', isAvailable);
    expect(r.allValid).toBe(false);
    expect(r.invalid.map((i) => i.product.id)).toEqual(['a']);
  });
  it('a different branch can make a previously-valid item invalid', () => {
    const r = validateCartForBranch([line('a')], 'b2', isAvailable);
    expect(r.allValid).toBe(false);
    expect(r.invalid.map((i) => i.product.id)).toEqual(['a']);
  });
  it('no branch → every item invalid; empty cart is trivially valid', () => {
    expect(validateCartForBranch([line('a')], null, isAvailable).allValid).toBe(false);
    expect(validateCartForBranch([], null, isAvailable).allValid).toBe(true);
    expect(validateCartForBranch([], 'b1', isAvailable).allValid).toBe(true);
  });
  it('does not mutate the input array', () => {
    const items = [line('a'), line('b')];
    validateCartForBranch(items, 'b1', isAvailable);
    expect(items).toHaveLength(2);
  });
});

describe('validateCartForBranch — closed OPTIONS', () => {
  const withMods = (id: string, mods: Modifier[]): CartItem => ({
    ...line(id),
    selectedModifiers: { g1: mods },
  });
  const mod = (id: string): Modifier => ({ id, groupId: 'g1', nameEn: id, nameAr: id, price: 0 });
  const openAll = () => true;

  it('a line naming a CLOSED option is invalid even though the product is open', () => {
    const r = validateCartForBranch(
      [withMods('a', [mod('m1')])], 'b1', isAvailable, (mid) => mid !== 'm1');
    expect(r.invalid.map((i) => i.product.id)).toEqual(['a']);
  });

  it('a line whose options are all open stays valid', () => {
    const r = validateCartForBranch([withMods('a', [mod('m1')])], 'b1', isAvailable, openAll);
    expect(r.allValid).toBe(true);
  });

  it('one closed option among several fails the line', () => {
    const r = validateCartForBranch(
      [withMods('a', [mod('m1'), mod('m2')])], 'b1', isAvailable, (mid) => mid !== 'm2');
    expect(r.allValid).toBe(false);
  });

  it('OMITTING the option lookup preserves the old product-only behaviour', () => {
    // The branch-switch screen still calls the three-argument form; adding a
    // fourth parameter must not change what it decides.
    const r = validateCartForBranch([withMods('a', [mod('m1')])], 'b1', isAvailable);
    expect(r.allValid).toBe(true);
  });

  it('a closed option is checked against the TARGET branch, not any branch', () => {
    const r = validateCartForBranch(
      [withMods('a', [mod('m1')])], 'b1', isAvailable, (_mid, bid) => bid !== 'b1');
    expect(r.allValid).toBe(false);
  });
});

describe('availabilityLookup', () => {
  it('treats a missing entry as available, matching the exceptions-only table', () => {
    // Defaulting the other way would tell a customer their whole cart had sold
    // out the first time a product appeared that has no availability row yet.
    const lookup = availabilityLookup({});
    expect(lookup('p1', 'b1')).toBe(true);
  });

  it('treats a missing branch on a known product as available', () => {
    const lookup = availabilityLookup({ p1: { b2: false } });
    expect(lookup('p1', 'b1')).toBe(true);
  });

  it('reports an explicit closure', () => {
    const lookup = availabilityLookup({ p1: { b1: false } });
    expect(lookup('p1', 'b1')).toBe(false);
  });

  it('reports an explicit availability', () => {
    const lookup = availabilityLookup({ p1: { b1: true } });
    expect(lookup('p1', 'b1')).toBe(true);
  });
});
