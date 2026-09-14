import { describe, it, expect } from 'vitest';
import {
  availableMethods, checkoutBlocked, clearIfUnavailable,
  paymentDisplayState, paymentMethodLabel, type PaymentMethodSettings,
} from './payment';

const S = (o: Partial<PaymentMethodSettings>): PaymentMethodSettings => ({
  onlineEnabled: false, cashEnabled: false, defaultMethod: null, outageMode: false, ...o,
});

describe('checkout payment availability', () => {
  it('online only → only online is offered', () => {
    const s = S({ onlineEnabled: true, cashEnabled: false });
    expect(availableMethods(s)).toEqual(['online']);
    expect(checkoutBlocked(s)).toBe(false);
  });

  it('cash only → only cash is offered', () => {
    const s = S({ onlineEnabled: false, cashEnabled: true });
    expect(availableMethods(s)).toEqual(['cash']);
    expect(checkoutBlocked(s)).toBe(false);
  });

  it('both enabled → both are offered, online first', () => {
    const s = S({ onlineEnabled: true, cashEnabled: true });
    expect(availableMethods(s)).toEqual(['online', 'cash']);
    expect(checkoutBlocked(s)).toBe(false);
  });

  it('both disabled → checkout blocked', () => {
    const s = S({ onlineEnabled: false, cashEnabled: false });
    expect(availableMethods(s)).toEqual([]);
    expect(checkoutBlocked(s)).toBe(true);
  });
});

describe('clearIfUnavailable — the only automatic movement, and it only removes', () => {
  it('keeps a choice that is still offered', () => {
    const s = S({ onlineEnabled: true, cashEnabled: true });
    expect(clearIfUnavailable(s, 'cash')).toBe('cash');
    expect(clearIfUnavailable(s, 'online')).toBe('online');
  });

  it('drops a choice whose method was switched off', () => {
    const s = S({ onlineEnabled: false, cashEnabled: true });
    expect(clearIfUnavailable(s, 'online')).toBeNull();
  });

  it('NEVER invents a method for a customer who has chosen nothing', () => {
    // The regression this file exists to catch. Checkout used to preselect the
    // admin default, so a customer could place a cash order without ever
    // stating they would pay cash. Both shapes that used to produce a method
    // out of nothing are asserted here: a configured default, and a single
    // enabled method.
    expect(clearIfUnavailable(S({ cashEnabled: true, defaultMethod: 'cash' }), null)).toBeNull();
    expect(clearIfUnavailable(S({ onlineEnabled: true, cashEnabled: true, defaultMethod: 'online' }), null)).toBeNull();
    expect(clearIfUnavailable(S({ cashEnabled: true }), null)).toBeNull();
  });

  it('does not substitute the other method when the chosen one goes away', () => {
    // The subtler half: cash is enabled, so a fallback would have looked
    // reasonable. Sliding the customer from online onto cash is exactly the
    // silent decision this rule forbids.
    const s = S({ onlineEnabled: false, cashEnabled: true, defaultMethod: 'cash' });
    expect(clearIfUnavailable(s, 'online')).toBeNull();
  });

  it('drops everything when nothing is enabled', () => {
    const s = S({ onlineEnabled: false, cashEnabled: false });
    expect(clearIfUnavailable(s, 'cash')).toBeNull();
    expect(clearIfUnavailable(s, null)).toBeNull();
  });
});

describe('paymentDisplayState (derived, no fake "paid")', () => {
  it('paid → paid', () => {
    expect(paymentDisplayState({ paymentStatus: 'paid', paymentMethod: 'online' })).toBe('paid');
    expect(paymentDisplayState({ paymentStatus: 'paid', paymentMethod: 'cash' })).toBe('paid');
  });
  it('online + pending → pending_online', () => {
    expect(paymentDisplayState({ paymentStatus: 'pending', paymentMethod: 'online' })).toBe('pending_online');
  });
  it('cash + pending → cash_required', () => {
    expect(paymentDisplayState({ paymentStatus: 'pending', paymentMethod: 'cash' })).toBe('cash_required');
  });
  it('no method + pending → unpaid (never assumed cash)', () => {
    expect(paymentDisplayState({ paymentStatus: 'pending', paymentMethod: null })).toBe('unpaid');
    expect(paymentDisplayState({ paymentStatus: 'pending' })).toBe('unpaid');
  });
});

describe('paymentMethodLabel (Cash on Pickup vs Delivery, never blanket COD)', () => {
  it('online → online', () => {
    expect(paymentMethodLabel('online', 'pickup')).toBe('online');
  });
  it('cash + pickup → cash_pickup', () => {
    expect(paymentMethodLabel('cash', 'pickup')).toBe('cash_pickup');
  });
  it('cash + delivery → cash_delivery', () => {
    expect(paymentMethodLabel('cash', 'delivery')).toBe('cash_delivery');
  });
  it('no method → none (no COD fallback)', () => {
    expect(paymentMethodLabel(null, 'pickup')).toBe('none');
    expect(paymentMethodLabel(undefined, 'delivery')).toBe('none');
  });
});
