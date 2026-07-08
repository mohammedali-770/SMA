import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { createSessionSignature, formatAmount, geideaApiBase, geideaHppBase } from '../_shared/geidea.ts';

/**
 * payment-initiate — the authenticated customer starts paying for an order they
 * already created (place_order left it payment_status='pending').
 *
 * verify_jwt = true (config.toml): only a signed-in user reaches this. We read
 * the order through the USER's client so RLS proves ownership and hands us the
 * server-trusted total; the Geidea secret + amount signing happen server-side.
 * The client only ever receives the Geidea sessionId + hosted-checkout URL —
 * never the merchant key or API password.
 *
 * Flow: create a Geidea session (server-to-server, Basic auth + HMAC signature),
 * record a payment_records 'initiated' row, and return the session so the app
 * can open the Geidea Hosted Payment Page. The order is marked paid ONLY later,
 * by the verified payment-webhook.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Authentication required' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const orderId = String(body.orderId ?? '');
  if (!orderId) return json({ error: 'orderId is required' }, 400);

  // Read the order AS THE USER — RLS returns it only if they own it, and its
  // `total` is the server-computed amount we must charge (never a client value).
  const supaUser = userClient(authHeader);
  const { data: order, error: orderErr } = await supaUser
    .from('orders')
    .select('id, total, payment_status, order_number')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr) return json({ error: orderErr.message }, 400);
  if (!order) return json({ error: 'Order not found' }, 404);
  if (order.payment_status === 'paid') return json({ status: 'already_paid', orderId }, 200);

  // Provider config + secret (service role — bypasses the table's revoked grants).
  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg || !cfg.enabled) return json({ error: 'Online payment is not enabled' }, 400);
  if ((cfg.providerName ?? '').toLowerCase() !== 'geidea') {
    return json({ error: `Configured payment provider is '${cfg.providerName}', not 'geidea'` }, 400);
  }
  const publicKey = String(cfg.secretConfig.publicKey ?? '');
  const apiPassword = String(cfg.secretConfig.apiPassword ?? '');
  if (!publicKey || !apiPassword) {
    return json({ error: 'Geidea credentials are not set (publicKey / apiPassword)' }, 500);
  }

  const currency = String(cfg.publicConfig.currency ?? 'SAR');
  const amount = formatAmount(Number(order.total));
  const timestamp = new Date().toISOString();
  const merchantReferenceId = String(order.id); // our order id round-trips in the callback
  const signature = await createSessionSignature({
    publicKey, amount, currency, merchantReferenceId, timestamp, apiPassword,
  });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const callbackUrl = `${supabaseUrl}/functions/v1/payment-webhook`;
  const returnUrl = String(cfg.publicConfig.returnUrl ?? '') || callbackUrl;

  let result: Record<string, unknown> = {};
  try {
    const resp = await fetch(`${geideaApiBase(cfg.publicConfig)}/payment-intent/api/v2/direct/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${publicKey}:${apiPassword}`)}`,
      },
      body: JSON.stringify({
        amount: Number(amount),
        currency,
        timestamp,
        merchantReferenceId,
        callbackUrl,
        returnUrl,
        signature,
      }),
    });
    result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Log the upstream detail SERVER-SIDE only; never echo the gateway's raw
      // response body back to the client (it can carry internal error detail).
      console.error('Geidea session creation failed', resp.status, JSON.stringify(result).slice(0, 500));
      return json({ error: 'Geidea session creation failed', status: resp.status }, 502);
    }
  } catch (e) {
    console.error('Geidea request failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'Geidea request failed' }, 502);
  }

  const session = (result.session ?? result) as Record<string, unknown>;
  const sessionId = String(session.id ?? result.sessionId ?? '');
  if (!sessionId) {
    console.error('Geidea returned no session id', JSON.stringify(result).slice(0, 500));
    return json({ error: 'Geidea did not return a session id' }, 502);
  }

  // Audit the initiation (best-effort; the webhook is the source of truth for paid).
  await admin.from('payment_records').insert({
    order_id: order.id,
    provider: 'geidea',
    provider_ref: sessionId,
    status: 'initiated',
    amount: Number(order.total),
    currency,
    raw: result,
  });

  return json({
    sessionId,
    checkoutUrl: `${geideaHppBase(cfg.publicConfig)}/hpp/checkout/?${sessionId}`,
    orderNumber: order.order_number,
  });
});
