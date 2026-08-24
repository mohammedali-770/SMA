import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig, type ProviderConfig } from '../_shared/secrets.ts';
import { resolveTapConfig, mapTapStatus } from '../_shared/tap.ts';
import { retrieveTapCharge, validateAndConfirmTapCharge, type TapAttempt } from '../_shared/tapVerify.ts';
import { resolveMoyasarConfig } from '../_shared/moyasar.ts';
import { verifyMoyasarAttempt, type MoyasarAttempt } from '../_shared/moyasarVerify.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * payment-verify — the app calls this after returning from the provider's hosted
 * checkout. It is the ONLY thing the app trusts: it retrieves the charge (Tap) or
 * the invoice and its payment (Moyasar) server-to-server and confirms the order
 * paid only on a clean success. The redirect params the app saw are never
 * trusted — Moyasar's redirect in particular appends only an unsigned `id`, and
 * Moyasar's own guide requires this server-side fetch before fulfilling an order.
 * verify_jwt = true and the order is read via the user's RLS, so a customer can
 * only ever verify their OWN order.
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
  const sessionId = String(body.checkoutSessionId ?? body.checkout_session_id ?? '');
  if (!orderId && !sessionId) return json({ error: 'orderId or checkoutSessionId is required' }, 400);

  const supaUser = userClient(authHeader);
  const admin = adminClient();

  // Session flow: the order is created by finalize_checkout_session on a clean
  // CAPTURED. Return its id so the app can open the receipt.
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

  const cfg = await getProviderConfig(admin, 'payment');
  const providerName = (cfg?.providerName ?? '').toLowerCase();
  // Route by the provider of the attempt that is actually in flight, not by the
  // one configured right now — see attemptProvider().
  const route = (await attemptProvider(admin, 'order_id', orderId)) || providerName;
  if (route && route !== providerName) return await unverifiableProvider(admin, route, providerName);
  if (route === 'moyasar') return await verifyMoyasarOrder(admin, cfg!, orderId);
  if (!cfg || route !== 'tap') {
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
  return json({ status: outcome, messageKey, orderId }, 200);
});

/**
 * Verify the Tap charge tied to a CHECKOUT SESSION. On a clean CAPTURED,
 * validateAndConfirmTapCharge → finalize_checkout_session creates the real order;
 * we return its id + number so the app opens the receipt. Never trusts the app.
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
  const providerName = (cfg?.providerName ?? '').toLowerCase();
  const route = (await attemptProvider(admin, 'checkout_session_id', sessionId)) || providerName;
  if (route && route !== providerName) return await unverifiableProvider(admin, route, providerName);
  if (route === 'moyasar') return await verifyMoyasarSession(supaUser, admin, cfg!, sessionId);
  if (!cfg || route !== 'tap') return json({ status: 'pending' }, 200);

  const { data: recs } = await admin.from('payment_records')
    .select('id, order_id, checkout_session_id, provider_ref, reference_transaction, reference_order, amount, mode, status')
    .eq('checkout_session_id', sessionId).eq('provider', 'tap')
    .order('created_at', { ascending: false }).limit(1);
  const rec = (Array.isArray(recs) ? recs[0] : null) as TapAttempt | null;
  if (!rec || !rec.provider_ref) return json({ status: 'pending' }, 200);

  const tap = resolveTapConfig(cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig, (rec.mode as 'test' | 'live') ?? undefined);
  if (!tap.secretKey) return json({ status: 'pending' }, 200);

  const retrieved = await retrieveTapCharge(tap.secretKey, String(rec.provider_ref));
  if (!retrieved.ok) return json({ status: 'pending' }, 200); // transient — let the app retry

  const result = await validateAndConfirmTapCharge(admin, rec, retrieved.charge, tap.merchantId);
  const outcome = result.paid ? 'paid' : (result.outcome === 'mismatch' ? 'failed' : result.outcome);
  const { messageKey } = mapTapStatus(retrieved.charge.status);

  let outOrderId = result.orderId ?? '';
  if (outcome === 'paid' && !outOrderId) {
    const { data: s2 } = await supaUser.from('checkout_sessions').select('order_id').eq('id', sessionId).maybeSingle();
    outOrderId = String(s2?.order_id ?? '');
  }
  return json({ status: outcome, messageKey, orderId: outOrderId || null }, 200);
}

// ---------------------------------------------------------------------------
// Provider routing.
//
// An in-flight attempt belongs to the gateway that opened it. Routing
// verification by `integration_settings.provider_name` — whatever is configured
// at the moment the app asks — means that after a provider switch a customer
// with an open Tap checkout is looked up in the Moyasar tables, found absent,
// and told 'pending' forever even after they pay.
//
// So: find the attempt first, and let IT choose the path.
// ---------------------------------------------------------------------------
async function attemptProvider(
  admin: SupabaseClient, column: 'order_id' | 'checkout_session_id', value: string,
): Promise<string | null> {
  const { data } = await admin.from('payment_records')
    .select('provider')
    .eq(column, value)
    .order('created_at', { ascending: false }).limit(1);
  const row = (Array.isArray(data) ? data[0] : null) as { provider?: string } | null;
  return row?.provider ? String(row.provider).toLowerCase() : null;
}

/**
 * The attempt belongs to a gateway that is not the configured one. There is a
 * single credential slot for provider_type='payment', so switching overwrites
 * the previous gateway's keys and this attempt genuinely cannot be verified.
 *
 * Reported as 'pending' because that is the truth from the app's point of view —
 * it keeps polling and the order is not falsely failed — and logged so the
 * situation is visible to an operator rather than presenting as a customer who
 * "never finished paying".
 */
async function unverifiableProvider(
  admin: SupabaseClient, attemptProviderName: string, configured: string,
): Promise<Response> {
  console.warn('payment attempt for a provider that is no longer configured', JSON.stringify({
    attempt: attemptProviderName, configured,
  }));
  await admin.from('integration_sync_logs').insert({
    provider: attemptProviderName, order_id: null, direction: 'webhook', status: 'skipped',
    request: { action: 'verify' }, error: 'provider_not_configured',
  }).then(() => {}, () => {});
  return json({ status: 'pending', reason: 'provider_not_configured' }, 200);
}

// ---------------------------------------------------------------------------
// Moyasar verification.
//
// Same shape as the Tap paths and the same guarantees: the attempt's STORED mode
// picks the secret key (so flipping Admin test<->live never breaks verification
// of an older attempt), the provider is asked directly, and confirmation runs
// through the shared idempotent RPCs. A transient failure returns 'pending' so
// the app retries rather than showing a customer a failure that did not happen.
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
