import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { resolveTapConfig, mapTapStatus } from '../_shared/tap.ts';
import { retrieveTapCharge, validateAndConfirmTapCharge, type TapAttempt } from '../_shared/tapVerify.ts';

/**
 * payment-verify — the app calls this after returning from Tap checkout. It is
 * the ONLY thing the app trusts: it retrieves the charge from Tap server-to-server
 * and confirms the order paid only on a clean CAPTURED. The redirect params the
 * app saw are never trusted. verify_jwt = true and the order is read via the
 * user's RLS, so a customer can only ever verify their OWN order.
 *
 * The secret key is chosen by the STORED attempt's mode (not the current Admin
 * mode), so flipping Admin test↔live never breaks verification of older attempts.
 * Idempotent: repeated calls converge on a single confirmation.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Authentication required' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const orderId = String(body.orderId ?? body.order_id ?? '');
  if (!orderId) return json({ error: 'orderId is required' }, 400);

  // Ownership + server-trusted state via RLS.
  const supaUser = userClient(authHeader);
  const { data: order, error: orderErr } = await supaUser
    .from('orders').select('id, payment_status, order_number').eq('id', orderId).maybeSingle();
  if (orderErr) return json({ error: orderErr.message }, 400);
  if (!order) return json({ error: 'Order not found' }, 404);
  if (order.payment_status === 'paid') return json({ status: 'paid', orderNumber: order.order_number }, 200);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg || (cfg.providerName ?? '').toLowerCase() !== 'tap') {
    return json({ status: 'pending' }, 200);
  }

  const { data: recs } = await admin.from('payment_records')
    .select('id, order_id, provider_ref, reference_transaction, reference_order, amount, mode, status')
    .eq('order_id', orderId).eq('provider', 'tap')
    .order('created_at', { ascending: false }).limit(1);
  const rec = (Array.isArray(recs) ? recs[0] : null) as TapAttempt | null;
  if (!rec || !rec.provider_ref) return json({ status: 'pending' }, 200);

  // Verify with the key for the ATTEMPT's mode (not current admin mode).
  const tap = resolveTapConfig(cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig, (rec.mode as 'test' | 'live') ?? undefined);
  if (!tap.secretKey) return json({ status: 'pending' }, 200);

  const retrieved = await retrieveTapCharge(tap.secretKey, String(rec.provider_ref));
  if (!retrieved.ok) return json({ status: 'pending' }, 200); // transient — let the app retry

  const result = await validateAndConfirmTapCharge(admin, rec, retrieved.charge, tap.merchantId);
  const outcome = result.paid ? 'paid' : (result.outcome === 'mismatch' ? 'failed' : result.outcome);
  const { messageKey } = mapTapStatus(retrieved.charge.status);
  return json({ status: outcome, messageKey, orderNumber: order.order_number }, 200);
});
