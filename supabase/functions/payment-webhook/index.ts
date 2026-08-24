import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig, type ProviderConfig } from '../_shared/secrets.ts';
import { callbackSignature, formatAmount, timingSafeEqual as geideaTimingSafeEqual } from '../_shared/geidea.ts';
import {
  resolveTapConfig, chargeHashFields, computeChargeWebhookHash, timingSafeEqual, isAdminTestCharge,
} from '../_shared/tap.ts';
import { retrieveTapCharge, validateAndConfirmTapCharge, type TapAttempt } from '../_shared/tapVerify.ts';
import {
  HANDLED_WEBHOOK_TYPES, isAdminTestInvoice, looksLikeMoyasarWebhook, parseWebhookEnvelope,
  resolveMoyasarConfig, verifyWebhookSecretToken,
} from '../_shared/moyasar.ts';
import {
  retrieveMoyasarPayment, validateAndConfirmMoyasarPayment, type MoyasarAttempt,
} from '../_shared/moyasarVerify.ts';
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
 *
 * Moyasar: compare the body's `secret_token` (timing-safe) against the stored
 * webhook secret for the event's mode, then RETRIEVE the payment
 * server-to-server and only confirm on `paid` with every bound field matching.
 * The token is a bearer secret, not a signature over the payload, so it gates
 * whether we look — never what we conclude. Same confirmation RPCs.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg || !cfg.enabled) return json({ status: 'ignored', reason: 'payment provider not configured' }, 200);

  const providerName = (cfg.providerName ?? '').toLowerCase();
  const rawBody = await req.text();

  // ROUTE BY THE EVENT, NOT BY THE CURRENT CONFIGURATION.
  //
  // An event belongs to the gateway that took the money, which is not
  // necessarily the gateway configured right now. Picking the handler from
  // `provider_name` alone meant that during a provider switch a Tap charge was
  // fed to the Moyasar handler, failed its secret-token check, and returned 401
  // — so a customer who had already paid never had their order confirmed.
  //
  // Detection only chooses which handler reads the body. Each one still
  // authenticates independently and fails closed, so a wrong guess can never
  // confirm anything. Geidea keeps its original configuration-driven path:
  // it is dormant scaffold and has no detector.
  const detected: 'tap' | 'moyasar' | null =
    (providerName === 'tap' || providerName === 'moyasar')
      ? (looksLikeMoyasarWebhook(safeParse(rawBody)) ? 'moyasar' : 'tap')
      : null;

  if (detected && detected !== providerName) {
    // We hold exactly ONE credential slot for provider_type='payment', so a
    // switch overwrites the previous gateway's keys: this event cannot be
    // verified at all, and guessing would be worse than admitting it. Return a
    // retryable status so the provider's redelivery schedule gives an operator a
    // window to put the original gateway back, and record it where the admin
    // feed will show it.
    console.warn('payment webhook for a provider that is no longer configured', JSON.stringify({
      detected, configured: providerName, body_bytes: rawBody.length,
    }));
    await admin.from('integration_sync_logs').insert({
      provider: detected, order_id: null, direction: 'webhook', status: 'failed',
      request: { body_bytes: rawBody.length }, error: 'provider_not_configured',
    }).then(() => {}, () => {});
    return json({ status: 'retry', reason: 'provider_not_configured' }, 503);
  }

  if (providerName === 'tap') return await handleTapWebhook(admin, req, cfg, rawBody);
  if (providerName === 'moyasar') return await handleMoyasarWebhook(admin, cfg, rawBody);
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
// Moyasar webhook
//
// Moyasar authenticates a webhook with a bearer `secret_token` inside the JSON
// body — there is no HMAC and no signature header
// (https://docs.moyasar.com/guides/dashboard/setting-up-webhooks). That proves
// the sender knows a secret; it does NOT bind the secret to the payload, so it
// cannot detect a tampered body the way Tap's hashstring can.
//
// The webhook is therefore treated purely as a NUDGE. It decides whether we
// bother to look, never what the answer is: the payment is re-fetched
// server-to-server with our own secret key and confirmed only on a clean `paid`
// with every bound field matching. A forged webhook that guessed the token would
// still confirm nothing.
// ---------------------------------------------------------------------------
async function handleMoyasarWebhook(
  admin: SupabaseClient, cfg: ProviderConfig, rawBody: string,
): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody) as Record<string, unknown>; } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const evt = parseWebhookEnvelope(body);
  const mode: 'test' | 'live' = evt.live ? 'live' : 'test';
  const m = resolveMoyasarConfig(cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig, mode);

  // Without the secret for this mode we cannot authenticate anything, so we
  // change no state at all rather than acting on an unverified body.
  if (!m.webhookSecret) {
    return json({ status: 'ignored', reason: 'webhook secret for mode not configured' }, 200);
  }
  if (!verifyWebhookSecretToken(evt.secretToken, m.webhookSecret)) {
    await admin.from('integration_sync_logs').insert({
      provider: 'moyasar', order_id: null, direction: 'webhook', status: 'failed',
      request: { event: evt.id.slice(0, 64), type: evt.type.slice(0, 40), body_bytes: rawBody.length },
      error: 'secret token mismatch',
    }).then(() => {}, () => {});
    return json({ error: 'invalid secret token' }, 401);
  }

  // Moyasar's own spelling of the failure event is `payment_faild`; both
  // spellings are accepted so a corrected event name would not silently stop
  // matching. Anything outside the payment set is acknowledged and ignored.
  if (!HANDLED_WEBHOOK_TYPES.has(evt.type)) {
    return json({ status: 'acknowledged', reason: `unhandled type '${evt.type}'` }, 200);
  }

  const payment = evt.data;
  const paymentId = String(payment.id ?? '');
  const invoiceId = String(payment.invoice_id ?? '');

  // The admin dashboard's isolated test invoice is NOT linked to any order.
  // Recognise it and acknowledge WITHOUT touching order/payment state.
  if (isAdminTestInvoice(payment)) {
    await admin.from('integration_sync_logs').insert({
      provider: 'moyasar', order_id: null, direction: 'webhook', status: 'skipped',
      request: { payment_id: paymentId.slice(0, 64) }, error: 'admin_test payment ignored',
    }).then(() => {}, () => {});
    return json({ status: 'acknowledged', reason: 'admin_test' }, 200);
  }

  // Locate the stored attempt. Normally by the invoice the attempt was opened
  // against; a repeat webhook arriving after confirmation matches on the payment
  // id instead, because that is what confirmation stamps into provider_ref.
  let rec: MoyasarAttempt | null = null;
  const select = 'id, order_id, checkout_session_id, provider_ref, provider_checkout_ref, reference_transaction, reference_order, amount, currency, mode, status';
  if (invoiceId) {
    const { data } = await admin.from('payment_records').select(select)
      .eq('provider', 'moyasar').eq('provider_checkout_ref', invoiceId)
      .order('created_at', { ascending: false }).limit(1);
    rec = (Array.isArray(data) ? data[0] : null) as MoyasarAttempt | null;
  }
  if (!rec && paymentId) {
    const { data } = await admin.from('payment_records').select(select)
      .eq('provider', 'moyasar').eq('provider_ref', paymentId).maybeSingle();
    rec = (data ?? null) as MoyasarAttempt | null;
  }
  if (!rec) {
    // Unknown payment — acknowledge (so Moyasar stops retrying) and flag for review.
    await admin.from('integration_sync_logs').insert({
      provider: 'moyasar', order_id: null, direction: 'webhook', status: 'skipped',
      request: { payment_id: paymentId.slice(0, 64), invoice_id: invoiceId.slice(0, 64) },
      error: 'unknown payment',
    }).then(() => {}, () => {});
    return json({ status: 'acknowledged', reason: 'unknown payment' }, 200);
  }

  // Do NOT trust the webhook JSON alone — retrieve the payment server-to-server
  // using the key for the ATTEMPT's stored mode, so a webhook that claims the
  // wrong mode cannot steer us at the key that would make it verifiable.
  const mAttempt = resolveMoyasarConfig(
    cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig,
    (rec.mode as 'test' | 'live' | null) ?? mode,
  );
  if (!mAttempt.secretKey || !paymentId) {
    return json({ status: 'acknowledged', reason: 'cannot verify' }, 200);
  }
  const retrieved = await retrieveMoyasarPayment(mAttempt.secretKey, paymentId);
  if (!retrieved.ok) {
    // Transient at Moyasar's end. Return a non-2xx so their retry schedule brings
    // the event back rather than dropping it after we changed nothing.
    return json({ status: 'retry', reason: 'could not retrieve payment' }, 503);
  }

  const result = await validateAndConfirmMoyasarPayment(admin, rec, retrieved.body, { liveMode: evt.live });
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

/** Parse a webhook body for ROUTING only; both handlers re-parse and validate. */
function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return {}; }
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
