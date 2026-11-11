import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig, type ProviderConfig } from '../_shared/secrets.ts';
import { resolveMoyasarConfig } from '../_shared/moyasar.ts';
import { verifyMoyasarAttempt, type MoyasarAttempt } from '../_shared/moyasarVerify.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * payment-verify — the app calls this after returning from Moyasar's hosted
 * checkout. It is the ONLY thing the app trusts: it retrieves the invoice and its
 * payment server-to-server and confirms the order paid only on a clean success.
 * The redirect params the app saw are never trusted — Moyasar's redirect appends
 * only an unsigned `id`, and Moyasar's own guide requires this server-side fetch
 * before fulfilling an order. verify_jwt = true and the order is read via the
 * user's RLS, so a customer can only ever verify their OWN order.
 *
 * The secret key is chosen by the STORED attempt's mode (not the current Admin
 * mode), so flipping Admin test↔live never breaks verification of older attempts.
 * Only Moyasar attempts are looked up, so the July Tap attempts still in
 * payment_records (none of them paid) read 'pending'. Idempotent: repeated calls
 * converge on a single confirmation.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Authentication required' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const orderId = String(body.orderId ?? body.order_id ?? '');
  const sessionId = String(body.checkoutSessionId ?? body.checkout_session_id ?? '');
  if (!orderId && !sessionId) return json({ error: 'orderId or checkoutSessionId is required' }, 400);

  const supaUser = userClient(authHeader);
  const admin = adminClient();

  // Session flow: the order is created by finalize_checkout_session on a clean
  // paid payment. Return its id so the app can open the receipt.
  if (sessionId) return await verifySession(supaUser, admin, sessionId);

  // Legacy order flow (unchanged): verify an already-created order.
  // NOTE: order_number (the internal SM-… id) is deliberately neither selected
  // nor returned. The app opens the receipt by orderId and renders only the
  // branch's own number once Lazywait issues one (Issue #94).
  const { data: order, error: orderErr } = await supaUser
    .from('orders').select('id, payment_status').eq('id', orderId).maybeSingle();
  if (orderErr) return json({ error: orderErr.message }, 400);
  if (!order) return json({ error: 'Order not found' }, 404);
  if (order.payment_status === 'paid') return json({ status: 'paid', orderId }, 200);

  // An explicit guard, not an assertion: with no payment row there is no key to
  // verify with, and the app keeps polling 'pending' rather than seeing a crash.
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg) return json({ status: 'pending' }, 200);
  return await verifyMoyasarOrder(admin, cfg, orderId);
});

/**
 * Verify the Moyasar payment tied to a CHECKOUT SESSION. On a clean `paid`,
 * validateAndConfirmMoyasarPayment → finalize_checkout_session creates the real
 * order; we return its id so the app opens the receipt. Never trusts the app.
 */
async function verifySession(supaUser: SupabaseClient, admin: SupabaseClient, sessionId: string): Promise<Response> {
  const { data: session, error: sErr } = await supaUser
    .from('checkout_sessions').select('id, status, order_id').eq('id', sessionId).maybeSingle();
  if (sErr) return json({ error: sErr.message }, 400);
  if (!session) return json({ error: 'Checkout session not found' }, 404);
  if (session.order_id) {
    return json({ status: 'paid', orderId: session.order_id }, 200);
  }

  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg) return json({ status: 'pending' }, 200);
  return await verifyMoyasarSession(supaUser, admin, cfg, sessionId);
}

// ---------------------------------------------------------------------------
// Moyasar verification.
//
// The attempt's STORED mode picks the secret key (so flipping Admin test<->live
// never breaks verification of an older attempt), Moyasar is asked directly,
// and confirmation runs through the shared idempotent RPCs. A transient failure
// returns 'pending' so the app retries rather than showing a customer a failure
// that did not happen.
// ---------------------------------------------------------------------------
function moyasarSelect(): string {
  return 'id, order_id, checkout_session_id, provider_ref, provider_checkout_ref, reference_transaction, reference_order, amount, currency, mode, status';
}

async function latestMoyasarAttempt(
  admin: SupabaseClient, column: 'order_id' | 'checkout_session_id', value: string,
): Promise<MoyasarAttempt | null> {
  const { data } = await admin.from('payment_records')
    .select(moyasarSelect())
    .eq(column, value).eq('provider', 'moyasar')
    .order('created_at', { ascending: false }).limit(1);
  return (Array.isArray(data) ? data[0] : null) as MoyasarAttempt | null;
}

async function verifyMoyasarOrder(
  admin: SupabaseClient, cfg: ProviderConfig, orderId: string,
): Promise<Response> {
  const rec = await latestMoyasarAttempt(admin, 'order_id', orderId);
  if (!rec || !rec.provider_checkout_ref) return json({ status: 'pending' }, 200);

  const m = resolveMoyasarConfig(
    cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig,
    (rec.mode as 'test' | 'live') ?? undefined,
  );
  if (!m.secretKey) return json({ status: 'pending' }, 200);

  const result = await verifyMoyasarAttempt(admin, rec, m.secretKey);
  const outcome = result.paid ? 'paid' : (result.outcome === 'mismatch' ? 'failed' : result.outcome);
  return json({ status: outcome, messageKey: result.messageKey, orderId }, 200);
}

async function verifyMoyasarSession(
  supaUser: SupabaseClient, admin: SupabaseClient, cfg: ProviderConfig, sessionId: string,
): Promise<Response> {
  const rec = await latestMoyasarAttempt(admin, 'checkout_session_id', sessionId);
  if (!rec || !rec.provider_checkout_ref) return json({ status: 'pending' }, 200);

  const m = resolveMoyasarConfig(
    cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig,
    (rec.mode as 'test' | 'live') ?? undefined,
  );
  if (!m.secretKey) return json({ status: 'pending' }, 200);

  const result = await verifyMoyasarAttempt(admin, rec, m.secretKey);
  const outcome = result.paid ? 'paid' : (result.outcome === 'mismatch' ? 'failed' : result.outcome);

  let outOrderId = result.orderId ?? '';
  if (outcome === 'paid' && !outOrderId) {
    const { data: s2 } = await supaUser.from('checkout_sessions').select('order_id').eq('id', sessionId).maybeSingle();
    outOrderId = String(s2?.order_id ?? '');
  }
  return json({ status: outcome, messageKey: result.messageKey, orderId: outOrderId || null }, 200);
}
