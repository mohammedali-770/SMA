/**
 * Gate for the Admin-only "Run Moyasar test checkout" control. The test is
 * allowed ONLY when Moyasar is fully configured in TEST mode by an admin (never
 * an accountant), mirroring the server-side fail-closed checks in
 * payment-test-config. Pure + framework-free so it's unit-tested directly.
 *
 * `key_prefix_ok` has no Tap equivalent and is required here on purpose.
 * Moyasar's keys announce their own mode — `sk_test_…` vs `sk_live_…` — so a
 * live key pasted into the test slot is DETECTABLE, and the one thing this
 * control must never do is open a real charge from a screen labelled TEST. If
 * the prefix does not match the slot, the button stays off and the connection
 * test explains why, rather than the mistake surfacing on a customer's
 * statement.
 */
export interface MoyasarAdminTestGateInput {
  provider: string | null;
  enabled: boolean;
  mode: 'test' | 'live';
  test_key_set: boolean;
  key_prefix_ok?: boolean;
  webhook_secret_set?: boolean;
}

export function canRunMoyasarAdminTestCheckout(
  status: MoyasarAdminTestGateInput | null | undefined,
  isAccountant: boolean,
): boolean {
  if (!status || isAccountant) return false;
  return (
    status.provider === 'moyasar' &&
    status.enabled === true &&
    status.mode === 'test' &&        // TEST mode only — never live
    status.test_key_set === true &&
    status.key_prefix_ok === true
  );
}

/**
 * Readiness the ADMIN needs to see, in the order a person actually fixes it.
 * Returns the first blocking reason, or null when the provider is ready to take
 * a live-mode payment. The webhook secret is included because Moyasar's webhook
 * carries no signature — without the token the server cannot authenticate a
 * notification at all and refuses to act on one, so a gateway missing it is not
 * "mostly configured", it is broken in a way that only shows up as orders that
 * never confirm.
 */
export type MoyasarBlockingReason =
  | 'not_moyasar' | 'disabled' | 'no_key' | 'key_prefix' | 'no_webhook_secret';

export function moyasarBlockingReason(
  status: MoyasarAdminTestGateInput & { active_key_set?: boolean } | null | undefined,
): MoyasarBlockingReason | null {
  if (!status || status.provider !== 'moyasar') return 'not_moyasar';
  if (!status.enabled) return 'disabled';
  if (!status.active_key_set) return 'no_key';
  if (status.key_prefix_ok === false) return 'key_prefix';
  if (status.webhook_secret_set === false) return 'no_webhook_secret';
  return null;
}
