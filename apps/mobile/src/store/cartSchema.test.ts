/**
 * Cart tier selection and persisted-schema handling.
 *
 * Both behaviours here were P1 review findings on the variants PR, and both are
 * about money or about a customer being unable to order at all — so they are
 * pinned directly rather than left to the component tests.
 */
import { describe, it, expect } from 'vitest';
import { CART_SCHEMA_VERSION, cheapestVariant, parsePersistedCart } from './CartProvider';
import type { CartItem, ProductVariant } from '../types/models';

const variant = (id: string, price: number): ProductVariant => ({
  id, productId: 'P_CORAL', nameEn: id, nameAr: id, price, calories: null,
});

describe('cheapestVariant — the assumed tier must match the advertised price', () => {
  it('picks the cheapest tier, NOT the first row', () => {
    // Lazywait returns variants in `sort_order`. For Coral the first row is the
    // 29.00 tier while the card advertises `products.price` = 20.00, so taking
    // variants[0] charged 9.00 more than the customer was shown.
    const sourceOrdered = [variant('Large', 29), variant('Small', 20), variant('Mid', 24)];
    expect(cheapestVariant(sourceOrdered)?.price).toBe(20);
    expect(cheapestVariant(sourceOrdered)?.id).toBe('Small');
    // Explicitly: the first row is NOT what we return.
    expect(cheapestVariant(sourceOrdered)?.id).not.toBe(sourceOrdered[0].id);
  });

  it('is stable when the cheapest is already first, and on ties keeps the first', () => {
    expect(cheapestVariant([variant('A', 10), variant('B', 30)])?.id).toBe('A');
    expect(cheapestVariant([variant('A', 10), variant('B', 10)])?.id).toBe('A');
  });

  it('returns null for an untiered product, so the line carries no variant_id', () => {
    expect(cheapestVariant([])).toBeNull();
  });

  it('handles a single tier', () => {
    expect(cheapestVariant([variant('Only', 7)])?.id).toBe('Only');
  });
});

describe('parsePersistedCart — a cart that cannot be ordered is never hydrated', () => {
  const row: CartItem = {
    cartItemId: 'c1',
    product: { id: 'P1' } as CartItem['product'],
    selectedModifiers: {},
    quantity: 1,
    unitPrice: 20,
  } as CartItem;

  it('reads a payload written by THIS version', () => {
    const raw = JSON.stringify({ v: CART_SCHEMA_VERSION, items: [row] });
    expect(parsePersistedCart(raw)).toHaveLength(1);
  });

  it('DROPS a v1 bare array — its rows predate tiers and would block checkout', () => {
    // v1 rows carry no `variant`, so toOrderItems omits variant_id and
    // place_order refuses any product that has active tiers but no chosen tier.
    // The customer could not check out and nothing on screen would say why.
    expect(parsePersistedCart(JSON.stringify([row]))).toEqual([]);
  });

  it('drops an unknown or missing version rather than guessing', () => {
    expect(parsePersistedCart(JSON.stringify({ v: 1, items: [row] }))).toEqual([]);
    expect(parsePersistedCart(JSON.stringify({ v: 99, items: [row] }))).toEqual([]);
    expect(parsePersistedCart(JSON.stringify({ items: [row] }))).toEqual([]);
  });

  it('never throws on anything a device could hold', () => {
    for (const raw of ['', 'not json', '{', 'null', '3', '"str"', '{"v":2}', '{"v":2,"items":{}}']) {
      expect(parsePersistedCart(raw)).toEqual([]);
    }
  });

  it('keeps the version in the PAYLOAD — storageKeys.ts forbids changing a key', async () => {
    const { CART_STORAGE_KEY } = await import('../lib/storageKeys');
    expect(CART_STORAGE_KEY).toBe('spicymeal.cart');
    expect(CART_SCHEMA_VERSION).toBe(2);
  });
});
