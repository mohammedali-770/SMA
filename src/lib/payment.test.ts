import { describe, it, expect } from 'vitest';
import {
  availableMethods, checkoutBlocked, resolveDefaultMethod, onlineUnavailableCashOn,
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
    expect(resolveDefaultMethod(s)).toBe('online');
  });

  it('cash only → only cash is offered, online-unavailable notice shows', () => {
    const s = S({ onlineEnabled: false, cashEnabled: true });
    expect(availableMethods(s)).toEqual(['cash']);
    expect(resolveDefaultMethod(s)).toBe('cash');
    expect(onlineUnavailableCashOn(s)).toBe(true);
  });

  it('both enabled → customer can choose; default respected', () => {
    const s = S({ onlineEnabled: true, cashEnabled: true, defaultMethod: 'cash' });
    expect(availableMethods(s)).toEqual(['online', 'cash']);
    expect(checkoutBlocked(s)).toBe(false);
    expect(resolveDefaultMethod(s)).toBe('cash');
    expect(onlineUnavailableCashOn(s)).toBe(false);
  });

  it('both disabled → checkout blocked, no default', () => {
    const s = S({ onlineEnabled: false, cashEnabled: false });
    expect(availableMethods(s)).toEqual([]);
    expect(checkoutBlocked(s)).toBe(true);
    expect(resolveDefaultMethod(s)).toBeNull();
  });

  it('default falls back to the only enabled method when the configured default is disabled', () => {
    const s = S({ onlineEnabled: false, cashEnabled: true, defaultMethod: 'online' });
    expect(resolveDefaultMethod(s)).toBe('cash');
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
