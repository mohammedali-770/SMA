import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig, type ProviderConfig } from '../_shared/secrets.ts';
import { createSessionSignature, formatAmount, geideaApiBase, geideaHppBase } from '../_shared/geidea.ts';
import {
  buildTapChargePayload, resolveTapConfig, normalizeSaudiPhone, mapTapStatus, sanitizeTapResponse,
} from '../_shared/tap.ts';
import {
  MOYASAR_API_BASE, basicAuthHeader, buildInvoicePayload, decideCrossProviderAttempt,
  extractMoyasarError, invoiceExpiryIso, mapMoyasarInvoiceStatus, resolveMoyasarConfig,
  sanitizeMoyasarInvoice, type LiveAttempt,
} from '../_shared/moyasar.ts';
import { findInvoiceByReference } from '../_shared/moyasarVerify.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * payment-initiate — the authenticated customer starts paying for an order they
 * already created (place_order left it payment_status='pending').
 *
 * verify_jwt = true: only a signed-in user reaches this. We read the order
 * through the USER's client so RLS proves ownership and hands us the server-
 * trusted total; the provider secret is read server-side and never returned. The
 * active provider is selected by integration_settings('payment').provider_name —
 * 'tap' (Tap Hosted Checkout), 'moyasar' (Moyasar hosted Invoice), or the
 * pre-existing 'geidea' scaffold. Each provider is a separate branch; adding
 * Moyasar changed no Tap code path.
 */
const TAP_CHARGES = 'https://api.tap.company/v2/charges';

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
  const lang: 'ar' | 'en' = String(body.language ?? 'en').toLowerCase() === 'ar' ? 'ar' : 'en';

  const supaUser = userClient(authHeader);

  // New flow: pay for a CHECKOUT SESSION (no order exists yet — it is created
  // only after this charge is verified). Tap-only. RLS scopes the session read to
  // its owner.
  if (sessionId) {
    const admin0 = adminClient();
    const cfg0 = await getProviderConfig(admin0, 'payment');
    const sessionProvider = (cfg0?.providerName ?? '').toLowerCase();
    const blocked0 = await guardCrossProviderAttempt(admin0, 'checkout_session_id', sessionId, sessionProvider);
    if (blocked0) return blocked0;
    if (sessionProvider === 'tap') return await initiateTapForSession(admin0, supaUser, sessionId, cfg0!, lang);
    if (sessionProvider === 'moyasar') return await initiateMoyasarForSession(admin0, supaUser, sessionId, cfg0!, lang);
    return json({ error: 'Online payment is not enabled' }, 400);
  }

  // Legacy flow: pay for an already-created order. Read it AS THE USER — RLS
  // returns it only if they own it, and its `total` is the server-computed amount.
  const { data: order, error: orderErr } = await supaUser
    .from('orders')
    // order_number is deliberately NOT selected: nothing in this function may
    // forward the internal SM-… id to Tap. reference.order comes from the
    // attempt's own opaque ORD-… value (migration 20260724180000).
    .select('id, total, payment_status, payment_method, order_type, customer_name, customer_phone')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr) return json({ error: orderErr.message }, 400);
  if (!order) return json({ error: 'Order not found' }, 404);
  if (order.payment_status === 'paid') return json({ status: 'already_paid', orderId }, 200);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  const providerName = (cfg?.providerName ?? '').toLowerCase();

  // Refuse to open a second payable checkout on an order that already has a live
  // attempt at a DIFFERENT gateway — see decideCrossProviderAttempt().
  const blocked = await guardCrossProviderAttempt(admin, 'order_id', String(order.id), providerName);
  if (blocked) return blocked;

  if (providerName === 'tap') return await initiateTap(admin, supaUser, order, cfg!, lang);
  if (providerName === 'moyasar') return await initiateMoyasar(admin, order, cfg!);
  if (providerName === 'geidea') return await initiateGeidea(admin, order, cfg!);
  return json({ error: 'Online payment is not enabled' }, 400);
});

/**
 * Enforce ONE live checkout per order/session across ALL providers.
 *
 * The database guard is provider-scoped ((order_id, provider)), so it cannot see
 * this case; and it cannot be widened without redefining the frozen Tap RPCs.
 * This is the one place that knows about every gateway, so the check lives here.
 *
 * Returns a Response when the caller must stop, or null to continue.
 */
async function guardCrossProviderAttempt(
  admin: SupabaseClient,
  column: 'order_id' | 'checkout_session_id',
  value: string,
  wantedProvider: string,
): Promise<Response | null> {
  if (!value || !wantedProvider) return null;
  const { data } = await admin.from('payment_records')
    .select('id, provider, provider_ref, provider_checkout_ref')
    .eq(column, value).eq('status', 'initiated')
    .order('created_at', { ascending: false }).limit(1);
  const existing = (Array.isArray(data) ? data[0] : null) as LiveAttempt | null;

  const decision = decideCrossProviderAttempt(existing, wantedProvider);
  if (decision.action === 'proceed') return null;

  if (decision.action === 'close_stale') {
    // Nothing was ever created at the other gateway, so nothing is payable there.
    await admin.from('payment_records').update({
      status: 'failed',
      failure_code: 'provider_switched',
      failure_message_safe: 'The payment provider changed before checkout started.',
    }).eq('id', decision.attemptId).eq('status', 'initiated').then(() => {}, () => {});
    return null;
  }

  // A checkout page at the other gateway is live and payable. We cannot close it
  // from here, and opening a second one is how a customer gets charged twice for
  // one order — with only one of the two charges refundable.
  console.error('refusing a second checkout: a live attempt exists at another provider', JSON.stringify({
    other: decision.provider, wanted: wantedProvider,
  }));
  await admin.from('integration_sync_logs').insert({
    provider: decision.provider, order_id: column === 'order_id' ? value : null,
    direction: 'push', status: 'skipped',
    request: { action: 'initiate' }, error: 'cross_provider_attempt_open',
  }).then(() => {}, () => {});
  return json({
    error: 'A payment for this order is already in progress. Please finish it, or wait for it to expire before trying again.',
  }, 409);
}

// ---------------------------------------------------------------------------
// Tap Hosted Checkout
// ---------------------------------------------------------------------------
async function initiateTap(
  admin: SupabaseClient,
  supaUser: SupabaseClient,
  order: Record<string, unknown>,
  cfg: ProviderConfig,
  lang: 'ar' | 'en',
): Promise<Response> {
  if (String(order.payment_method ?? '') !== 'online') {
    return json({ error: 'This order is not an online-payment order' }, 400);
  }
  const total = Number(order.total ?? 0);
  if (!(total > 0)) return json({ error: 'Order total must be greater than zero' }, 400);

  const tap = resolveTapConfig(cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig);
  if (!tap.ok) {
    // Fail closed. 'disabled' is a global state (safe to reveal); a missing key is
    // treated the same to the client — online payment simply isn't offered.
    if (tap.reason === 'disabled') return json({ status: 'disabled' }, 200);
    return json({ error: 'Online payment is not available' }, 400);
  }

  // Atomic open-or-reuse of THE single active attempt for this order (DB-level
  // double-charge guard). A reused attempt that already has a checkout URL is
  // returned as-is — no second Tap charge is ever created.
  const { data: rows, error: beginErr } = await admin.rpc('tap_begin_payment_attempt', {
    p_order_id: order.id, p_mode: tap.mode, p_expiry_minutes: tap.expiryMinutes,
  });
  if (beginErr) {
    console.error('tap_begin_payment_attempt failed', String(beginErr.message ?? '').slice(0, 200));
    return json({ error: 'Could not start the payment. Please try again.' }, 400);
  }
  const attempt = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;
  // tap_begin_payment_attempt returns the payment_records id as `attempt_id`
  // (NOT `id`). Guard it explicitly: a missing id here previously slipped through
  // as `.eq('id', undefined)` → Postgres "invalid input syntax for type uuid" →
  // the charge was created at Tap but never persisted, surfacing as the generic
  // "Could not start the payment" while leaving the record stuck 'initiated'.
  if (!attempt || !attempt.attempt_id) {
    console.error('tap_begin_payment_attempt returned no attempt_id');
    return json({ error: 'Could not start the payment. Please try again.' }, 400);
  }

  if (attempt.reused && attempt.checkout_url && attempt.provider_ref) {
    return json({
      provider: 'tap', mode: tap.mode, chargeId: attempt.provider_ref,
      checkoutUrl: attempt.checkout_url, expiryMinutes: tap.expiryMinutes,
    }, 200);
  }

  // Build the charge. Customer email comes from the authenticated session; phone
  // from the order snapshot; both optional and only sent when valid.
  const { data: { user } } = await supaUser.auth.getUser();
  const fullName = String(order.customer_name ?? '').trim();
  const [firstName, ...rest] = fullName.split(/\s+/).filter(Boolean);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const payload = buildTapChargePayload({
    amount: total,
    currency: tap.currency,
    descriptor: tap.descriptor,
    // CUSTOMER-SAFE. Tap documents `description` only as "an arbitrary string
    // which you can attach to a Charge request with more details" and does NOT
    // state that it stays internal, so it must be assumed visible on the hosted
    // payment page / receipt. It is NOT one of the bound fields
    // validateAndConfirmTapCharge compares, and NOT part of the webhook
    // hashstring (chargeHashFields), so neutralizing it cannot weaken
    // verification. The binding stays on referenceOrder below, UNCHANGED.
    description: 'Spicy Meal order',
    referenceTransaction: String(attempt.reference_transaction ?? ''),
    referenceOrder: String(attempt.reference_order ?? ''),
    idempotent: String(attempt.reference_transaction ?? ''),
    sourceId: tap.sourceId,
    merchantId: tap.merchantId,
    expiryMinutes: tap.expiryMinutes,
    langCode: lang,
    postUrl: `${supabaseUrl}/functions/v1/payment-webhook`,
    redirectUrl: `${supabaseUrl}/functions/v1/payment-return?order=${encodeURIComponent(String(order.id))}`,
    customer: {
      firstName: firstName ?? 'Customer',
      lastName: rest.join(' ') || '-',
      email: user?.email ?? null,
      phone: normalizeSaudiPhone(order.customer_phone),
    },
  });

  // Create the charge. A transient network blip (DNS / connect reset / timeout)
  // shouldn't fail the whole checkout, so retry once. Retrying is double-charge
  // safe: the payload carries the same `idempotent` reference_transaction, so Tap
  // returns the SAME charge instead of creating a second one.
  let result: Record<string, unknown> = {};
  let resp: Response | null = null;
  for (let attemptNo = 1; attemptNo <= 2; attemptNo++) {
    try {
      resp = await fetch(TAP_CHARGES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tap.secretKey}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      break; // got an HTTP response (ok or not) — stop retrying
    } catch (e) {
      console.error(`Tap charge request error (attempt ${attemptNo}/2)`, e instanceof Error ? e.message : 'error');
      if (attemptNo < 2) await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (!resp) {
    // Still couldn't reach Tap after the retry. Annotate the attempt so the
    // failure is visible instead of a bare 'initiated' record — but KEEP the
    // status 'initiated' so tap_begin_payment_attempt reuses this same attempt
    // (and its idempotent reference) on the next "Try Again", preserving the
    // double-charge guard.
    await admin.from('payment_records').update({
      failure_code: 'network_unreachable',
      failure_message_safe: 'Could not reach the payment provider.',
      last_verified_at: new Date().toISOString(),
    }).eq('id', attempt.attempt_id).then(() => {}, () => {});
    return json({ error: 'Could not reach the payment provider. Please try again.' }, 502);
  }

  result = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('Tap charge create failed', resp.status);
    await admin.from('payment_records').update({
      status: 'failed', failure_code: `create_${resp.status}`, failure_message_safe: 'Could not start payment.',
      raw: sanitizeTapResponse(result),
    }).eq('id', attempt.attempt_id).then(() => {}, () => {});
    return json({ error: 'Could not start the payment. Please try again.' }, 502);
  }

  const chargeId = String(result.id ?? '');
  const transaction = (result.transaction ?? {}) as Record<string, unknown>;
  const checkoutUrl = String(transaction.url ?? '');
  const { outcome } = mapTapStatus(result.status);

  if (!chargeId) {
    await admin.from('payment_records').update({ status: 'failed', failure_code: 'no_charge_id', raw: sanitizeTapResponse(result) })
      .eq('id', attempt.attempt_id).then(() => {}, () => {});
    return json({ error: 'Could not start the payment. Please try again.' }, 502);
  }

  // Persist the charge id BEFORE returning any checkout URL. The webhook and
  // payment-verify both key off provider_ref, so handing the customer a URL for a
  // charge we failed to store would let them pay a charge we can never match. If
  // this write fails we return a retryable error instead: the charge already
  // exists at Tap, and a retry reuses THIS attempt + the same `idempotent` string,
  // so Tap returns the SAME charge (never a second one) and we persist it then.
  const { error: persistErr } = await admin.from('payment_records').update({
    provider_ref: chargeId, checkout_url: checkoutUrl || null, raw: sanitizeTapResponse(result),
    last_verified_at: new Date().toISOString(),
    // Clear any prior 'network_unreachable' breadcrumb now that the charge exists.
    failure_code: null, failure_message_safe: null,
  }).eq('id', attempt.attempt_id);
  if (persistErr) {
    console.error('Tap charge persist failed', String(persistErr.message ?? '').slice(0, 200));
    return json({ error: 'Could not start the payment. Please try again.' }, 502);
  }

  if (outcome === 'pending' && checkoutUrl) {
    return json({
      provider: 'tap', mode: tap.mode, chargeId, checkoutUrl,
      expiryMinutes: tap.expiryMinutes,
    }, 200);
  }
  // CAPTURED-at-create (rare for hosted 3DS) or any other state → let the app run
  // the server verify path, which retrieves + confirms authoritatively.
  return json({
    provider: 'tap', mode: tap.mode, chargeId, checkoutUrl: checkoutUrl || null,
    needsVerify: true,
  }, 200);
}

// ---------------------------------------------------------------------------
// Tap Hosted Checkout for a CHECKOUT SESSION. The order does NOT exist yet — it
// is created only after this charge is verified (webhook / payment-verify →
// finalize_checkout_session). Mirrors initiateTap but keyed on the session.
// ---------------------------------------------------------------------------
async function initiateTapForSession(
  admin: SupabaseClient,
  supaUser: SupabaseClient,
  sessionId: string,
  cfg: ProviderConfig,
  lang: 'ar' | 'en',
): Promise<Response> {
  // Read the session AS THE USER — RLS returns it only if they own it; its
  // `total` is the server-computed amount we charge (never a client value).
  const { data: session, error: sErr } = await supaUser
    .from('checkout_sessions')
    .select('id, status, total, currency, order_id, snapshot')
    .eq('id', sessionId)
    .maybeSingle();
  if (sErr) return json({ error: sErr.message }, 400);
  if (!session) return json({ error: 'Checkout session not found' }, 404);
  if (session.order_id) return json({ status: 'already_paid', orderId: session.order_id }, 200);
  if (session.status !== 'pending_payment') return json({ error: 'This checkout can no longer be paid.' }, 400);

  const total = Number(session.total ?? 0);
  if (!(total > 0)) return json({ error: 'Order total must be greater than zero' }, 400);

  const tap = resolveTapConfig(cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig);
  if (!tap.ok) {
    if (tap.reason === 'disabled') return json({ status: 'disabled' }, 200);
    return json({ error: 'Online payment is not available' }, 400);
  }

  const { data: rows, error: beginErr } = await admin.rpc('tap_begin_session_attempt', {
    p_session_id: session.id, p_mode: tap.mode, p_expiry_minutes: tap.expiryMinutes,
  });
  if (beginErr) {
    console.error('tap_begin_session_attempt failed', String(beginErr.message ?? '').slice(0, 200));
    return json({ error: 'Could not start the payment. Please try again.' }, 400);
  }
  const attempt = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;
  if (!attempt || !attempt.attempt_id) {
    console.error('tap_begin_session_attempt returned no attempt_id');
    return json({ error: 'Could not start the payment. Please try again.' }, 400);
  }

  if (attempt.reused && attempt.checkout_url && attempt.provider_ref) {
    return json({
      provider: 'tap', mode: tap.mode, chargeId: attempt.provider_ref,
      checkoutUrl: attempt.checkout_url, checkoutSessionId: session.id, expiryMinutes: tap.expiryMinutes,
    }, 200);
  }

  const snap = (session.snapshot ?? {}) as Record<string, unknown>;
  const { data: { user } } = await supaUser.auth.getUser();
  const fullName = String(snap.customer_name ?? '').trim();
  const [firstName, ...rest] = fullName.split(/\s+/).filter(Boolean);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const payload = buildTapChargePayload({
    amount: total,
    currency: tap.currency,
    descriptor: tap.descriptor,
    description: `Spicy Meal checkout ${String(attempt.reference_order ?? '')}`,
    referenceTransaction: String(attempt.reference_transaction ?? ''),
    referenceOrder: String(attempt.reference_order ?? ''),
    idempotent: String(attempt.reference_transaction ?? ''),
    sourceId: tap.sourceId,
    merchantId: tap.merchantId,
    expiryMinutes: tap.expiryMinutes,
    langCode: lang,
    postUrl: `${supabaseUrl}/functions/v1/payment-webhook`,
    redirectUrl: `${supabaseUrl}/functions/v1/payment-return?session=${encodeURIComponent(String(session.id))}`,
    customer: {
      firstName: firstName ?? 'Customer',
      lastName: rest.join(' ') || '-',
      email: user?.email ?? null,
      phone: normalizeSaudiPhone(snap.customer_phone),
    },
  });

  let result: Record<string, unknown> = {};
  let resp: Response | null = null;
  for (let attemptNo = 1; attemptNo <= 2; attemptNo++) {
    try {
      resp = await fetch(TAP_CHARGES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tap.secretKey}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      break;
    } catch (e) {
      console.error(`Tap session charge request error (attempt ${attemptNo}/2)`, e instanceof Error ? e.message : 'error');
      if (attemptNo < 2) await new Promise((r) => setTimeout(r, 600));
    }
  }
  if (!resp) {
    await admin.from('payment_records').update({
      failure_code: 'network_unreachable', failure_message_safe: 'Could not reach the payment provider.',
      last_verified_at: new Date().toISOString(),
    }).eq('id', attempt.attempt_id).then(() => {}, () => {});
    return json({ error: 'Could not reach the payment provider. Please try again.' }, 502);
  }
  result = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('Tap session charge create failed', resp.status);
    await admin.from('payment_records').update({
      status: 'failed', failure_code: `create_${resp.status}`, failure_message_safe: 'Could not start payment.',
      raw: sanitizeTapResponse(result),
    }).eq('id', attempt.attempt_id).then(() => {}, () => {});
    return json({ error: 'Could not start the payment. Please try again.' }, 502);
  }

  const chargeId = String(result.id ?? '');
  const transaction = (result.transaction ?? {}) as Record<string, unknown>;
  const checkoutUrl = String(transaction.url ?? '');
  const { outcome } = mapTapStatus(result.status);
  if (!chargeId) {
    await admin.from('payment_records').update({ status: 'failed', failure_code: 'no_charge_id', raw: sanitizeTapResponse(result) })
      .eq('id', attempt.attempt_id).then(() => {}, () => {});
    return json({ error: 'Could not start the payment. Please try again.' }, 502);
  }

  const { error: persistErr } = await admin.from('payment_records').update({
    provider_ref: chargeId, checkout_url: checkoutUrl || null, raw: sanitizeTapResponse(result),
    last_verified_at: new Date().toISOString(), failure_code: null, failure_message_safe: null,
  }).eq('id', attempt.attempt_id);
  if (persistErr) {
    console.error('Tap session charge persist failed', String(persistErr.message ?? '').slice(0, 200));
    return json({ error: 'Could not start the payment. Please try again.' }, 502);
  }

  if (outcome === 'pending' && checkoutUrl) {
    return json({
      provider: 'tap', mode: tap.mode, chargeId, checkoutUrl,
      checkoutSessionId: session.id, expiryMinutes: tap.expiryMinutes,
    }, 200);
  }
  return json({
    provider: 'tap', mode: tap.mode, chargeId, checkoutUrl: checkoutUrl || null,
    checkoutSessionId: session.id, needsVerify: true,
  }, 200);
}

// ---------------------------------------------------------------------------
// Moyasar hosted Invoice checkout.
//
// Moyasar prohibits cardholder data reaching the merchant backend
// (https://docs.moyasar.com/api/authentication), so `POST /v1/payments` with a
// creditcard source is not something this server may do. The equivalent of Tap's
// hosted charge is `POST /v1/invoices`: it returns a hosted checkout `url` on
// Moyasar's own domain, and the card never touches our infrastructure.
//
// Two ids, not one. The invoice id is what we get now and store in
// `provider_checkout_ref`; the payment id only exists once the customer pays and
// is stamped into `provider_ref` at confirmation, so the refund stack and the
// (provider, provider_ref) confirmation idempotency work unchanged.
// ---------------------------------------------------------------------------
const MOYASAR_INVOICES = `${MOYASAR_API_BASE}/invoices`;

/** Shared invoice-create + persist step for both the order and session flows. */
async function createMoyasarInvoice(
  admin: SupabaseClient,
  m: ReturnType<typeof resolveMoyasarConfig>,
  attempt: Record<string, unknown>,
  params: {
    amount: number;
    description: string;
    returnQuery: string;              // e.g. `order=<uuid>` or `session=<uuid>`
    extra: Record<string, unknown>;   // extra fields echoed back to the client
  },
): Promise<Response> {
  const attemptId = attempt.attempt_id;
  const referenceTransaction = String(attempt.reference_transaction ?? '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';

  // CHARGE IN THE CURRENCY THE ATTEMPT WAS OPENED IN, not the configured one.
  //
  // The attempt row is the single source of truth for verification:
  // checkPaymentBinding compares the settled payment's currency against
  // `payment_records.currency`. Building the invoice from `m.currency` instead
  // would let an administrator who sets a non-SAR currency in the payment card
  // create an invoice the binding then rejects — a customer charged, and an
  // order that never confirms, from a single settings field.
  //
  // The attempt's currency is also the one the order was actually priced in
  // (`orders.total` is SAR-denominated), so this is the correct amount as well
  // as the verifiable one. A configured value that disagrees is a
  // misconfiguration; it is surfaced rather than silently honoured.
  const attemptCurrency = String(attempt.currency ?? 'SAR').toUpperCase() || 'SAR';
  if (attemptCurrency !== m.currency) {
    console.warn('Moyasar configured currency ignored in favour of the attempt currency', JSON.stringify({
      configured: m.currency, attempt: attemptCurrency,
    }));
  }

  const persistAndReturn = async (invoice: Record<string, unknown>): Promise<Response> => {
    const invoiceId = String(invoice.id ?? '');
    const checkoutUrl = String(invoice.url ?? '');
    if (!invoiceId || !checkoutUrl) {
      await admin.from('payment_records').update({
        status: 'failed', failure_code: 'no_invoice_url', raw: sanitizeMoyasarInvoice(invoice),
      }).eq('id', attemptId).then(() => {}, () => {});
      return json({ error: 'Could not start the payment. Please try again.' }, 502);
    }

    // Persist the invoice id BEFORE handing out any checkout URL. The webhook and
    // payment-verify both locate the attempt by provider_checkout_ref, so a URL
    // for an invoice we failed to store would let the customer pay something we
    // can never match back to their order.
    const { error: persistErr } = await admin.from('payment_records').update({
      provider_checkout_ref: invoiceId,
      checkout_url: checkoutUrl,
      raw: sanitizeMoyasarInvoice(invoice),
      last_verified_at: new Date().toISOString(),
      failure_code: null,
      failure_message_safe: null,
    }).eq('id', attemptId);
    if (persistErr) {
      console.error('Moyasar invoice persist failed', String(persistErr.message ?? '').slice(0, 200));
      // The invoice exists at Moyasar. A retry reuses THIS attempt, whose
      // reference_transaction is already in that invoice's metadata, so the
      // reconciliation lookup below will adopt it rather than create a second one.
      return json({ error: 'Could not start the payment. Please try again.' }, 502);
    }

    const { outcome } = mapMoyasarInvoiceStatus(invoice.status);
    return json({
      provider: 'moyasar', mode: m.mode, invoiceId, checkoutUrl,
      expiryMinutes: m.expiryMinutes,
      ...(outcome === 'pending' ? {} : { needsVerify: true }),
      ...params.extra,
    }, 200);
  };

  // A reused attempt with no stored invoice means an EARLIER create left us
  // uncertain. Reconcile before creating anything: Moyasar documents no
  // idempotency on invoice creation, so a blind retry could open a second
  // invoice for the same order (see findInvoiceByReference).
  if (attempt.reused === true && !attempt.provider_checkout_ref) {
    const found = await findInvoiceByReference(m.secretKey, referenceTransaction);
    if (found.ok && found.invoice) return await persistAndReturn(found.invoice);
    if (!found.ok) {
      // We could not establish whether an invoice already exists. Creating one
      // now risks a duplicate, so refuse and let the customer try again — the
      // next attempt re-runs this same lookup.
      await admin.from('payment_records').update({
        failure_code: 'reconcile_unavailable',
        failure_message_safe: 'Could not reach the payment provider.',
        last_verified_at: new Date().toISOString(),
      }).eq('id', attemptId).then(() => {}, () => {});
      return json({ error: 'Could not reach the payment provider. Please try again.' }, 502);
    }
    // found.ok && !found.invoice: Moyasar positively reports no such invoice, so
    // creating one now is safe.
  }

  const payload = buildInvoicePayload({
    amount: params.amount,
    currency: attemptCurrency,
    description: params.description,
    referenceTransaction,
    referenceOrder: String(attempt.reference_order ?? ''),
    expiryMinutes: m.expiryMinutes,
    successUrl: `${supabaseUrl}/functions/v1/payment-return?${params.returnQuery}`,
    backUrl: `${supabaseUrl}/functions/v1/payment-return?${params.returnQuery}`,
    expiresAtIso: invoiceExpiryIso(Date.now(), m.expiryMinutes),
  });

  let resp: Response;
  try {
    resp = await fetch(MOYASAR_INVOICES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader(m.secretKey) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // DELIBERATELY NOT RETRIED. The Tap path retries because its payload carries
    // an idempotency reference; this one has none, so a retry could create a
    // second invoice. Reconcile instead.
    console.error('Moyasar invoice request error', e instanceof Error ? e.message : 'error');
    const found = await findInvoiceByReference(m.secretKey, referenceTransaction);
    if (found.ok && found.invoice) return await persistAndReturn(found.invoice);
    await admin.from('payment_records').update({
      failure_code: 'network_unreachable',
      failure_message_safe: 'Could not reach the payment provider.',
      last_verified_at: new Date().toISOString(),
    }).eq('id', attemptId).then(() => {}, () => {});
    return json({ error: 'Could not reach the payment provider. Please try again.' }, 502);
  }

  const result = await resp.json().catch(() => ({})) as Record<string, unknown>;
  if (!resp.ok) {
    const err = extractMoyasarError(result);
    console.error('Moyasar invoice create failed', { httpStatus: resp.status, type: err.type });
    await admin.from('payment_records').update({
      status: 'failed', failure_code: `create_${resp.status}`,
      failure_message_safe: 'Could not start payment.',
      raw: sanitizeMoyasarInvoice(result),
    }).eq('id', attemptId).then(() => {}, () => {});
    return json({ error: 'Could not start the payment. Please try again.' }, 502);
  }

  return await persistAndReturn(result);
}

/**
 * Re-resolve the config for the mode the ATTEMPT is actually stored under.
 *
 * `begin_payment_attempt` / `begin_session_attempt` ignore `p_mode` when they
 * reuse a live attempt — they return the row's existing `mode`. So after an
 * administrator flips test↔live, a reused attempt still belongs to the OLD
 * mode, and creating its invoice with the newly configured key would put a live
 * invoice id on a row stamped `mode='test'`. Verification then resolves its key
 * from the row (payment-verify and payment-webhook both do), looks the invoice
 * up in the wrong key namespace, 404s, and returns 'pending' forever — a real
 * card charged against an order that can never confirm.
 *
 * Moyasar's test and live spaces are disjoint, so the only key that can ever
 * verify this attempt is the one for its own stored mode. Use that key to
 * create it too. Returns null when that mode has no usable credentials.
 */
function configForAttempt(
  cfg: ProviderConfig, attempt: Record<string, unknown>,
): ReturnType<typeof resolveMoyasarConfig> | null {
  const attemptMode = attempt.mode === 'live' ? 'live' : attempt.mode === 'test' ? 'test' : undefined;
  const resolved = resolveMoyasarConfig(
    cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig, attemptMode,
  );
  return resolved.ok ? resolved : null;
}

async function initiateMoyasar(
  admin: SupabaseClient,
  order: Record<string, unknown>,
  cfg: ProviderConfig,
): Promise<Response> {
  if (String(order.payment_method ?? '') !== 'online') {
    return json({ error: 'This order is not an online-payment order' }, 400);
  }
  const total = Number(order.total ?? 0);
  if (!(total > 0)) return json({ error: 'Order total must be greater than zero' }, 400);

  const m = resolveMoyasarConfig(cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig);
  if (!m.ok) {
    // Fail closed. 'disabled' is a global state (safe to reveal); everything else
    // — a missing key, a key filed under the wrong mode, a missing webhook secret
    // — is treated the same to the client: online payment simply isn't offered.
    if (m.reason === 'disabled') return json({ status: 'disabled' }, 200);
    console.error('Moyasar config unusable', m.reason);
    return json({ error: 'Online payment is not available' }, 400);
  }

  const { data: rows, error: beginErr } = await admin.rpc('begin_payment_attempt', {
    p_order_id: order.id, p_provider: 'moyasar', p_mode: m.mode, p_expiry_minutes: m.expiryMinutes,
  });
  if (beginErr) {
    console.error('begin_payment_attempt failed', String(beginErr.message ?? '').slice(0, 200));
    return json({ error: 'Could not start the payment. Please try again.' }, 400);
  }
  const attempt = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;
  if (!attempt || !attempt.attempt_id) {
    console.error('begin_payment_attempt returned no attempt_id');
    return json({ error: 'Could not start the payment. Please try again.' }, 400);
  }

  // The attempt's stored mode is authoritative from here on — a reused attempt
  // may predate a mode switch. See configForAttempt().
  const mAttempt = configForAttempt(cfg, attempt);
  if (!mAttempt) {
    console.error('Moyasar config unusable for the attempt mode', String(attempt.mode ?? ''));
    return json({ error: 'Online payment is not available' }, 400);
  }

  if (attempt.reused && attempt.checkout_url && attempt.provider_checkout_ref) {
    return json({
      provider: 'moyasar', mode: mAttempt.mode, invoiceId: attempt.provider_checkout_ref,
      checkoutUrl: attempt.checkout_url, expiryMinutes: mAttempt.expiryMinutes,
    }, 200);
  }

  return await createMoyasarInvoice(admin, mAttempt, attempt, {
    amount: total,
    // CUSTOMER-SAFE. Moyasar renders `description` on the hosted checkout page,
    // so it must never carry the internal SM-… order number (Issue #94). The
    // verification binding is payment.invoice_id, not this string.
    description: 'Spicy Meal order',
    returnQuery: `order=${encodeURIComponent(String(order.id))}`,
    extra: {},
  });
}

async function initiateMoyasarForSession(
  admin: SupabaseClient,
  supaUser: SupabaseClient,
  sessionId: string,
  cfg: ProviderConfig,
  _lang: 'ar' | 'en',
): Promise<Response> {
  // Read the session AS THE USER — RLS returns it only if they own it; its
  // `total` is the server-computed amount we charge (never a client value).
  const { data: session, error: sErr } = await supaUser
    .from('checkout_sessions')
    .select('id, status, total, currency, order_id, snapshot')
    .eq('id', sessionId)
    .maybeSingle();
  if (sErr) return json({ error: sErr.message }, 400);
  if (!session) return json({ error: 'Checkout session not found' }, 404);
  if (session.order_id) return json({ status: 'already_paid', orderId: session.order_id }, 200);
  if (session.status !== 'pending_payment') return json({ error: 'This checkout can no longer be paid.' }, 400);

  const total = Number(session.total ?? 0);
  if (!(total > 0)) return json({ error: 'Order total must be greater than zero' }, 400);

  const m = resolveMoyasarConfig(cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig);
  if (!m.ok) {
    if (m.reason === 'disabled') return json({ status: 'disabled' }, 200);
    console.error('Moyasar config unusable', m.reason);
    return json({ error: 'Online payment is not available' }, 400);
  }

  const { data: rows, error: beginErr } = await admin.rpc('begin_session_attempt', {
    p_session_id: session.id, p_provider: 'moyasar', p_mode: m.mode, p_expiry_minutes: m.expiryMinutes,
  });
  if (beginErr) {
    console.error('begin_session_attempt failed', String(beginErr.message ?? '').slice(0, 200));
    return json({ error: 'Could not start the payment. Please try again.' }, 400);
  }
  const attempt = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;
  if (!attempt || !attempt.attempt_id) {
    console.error('begin_session_attempt returned no attempt_id');
    return json({ error: 'Could not start the payment. Please try again.' }, 400);
  }

  const mAttempt = configForAttempt(cfg, attempt);
  if (!mAttempt) {
    console.error('Moyasar config unusable for the attempt mode', String(attempt.mode ?? ''));
    return json({ error: 'Online payment is not available' }, 400);
  }

  if (attempt.reused && attempt.checkout_url && attempt.provider_checkout_ref) {
    return json({
      provider: 'moyasar', mode: mAttempt.mode, invoiceId: attempt.provider_checkout_ref,
      checkoutUrl: attempt.checkout_url, checkoutSessionId: session.id,
      expiryMinutes: mAttempt.expiryMinutes,
    }, 200);
  }

  return await createMoyasarInvoice(admin, mAttempt, attempt, {
    amount: total,
    description: 'Spicy Meal order',
    returnQuery: `session=${encodeURIComponent(String(session.id))}`,
    extra: { checkoutSessionId: session.id },
  });
}

// ---------------------------------------------------------------------------
// Geidea (pre-existing scaffold — retained, dormant; selected only when
// provider_name='geidea'). Unchanged behavior.
// ---------------------------------------------------------------------------
async function initiateGeidea(
  admin: SupabaseClient, order: Record<string, unknown>, cfg: ProviderConfig,
): Promise<Response> {
  if (!cfg.enabled) return json({ error: 'Online payment is not enabled' }, 400);
  const publicKey = String(cfg.secretConfig.publicKey ?? '');
  const apiPassword = String(cfg.secretConfig.apiPassword ?? '');
  if (!publicKey || !apiPassword) return json({ error: 'Geidea credentials are not set' }, 500);

  const currency = String(cfg.publicConfig.currency ?? 'SAR');
  const amount = formatAmount(Number(order.total));
  const timestamp = new Date().toISOString();
  const merchantReferenceId = String(order.id);
  const signature = await createSessionSignature({ publicKey, amount, currency, merchantReferenceId, timestamp, apiPassword });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const callbackUrl = `${supabaseUrl}/functions/v1/payment-webhook`;
  const returnUrl = String(cfg.publicConfig.returnUrl ?? '') || callbackUrl;

  let result: Record<string, unknown> = {};
  try {
    const resp = await fetch(`${geideaApiBase(cfg.publicConfig)}/payment-intent/api/v2/direct/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${publicKey}:${apiPassword}`)}` },
      body: JSON.stringify({ amount: Number(amount), currency, timestamp, merchantReferenceId, callbackUrl, returnUrl, signature }),
    });
    result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('Geidea session creation failed', resp.status, JSON.stringify(result).slice(0, 500));
      return json({ error: 'Geidea session creation failed', status: resp.status }, 502);
    }
  } catch (e) {
    console.error('Geidea request failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'Geidea request failed' }, 502);
  }

  const session = (result.session ?? result) as Record<string, unknown>;
  const sessionId = String(session.id ?? result.sessionId ?? '');
  if (!sessionId) {
    console.error('Geidea returned no session id', JSON.stringify(result).slice(0, 500));
    return json({ error: 'Geidea did not return a session id' }, 502);
  }

  await admin.from('payment_records').insert({
    order_id: order.id, provider: 'geidea', provider_ref: sessionId, status: 'initiated',
    amount: Number(order.total), currency, raw: result,
  });

  return json({
    sessionId,
    checkoutUrl: `${geideaHppBase(cfg.publicConfig)}/hpp/checkout/?${sessionId}`,
  });
}
