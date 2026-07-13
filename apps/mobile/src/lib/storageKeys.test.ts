import { describe, expect, it } from 'vitest';

import { CART_STORAGE_KEY, LANGUAGE_STORAGE_KEY } from './storageKeys';

describe('storageKeys', () => {
  // These literals are persisted on customers' devices. Changing a value
  // silently discards every cart / language preference already stored in the
  // field — the exact values are therefore pinned.
  it('cart key is stable', () => {
    expect(CART_STORAGE_KEY).toBe('spicymeal.cart');
  });
  it('language key is stable', () => {
    expect(LANGUAGE_STORAGE_KEY).toBe('spicymeal.lang');
  });
  it('keys are distinct and namespaced', () => {
    expect(CART_STORAGE_KEY).not.toBe(LANGUAGE_STORAGE_KEY);
    expect(CART_STORAGE_KEY.startsWith('spicymeal.')).toBe(true);
    expect(LANGUAGE_STORAGE_KEY.startsWith('spicymeal.')).toBe(true);
  });
});
