import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { verifyWebhookSignature } from '../_shared/lazywait.ts';
import { syncLogOutcome } from '../_shared/syncLog.ts';

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
 *
 * TWO FAILURE MODES WERE FIXED HERE ON 2026-09-02, both of the same kind — a
 * result that was never looked at.
 *
 * 1. An unconfigured webhook secret returned 200 `{status:'ignored'}`. A 200 is
 *    an acknowledgement: it tells Lazywait the delivery succeeded, so it never
 *    retries, and a misconfiguration silently discards real POS events forever.
 *    It now returns 503, which is what `whatsapp-webhook` already did for the
 *    identical condition — two functions, one rule.
 * 2. The `orders` update was fired with `.then(() => {}, () => {})`, discarding
 *    its result, and the log row that followed hardcoded `status: 'success'`.
 *    A dropped status change left behind a row asserting it had landed. The
 *    outcome now comes from `syncLogOutcome`, and a failed log insert is at
 *    least printed rather than swallowed in silence.
 *
 * What deliberately did NOT change: an unmatched `order_ref` is still a 200, and
 * an authenticated request is still never failed back to the POS after the
 * signature check. Lazywait retrying a callback we simply have no local order for
 * would achieve nothing.
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
    // Can't verify without the secret — do not trust the payload, and do NOT
    // acknowledge it either. 503 keeps the event in Lazywait's retry queue so a
    // fixed configuration recovers it; the old 200 threw it away.
    return json({ error: 'webhook not configured' }, 503);
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
  let writeError: { message?: string | null; code?: string | null } | null = null;
  if (orderRef) {
    const { data: local, error: lookupError } = await admin
      .from('orders').select('id').eq('lazywait_ref', orderRef).maybeSingle();
    localOrderId = (local as { id?: string } | null)?.id ?? null;
    // A lookup that ERRORED is not the same as a ref we do not recognise: the
    // first leaves us unable to say whether the order exists, the second is a
    // normal outcome. Only the first is a failure worth recording.
    if (lookupError) writeError = lookupError;
    if (localOrderId && posStatus) {
      const { error: updateError } = await admin
        .from('orders').update({ lazywait_status: posStatus, updated_at: new Date().toISOString() })
        .eq('id', localOrderId);
      if (updateError) writeError = updateError;
    }
  }

  // Log safely — store only the event + refs/status, never the full customer payload.
  const outcome = syncLogOutcome(writeError);
  const { error: logError } = await admin.from('integration_sync_logs').insert({
    provider: 'lazywait',
    order_id: localOrderId,
    direction: 'webhook',
    status: outcome.status,
    request: { event, order_ref: orderRef, pos_status: posStatus, matched_local: !!localOrderId },
    error: outcome.error,
  });
  // The log is best-effort — losing it must not fail an authenticated callback —
  // but "best-effort" is not "unobservable". If this insert is failing, every
  // row in the table is a survivor of a filter nobody can see.
  if (logError) {
    console.error('lazywait-webhook: integration_sync_logs insert failed', syncLogOutcome(logError).error);
  }

  // Known events get status handling above; unknown events are accepted safely.
  return json({ status: 'accepted', event, matched: !!localOrderId }, 200);
});
