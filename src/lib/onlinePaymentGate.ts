/**
 * May an administrator switch customer online payment ON?
 *
 * Only while the payment integration is enabled, names Moyasar and is in LIVE
 * or TEST mode. Changed 2026-11-18 for the testing phase: TEST mode is allowed
 * too, because customer checkout in TEST mode is now decided on the server by
 * the PAYMENT_ALLOW_TEST_CHECKOUT Edge Function secret (docs/PAYMENTS.md §3).
 * With that secret unset, payment-initiate still refuses a TEST-mode checkout,
 * so a test card still cannot pay for an order; the customer sees the method
 * unavailable at the payment step.
 *
 * Switching online payment OFF is always allowed and is not decided here.
 *
 * THIS GATES THE CONSOLE CONTROL, NOT THE SETTING. The settings RPC does not
 * consult it, so a direct call can still turn online payment on; what keeps a
 * customer from paying in test mode is payment-initiate's refusal.
 *
 * Provider and mode are compared exactly as resolveMoyasarConfig compares them
 * (supabase/functions/_shared/moyasar.ts): lowercased, not trimmed. Pure +
 * framework-free so it's unit-tested directly.
 */
export interface PaymentIntegrationRow {
  provider_name: string | null;
  enabled: boolean;
  public_config: Record<string, unknown>;
}

export function canEnableOnlinePayment(row: PaymentIntegrationRow | null | undefined): boolean {
  if (!row || row.enabled !== true) return false;
  if ((row.provider_name ?? '').toLowerCase() !== 'moyasar') return false;
  const mode = String(row.public_config?.mode ?? '').toLowerCase();
  return mode === 'live' || mode === 'test';
}
