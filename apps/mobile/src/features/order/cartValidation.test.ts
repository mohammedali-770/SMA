import { describe, expect, it } from 'vitest';

import { validateCartForBranch } from './cartValidation';
import type { CartItem, Product } from '../../types/models';

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
