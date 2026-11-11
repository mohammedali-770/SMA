import { corsHeaders, json } from '../_shared/cors.ts';
import { decideAdminAuthorization } from '../_shared/adminAuth.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import {
  MOYASAR_API_BASE, MOYASAR_IP_NOT_ALLOWED, basicAuthHeader, buildInvoicePayload, extractMoyasarError,
  invoiceExpiryIso, isAdminTestInvoice, isMoyasarIpNotAllowed, keyMatchesMode, mapMoyasarInvoiceStatus,
  resolveMoyasarConfig, sanitizeMoyasarInvoice,
} from '../_shared/moyasar.ts';
import { MoyasarProxyError, moyasarFetch, moyasarProxyMode } from '../_shared/moyasarHttp.ts';
import {
  retrieveMoyasarInvoice, verifyMoyasarAttempt, type MoyasarAttempt,
} from '../_shared/moyasarVerify.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * payment-test-config — ADMIN-only (verify_jwt=true + is_admin(), role AND AAL2).
 *
 * THE GATE. This function used to test `profile.role !== 'admin'` alone, which
 * admitted an administrator who had not completed TOTP — the same defect fixed
 * in staff-accounts, email-test-config, whatsapp-test-config and push-dispatch
 * on 2026-08-23. It was held back then because CLAUDE.md §6 froze payment code;
 * the owner approved that specific exception on 2026-08-24 (#240).
 *
 * It matters here for a reason worth stating: `verify_order` is not a read. It
 * reaches `verifyMoyasarAttempt`, which can mark a real order paid. It cannot
 * invent a payment — it confirms only on a genuine settled payment retrieved
 * from Moyasar — but an AAL1 caller could still drive payment-state writes on
 * real orders through the service-role client, which bypasses RLS.
 *
 * Moyasar is the only payment provider (owner decision, 2026-11-11), and every
 * action is dispatched to handleMoyasar() AFTER this check, so each inherits
 * role-AND-AAL2 with nothing provider-specific to get right. Removing Tap did
 * not modify the gate itself.
 *
 *   action 'status'               → readiness booleans for the payment config
 *                                   (no secrets).
 *   action 'test_connection'      → validate the SELECTED-mode secret key against
 *                                   Moyasar WITHOUT creating anything, by
 *                                   requesting a non-existent payment id: a valid
 *                                   key is authorized (the API replies !=401), an
 *                                   invalid key returns 401.
 *   action 'verify_order'         → re-verify one order's Moyasar payment.
 *   action 'test_checkout'        → an isolated 1 SAR TEST invoice, linked to no
 *                                   order. This is where sandbox testing happens:
 *                                   payment-initiate refuses customer checkout in
 *                                   TEST mode, so a test card can never pay for a
 *                                   real order.
 *   action 'test_checkout_result' → read that test invoice back (display only).
 * Secret values are never returned; provider errors are sanitized.
 */
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

  let payload: { action?: string; orderId?: string; chargeId?: string; invoiceId?: string };
  try { payload = await req.json(); } catch { payload = {}; }

  const cfg = await getProviderConfig(admin, 'payment');
  const pub = (cfg?.publicConfig ?? {}) as Record<string, unknown>;
  const sec = (cfg?.secretConfig ?? {}) as Record<string, unknown>;
  const mode: 'test' | 'live' = String(pub.mode ?? 'test').toLowerCase() === 'live' ? 'live' : 'test';

  return await handleMoyasar(admin, payload, Boolean(cfg?.enabled), cfg?.providerName ?? null, pub, sec, mode);
});

// ---------------------------------------------------------------------------
// Moyasar admin actions.
//
// No secret value is ever returned, the isolated test invoice is never linked
// to an order, the live mode can never run a test checkout, and 'verify_order'
// can only CONFIRM a genuine paid payment — it can never force an order paid.
// ---------------------------------------------------------------------------
const MOYASAR_TEST_CONNECTION_ID = '00000000-0000-4000-8000-000000000000';

/**
 * What an administrator is told when Moyasar refused a call because of the
 * account's Allowed IPs list. A plain "key rejected" would send them to fix a
 * key that is fine. Which half needs fixing depends on whether MOYASAR_PROXY_URL
 * is set, so the message says.
 */
function ipNotAllowedMessage(mode: 'test' | 'live'): string {
  if (moyasarProxyMode() === 'proxy') {
    return `Moyasar refused the ${mode} key from the proxy in MOYASAR_PROXY_URL: its IP address is not on the account's Allowed IPs list. List every outbound IP of that proxy under Moyasar Dashboard → Settings → API Keys → Allowed IPs.`;
  }
  return `Moyasar refused the ${mode} key from this server's IP address, which is not on the account's Allowed IPs list. Supabase Edge Functions have no static outbound IP: set the MOYASAR_PROXY_URL secret to a static-IP proxy and list the proxy's IPs under Moyasar Dashboard → Settings → API Keys → Allowed IPs.`;
}

/** The admin-facing message for a request that never reached Moyasar. */
function unreachableMessage(e: unknown): string {
  return e instanceof MoyasarProxyError ? e.message : 'Could not reach Moyasar. Please try again.';
}

/**
 * Does this order's newest payment attempt belong to a provider other than
 * Moyasar?
 *
 * `verify_order` is the single manual lever an administrator has to rescue an
 * order that was paid but never confirmed. payment_records still holds the July
 * Tap attempts (none of them paid). For an order whose newest attempt is one of
 * those, "No Moyasar invoice to verify yet" would tell the operator the customer
 * never tried to pay, when the truth is that the attempt belongs to a provider
 * this function can no longer ask. That is worse than saying so.
 */
async function otherProviderAttempt(
  admin: SupabaseClient, orderId: string, configured: string,
): Promise<string | null> {
  const { data } = await admin.from('payment_records')
    .select('provider').eq('order_id', orderId)
    .order('created_at', { ascending: false }).limit(1);
  const row = (Array.isArray(data) ? data[0] : null) as { provider?: string } | null;
  const p = row?.provider ? String(row.provider).toLowerCase() : '';
  return p && p !== configured ? p : null;
}

async function handleMoyasar(
  admin: SupabaseClient,
  payload: { action?: string; orderId?: string; chargeId?: string; invoiceId?: string },
  enabled: boolean,
  providerName: string | null,
  pub: Record<string, unknown>,
  sec: Record<string, unknown>,
  mode: 'test' | 'live',
): Promise<Response> {
  if (payload.action === 'test_connection') {
    const m = resolveMoyasarConfig(enabled, providerName, pub, sec, mode);
    if (!m.secretKey) return json({ ok: false, message: `No ${mode} secret key is configured.` }, 200);
    if (!keyMatchesMode(m.secretKey, mode, 'secret')) {
      // Worth its own message: this is the mistake that charges real cards from a
      // screen labelled TEST, and Moyasar's key prefixes make it detectable.
      return json({
        ok: false,
        message: `The key in the ${mode} slot is not an ${mode === 'live' ? 'sk_live_' : 'sk_test_'} key. Fix the slot before using it.`,
      }, 200);
    }
    try {
      // A harmless authorized GET of a non-existent payment — never creates one.
      const resp = await moyasarFetch(`${MOYASAR_API_BASE}/payments/${MOYASAR_TEST_CONNECTION_ID}`, {
        method: 'GET',
        headers: { Authorization: basicAuthHeader(m.secretKey), 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      if (resp.status === 401) {
        const refusal = await resp.json().catch(() => ({}));
        if (isMoyasarIpNotAllowed(resp.status, refusal)) return json({ ok: false, message: ipNotAllowedMessage(mode) }, 200);
        return json({ ok: false, message: `The ${mode} secret key was rejected by Moyasar (unauthorized).` }, 200);
      }
      if (resp.status === 403) return json({ ok: false, message: `The ${mode} key authenticated but is not permitted to read payments.` }, 200);
      return json({ ok: true, message: `Moyasar accepted the ${mode} key. Connection OK.` }, 200);
    } catch (e) {
      return json({ ok: false, message: unreachableMessage(e) }, 200);
    }
  }

  if (payload.action === 'verify_order') {
    // Admin-triggered re-verification of a specific order. It NEVER force-marks
    // paid: it retrieves the invoice from Moyasar and only confirms on a genuine
    // paid payment, via the same shared, idempotent path the customer flow uses.
    const orderId = String(payload.orderId ?? '');
    if (!orderId) return json({ status: 'error', message: 'orderId is required' }, 200);
    const { data: recs } = await admin.from('payment_records')
      .select('id, order_id, checkout_session_id, provider_ref, provider_checkout_ref, reference_transaction, reference_order, amount, currency, mode, status')
      .eq('order_id', orderId).eq('provider', 'moyasar')
      .order('created_at', { ascending: false }).limit(1);
    const rec = (Array.isArray(recs) ? recs[0] : null) as MoyasarAttempt | null;
    if (!rec || !rec.provider_checkout_ref) {
      const other = await otherProviderAttempt(admin, orderId, 'moyasar');
      if (other) {
        return json({
          status: 'unavailable',
          message: `This order's latest payment attempt went through ${other}, which is no longer supported, so it cannot be verified here.`,
        }, 200);
      }
      return json({ status: 'pending', message: 'No Moyasar invoice to verify yet.' }, 200);
    }

    const m = resolveMoyasarConfig(enabled, providerName, pub, sec, (rec.mode as 'test' | 'live') ?? undefined);
    if (!m.secretKey) return json({ status: 'pending', message: `No ${rec.mode ?? mode} key configured.` }, 200);

    const result = await verifyMoyasarAttempt(admin, rec, m.secretKey);
    if (result.reason === MOYASAR_IP_NOT_ALLOWED) {
      return json({ status: 'pending', message: ipNotAllowedMessage(rec.mode === 'live' ? 'live' : 'test') }, 200);
    }
    if (result.reason === 'test_mode_attempt') {
      return json({ status: 'failed', message: 'This attempt was opened in TEST mode. A test payment never confirms a customer order.' }, 200);
    }
    const outcome = result.paid ? 'paid' : (result.outcome === 'mismatch' ? 'failed' : result.outcome);
    return json({ status: outcome, message: result.messageKey }, 200);
  }

  if (payload.action === 'test_checkout') {
    // Admin-only isolated Moyasar TEST invoice. Creates a 1 SAR sandbox invoice
    // that is NOT linked to any Spicy Meal order — it never touches orders,
    // payment_records, Lazywait, cash, or the mobile flow. Fails closed unless
    // Moyasar is enabled in TEST mode with a valid test key.
    if (!enabled) return json({ ok: false, message: 'Enable Moyasar first.' }, 200);
    // The resolver below is forced to 'moyasar' to pick the TEST key, so the
    // configured provider is checked here, or any enabled row would run it.
    if ((providerName ?? '').toLowerCase() !== 'moyasar') {
      return json({ ok: false, message: "Set the payment provider to 'moyasar' first." }, 200);
    }
    if (mode !== 'test') return json({ ok: false, message: 'Admin test checkout is only available in TEST mode.' }, 200);
    const m = resolveMoyasarConfig(true, 'moyasar', pub, sec, 'test'); // force the TEST key
    if (!m.secretKey) return json({ ok: false, message: 'Test secret key is not set.' }, 200);
    if (!keyMatchesMode(m.secretKey, 'test', 'secret')) {
      return json({ ok: false, message: 'The test slot does not hold an sk_test_ key. Refusing to run.' }, 200);
    }

    const ref = `admin_test_${crypto.randomUUID()}`;
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const body = buildInvoicePayload({
      // Moyasar rejects an invoice below 100 minor units, so 1 SAR is the floor.
      amount: 1,
      currency: 'SAR',
      description: 'Spicy Meal admin Moyasar test checkout',
      referenceTransaction: ref,
      referenceOrder: 'admin_test',
      expiryMinutes: 30,
      successUrl: `${supabaseUrl}/functions/v1/payment-admin-test-return`,
      backUrl: `${supabaseUrl}/functions/v1/payment-admin-test-return`,
      expiresAtIso: invoiceExpiryIso(Date.now(), 30),
      metadata: { purpose: 'admin_test' },
    });
    try {
      const resp = await moyasarFetch(`${MOYASAR_API_BASE}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader(m.secretKey) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await resp.json().catch(() => ({})) as Record<string, unknown>;
      if (!resp.ok) {
        // Surface the real reason to Admin — documented type + message ONLY (no
        // secret, no Authorization header, no raw body).
        const err = extractMoyasarError(result);
        console.error('Moyasar admin test invoice failed', { httpStatus: resp.status, type: err.type });
        return json({
          ok: false,
          message: isMoyasarIpNotAllowed(resp.status, result)
            ? ipNotAllowedMessage('test')
            : 'Moyasar did not accept the test invoice.',
          providerErrorCode: err.type,
          providerErrorDescription: err.message,
          httpStatus: resp.status,
        }, 200);
      }
      const invoiceId = String(result.id ?? '');
      const checkoutUrl = String(result.url ?? '');
      if (!invoiceId || !checkoutUrl) return json({ ok: false, message: 'Moyasar did not return a checkout URL.' }, 200);
      return json({ ok: true, invoiceId, chargeId: invoiceId, checkoutUrl, mode: 'test' }, 200);
    } catch (e) {
      return json({ ok: false, message: unreachableMessage(e) }, 200);
    }
  }

  if (payload.action === 'test_checkout_result') {
    // Verify the admin test invoice server-side. Display ONLY — never confirms an
    // order, never writes payment state. Redirect params are not trusted; the
    // frontend only supplies the invoice id it received on create.
    const invoiceId = String(payload.invoiceId ?? payload.chargeId ?? '');
    if (!invoiceId) return json({ ok: false, message: 'invoiceId is required' }, 200);
    const m = resolveMoyasarConfig(enabled, 'moyasar', pub, sec, 'test'); // TEST key
    if (!m.secretKey) return json({ ok: false, message: 'Test secret key is not set.' }, 200);
    const retrieved = await retrieveMoyasarInvoice(m.secretKey, invoiceId);
    if (!retrieved.ok) {
      return json({
        ok: false,
        message: isMoyasarIpNotAllowed(retrieved.status, retrieved.body)
          ? ipNotAllowedMessage('test')
          : 'Could not retrieve the invoice from Moyasar.',
      }, 200);
    }
    const invoice = retrieved.body;
    // Only ever report the isolated admin test invoice — never a real order's.
    if (!isAdminTestInvoice(invoice)) return json({ ok: false, message: 'That invoice is not an admin test invoice.' }, 200);
    const safe = sanitizeMoyasarInvoice(invoice);
    const { messageKey } = mapMoyasarInvoiceStatus(invoice.status);
    return json({
      ok: true, invoiceId: safe.id, chargeId: safe.id, status: safe.status,
      amount: safe.amount, currency: safe.currency, mode: 'test', messageKey,
    }, 200);
  }

  // Default: status booleans (never any secret values).
  // Moyasar's OWN namespaced names. The payment row can still hold Tap's old
  // `test_secret_key` / `live_secret_key`, because secret_config is merged on
  // save. Reading those meant a correctly configured Moyasar gateway reported
  // "no key" — and, worse, a leftover Tap key is also `sk_test_`-prefixed, so the
  // panel would report Moyasar fully ready, `key_prefix_ok` included, on a
  // credential belonging to a different gateway.
  const testKey = String(sec.moyasar_test_secret_key ?? '').trim();
  const liveKey = String(sec.moyasar_live_secret_key ?? '').trim();
  const activeKey = mode === 'live' ? liveKey : testKey;
  const m = resolveMoyasarConfig(enabled, providerName, pub, sec, mode);
  return json({
    status: 'ok',
    // The configured name, not an assumption: this handler answers for every
    // payment row, and the console reads anything but 'moyasar' as not set up.
    provider: (providerName ?? '').toLowerCase() || null,
    enabled,
    mode,
    currency: m.currency,
    // Tap-shaped fields kept for the staff console, which still reads them and
    // has to keep working against both this function and the July bundle it
    // replaces. Moyasar has no merchant id and no source id, and saying so
    // plainly beats reporting a readiness indicator that means nothing here.
    source_id: 'invoice',
    merchant_id_set: true,
    test_key_set: testKey.length > 0,
    live_key_set: liveKey.length > 0,
    active_key_set: activeKey.length > 0,
    expiry_minutes: m.expiryMinutes,
    // Moyasar-specific readiness.
    webhook_secret_set: m.webhookSecret.length > 0,
    key_prefix_ok: activeKey.length > 0 && keyMatchesMode(activeKey, mode, 'secret'),
    config_ok: m.ok,
    config_reason: m.reason ?? null,
  }, 200);
}
