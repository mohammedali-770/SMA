import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { callbackSignature, formatAmount, timingSafeEqual } from '../_shared/geidea.ts';

/**
 * payment-webhook — called by GEIDEA (not the app) after a payment completes
 * (Paid / Failed / Cancelled — Geidea sends no callback for InProgress).
 *
 * verify_jwt = false (config.toml): the caller is the gateway, authenticated by
 * its HMAC signature — NOT a Supabase user JWT. We recompute the signature from
 * the payload with the API password (server-only secret) and reject on mismatch,
 * so a forged callback can never mark an order paid. Only on a verified
 * status=Paid (+ responseCode 000) do we call the service-role-only
 * confirm_order_payment RPC, which additionally requires the amount to equal the
 * server-computed order total. The RPC is idempotent by (provider, provider_ref).
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg || !cfg.enabled) {
    return json({ status: 'ignored', reason: 'payment provider not configured' }, 200);
  }
  if ((cfg.providerName ?? '').toLowerCase() !== 'geidea') {
    return json({ status: 'ignored', reason: `provider is '${cfg.providerName}', not 'geidea'` }, 200);
  }

  const rawBody = await req.text();
  let evt: Record<string, unknown>;
  try { evt = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  // Geidea nests the transaction under `order` in most callbacks; fall back to
  // the top level so we tolerate both shapes.
  const order = ((evt.order ?? evt) as Record<string, unknown>);
  const publicKey = String(cfg.secretConfig.publicKey ?? '');
  const apiPassword = String(cfg.secretConfig.apiPassword ?? '');
  if (!publicKey || !apiPassword) {
    return json({ error: 'Geidea credentials are not set' }, 500);
  }

  const orderId = String(order.orderId ?? order.id ?? '');
  const merchantReferenceId = String(order.merchantReferenceId ?? '');
  const status = String(order.status ?? '');
  const currency = String(order.currency ?? 'SAR');
  const amountNum = Number(order.amount ?? order.totalAmount ?? 0);
  const timestamp = String(order.timestamp ?? evt.timestamp ?? '');
  const provided = String(evt.signature ?? order.signature ?? '');

  const expected = await callbackSignature({
    publicKey,
    amount: formatAmount(amountNum),
    currency,
    orderId,
    status,
    merchantReferenceId,
    timestamp,
    apiPassword,
  });

  if (!provided || !timingSafeEqual(provided, expected)) {
    // Do not touch the order. Log the rejected attempt for the ops view.
    await admin.from('integration_sync_logs').insert({
      provider: 'geidea',
      order_id: isUuid(merchantReferenceId) ? merchantReferenceId : null,
      direction: 'webhook',
      status: 'failed',
      request: evt,
      error: 'signature mismatch',
    }).then(() => {}, () => {});
    return json({ error: 'invalid signature' }, 401);
  }

  const responseCode = String(evt.responseCode ?? order.responseCode ?? '');
  const isPaid = status.toLowerCase() === 'paid' && responseCode === '000';
  if (!isPaid) {
    // Verified but not a successful payment (failed / cancelled). Acknowledge so
    // Geidea stops retrying; the order stays pending.
    await admin.from('integration_sync_logs').insert({
      provider: 'geidea',
      order_id: isUuid(merchantReferenceId) ? merchantReferenceId : null,
      direction: 'webhook',
      status: 'skipped',
      request: evt,
      error: `payment status: ${status || 'unknown'}`,
    }).then(() => {}, () => {});
    return json({ status: 'acknowledged', paymentStatus: status }, 200);
  }

  // Verified paid → confirm. merchantReferenceId is our order id; the RPC checks
  // the amount matches the server total and is idempotent on (provider, ref).
  const { data, error } = await admin.rpc('confirm_order_payment', {
    p_order_id: merchantReferenceId,
    p_provider: 'geidea',
    p_provider_ref: orderId,
    p_amount: amountNum,
    p_raw: evt,
  });
  if (error) return json({ error: error.message }, 400);
  return json({ status: 'paid', order: data }, 200);
});

/** Cheap UUID shape check so a bad merchantReferenceId doesn't break the log insert. */
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
