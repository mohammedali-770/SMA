import { describe, expect, it } from 'vitest';

import {
  checkoutInputSignature,
  checkoutSessionKey,
  sessionTotalMatchesShown,
  type CheckoutKeyInput,
} from './checkoutSessionKey';

const BASE: CheckoutKeyInput = {
  branchId: 'b0000000-0000-0000-0000-000000000001',
  orderType: 'pickup',
  items: [{ product_id: 'a0000000-0000-0000-0000-000000000001', quantity: 2, modifier_ids: [] }],
  addressId: null,
  couponCode: null,
  notes: null,
  loyaltyPoints: 0,
};
const CART = '3f1c0e7a-2b9d-4c55-8e21-6a7b9d0c1e42';

describe('checkoutSessionKey', () => {
  it('is UUID-shaped, so begin_checkout_session accepts it as a uuid', () => {
    expect(checkoutSessionKey(CART, BASE)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is the same for the same cart and inputs, so a retry finds its session', () => {
    expect(checkoutSessionKey(CART, BASE)).toBe(
      checkoutSessionKey(CART, { ...BASE, items: [...BASE.items] }),
    );
  });

  // Every input begin_checkout_session receives moves the key (F-X02-001).
  it.each([
    ['order type', { orderType: 'delivery', addressId: 'addr-1' }],
    ['branch', { branchId: 'b0000000-0000-0000-0000-000000000002' }],
    ['address', { addressId: 'addr-2' }],
    ['coupon', { couponCode: 'SEEDFIX10' }],
    ['points', { loyaltyPoints: 300 }],
    ['notes', { notes: 'no onions' }],
    ['item quantity', { items: [{ ...BASE.items[0], quantity: 3 }] }],
    ['item modifier', { items: [{ ...BASE.items[0], modifier_ids: ['m1'] }] }],
  ] as const)('changes when the %s changes', (_label, change) => {
    expect(checkoutSessionKey(CART, { ...BASE, ...change } as CheckoutKeyInput)).not.toBe(
      checkoutSessionKey(CART, BASE),
    );
  });

  it('changes with the cart key, so a new cart never meets an old cart session', () => {
    expect(checkoutSessionKey('another-cart-key', BASE)).not.toBe(checkoutSessionKey(CART, BASE));
  });

  it('reads absent and null the same, as the server receives them', () => {
    const bare: CheckoutKeyInput = { branchId: BASE.branchId, orderType: BASE.orderType, items: BASE.items };
    expect(checkoutSessionKey(CART, bare)).toBe(checkoutSessionKey(CART, BASE));
    expect(checkoutInputSignature({ ...BASE, loyaltyPoints: -5 })).toBe(checkoutInputSignature(BASE));
  });

  it('gives distinct keys across many nearby inputs', () => {
    const seen = new Set<string>();
    for (let q = 1; q <= 50; q++) {
      for (const orderType of ['pickup', 'delivery']) {
        seen.add(
          checkoutSessionKey(CART, { ...BASE, orderType, items: [{ ...BASE.items[0], quantity: q }] }),
        );
      }
    }
    expect(seen.size).toBe(100);
  });
});

describe('sessionTotalMatchesShown', () => {
  it('opens payment only when the server total equals the shown total to the halala', () => {
    expect(sessionTotalMatchesShown(64, 64)).toBe(true);
    expect(sessionTotalMatchesShown('64.00', 64)).toBe(true);
    expect(sessionTotalMatchesShown('69.00', 69.0)).toBe(true);
    expect(sessionTotalMatchesShown(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('refuses the audit case: a pickup session at 64.00 behind a delivery screen at 69.00', () => {
    expect(sessionTotalMatchesShown('64.00', 69)).toBe(false);
    expect(sessionTotalMatchesShown(64.01, 64)).toBe(false);
  });

  it('refuses when either total is unknown', () => {
    expect(sessionTotalMatchesShown(null, 64)).toBe(false);
    expect(sessionTotalMatchesShown(undefined, 64)).toBe(false);
    expect(sessionTotalMatchesShown('', 64)).toBe(false);
    expect(sessionTotalMatchesShown('abc', 64)).toBe(false);
    expect(sessionTotalMatchesShown(64, null)).toBe(false);
    expect(sessionTotalMatchesShown(64, Number.NaN)).toBe(false);
  });
});
