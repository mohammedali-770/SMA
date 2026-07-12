/**
 * Gate for the Admin-only "Run Tap test checkout" control. The test is allowed
 * ONLY when Tap is fully configured in TEST mode by an admin (never accountant),
 * mirroring the server-side fail-closed checks in payment-test-config. Pure +
 * framework-free so it's unit-tested directly.
 */
export interface AdminTestGateInput {
  provider: string | null;
  enabled: boolean;
  mode: 'test' | 'live';
  merchant_id_set: boolean;
  test_key_set: boolean;
}

export function canRunAdminTestCheckout(
  status: AdminTestGateInput | null | undefined,
  isAccountant: boolean,
): boolean {
  if (!status || isAccountant) return false;
  return (
    status.provider === 'tap' &&
    status.enabled === true &&
    status.mode === 'test' &&        // TEST mode only — never live
    status.merchant_id_set === true &&
    status.test_key_set === true
  );
}
