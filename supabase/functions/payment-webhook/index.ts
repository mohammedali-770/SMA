import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig, type ProviderConfig } from '../_shared/secrets.ts';
import { callbackSignature, formatAmount, timingSafeEqual as geideaTimingSafeEqual } from '../_shared/geidea.ts';
import {
  resolveTapConfig, chargeHashFields, computeChargeWebhookHash, timingSafeEqual, isAdminTestCharge,
} from '../_shared/tap.ts';
import { retrieveTapCharge, validateAndConfirmTapCharge, type TapAttempt } from '../_shared/tapVerify.ts';
import { triggerLazywaitSyncOnce, pushLazywaitOnlinePayment } from '../_shared/paymentSync.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * payment-webhook — called by the PAYMENT GATEWAY (not the app) after a payment
 * event. verify_jwt = false: the caller is the gateway, authenticated by its own
 * signature/hashstring (NOT a Supabase JWT). The active provider is chosen by
 * integration_settings('payment').provider_name.
 *
 * Tap: validate the documented webhook hashstring (timing-safe) with the secret
 * key for the charge's live_mode, then RETRIEVE the charge server-to-server and
 * only confirm on CAPTURED with every bound field matching — never trusting the
 * webhook JSON alone. Confirmation is the idempotent confirm_order_payment RPC.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg || !cfg.enabled) return json({ status: 'ignored', reason: 'payment provider not configured' }, 200);

  const providerName = (cfg.providerName ?? '').toLowerCase();
  const rawBody = await req.text();

  if (providerName === 'tap') return await handleTapWebhook(admin, req, cfg, rawBody);
  if (providerName === 'geidea') return await handleGeideaWebhook(admin, cfg, rawBody);
  return json({ status: 'ignored', reason: `provider is '${providerName}'` }, 200);
});

// ---------------------------------------------------------------------------
// Tap webhook
// ---------------------------------------------------------------------------
async function handleTapWebhook(
  admin: SupabaseClient, req: Request, cfg: ProviderConfig, rawBody: string,
): Promise<Response> {
  let charge: Record<string, unknown>;
  try { charge = JSON.parse(rawBody) as Record<string, unknown>; } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const chargeId = String(charge.id ?? '');
  const mode: 'test' | 'live' = charge.live_mode === true ? 'live' : 'test';
  const tap = resolveTapConfig(cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig, mode);
  if (!tap.secretKey) {
    // Can't validate without the mode's key → do not change any state.
    return json({ status: 'ignored', reason: 'key for mode not configured' }, 200);
  }

  // Validate the hashstring exactly as Tap documents (header 'hashstring'; the
  // charge body also carries it as a fallback). Timing-safe compare.
  const provided = req.headers.get('hashstring') ?? (charge.hashstring != null ? String(charge.hashstring) : '');
  const expected = await computeChargeWebhookHash(chargeHashFields(charge), tap.secretKey);
  if (!provided || !timingSafeEqual(provided, expected)) {
    await admin.from('integration_sync_logs').insert({
      provider: 'tap', order_id: null, direction: 'webhook', status: 'failed',
      request: { charge_id: chargeId.slice(0, 64), body_bytes: rawBody.length }, error: 'hashstring mismatch',
    }).then(() => {}, () => {});
    return json({ error: 'invalid hashstring' }, 401);
  }

  // The admin dashboard's isolated test charge is NOT linked to any order.
  // Recognise it and acknowledge WITHOUT touching order/payment state — never look
  // it up or confirm anything. (It is also never stored in payment_records, so the
  // lookup below would miss it anyway; this is the explicit, logged safeguard.)
  if (isAdminTestCharge(charge)) {
    await admin.from('integration_sync_logs').insert({
      provider: 'tap', order_id: null, direction: 'webhook', status: 'skipped',
      request: { charge_id: chargeId.slice(0, 64) }, error: 'admin_test charge ignored',
    }).then(() => {}, () => {});
    return json({ status: 'acknowledged', reason: 'admin_test' }, 200);
  }

  // Locate the stored attempt for this charge.
  const { data: rec } = await admin.from('payment_records')
    .select('id, order_id, checkout_session_id, provider_ref, reference_transaction, reference_order, amount, mode, status')
    .eq('provider', 'tap').eq('provider_ref', chargeId).maybeSingle();
  if (!rec) {
    // Unknown charge — acknowledge (so Tap stops retrying) and flag for review.
    await admin.from('integration_sync_logs').insert({
      provider: 'tap', order_id: null, direction: 'webhook', status: 'skipped',
      request: { charge_id: chargeId.slice(0, 64) }, error: 'unknown charge',
    }).then(() => {}, () => {});
    return json({ status: 'acknowledged', reason: 'unknown charge' }, 200);
  }

  // Do NOT trust the webhook JSON alone — retrieve the charge server-to-server.
  const retrieved = await retrieveTapCharge(tap.secretKey, chargeId);
  const authoritative = retrieved.ok ? retrieved.charge : charge;
  const result = await validateAndConfirmTapCharge(admin, rec as TapAttempt, authoritative, tap.merchantId);

  return json({ status: result.paid ? 'paid' : 'acknowledged', outcome: result.outcome }, 200);
}

// ---------------------------------------------------------------------------
// Geidea webhook (pre-existing scaffold — retained, dormant). Behavior unchanged;
// now uses the shared Lazywait online-payment helper.
// ---------------------------------------------------------------------------
async function handleGeideaWebhook(
  admin: SupabaseClient, cfg: ProviderConfig, rawBody: string,
): Promise<Response> {
  let evt: Record<string, unknown>;
  try { evt = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const order = ((evt.order ?? evt) as Record<string, unknown>);
  const publicKey = String(cfg.secretConfig.publicKey ?? '');
  const apiPassword = String(cfg.secretConfig.apiPassword ?? '');
  if (!publicKey || !apiPassword) return json({ error: 'Geidea credentials are not set' }, 500);

  const orderId = String(order.orderId ?? order.id ?? '');
  const merchantReferenceId = String(order.merchantReferenceId ?? '');
  const status = String(order.status ?? '');
  const currency = String(order.currency ?? 'SAR');
  const amountNum = Number(order.amount ?? order.totalAmount ?? 0);
  const timestamp = String(order.timestamp ?? evt.timestamp ?? '');
  const provided = String(evt.signature ?? order.signature ?? '');

  const expected = await callbackSignature({
    publicKey, amount: formatAmount(amountNum), currency, orderId, status, merchantReferenceId, timestamp, apiPassword,
  });

  if (!provided || !geideaTimingSafeEqual(provided, expected)) {
    await admin.from('integration_sync_logs').insert({
      provider: 'geidea', order_id: isUuid(merchantReferenceId) ? merchantReferenceId : null,
      direction: 'webhook', status: 'failed',
      request: { merchant_reference_id: merchantReferenceId ? merchantReferenceId.slice(0, 64) : null, status: status ? status.slice(0, 32) : null, body_bytes: rawBody.length },
      error: 'signature mismatch',
    }).then(() => {}, () => {});
    return json({ error: 'invalid signature' }, 401);
  }

  const responseCode = String(evt.responseCode ?? order.responseCode ?? '');
  const isPaid = status.toLowerCase() === 'paid' && responseCode === '000';
  if (!isPaid) {
    await admin.from('integration_sync_logs').insert({
      provider: 'geidea', order_id: isUuid(merchantReferenceId) ? merchantReferenceId : null,
      direction: 'webhook', status: 'skipped', request: evt, error: `payment status: ${status || 'unknown'}`,
    }).then(() => {}, () => {});
    return json({ status: 'acknowledged', paymentStatus: status }, 200);
  }

  const { data, error } = await admin.rpc('confirm_order_payment', {
    p_order_id: merchantReferenceId, p_provider: 'geidea', p_provider_ref: orderId, p_amount: amountNum, p_raw: evt,
  });
  if (error) {
    console.error('confirm_order_payment failed', String(error.message ?? '').slice(0, 300));
    return json({ error: 'payment confirmation failed' }, 400);
  }

  await triggerLazywaitSyncOnce(admin);
  const { data: fresh } = await admin.from('orders').select('*').eq('id', merchantReferenceId).maybeSingle();
  await pushLazywaitOnlinePayment(admin, (fresh ?? data) as Record<string, unknown> | null, orderId).catch(() => {});

  return json({ status: 'paid', order: data }, 200);
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
