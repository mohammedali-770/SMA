import { describe, it, expect } from 'vitest';
import { canRunAdminTestCheckout, AdminTestGateInput } from './tapAdminTest';

const ready: AdminTestGateInput = {
  provider: 'tap', enabled: true, mode: 'test', merchant_id_set: true, test_key_set: true,
};

describe('canRunAdminTestCheckout', () => {
  it('allows an admin when Tap is fully configured in TEST mode', () => {
    expect(canRunAdminTestCheckout(ready, false)).toBe(true);
  });
  it('never allows an accountant', () => {
    expect(canRunAdminTestCheckout(ready, true)).toBe(false);
  });
  it('fails closed when not tap / disabled / live / missing merchant / missing key', () => {
    expect(canRunAdminTestCheckout({ ...ready, provider: 'sandbox' }, false)).toBe(false);
    expect(canRunAdminTestCheckout({ ...ready, enabled: false }, false)).toBe(false);
    expect(canRunAdminTestCheckout({ ...ready, mode: 'live' }, false)).toBe(false); // TEST only
    expect(canRunAdminTestCheckout({ ...ready, merchant_id_set: false }, false)).toBe(false);
    expect(canRunAdminTestCheckout({ ...ready, test_key_set: false }, false)).toBe(false);
  });
  it('fails closed with no status', () => {
    expect(canRunAdminTestCheckout(null, false)).toBe(false);
    expect(canRunAdminTestCheckout(undefined, false)).toBe(false);
  });
});
