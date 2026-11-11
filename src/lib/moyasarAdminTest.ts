/**
 * Gate for the Admin-only "Run Moyasar test checkout" control. The test is
 * allowed ONLY when Moyasar is fully configured in TEST mode by an admin (never
 * an accountant), mirroring the server-side fail-closed checks in
 * payment-test-config. Pure + framework-free so it's unit-tested directly.
 *
 * `key_prefix_ok` is required here on purpose. Moyasar's keys announce their
 * own mode — `sk_test_…` vs `sk_live_…` — so a live key pasted into the test
 * slot is DETECTABLE, and the one thing this control must never do is open a
 * real charge from a screen labelled TEST. If the prefix does not match the
 * slot, the button stays off and the connection test explains why, rather than
 * the mistake surfacing on a customer's statement.
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
 * Does this status come from a payment-test-config that knows Moyasar?
 *
 * The console deploys on merge and the payment functions do not, so the panel
 * can be talking to a bundle deployed before any Moyasar code existed (the one
 * in Production on 2026-11-11 dates from 2026-07-12). That status has no
 * `webhook_secret_set` and no `key_prefix_ok`, and it fills `test_key_set`,
 * `live_key_set` and `active_key_set` from another gateway's key names. Read as
 * Moyasar readiness, it reports a key as present that Moyasar will never use.
 * A Moyasar-aware status always carries both fields as booleans, so their
 * absence is the signal.
 */
export function isMoyasarShapedStatus(status: MoyasarAdminTestGateInput | null | undefined): boolean {
  return (
    !!status && typeof status.webhook_secret_set === 'boolean' && typeof status.key_prefix_ok === 'boolean'
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
 *
 * The stored provider comes first because it reads the same from any server.
 * After that, a server that predates Moyasar is reported as such and never as
 * ready. Otherwise the server's own verdict (`config_ok` / `config_reason`, from
 * the resolver every payment function uses) decides, so a check the server adds
 * later shows up here as `server_not_ready` instead of being re-derived, or
 * missed, by the console.
 */
export type MoyasarBlockingReason =
  | 'not_moyasar' | 'server_predates_moyasar' | 'disabled' | 'no_key' | 'key_prefix'
  | 'no_webhook_secret' | 'server_not_ready';

/** resolveMoyasarConfig's reasons (supabase/functions/_shared/moyasar.ts). */
const SERVER_REASONS = new Map<string, MoyasarBlockingReason>([
  ['disabled', 'disabled'],
  ['not_moyasar', 'not_moyasar'],
  ['missing_key', 'no_key'],
  ['key_mode_mismatch', 'key_prefix'],
  ['missing_webhook_secret', 'no_webhook_secret'],
]);

export function moyasarBlockingReason(
  status: MoyasarAdminTestGateInput & {
    active_key_set?: boolean;
    config_ok?: boolean;
    config_reason?: string | null;
  } | null | undefined,
): MoyasarBlockingReason | null {
  if (!status || status.provider !== 'moyasar') return 'not_moyasar';
  if (!isMoyasarShapedStatus(status)) return 'server_predates_moyasar';
  if (typeof status.config_ok === 'boolean') {
    if (status.config_ok) return null;
    return SERVER_REASONS.get(status.config_reason ?? '') ?? 'server_not_ready';
  }
  if (!status.enabled) return 'disabled';
  if (!status.active_key_set) return 'no_key';
  if (status.key_prefix_ok === false) return 'key_prefix';
  if (status.webhook_secret_set === false) return 'no_webhook_secret';
  return null;
}
