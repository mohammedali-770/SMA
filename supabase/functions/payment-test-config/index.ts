import { corsHeaders, json } from '../_shared/cors.ts';
import { decideAdminAuthorization } from '../_shared/adminAuth.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { resolveTapConfig, mapTapStatus, buildTapChargePayload, sanitizeTapResponse, isAdminTestCharge, extractTapError } from '../_shared/tap.ts';
import { retrieveTapCharge, validateAndConfirmTapCharge, type TapAttempt } from '../_shared/tapVerify.ts';

/**
 * payment-test-config — ADMIN-only (verify_jwt=true + is_admin(), role AND AAL2).
 *
 * THE GATE IS THE ONLY THING THIS FILE HAD CHANGED FOR since the payment freeze
 * began. It used to test `profile.role !== 'admin'` alone, which admitted an
 * administrator who had not completed TOTP — the same defect fixed in
 * staff-accounts, email-test-config, whatsapp-test-config and push-dispatch on
 * 2026-08-23. It was held back then because CLAUDE.md §6 freezes payment code;
 * the owner approved this specific exception on 2026-08-24.
 *
 * It mattered here for a reason worth stating: `verify_order` below is not a
 * read. It reaches `validateAndConfirmTapCharge`, which can mark a real order
 * paid. It cannot invent a payment — it confirms only on a genuine CAPTURED
 * charge retrieved from Tap — but an AAL1 caller could still drive payment-state
 * writes on real orders, through the service-role client, which bypasses RLS.
 *
 * NOTHING ELSE IN THIS FILE WAS TOUCHED. No provider behaviour, no charge
 * construction, no verification logic, no configuration. The freeze still holds
 * over all of it.
 *
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

  // Admin AND AAL2 — asked of Postgres as the CALLER so the assurance level is
  // evaluated by the same SQL every RLS policy uses. See _shared/adminAuth.ts.
  // Placed after getUser() on purpose: a failed session refresh makes
  // supabase-js send the anon key, and gating earlier would report that as
  // "two-factor required" instead of the truthful "unauthorized".
  const caller = userClient(authHeader);
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin');
  const gate = decideAdminAuthorization({ data: isAdmin, error: adminErr }, profile?.role);
  if (!gate.allowed) return json({ error: gate.error, code: gate.code }, gate.status);

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
      // Tap Create Charge requires customer email OR phone (error 1139 otherwise).
      // Admin-test-only dummy contact — sandbox values, never a real customer; the
      // receipt is off, so nothing is sent to this address/number.
      customer: {
        firstName: 'Spicy', lastName: 'Meal',
        email: 'test@spicymeal.com.sa',
        phone: { country_code: '966', number: '500000000' },
      },
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
        // Surface the real Tap reason to Admin — code + description ONLY (no secret,
        // no Authorization header, no raw body). Logs are sanitized the same way.
        const tapErr = extractTapError(result);
        console.error('Tap admin test charge failed', { httpStatus: resp.status, code: tapErr.code, description: tapErr.description });
        return json({
          ok: false,
          message: 'Tap did not accept the test charge.',
          tapErrorCode: tapErr.code,
          tapErrorDescription: tapErr.description,
          httpStatus: resp.status,
        }, 200);
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
