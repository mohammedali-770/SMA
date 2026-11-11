/**
 * May an administrator switch customer online payment ON?
 *
 * Only while the payment integration is enabled, names Moyasar and is in LIVE
 * mode. payment-initiate refuses every customer checkout while Moyasar is in
 * TEST mode, so a test card can never pay for a real order. Switching online
 * payment on before then would offer customers a method that is refused at the
 * payment step. Sandbox testing happens through the console's admin test
 * checkout instead, which needs no customer-facing switch.
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
  return String(row.public_config?.mode ?? '').toLowerCase() === 'live';
}
