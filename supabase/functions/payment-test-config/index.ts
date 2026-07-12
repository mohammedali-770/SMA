import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { resolveTapConfig, mapTapStatus, buildTapChargePayload, sanitizeTapResponse, isAdminTestCharge } from '../_shared/tap.ts';
import { retrieveTapCharge, validateAndConfirmTapCharge, type TapAttempt } from '../_shared/tapVerify.ts';

/**
 * payment-test-config — ADMIN-only (verify_jwt=true + is_admin check).
 *   action 'status'          → readiness booleans for the Tap config (no secrets).
 *   action 'test_connection' → validate the SELECTED-mode secret key against Tap
 *                              WITHOUT creating a charge, by requesting a
 *                              non-existent charge id: a valid key is authorized
 *                              (Tap replies !=401), an invalid key returns 401.
 * Secret values are never returned; provider errors are sanitized.
 */
const TAP_BASE = 'https://api.tap.company/v2/charges';

function has(v: unknown): boolean { return typeof v === 'string' && v.trim().length > 0; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const admin = adminClient();
  const { data: { user } } = await userClient(authHeader).auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!profile || profile.role !== 'admin') return json({ error: 'forbidden' }, 403);

  let payload: { action?: string; orderId?: string; chargeId?: string };
  try { payload = await req.json(); } catch { payload = {}; }

  const cfg = await getProviderConfig(admin, 'payment');
  const pub = (cfg?.publicConfig ?? {}) as Record<string, unknown>;
  const sec = (cfg?.secretConfig ?? {}) as Record<string, unknown>;
  const providerName = (cfg?.providerName ?? '').toLowerCase();
  const mode: 'test' | 'live' = String(pub.mode ?? 'test').toLowerCase() === 'live' ? 'live' : 'test';

  if (payload.action === 'test_connection') {
    if (providerName !== 'tap') return json({ ok: false, message: "Set the payment provider to 'tap' first." }, 200);
    const tap = resolveTapConfig(Boolean(cfg?.enabled), cfg?.providerName ?? null, pub, sec, mode);
    if (!tap.merchantId) return json({ ok: false, message: 'Merchant ID is not set.' }, 200);
    if (!tap.secretKey) return json({ ok: false, message: `No ${mode} secret key is configured.` }, 200);
    try {
      // A harmless authorized GET of a non-existent charge — never creates one.
      const resp = await fetch(`${TAP_BASE}/chg_credential_check_000000000000`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${tap.secretKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      if (resp.status === 401) return json({ ok: false, message: `The ${mode} secret key was rejected by Tap (unauthorized).` }, 200);
      return json({ ok: true, message: `Tap accepted the ${mode} key. Connection OK.` }, 200);
    } catch {
      return json({ ok: false, message: 'Could not reach Tap. Please try again.' }, 200);
    }
  }

  if (payload.action === 'verify_order') {
    // Admin-triggered re-verification of a specific order (admin-only — this
    // whole function already required role='admin', so an accountant cannot reach
    // it). It NEVER force-marks paid: it retrieves the charge from Tap and only
    // confirms on a genuine CAPTURED, via the same shared, idempotent path.
    if (providerName !== 'tap') return json({ status: 'unavailable' }, 200);
    const orderId = String(payload.orderId ?? '');
    if (!orderId) return json({ status: 'error', message: 'orderId is required' }, 200);
    const { data: recs } = await admin.from('payment_records')
      .select('id, order_id, provider_ref, reference_transaction, reference_order, amount, mode, status')
      .eq('order_id', orderId).eq('provider', 'tap')
      .order('created_at', { ascending: false }).limit(1);
    const rec = (Array.isArray(recs) ? recs[0] : null) as TapAttempt | null;
    if (!rec || !rec.provider_ref) return json({ status: 'pending', message: 'No Tap charge to verify yet.' }, 200);
    const tap = resolveTapConfig(Boolean(cfg?.enabled), cfg?.providerName ?? null, pub, sec, (rec.mode as 'test' | 'live') ?? undefined);
    if (!tap.secretKey) return json({ status: 'pending', message: `No ${rec.mode ?? mode} key configured.` }, 200);
    const retrieved = await retrieveTapCharge(tap.secretKey, String(rec.provider_ref));
    if (!retrieved.ok) return json({ status: 'pending', message: 'Could not reach Tap. Try again.' }, 200);
    const result = await validateAndConfirmTapCharge(admin, rec, retrieved.charge, tap.merchantId);
    const outcome = result.paid ? 'paid' : (result.outcome === 'mismatch' ? 'failed' : result.outcome);
    return json({ status: outcome, message: mapTapStatus(retrieved.charge.status).messageKey }, 200);
  }

  if (payload.action === 'test_checkout') {
    // Admin-only isolated Tap TEST checkout. Creates a 1 SAR sandbox charge that is
    // NOT linked to any Spicy Meal order — it never touches orders, payment_records
    // (order_id is required there), Lazywait, cash, or the mobile flow. Fails closed
    // unless Tap is enabled in TEST mode with a merchant id + test key.
    if (providerName !== 'tap') return json({ ok: false, message: "Set the payment provider to 'tap' first." }, 200);
    if (!cfg?.enabled) return json({ ok: false, message: 'Enable Tap first.' }, 200);
    if (mode !== 'test') return json({ ok: false, message: 'Admin test checkout is only available in TEST mode.' }, 200);
    const tap = resolveTapConfig(true, 'tap', pub, sec, 'test'); // force the TEST key
    if (!tap.merchantId) return json({ ok: false, message: 'Merchant ID is not set.' }, 200);
    if (!tap.secretKey) return json({ ok: false, message: 'Test secret key is not set.' }, 200);

    const ref = `admin_test_${crypto.randomUUID()}`;
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const chargeBody = buildTapChargePayload({
      amount: 1, currency: 'SAR', description: 'Spicy Meal admin Tap test checkout',
      referenceTransaction: ref, referenceOrder: 'admin_test', idempotent: ref,
      sourceId: 'src_all', merchantId: tap.merchantId, expiryMinutes: 30, langCode: 'en',
      postUrl: `${supabaseUrl}/functions/v1/payment-webhook`,
      redirectUrl: `${supabaseUrl}/functions/v1/tap-admin-test-return`,
      metadata: { purpose: 'admin_test' },
      customer: { firstName: 'Admin', lastName: 'Test' },
    });
    try {
      const resp = await fetch(TAP_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tap.secretKey}` },
        body: JSON.stringify(chargeBody),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error('Tap admin test charge failed', resp.status);
        return json({ ok: false, message: 'Tap did not accept the test charge. Check the merchant id / test key.' }, 200);
      }
      const chargeId = String((result as Record<string, unknown>).id ?? '');
      const transaction = ((result as Record<string, unknown>).transaction ?? {}) as Record<string, unknown>;
      const checkoutUrl = String(transaction.url ?? '');
      if (!chargeId || !checkoutUrl) return json({ ok: false, message: 'Tap did not return a checkout URL.' }, 200);
      return json({ ok: true, chargeId, checkoutUrl, mode: 'test' }, 200);
    } catch {
      return json({ ok: false, message: 'Could not reach Tap. Please try again.' }, 200);
    }
  }

  if (payload.action === 'test_checkout_result') {
    // Verify the admin test charge server-side via Retrieve Charge. Display ONLY —
    // never confirms an order, never writes payment state. Redirect params are not
    // trusted; the frontend only supplies the charge id it received on create.
    if (providerName !== 'tap') return json({ ok: false, message: 'unavailable' }, 200);
    const chargeId = String(payload.chargeId ?? '');
    if (!chargeId) return json({ ok: false, message: 'chargeId is required' }, 200);
    const tap = resolveTapConfig(Boolean(cfg?.enabled), 'tap', pub, sec, 'test'); // TEST key
    if (!tap.secretKey) return json({ ok: false, message: 'Test secret key is not set.' }, 200);
    const retrieved = await retrieveTapCharge(tap.secretKey, chargeId);
    if (!retrieved.ok) return json({ ok: false, message: 'Could not retrieve the charge from Tap.' }, 200);
    const c = retrieved.charge;
    // Only ever report the isolated admin test charge — never a real order's charge.
    if (!isAdminTestCharge(c)) return json({ ok: false, message: 'That charge is not an admin test charge.' }, 200);
    const s = sanitizeTapResponse(c);
    const { messageKey } = mapTapStatus(c.status);
    return json({
      ok: true, chargeId: s.id, status: s.status, amount: s.amount, currency: s.currency,
      mode: c.live_mode ? 'live' : 'test', messageKey,
    }, 200);
  }

  // Default: status booleans (never any secret values).
  return json({
    status: 'ok',
    provider: providerName || null,
    enabled: Boolean(cfg?.enabled),
    mode,
    currency: has(pub.currency) ? String(pub.currency) : 'SAR',
    source_id: has(pub.source_id) ? String(pub.source_id) : 'src_all',
    merchant_id_set: has(pub.merchant_id),
    test_key_set: has(sec.test_secret_key),
    live_key_set: has(sec.live_secret_key),
    active_key_set: has(mode === 'live' ? sec.live_secret_key : sec.test_secret_key),
    expiry_minutes: Number(pub.transaction_expiry_minutes ?? 30),
  }, 200);
});
