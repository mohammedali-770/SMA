import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig, type ProviderConfig } from '../_shared/secrets.ts';
import {
  HANDLED_WEBHOOK_TYPES, WEBHOOK_VERIFICATION_TYPE, isAdminTestInvoice, matchesAnyWebhookSecret,
  parseWebhookEnvelope, resolveMoyasarConfig, verifyWebhookSecretToken, webhookVerificationLogRow,
  type MoyasarWebhookEnvelope,
} from '../_shared/moyasar.ts';
import {
  retrieveMoyasarPayment, validateAndConfirmMoyasarPayment, type MoyasarAttempt,
} from '../_shared/moyasarVerify.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * payment-webhook — called by Moyasar (not the app) after a payment event.
 * verify_jwt = false: the caller is the gateway, authenticated by the
 * `secret_token` it carries in the body (NOT a Supabase JWT).
 *
 * Compare that token (timing-safe) against the stored webhook secret for the
 * event's mode, then RETRIEVE the payment server-to-server and only confirm on
 * `paid` with every bound field matching. The token is a bearer secret, not a
 * signature over the payload, so it gates whether we look — never what we
 * conclude. Confirmation is the idempotent confirm_order_payment /
 * finalize_checkout_session RPCs.
 *
 * Moyasar is the only payment provider. A payment row that is missing,
 * disabled or names any other provider acknowledges the event with 200 and
 * changes nothing; the app's own call to payment-verify still confirms a
 * genuine payment. The one event a disabled Moyasar row still records is a
 * `webhook_verification`; see recordWebhookVerification().
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg) return json({ status: 'ignored', reason: 'payment provider not configured' }, 200);

  const providerName = (cfg.providerName ?? '').toLowerCase();
  if (providerName !== 'moyasar') return json({ status: 'ignored', reason: `provider is '${providerName}'` }, 200);

  // Before the enabled check, on purpose: Moyasar sends the verification code
  // once and never retries it, so a row that is still switched off while the
  // webhook is being set up would acknowledge it and lose the only copy.
  const rawBody = await req.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(rawBody); } catch { /* not JSON: handleMoyasarWebhook answers 400 */ }
  const evt = parseWebhookEnvelope(parsed);
  if (evt.type === WEBHOOK_VERIFICATION_TYPE) return await recordWebhookVerification(admin, cfg, evt);

  if (!cfg.enabled) return json({ status: 'ignored', reason: 'payment provider not configured' }, 200);

  return await handleMoyasarWebhook(admin, cfg, rawBody);
});

// ---------------------------------------------------------------------------
// Webhook verification
//
// A new Moyasar webhook may receive one `webhook_verification` event: a
// 6-digit code the merchant enters in Moyasar's dashboard within 30 minutes.
// Until then nothing is delivered, and events from before it never are
// (https://docs.moyasar.com/api/other/webhooks/verify-webhook). It is not a
// payment event: nothing is re-fetched, confirmed or changed. The code is kept
// in one place, a staff-readable integration_sync_logs row the console shows,
// and never in a log line or the response.
// ---------------------------------------------------------------------------
async function recordWebhookVerification(
  admin: SupabaseClient, cfg: ProviderConfig, evt: MoyasarWebhookEnvelope,
): Promise<Response> {
  // Any configured token (test, live or shared): this is the setup step, so
  // the account the webhook was registered on decides which one it carries.
  // A mismatch records nothing at all.
  if (!matchesAnyWebhookSecret(evt.secretToken, cfg.secretConfig)) {
    return json({ error: 'invalid secret token' }, 401);
  }
  const { error } = await admin.from('integration_sync_logs').insert(webhookVerificationLogRow(evt));
  if (error) {
    console.error('moyasar webhook verification code could not be stored; request a new code in the Moyasar dashboard');
    return json({ status: 'error', reason: 'could not record the verification' }, 500);
  }
  return json({ status: 'acknowledged', reason: WEBHOOK_VERIFICATION_TYPE }, 200);
}

// ---------------------------------------------------------------------------
// Moyasar webhook
//
// Moyasar authenticates a webhook with a bearer `secret_token` inside the JSON
// body — there is no HMAC and no signature header
// (https://docs.moyasar.com/guides/dashboard/setting-up-webhooks). That proves
// the sender knows a secret; it does NOT bind the secret to the payload, so it
// cannot detect a tampered body the way a signature over the payload could.
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
  //
  // BE HONEST ABOUT WHAT PROTECTS US HERE. This check reads `metadata.purpose`
  // off the PAYMENT, and Moyasar does not document metadata propagating from an
  // invoice to the payment that settles it — which is the same reason
  // checkPaymentBinding deliberately does not bind on metadata. So this will
  // usually not fire. What actually keeps an admin test payment away from order
  // state is that no `payment_records` row exists for it, so the lookup below
  // falls through to 'unknown payment' and acknowledges.
  //
  // The check is kept because it costs nothing and would work if Moyasar ever
  // does propagate metadata; it is defence in depth, not the defence.
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
