import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type ProviderType = 'payment' | 'sms' | 'push' | 'lazywait';

export interface ProviderConfig {
  enabled: boolean;
  providerName: string | null;
  publicConfig: Record<string, unknown>;
  secretConfig: Record<string, unknown>; // NEVER return this to a client
}

/**
 * Read an integration's config + secret SERVER-SIDE via the service-role client
 * (which bypasses the table's revoked grants / RLS). The secret_config never
 * leaves the Edge Function. Returns null if the provider row is missing.
 *
 * This is the ONLY sanctioned way to obtain a provider secret; the frontend
 * only ever sees the `has_secret` flag via list_integration_settings().
 */
export async function getProviderConfig(
  admin: SupabaseClient,
  provider: ProviderType,
): Promise<ProviderConfig | null> {
  const { data, error } = await admin
    .from('integration_settings')
    .select('enabled, provider_name, public_config, secret_config')
    .eq('provider_type', provider)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    enabled: Boolean(data.enabled),
    providerName: data.provider_name ?? null,
    publicConfig: (data.public_config ?? {}) as Record<string, unknown>,
    secretConfig: (data.secret_config ?? {}) as Record<string, unknown>,
  };
}
