import { describe, expect, it } from 'vitest';

import { canEnableOnlinePayment } from './onlinePaymentGate';

const liveMoyasar = { provider_name: 'moyasar', enabled: true, public_config: { mode: 'live' } };

describe('canEnableOnlinePayment', () => {
  it('allows switching online payment on for an enabled Moyasar gateway in live mode', () => {
    expect(canEnableOnlinePayment(liveMoyasar)).toBe(true);
  });

  /**
   * payment-initiate refuses every customer checkout while Moyasar is in TEST
   * mode, so online payment switched on in test mode is offered to customers
   * and then refused at the payment step.
   */
  it('refuses while the gateway is in test mode, or names no mode', () => {
    expect(canEnableOnlinePayment({ ...liveMoyasar, public_config: { mode: 'test' } })).toBe(false);
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
