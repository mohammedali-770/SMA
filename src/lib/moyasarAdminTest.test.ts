import { describe, it, expect } from 'vitest';
import { canRunMoyasarAdminTestCheckout, isMoyasarShapedStatus, moyasarBlockingReason } from './moyasarAdminTest';

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
   * A live key sitting in the test slot is the mistake that charges a real card
   * from a screen labelled TEST, and Moyasar's key prefixes make it detectable —
   * so the button stays off rather than finding out from a customer's statement.
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

/**
 * A status from a payment-test-config that predates Moyasar.
 *
 * Production still runs the 2026-07-12 bundle, written before any Moyasar code
 * existed. Its status carries no `webhook_secret_set` and no `key_prefix_ok`,
 * and it fills the key booleans from the other gateway's key names. Read as
 * Moyasar readiness, a leftover key of that gateway made the panel report a
 * Moyasar key as present and, with nothing else to object, nothing blocking.
 */
const july = {
  provider: 'moyasar',
  enabled: true,
  mode: 'test' as const,
  test_key_set: true,
  active_key_set: true,
};

describe('isMoyasarShapedStatus', () => {
  it('accepts a status that reports the Moyasar readiness fields', () => {
    expect(isMoyasarShapedStatus(ready)).toBe(true);
    expect(isMoyasarShapedStatus({ ...ready, webhook_secret_set: false, key_prefix_ok: false })).toBe(true);
  });

  it('rejects a status missing either Moyasar field', () => {
    expect(isMoyasarShapedStatus(july)).toBe(false);
    expect(isMoyasarShapedStatus({ ...ready, webhook_secret_set: undefined })).toBe(false);
    expect(isMoyasarShapedStatus({ ...ready, key_prefix_ok: undefined })).toBe(false);
    expect(isMoyasarShapedStatus(null)).toBe(false);
  });
});

describe('moyasarBlockingReason — the server that answers', () => {
  it('never reports a server that predates Moyasar as ready', () => {
    expect(moyasarBlockingReason(july)).toBe('server_predates_moyasar');
  });

  it('still asks for the provider first, because that reading is plain in both versions', () => {
    expect(moyasarBlockingReason({ ...july, provider: 'tap' })).toBe('not_moyasar');
  });

  /**
   * The server's verdict comes from resolveMoyasarConfig, the resolver every
   * payment function uses. Following it means a check the server adds later
   * shows up here without the console re-deriving it.
   */
  it("follows the server's verdict when it gives one", () => {
    const verdict = (config_ok: boolean, config_reason: string | null) =>
      moyasarBlockingReason({ ...ready, config_ok, config_reason });
    expect(verdict(true, null)).toBeNull();
    expect(verdict(false, 'disabled')).toBe('disabled');
    expect(verdict(false, 'not_moyasar')).toBe('not_moyasar');
    expect(verdict(false, 'missing_key')).toBe('no_key');
    expect(verdict(false, 'key_mode_mismatch')).toBe('key_prefix');
    expect(verdict(false, 'missing_webhook_secret')).toBe('no_webhook_secret');
  });

  it('reports a reason it does not know rather than calling the gateway ready', () => {
    expect(moyasarBlockingReason({ ...ready, config_ok: false, config_reason: 'something_new' })).toBe(
      'server_not_ready',
    );
    expect(moyasarBlockingReason({ ...ready, config_ok: false, config_reason: null })).toBe('server_not_ready');
    expect(moyasarBlockingReason({ ...ready, config_ok: false, config_reason: 'toString' })).toBe('server_not_ready');
  });
});
