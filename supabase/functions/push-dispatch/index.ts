import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';

/**
 * push-dispatch — PLACEHOLDER. Push notification send is NOT implemented (no
 * provider chosen). Structure only; the push provider secret is read
 * server-side and never returned. Typically invoked server-side on order-status
 * changes. verify_jwt = false.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'push');
  if (!cfg || !cfg.enabled) {
    return json({ status: 'ignored', reason: 'push provider not configured' }, 200);
  }

  // TODO(push): send via the provider (Expo Push / OneSignal) using
  //             cfg.secretConfig.api_key (server-side only); look up device
  //             tokens from a future device_tokens table scoped by RLS.
  return json({ status: 'not_implemented', message: 'push-dispatch not implemented yet' }, 501);
});
