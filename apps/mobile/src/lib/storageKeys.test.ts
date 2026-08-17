import { describe, expect, it } from 'vitest';

import { CART_STORAGE_KEY, LANGUAGE_STORAGE_KEY, ORDER_CONTEXT_STORAGE_KEY, SUGGESTIONS_STORAGE_KEY } from './storageKeys';

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
  it('suggestions key is stable', () => {
    expect(SUGGESTIONS_STORAGE_KEY).toBe('spicymeal.suggestions');
  });
  it('keys are distinct and namespaced', () => {
    const all = [CART_STORAGE_KEY, LANGUAGE_STORAGE_KEY, ORDER_CONTEXT_STORAGE_KEY, SUGGESTIONS_STORAGE_KEY];
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((k) => k.startsWith('spicymeal.'))).toBe(true);
  });
});
