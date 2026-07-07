import { corsHeaders, json } from '../_shared/cors.ts';

/**
 * lazywait-create-order — PLACEHOLDER ONLY.
 *
 * Do NOT implement until the official Lazywait "Create Order" API is documented
 * (endpoint, auth, payload, idempotency, error model). This stub exists so the
 * function, routing and deployment slot are ready ahead of time. When docs are
 * available, the implementation will: load Lazywait creds via _shared/secrets,
 * map a local order -> Lazywait payload, POST it, then call record_order_sync to
 * persist lazywait_order_id + sync_status and log the attempt.
 */
Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return json(
    {
      status: 'not_implemented',
      message: 'Lazywait Create Order is not implemented — awaiting official API documentation.',
    },
    501,
  );
});
