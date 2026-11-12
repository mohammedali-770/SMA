import { describe, expect, it } from 'vitest';

import { availableMethods, checkoutBlocked, clearIfUnavailable, type PaymentMethodSettings } from './payment';

const both: PaymentMethodSettings = {
  onlineEnabled: true,
  cashEnabled: true,
  defaultMethod: null,
  outageMode: false,
};
const onlineOnly: PaymentMethodSettings = { ...both, cashEnabled: false };
const cashOnly: PaymentMethodSettings = { ...both, onlineEnabled: false };
const none: PaymentMethodSettings = { ...both, onlineEnabled: false, cashEnabled: false };

describe('online payment is offered only in the native app', () => {
  it.each(['ios', 'android'])('%s offers online, then cash', (platform) => {
    expect(availableMethods(both, platform)).toEqual(['online', 'cash']);
  });

  it('the web build offers cash only, even with online switched on', () => {
    // online_payment_enabled is one global flag; the payment WebView cannot run
    // in a browser, so /app must not offer what it cannot complete.
    expect(availableMethods(both, 'web')).toEqual(['cash']);
    expect(availableMethods(onlineOnly, 'web')).toEqual([]);
  });

  it('the web build is blocked when online is the only method switched on', () => {
    expect(checkoutBlocked(onlineOnly, 'web')).toBe(true);
    expect(checkoutBlocked(onlineOnly, 'ios')).toBe(false);
  });

  it('an online choice is dropped on web and kept in the app', () => {
    expect(clearIfUnavailable(both, 'online', 'web')).toBeNull();
    expect(clearIfUnavailable(both, 'online', 'android')).toBe('online');
    expect(clearIfUnavailable(both, 'cash', 'web')).toBe('cash');
  });
});

describe('availability follows the admin settings', () => {
  it('offers only what is switched on, online before cash', () => {
    expect(availableMethods(cashOnly, 'ios')).toEqual(['cash']);
    expect(availableMethods(onlineOnly, 'ios')).toEqual(['online']);
  });

  it('blocks checkout when nothing is switched on', () => {
    expect(checkoutBlocked(none, 'ios')).toBe(true);
    expect(checkoutBlocked(cashOnly, 'web')).toBe(false);
  });

  it('can only take a choice away, never make one', () => {
    expect(clearIfUnavailable(cashOnly, 'online', 'ios')).toBeNull();
    expect(clearIfUnavailable(both, null, 'ios')).toBeNull();
    expect(clearIfUnavailable(cashOnly, 'cash', 'ios')).toBe('cash');
  });
});
