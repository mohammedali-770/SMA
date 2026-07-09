import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { callbackSignature, formatAmount, timingSafeEqual } from '../_shared/geidea.ts';
import { DEFAULT_BASE_URL, lazywaitFetch, round2, type LazywaitConfig } from '../_shared/lazywait.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

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
    // Do not touch the order. Log the rejected attempt for ops, but WITHOUT
    // persisting the full body: this branch runs before the signature is verified,
    // so `evt` is unauthenticated + attacker-controlled and unbounded. Store only
    // a small bounded snapshot to keep visibility without a write-amplification /
    // storage-growth vector on this public endpoint.
    await admin.from('integration_sync_logs').insert({
      provider: 'geidea',
      order_id: isUuid(merchantReferenceId) ? merchantReferenceId : null,
      direction: 'webhook',
      status: 'failed',
      request: {
        merchant_reference_id: merchantReferenceId ? merchantReferenceId.slice(0, 64) : null,
        status: status ? status.slice(0, 32) : null,
        body_bytes: rawBody.length,
      },
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
  if (error) {
    // Do NOT echo the internal RPC/DB error to the caller: confirm_order_payment's
    // amount-mismatch message contains the server-trusted order total, and other
    // failures can leak internal detail. Log server-side; return a generic 400 so
    // the gateway still sees a non-2xx and retries. (A legitimate paid callback
    // with a matching amount succeeds above and never reaches this branch.)
    console.error('confirm_order_payment failed', String(error.message ?? '').slice(0, 300));
    return json({ error: 'payment confirmation failed' }, 400);
  }

  // Prepared hook: after the LOCAL order is confirmed paid, best-effort notify
  // Lazywait POS of the online payment (server-trusted amount). Never affects the
  // payment result — a Lazywait failure is logged and retried by ops, not fatal.
  await pushLazywaitOnlinePayment(admin, data as Record<string, unknown> | null, orderId).catch(() => {});

  return json({ status: 'paid', order: data }, 200);
});

/**
 * POST /pos/orders/update-online-payment with the SERVER-TRUSTED paid total.
 * Only runs after confirm_order_payment succeeded and the order was already
 * synced to Lazywait (has a lazywait_ref). Best-effort + logged; never throws.
 */
async function pushLazywaitOnlinePayment(
  admin: SupabaseClient, order: Record<string, unknown> | null, geideaRef: string,
): Promise<void> {
  if (!order) return;
  const lazywaitRef = order.lazywait_ref ? String(order.lazywait_ref) : '';
  if (!lazywaitRef) return; // order not synced to POS yet — nothing to attach payment to

  const cfg = await getProviderConfig(admin, 'lazywait');
  if (!cfg || !cfg.enabled) return;
  const lw: LazywaitConfig = {
    baseUrl: String((cfg.publicConfig as Record<string, unknown>).base_url ?? DEFAULT_BASE_URL),
    clientId: String((cfg.publicConfig as Record<string, unknown>).client_id ?? ''),
    apiToken: String((cfg.secretConfig as Record<string, unknown>).api_token ?? ''),
  };
  if (!lw.clientId || !lw.apiToken) return;

  const { data: branch } = await admin
    .from('branches').select('lazywait_branch_id').eq('id', order.branch_id).maybeSingle();
  const branchId = (branch as { lazywait_branch_id?: string } | null)?.lazywait_branch_id;
  if (!branchId) return;

  const res = await lazywaitFetch(lw, {
    method: 'POST',
    path: '/pos/orders/update-online-payment',
    body: {
      client_id: lw.clientId,
      branch_id: branchId,
      order_ref: lazywaitRef,
      Trans_Amount: round2(Number(order.total ?? 0)), // server-trusted paid amount
      Approval_No: geideaRef,
      Card_Type: 'card',
    },
    timeoutMs: 12000,
  });

  await admin.from('integration_sync_logs').insert({
    provider: 'lazywait',
    order_id: order.id ? String(order.id) : null,
    direction: 'push',
    status: res.ok ? 'success' : 'failed',
    request: { endpoint: 'update-online-payment', order_ref: lazywaitRef },
    error: res.ok ? null : `payment_push_${res.status}`,
  }).then(() => {}, () => {});
}

/** Cheap UUID shape check so a bad merchantReferenceId doesn't break the log insert. */
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
