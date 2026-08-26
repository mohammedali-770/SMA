import { describe, expect, it } from 'vitest';

import { canSubmitOrder, computePreviewTotals, lineTotal } from './previewTotals';
import type { CartItem, Modifier, Product } from '../../types/models';

/** Minimal cart line. Only unitPrice/quantity affect the math. */
function line(unitPrice: number, quantity: number, id = 'p1', modifiers: Modifier[] = []): CartItem {
  return {
    cartItemId: modifiers.length ? `${id}::${modifiers.map((m) => m.id).sort().join(',')}` : id,
    product: { id, price: unitPrice } as unknown as Product,
    selectedModifiers: modifiers.length ? { g1: modifiers } : {},
    quantity,
    unitPrice,
  };
}

const base = {
  orderType: 'delivery' as const,
  deliveryFee: 10,
  minDeliveryOrder: 25,
  couponDiscount: 0,
  loyaltyPoints: 0,
  discountPerPoint: 0,
};

describe('lineTotal', () => {
  it('multiplies unit price by quantity', () => {
    expect(lineTotal({ unitPrice: 20, quantity: 4 })).toBe(80);
  });

  it('rounds to 2 decimals so the row and the summary agree', () => {
    expect(lineTotal({ unitPrice: 3.33, quantity: 3 })).toBe(9.99);
    expect(lineTotal({ unitPrice: 0.1, quantity: 3 })).toBe(0.3);
  });
});

describe('computePreviewTotals — quantity changes move every dependent number', () => {
  it('recomputes subtotal, total and item count when quantity increases', () => {
    const at1 = computePreviewTotals({ ...base, items: [line(20, 1)] });
    expect(at1.subtotal).toBe(20);
    expect(at1.itemCount).toBe(1);
    expect(at1.total).toBe(30); // 20 + 10 fee

    const at4 = computePreviewTotals({ ...base, items: [line(20, 4)] });
    expect(at4.subtotal).toBe(80);
    expect(at4.itemCount).toBe(4);
    expect(at4.total).toBe(90);
  });

  it('crosses the delivery minimum in both directions as quantity changes', () => {
    // The screenshot case: 1 x 20.00 SAR is under a 25.00 minimum.
    const below = computePreviewTotals({ ...base, items: [line(20, 1)] });
    expect(below.belowMinimum).toBe(true);
    expect(below.missingForMinimum).toBe(5);

    const above = computePreviewTotals({ ...base, items: [line(20, 2)] });
    expect(above.belowMinimum).toBe(false);
    expect(above.missingForMinimum).toBe(0);

    // ...and decrementing puts it back below.
    const backBelow = computePreviewTotals({ ...base, items: [line(20, 1)] });
    expect(backBelow.belowMinimum).toBe(true);
  });

  it('judges the minimum on goods only, never on the delivery fee', () => {
    // 20 goods + 10 fee = 30 > 25, but the customer has not met the minimum.
    const r = computePreviewTotals({ ...base, items: [line(20, 1)], deliveryFee: 10, minDeliveryOrder: 25 });
    expect(r.belowMinimum).toBe(true);
  });

  it('charges no delivery fee and applies no minimum for pickup', () => {
    const r = computePreviewTotals({ ...base, items: [line(20, 1)], orderType: 'pickup' });
    expect(r.deliveryFee).toBe(0);
    expect(r.belowMinimum).toBe(false);
    expect(r.total).toBe(20);
  });

  it('is empty and blocked when the last line is removed at zero', () => {
    // An EMPTY delivery cart carries NO fee. This used to read subtotal 0,
    // delivery 10, total 10 — a payable amount for nothing. Submission was
    // already blocked by itemCount, so nobody was ever charged; the preview was
    // simply telling the customer they owed something.
    const r = computePreviewTotals({ ...base, items: [] });
    expect(r.subtotal).toBe(0);
    expect(r.itemCount).toBe(0);
    expect(r.deliveryFee).toBe(0);
    expect(r.total).toBe(0);
    expect(r.belowMinimum).toBe(true);
  });

  it('applies the delivery fee again as soon as one item is added back', () => {
    // The fee is suppressed by an EMPTY cart, not removed. Without this,
    // "no fee when empty" could be implemented as "no fee" and still pass.
    const r = computePreviewTotals({ ...base, items: [line(20, 1)] });
    expect(r.itemCount).toBe(1);
    expect(r.deliveryFee).toBe(10);
    expect(r.total).toBe(30);
  });

  it('charges no fee for an empty PICKUP cart either', () => {
    const r = computePreviewTotals({ ...base, items: [], orderType: 'pickup' });
    expect(r.deliveryFee).toBe(0);
    expect(r.total).toBe(0);
  });

  it('sums multiple lines with different modifier sets independently', () => {
    const cheese = { id: 'm-cheese', price: 3 } as unknown as Modifier;
    const items = [line(20, 2, 'p1'), line(23, 1, 'p1', [cheese])];
    const r = computePreviewTotals({ ...base, items });
    expect(r.subtotal).toBe(63); // 40 + 23
    expect(r.itemCount).toBe(3);
    // Distinct cartItemIds: the modifier line is not merged into the plain line.
    expect(items[0].cartItemId).not.toBe(items[1].cartItemId);
  });

  it('keeps modifier-inclusive unit prices in the line total', () => {
    const cheese = { id: 'm-cheese', price: 3 } as unknown as Modifier;
    const withMods = line(23, 3, 'p1', [cheese]);
    expect(lineTotal(withMods)).toBe(69);
    expect(computePreviewTotals({ ...base, items: [withMods] }).subtotal).toBe(69);
  });
});

describe('computePreviewTotals — discounts', () => {
  it('applies a coupon and recomputes the total', () => {
    const r = computePreviewTotals({ ...base, items: [line(20, 4)], couponDiscount: 15 });
    expect(r.couponDiscount).toBe(15);
    expect(r.total).toBe(75); // 80 + 10 - 15
  });

  it('never lets a coupon exceed the goods value', () => {
    const r = computePreviewTotals({ ...base, items: [line(20, 1)], couponDiscount: 999 });
    expect(r.couponDiscount).toBe(20);
    expect(r.total).toBe(10); // the delivery fee still stands
  });

  it('caps loyalty at what remains after the coupon', () => {
    const r = computePreviewTotals({
      ...base, items: [line(20, 1)], couponDiscount: 15, loyaltyPoints: 100, discountPerPoint: 1,
    });
    expect(r.couponDiscount).toBe(15);
    expect(r.loyaltyDiscount).toBe(5); // not 100
    expect(r.total).toBe(10);
  });

  it('never produces a negative total', () => {
    const r = computePreviewTotals({
      ...base, items: [line(5, 1)], deliveryFee: 0, couponDiscount: 999, loyaltyPoints: 999, discountPerPoint: 1,
    });
    expect(r.total).toBe(0);
  });

  it('ignores loyalty entirely when no points are being redeemed', () => {
    const r = computePreviewTotals({ ...base, items: [line(20, 2)], loyaltyPoints: 0, discountPerPoint: 5 });
    expect(r.loyaltyDiscount).toBe(0);
  });
});

describe('computePreviewTotals — comped customers', () => {
  // The owner's decision, 2026-08-26: automatic, zeroes EVERYTHING including
  // the delivery fee, no cap. These mirror the SQL suite's cases 4 and 8.
  it('zeroes the total and reports what the comp was worth', () => {
    const t = computePreviewTotals({ ...base, items: [line(20, 2)], comped: true });
    expect(t.total).toBe(0);
    expect(t.compDiscount).toBe(50);   // 40 goods + 10 delivery
    expect(t.subtotal).toBe(40);       // the real value of the goods is kept
    expect(t.deliveryFee).toBe(10);    // still shown, still comped
  });

  it('leaves a non-comped cart exactly as before', () => {
    const t = computePreviewTotals({ ...base, items: [line(20, 2)] });
    expect(t.total).toBe(50);
    expect(t.compDiscount).toBe(0);
  });

  it('treats an absent flag as not comped', () => {
    const t = computePreviewTotals({ ...base, items: [line(20, 2)], comped: undefined });
    expect(t.total).toBe(50);
    expect(t.compDiscount).toBe(0);
  });

  it('does not comp a pickup delivery fee that was never charged', () => {
    const t = computePreviewTotals({
      ...base, items: [line(20, 2)], orderType: 'pickup', comped: true,
    });
    expect(t.total).toBe(0);
    expect(t.compDiscount).toBe(40);   // no fee to comp on pickup
  });

  it('still reports belowMinimum — a comp does not buy past the branch minimum', () => {
    // The server refuses this too: place_order judges the minimum on subtotal,
    // which a comp does not change.
    const t = computePreviewTotals({ ...base, items: [line(20, 1)], comped: true });
    expect(t.belowMinimum).toBe(true);
    expect(t.missingForMinimum).toBe(5);
    expect(t.total).toBe(0);
  });

  it('reports the comp net of a coupon and loyalty, never more than was owed', () => {
    // The server SKIPS both for a comped customer, so the comp is worth the
    // full amount there. The preview is shown before that resolution, so it
    // must not report a comp larger than the number on screen.
    const t = computePreviewTotals({
      ...base, items: [line(20, 2)], couponDiscount: 10,
      loyaltyPoints: 100, discountPerPoint: 0.1, comped: true,
    });
    expect(t.compDiscount).toBe(30);   // 40 + 10 - 10 coupon - 10 loyalty
    expect(t.total).toBe(0);
  });

  it('never reports a negative comp on an empty cart', () => {
    const t = computePreviewTotals({ ...base, items: [], comped: true });
    expect(t.total).toBe(0);
    expect(t.compDiscount).toBe(0);
  });
});

describe('canSubmitOrder', () => {
  const totals = computePreviewTotals({ ...base, items: [line(20, 2)] }); // 40, above minimum

  const okInput = {
    totals,
    blocked: false,
    placing: false,
    pendingRecalc: false,
    descriptionValid: true,
    requiresDescription: true,
  };

  it('allows submission when everything is settled and valid', () => {
    expect(canSubmitOrder(okInput)).toBe(true);
  });

  it('refuses while a quantity change is still recalculating', () => {
    // Section 3: the server must never be handed a cart the customer has not
    // seen priced.
    expect(canSubmitOrder({ ...okInput, pendingRecalc: true })).toBe(false);
  });

  it('refuses while an order is already being placed', () => {
    expect(canSubmitOrder({ ...okInput, placing: true })).toBe(false);
  });

  it('refuses on an empty cart', () => {
    const empty = computePreviewTotals({ ...base, items: [] });
    expect(canSubmitOrder({ ...okInput, totals: empty })).toBe(false);
  });

  it('refuses below the delivery minimum', () => {
    const below = computePreviewTotals({ ...base, items: [line(20, 1)] });
    expect(canSubmitOrder({ ...okInput, totals: below })).toBe(false);
  });

  it('refuses delivery without a valid location description', () => {
    expect(canSubmitOrder({ ...okInput, descriptionValid: false })).toBe(false);
  });

  it('does not require a description for pickup', () => {
    const pickup = computePreviewTotals({ ...base, items: [line(20, 2)], orderType: 'pickup' });
    expect(canSubmitOrder({
      ...okInput, totals: pickup, requiresDescription: false, descriptionValid: false,
    })).toBe(true);
  });

  it('respects an upstream block reason (closed branch, no payment method)', () => {
    expect(canSubmitOrder({ ...okInput, blocked: true })).toBe(false);
  });
});
