// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useApp } from './AppContext';

// The brand-theming effect calls CSS.supports, which jsdom may not implement.
beforeAll(() => {
  const g = globalThis as any;
  if (typeof g.CSS === 'undefined') g.CSS = { supports: () => true };
  else if (typeof g.CSS.supports !== 'function') g.CSS.supports = () => true;
});

// Each test starts from a clean persisted store so seed data (and order
// numbering) is deterministic.
beforeEach(() => {
  localStorage.clear();
});

function renderApp() {
  return renderHook(() => useApp(), { wrapper: AppProvider });
}

// Stage a placeable pickup cart (pickup avoids the delivery-address/min-order
// checks) with one unit of the first active product at the first active branch.
function setupPickupCart(result: { current: ReturnType<typeof useApp> }) {
  const branch = result.current.branches.find(b => b.isActive) || result.current.branches[0];
  const product = result.current.products.find(p => p.isActive) || result.current.products[0];
  act(() => { result.current.setCheckoutType('pickup'); });
  act(() => { result.current.setSelectedBranch(branch); });
  act(() => { result.current.addToCart(product, {}, 1); });
  return { branch, product };
}

describe('placeOrder', () => {
  it('places a pickup order, marks it paid via the enabled gateway, and appends it', () => {
    const { result } = renderApp();
    const { product } = setupPickupCart(result);
    const before = result.current.orders.length;

    let ret: any;
    act(() => { ret = result.current.placeOrder(); });

    expect(ret.success).toBe(true);
    expect(ret.order.orderType).toBe('pickup');
    expect(ret.order.deliveryFee).toBe(0);
    expect(ret.order.total).toBe(product.price); // no delivery/discount/loyalty
    // Payment gateway on by default (Moyasar, test mode) => paid.
    expect(ret.order.paymentStatus).toBe('paid');
    expect(ret.order.paymentMethod).toBe('Moyasar (Test)');
    // Appended to the front of the orders table.
    expect(result.current.orders.length).toBe(before + 1);
    expect(result.current.orders[0].id).toBe(ret.orderId);
  });

  it('rejects an empty cart', () => {
    const { result } = renderApp();
    let ret: any;
    act(() => { ret = result.current.placeOrder(); });
    expect(ret.success).toBe(false);
    expect(ret.error).toMatch(/cart is empty/i);
  });

  it('rejects checkout with no branch selected', () => {
    const { result } = renderApp();
    act(() => { result.current.setCheckoutType('pickup'); });
    act(() => { result.current.addToCart(result.current.products[0], {}, 1); });
    act(() => { result.current.setSelectedBranch(null); });
    let ret: any;
    act(() => { ret = result.current.placeOrder(); });
    expect(ret.success).toBe(false);
    expect(ret.error).toMatch(/no branch/i);
  });

  it('continues the order-number sequence from the highest existing order', () => {
    // Seed orders end at SM-2026-000414, so the next two are 415 then 416 —
    // proving it uses the max sequence, not orders.length.
    const { result } = renderApp();

    setupPickupCart(result);
    let ret1: any;
    act(() => { ret1 = result.current.placeOrder(); });
    expect(ret1.order.orderNumber).toBe('SM-2026-000415');

    setupPickupCart(result); // cart was cleared by the first order
    let ret2: any;
    act(() => { ret2 = result.current.placeOrder(); });
    expect(ret2.order.orderNumber).toBe('SM-2026-000416');
  });

  it('caps the loyalty redemption to points actually held and never goes negative', () => {
    const { result } = renderApp();
    // Grant the customer 150 points, then try to redeem far more than that.
    act(() => { result.current.updateCustomerPoints('usr-customer-1', 150); });
    act(() => { result.current.setLoyaltyPointsRedeemed(9999); });
    setupPickupCart(result);

    let ret: any;
    act(() => { ret = result.current.placeOrder(); });

    // Discount is 150 * 0.10 = 15 (capped), NOT 9999 * 0.10.
    expect(ret.order.loyaltyDiscountAmount).toBe(15);
    // Exactly the capped 150 points were spent, then points earned on the
    // final total are added back — so the balance equals floor(total) and is
    // never negative.
    const after = result.current.currentUser.loyaltyPoints ?? 0;
    expect(after).toBe(Math.floor(ret.order.total));
    expect(after).toBeGreaterThanOrEqual(0);
  });

  it('falls back to Cash on Delivery when the payment gateway is disabled', () => {
    const { result } = renderApp();
    act(() => { result.current.updatePaymentSettings({ isEnabled: false }); });
    setupPickupCart(result);
    let ret: any;
    act(() => { ret = result.current.placeOrder(); });
    expect(ret.success).toBe(true);
    expect(ret.order.paymentStatus).toBe('pending');
    expect(ret.order.paymentMethod).toBe('Cash on Delivery');
  });

  it('revalidates the cart and refuses an order for a deactivated product', () => {
    const { result } = renderApp();
    const product = result.current.products.find(p => p.isActive)!;
    act(() => { result.current.setCheckoutType('pickup'); });
    act(() => { result.current.setSelectedBranch(result.current.branches.find(b => b.isActive)!); });
    act(() => { result.current.addToCart(product, {}, 1); });
    // The admin deactivates the product while it sits in the cart.
    act(() => { result.current.updateProduct({ ...product, isActive: false }); });

    let ret: any;
    act(() => { ret = result.current.placeOrder(); });
    expect(ret.success).toBe(false);
    expect(ret.error).toMatch(/no longer on the menu/i);
  });

  it('notifies the customer via in-app push (primary channel) and not SMS', () => {
    const { result } = renderApp();
    setupPickupCart(result);
    act(() => { result.current.placeOrder(); });

    const ev = result.current.integrationEvents;
    expect(ev.length).toBe(1);
    expect(ev[0].channel).toBe('push');
    expect(ev.some(e => e.channel === 'sms')).toBe(false);
  });

  it('falls back to SMS for notifications only when push is disabled', () => {
    const { result } = renderApp();
    act(() => { result.current.updateNotificationSettings({ isEnabled: false }); });
    setupPickupCart(result);
    act(() => { result.current.placeOrder(); });

    const ev = result.current.integrationEvents;
    expect(ev.length).toBe(1);
    expect(ev[0].channel).toBe('sms');
  });
});
