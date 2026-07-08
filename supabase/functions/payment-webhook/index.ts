import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';

/**
 * payment-webhook — called by the PAYMENT GATEWAY (not the app). Verifies the
 * event server-side, then confirms the order via the service-role-only
 * confirm_order_payment RPC. An order is NEVER marked paid without a verified
 * webhook, and the paid amount must match the server-computed order total.
 *
 * verify_jwt = false (see config.toml): the caller is the gateway, authenticated
 * by its signature, not by a Supabase user JWT.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg || !cfg.enabled) {
    return json({ status: 'ignored', reason: 'payment provider not configured' }, 200);
  }

  const rawBody = await req.text();

  // TODO(payment): verify the gateway signature with cfg.secretConfig (e.g. a
  // webhook signing secret) BEFORE trusting the payload; reject on mismatch.
  //   const sig = req.headers.get('x-provider-signature');
  //   if (!verifySignature(sig, rawBody, cfg.secretConfig.webhook_secret)) {
  //     return json({ error: 'invalid signature' }, 401);
  //   }
  //
  // Then, on a verified "payment succeeded" event, confirm the order:
  //   const evt = JSON.parse(rawBody);
  //   const { data, error } = await admin.rpc('confirm_order_payment', {
  //     p_order_id: evt.metadata.order_id,
  //     p_provider: cfg.providerName ?? 'payment',
  //     p_provider_ref: evt.id,          // gateway transaction id (idempotency)
  //     p_amount: evt.amount,            // must equal orders.total server-side
  //     p_raw: evt,
  //   });
  //   if (error) return json({ error: error.message }, 400);
  //   return json({ status: 'paid', order: data });

  // No real provider is integrated yet — do not mark anything paid.
  return json(
    { status: 'not_implemented', message: 'payment webhook verification not implemented' },
    501,
  );
});
