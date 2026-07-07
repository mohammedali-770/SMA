import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';

/**
 * lazywait-sync — server-side Lazywait sync worker (invoked by a schedule/cron
 * or queue, NOT by the app). Reads Lazywait credentials server-side and records
 * every attempt via the service-role-only record_order_sync RPC, which updates
 * orders.sync_status / lazywait_* and appends an integration_sync_logs row.
 *
 * verify_jwt = false (see config.toml): server/scheduled caller.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'lazywait');
  if (!cfg || !cfg.enabled) {
    return json({ status: 'ignored', reason: 'lazywait not configured' }, 200);
  }

  // Safe (public) config: cfg.publicConfig.base_url, cfg.publicConfig.client_id.
  // Secret stays server-side: cfg.secretConfig.api_key.
  //
  // TODO(lazywait): pull the sync queue (orders where sync_status in
  // ('not_synced','failed') — indexed by orders_sync_queue_idx), call the
  // DOCUMENTED Lazywait read/sync endpoints, and for each order:
  //   await admin.rpc('record_order_sync', {
  //     p_order_id: order.id,
  //     p_sync_status: 'synced',            // or 'failed'
  //     p_lazywait_order_id: resp.id,
  //     p_lazywait_ref: resp.ref,
  //     p_direction: 'push',
  //     p_status: 'success',                // or 'failed'
  //     p_request: reqPayload, p_response: resp, p_error: null,
  //   });
  //
  // TODO(lazywait): Create Order is NOT implemented — see lazywait-create-order.
  return json({ status: 'not_implemented', message: 'lazywait sync not implemented yet' }, 501);
});
