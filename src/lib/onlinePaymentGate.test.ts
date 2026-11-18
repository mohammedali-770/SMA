import { describe, expect, it } from 'vitest';

import { canEnableOnlinePayment } from './onlinePaymentGate';

const liveMoyasar = { provider_name: 'moyasar', enabled: true, public_config: { mode: 'live' } };

describe('canEnableOnlinePayment', () => {
  it('allows switching online payment on for an enabled Moyasar gateway in live mode', () => {
    expect(canEnableOnlinePayment(liveMoyasar)).toBe(true);
  });

  /**
   * Since 2026-11-18 TEST mode may also be switched on: whether a TEST-mode
   * checkout is allowed is decided on the server by PAYMENT_ALLOW_TEST_CHECKOUT.
   * A row that names no mode, or an unknown one, is still refused.
   */
  it('allows test mode, and refuses a row that names no mode or an unknown one', () => {
    expect(canEnableOnlinePayment({ ...liveMoyasar, public_config: { mode: 'test' } })).toBe(true);
    expect(canEnableOnlinePayment({ ...liveMoyasar, public_config: { mode: 'TEST' } })).toBe(true);
    expect(canEnableOnlinePayment({ ...liveMoyasar, public_config: {} })).toBe(false);
    expect(canEnableOnlinePayment({ ...liveMoyasar, public_config: { mode: 'production' } })).toBe(false);
  });

  it('refuses while the gateway is disabled', () => {
    expect(canEnableOnlinePayment({ ...liveMoyasar, enabled: false })).toBe(false);
  });

  it('refuses for any provider other than Moyasar', () => {
    expect(canEnableOnlinePayment({ ...liveMoyasar, provider_name: 'tap' })).toBe(false);
    expect(canEnableOnlinePayment({ ...liveMoyasar, provider_name: null })).toBe(false);
  });

  it('refuses when the payment row has not been read', () => {
    expect(canEnableOnlinePayment(undefined)).toBe(false);
    expect(canEnableOnlinePayment(null)).toBe(false);
  });

  /** The server lowercases both before comparing, so the console does too. */
  it('reads the provider and the mode the way the server does', () => {
    expect(canEnableOnlinePayment({ ...liveMoyasar, provider_name: 'Moyasar' })).toBe(true);
    expect(canEnableOnlinePayment({ ...liveMoyasar, public_config: { mode: 'LIVE' } })).toBe(true);
  });
});
