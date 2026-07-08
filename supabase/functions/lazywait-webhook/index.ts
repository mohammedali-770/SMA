import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { verifyWebhookSignature } from '../_shared/lazywait.ts';

/**
 * lazywait-webhook — inbound receiver for Lazywait POS callbacks.
 *
 * Auth = HMAC-SHA256 (hex) of the body with the webhook secret, sent in
 * X-LazyWait-Signature; the event name is in X-LazyWait-Event. A forged callback
 * (bad signature) is rejected 401 and never touches an order. For UNKNOWN events
 * we still verify the signature, log safely, and return 200 (never throw).
 *
 * We update only `lazywait_status` (the POS status string) on the mapped order —
 * we do NOT auto-flip the customer-facing local order status (that stays
 * admin/workflow driven). Supabase remains the source of truth.
 *
 * verify_jwt = false (config.toml): the caller is Lazywait, authenticated by the
 * signature, not a Supabase user JWT.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'lazywait');
  const secret = cfg ? String((cfg.secretConfig as Record<string, unknown>).webhook_secret ?? '') : '';
  const rawBody = await req.text();
  const signature = req.headers.get('x-lazywait-signature');
  const event = req.headers.get('x-lazywait-event') ?? 'unknown';

  if (!secret) {
    // Can't verify without the secret — do not trust the payload.
    return json({ status: 'ignored', reason: 'webhook secret not configured' }, 200);
  }

  // Verify against the raw body AND the re-serialized JSON (proxy whitespace).
  const candidates = [rawBody];
  try { candidates.push(JSON.stringify(JSON.parse(rawBody))); } catch { /* not JSON */ }
  const valid = await verifyWebhookSignature(candidates, signature, secret);
  if (!valid) return json({ error: 'invalid signature' }, 401);

  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { payload = {}; }
  const order = ((payload.order ?? payload) as Record<string, unknown>);
  const orderRef = order.order_ref != null ? String(order.order_ref) : null;
  const posStatus = order.order_status_id != null ? String(order.order_status_id) : null;

  // Map back to the local order (only if we recognize the ref) and record the
  // POS status. Never fail the webhook if the order isn't found locally.
  let localOrderId: string | null = null;
  if (orderRef) {
    const { data: local } = await admin
      .from('orders').select('id').eq('lazywait_ref', orderRef).maybeSingle();
    localOrderId = (local as { id?: string } | null)?.id ?? null;
    if (localOrderId && posStatus) {
      await admin.from('orders').update({ lazywait_status: posStatus, updated_at: new Date().toISOString() })
        .eq('id', localOrderId).then(() => {}, () => {});
    }
  }

  // Log safely — store only the event + refs/status, never the full customer payload.
  await admin.from('integration_sync_logs').insert({
    provider: 'lazywait',
    order_id: localOrderId,
    direction: 'webhook',
    status: 'success',
    request: { event, order_ref: orderRef, pos_status: posStatus, matched_local: !!localOrderId },
    error: null,
  }).then(() => {}, () => {});

  // Known events get status handling above; unknown events are accepted safely.
  return json({ status: 'accepted', event, matched: !!localOrderId }, 200);
});
