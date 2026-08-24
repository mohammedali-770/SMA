import { describe, it, expect } from 'vitest';
import { canRunMoyasarAdminTestCheckout, moyasarBlockingReason } from './moyasarAdminTest';

const ready = {
  provider: 'moyasar',
  enabled: true,
  mode: 'test' as const,
  test_key_set: true,
  key_prefix_ok: true,
  webhook_secret_set: true,
  active_key_set: true,
};

describe('canRunMoyasarAdminTestCheckout', () => {
  it('allows the sandbox checkout only when everything is ready', () => {
    expect(canRunMoyasarAdminTestCheckout(ready, false)).toBe(true);
  });

  /** LIVE means real cards. The control refuses outright, never with a prompt. */
  it('refuses in live mode', () => {
    expect(canRunMoyasarAdminTestCheckout({ ...ready, mode: 'live' }, false)).toBe(false);
  });

  it('refuses for an accountant', () => {
    expect(canRunMoyasarAdminTestCheckout(ready, true)).toBe(false);
  });

  it('refuses when the provider is not Moyasar, or is disabled, or has no key', () => {
    expect(canRunMoyasarAdminTestCheckout({ ...ready, provider: 'tap' }, false)).toBe(false);
    expect(canRunMoyasarAdminTestCheckout({ ...ready, enabled: false }, false)).toBe(false);
    expect(canRunMoyasarAdminTestCheckout({ ...ready, test_key_set: false }, false)).toBe(false);
  });

  /**
   * The check with no Tap equivalent. A live key sitting in the test slot is the
   * mistake that charges a real card from a screen labelled TEST, and Moyasar's
   * key prefixes make it detectable — so the button stays off rather than
   * finding out from a customer's statement.
   */
  it('refuses when the stored key does not carry the prefix for its slot', () => {
    expect(canRunMoyasarAdminTestCheckout({ ...ready, key_prefix_ok: false }, false)).toBe(false);
    expect(canRunMoyasarAdminTestCheckout({ ...ready, key_prefix_ok: undefined }, false)).toBe(false);
  });

  it('refuses a missing status', () => {
    expect(canRunMoyasarAdminTestCheckout(null, false)).toBe(false);
    expect(canRunMoyasarAdminTestCheckout(undefined, false)).toBe(false);
  });
});

describe('moyasarBlockingReason', () => {
  it('reports nothing blocking when the gateway is ready', () => {
    expect(moyasarBlockingReason(ready)).toBeNull();
  });

  it('reports reasons in the order a person actually fixes them', () => {
    expect(moyasarBlockingReason(null)).toBe('not_moyasar');
    expect(moyasarBlockingReason({ ...ready, provider: 'tap' })).toBe('not_moyasar');
    expect(moyasarBlockingReason({ ...ready, enabled: false })).toBe('disabled');
    expect(moyasarBlockingReason({ ...ready, active_key_set: false })).toBe('no_key');
    expect(moyasarBlockingReason({ ...ready, key_prefix_ok: false })).toBe('key_prefix');
    expect(moyasarBlockingReason({ ...ready, webhook_secret_set: false })).toBe('no_webhook_secret');
  });

  /**
   * A gateway with no webhook secret is not "mostly configured": Moyasar's
   * webhook carries no signature, so without the token the server cannot
   * authenticate a notification and refuses to act on one. That shows up as
   * orders paid at Moyasar that never confirm here, so it is a blocking reason
   * rather than a warning.
   */
  it('treats a missing webhook secret as blocking, not cosmetic', () => {
    expect(moyasarBlockingReason({ ...ready, webhook_secret_set: false })).toBe('no_webhook_secret');
  });
});
