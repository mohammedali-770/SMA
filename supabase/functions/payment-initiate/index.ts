import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig, type ProviderConfig } from '../_shared/secrets.ts';
import {
  MOYASAR_API_BASE, basicAuthHeader, buildInvoicePayload, customerCheckoutUrl, extractMoyasarError,
  invoiceExpiryForAttempt, isBelowMoyasarMinimum, mapMoyasarInvoiceStatus, resolveMoyasarConfig,
  sanitizeMoyasarInvoice, type CheckoutLanguage,
} from '../_shared/moyasar.ts';
import { moyasarFetch } from '../_shared/moyasarHttp.ts';
import { findInvoiceByReference } from '../_shared/moyasarVerify.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * payment-initiate — the authenticated customer starts paying for an order they
 * already created (place_order left it payment_status='pending').
 *
 * verify_jwt = true: only a signed-in user reaches this. We read the order (or
 * checkout session) through the USER's client so RLS proves ownership and hands
 * us the server-trusted total; the provider secret is read server-side and never
 * returned. Moyasar's hosted invoice is the only payment provider (owner
 * decision, 2026-11-11). A payment row that is missing, disabled or names any
 * other provider answers 200 {status:'disabled'}, which the app already shows as
 * "online payment unavailable".
 *
 * Customer checkout is refused while the gateway is in TEST mode, so a test
 * card can never pay for a real order; see refuseTestModeCheckout(). Sandbox
 * testing is the console's admin test (payment-test-config `test_checkout`).
 *
 * A total under Moyasar's invoice minimum (1.00 SAR) is refused before any
 * attempt is opened; see refuseBelowMinimum().
 *
 * The checkout URL handed to the app is always https on Moyasar's own domain;
 * anything else is refused (customerCheckoutUrl, refuseCheckoutUrl). The app
 * also sends `language` ('ar' or 'en'), which sets that URL's `lang`; the
 * invoice request itself carries no language field.
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
  const lang: CheckoutLanguage = body.language === 'ar' ? 'ar' : 'en';

  const supaUser = userClient(authHeader);

  // New flow: pay for a CHECKOUT SESSION (no order exists yet — it is created
  // only after this payment is verified). RLS scopes the session read to its
  // owner.
  if (sessionId) {
    // OWNERSHIP FIRST. `checkoutSessionId` is raw client input, and everything
    // below it runs on the SERVICE-ROLE client, which bypasses RLS, so no
    // service-role work happens for a session the caller cannot see. (The
    // cross-provider guard that once ran here could close someone else's
    // in-flight attempt; it went with Tap.) initiateMoyasarForSession re-reads
    // the full row through the user's client; this is only the gate.
    const { data: owned } = await supaUser
      .from('checkout_sessions').select('id').eq('id', sessionId).maybeSingle();
    if (!owned) return json({ error: 'Checkout session not found' }, 404);

    const admin0 = adminClient();
    const cfg0 = await getProviderConfig(admin0, 'payment');
    if (!cfg0) return json({ status: 'disabled' }, 200);
    return await initiateMoyasarForSession(admin0, supaUser, sessionId, cfg0, lang);
  }

  // Legacy flow: pay for an already-created order. Read it AS THE USER — RLS
  // returns it only if they own it, and its `total` is the server-computed amount.
  const { data: order, error: orderErr } = await supaUser
    .from('orders')
    // order_number is deliberately NOT selected: nothing in this function may
    // forward the internal SM-… id to the payment provider. The invoice's
    // reference_order comes from the attempt's own opaque ORD-… value
    // (migration 20260724180000).
    .select('id, total, payment_status, payment_method, order_type')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr) return json({ error: orderErr.message }, 400);
  if (!order) return json({ error: 'Order not found' }, 404);
  if (order.payment_status === 'paid') return json({ status: 'already_paid', orderId }, 200);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg) return json({ status: 'disabled' }, 200);
  return await initiateMoyasar(admin, order, cfg, lang);
});

// ---------------------------------------------------------------------------
// Moyasar hosted Invoice checkout.
//
// Moyasar prohibits cardholder data reaching the merchant backend
// (https://docs.moyasar.com/api/authentication), so `POST /v1/payments` with a
// creditcard source is not something this server may do. The hosted checkout is
// `POST /v1/invoices` instead: it returns a hosted checkout `url` on Moyasar's
// own domain, and the card never touches our infrastructure.
//
// Two ids, not one. The invoice id is what we get now and store in
// `provider_checkout_ref`; the payment id only exists once the customer pays and
// is stamped into `provider_ref` at confirmation, so the refund stack and the
// (provider, provider_ref) confirmation idempotency work unchanged.
// ---------------------------------------------------------------------------
const MOYASAR_INVOICES = `${MOYASAR_API_BASE}/invoices`;

/**
 * The hosted page Moyasar returned is not https on Moyasar's own domain, so it
 * is not handed to the app (see customerCheckoutUrl). The log line carries the
 * scheme and host only: the path holds the invoice id.
 */
function refuseCheckoutUrl(raw: unknown, attempt: 'created' | 'reused'): Response {
  let scheme = '';
  let host = 'unparseable';
  try { const u = new URL(String(raw ?? '')); scheme = u.protocol; host = u.hostname; } catch { /* stays unparseable */ }
  console.error(JSON.stringify({ event: 'payment_initiate_refused', reason: 'checkout_url_rejected', attempt, scheme, host }));
  return json({ error: 'Could not start the payment. Please try again.' }, 502);
}

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
    lang: CheckoutLanguage;           // the hosted page's language
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
    const invoiceUrl = String(invoice.url ?? '');
    if (!invoiceId || !invoiceUrl) {
      await admin.from('payment_records').update({
        status: 'failed', failure_code: 'no_invoice_url', raw: sanitizeMoyasarInvoice(invoice),
      }).eq('id', attemptId).then(() => {}, () => {});
      return json({ error: 'Could not start the payment. Please try again.' }, 502);
    }
    // Refused before anything is stored, and the attempt is closed, so the next
    // try opens a fresh invoice instead of reusing a page nobody may be sent to.
    const checkoutUrl = customerCheckoutUrl(invoiceUrl, params.lang);
    if (!checkoutUrl) {
      await admin.from('payment_records').update({
        status: 'failed', failure_code: 'checkout_url_rejected', raw: sanitizeMoyasarInvoice(invoice),
      }).eq('id', attemptId).then(() => {}, () => {});
      return refuseCheckoutUrl(invoiceUrl, 'created');
    }

    // Persist the invoice id BEFORE handing out any checkout URL. The webhook and
    // payment-verify both locate the attempt by provider_checkout_ref, so a URL
    // for an invoice we failed to store would let the customer pay something we
    // can never match back to their order. The URL is stored as Moyasar
    // returned it; the language is the request's, so it is applied on the way out.
    const { error: persistErr } = await admin.from('payment_records').update({
      provider_checkout_ref: invoiceId,
      checkout_url: invoiceUrl,
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

  // NO INVOICE MAY OUTLIVE ITS ATTEMPT. Once the attempt expires,
  // begin_*_attempt closes it and the next start opens a new attempt with a new
  // invoice; an old invoice still payable then would be a second way to pay the
  // same checkout. So the invoice ends with the attempt's own expires_at, which
  // the database set from the same clamped expiry, never at a fresh
  // `Date.now()` window: that ran past the attempt by request latency on a new
  // attempt, and by the attempt's whole age when a reused one's first create had
  // failed (invoiceExpiryForAttempt).
  const { data: attemptRow, error: attemptErr } = await admin.from('payment_records')
    .select('expires_at').eq('id', attemptId).maybeSingle();
  if (attemptErr || !attemptRow) {
    console.error('Moyasar attempt expiry unreadable', String(attemptErr?.message ?? 'no row').slice(0, 200));
    return json({ error: 'Could not start the payment. Please try again.' }, 502);
  }
  const expiresAtIso = invoiceExpiryForAttempt(Date.now(), attemptRow.expires_at, m.expiryMinutes);
  if (!expiresAtIso) {
    // Too little of the attempt is left for anyone to pay inside it. No invoice
    // exists for it (a reused attempt was reconciled just above and none was
    // found), so it is closed, and the next start opens a fresh attempt with a
    // full window of its own.
    await admin.from('payment_records').update({
      status: 'failed', failure_code: 'attempt_expiring', failure_message_safe: 'Payment session expired',
      last_verified_at: new Date().toISOString(),
    }).eq('id', attemptId).eq('status', 'initiated').is('provider_checkout_ref', null).then(() => {}, () => {});
    return json({ error: 'Could not start the payment. Please try again.' }, 502);
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
    expiresAtIso,
  });

  let resp: Response;
  try {
    resp = await moyasarFetch(MOYASAR_INVOICES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader(m.secretKey) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // DELIBERATELY NOT RETRIED. Moyasar documents no idempotency on invoice
    // creation, so a retry could create a second invoice. Reconcile instead.
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

/**
 * A TEST-mode payment must never pay for a real customer's order.
 *
 * Moyasar's sandbox accepts its published test cards, and a paid test invoice
 * confirms through exactly the path a live one takes: the binding (invoice id,
 * amount, currency) matches, because the invoice was opened for that order. So
 * with online payment switched on while the gateway is in TEST mode, anyone
 * holding a public test card number could have a real order marked paid and
 * sent to the kitchen without any money moving. Customer checkout therefore
 * refuses TEST mode outright. Sandbox testing is the console's admin test
 * (payment-test-config `test_checkout`), which never touches an order.
 *
 * Checked twice: against the configured mode before begin_*_attempt opens
 * anything, and against the attempt's STORED mode after it returns, because a
 * reused attempt keeps the mode it was opened in and can predate a switch from
 * test to live.
 *
 * Answers {status:'disabled'}, which the app shows as "Online payment is
 * unavailable right now." (CheckoutScreen.tsx: status 'disabled' →
 * t('payUnavailable')).
 */
function refuseTestModeCheckout(flow: 'order' | 'session', check: 'configured' | 'attempt'): Response {
  console.warn(JSON.stringify({ event: 'payment_initiate_refused', reason: 'test_mode', flow, check }));
  return json({ status: 'disabled', reason: 'test_mode' }, 200);
}

/**
 * A total Moyasar will not invoice can never be paid online.
 *
 * Moyasar refuses an invoice under 1.00 SAR (MOYASAR_MIN_INVOICE_MINOR_UNITS),
 * and redeeming points can leave a remainder of a few halalas. Unrefused, the
 * attempt was opened, the create failed, and every "Try again" failed the same
 * way. So it is refused BEFORE begin_*_attempt, and no attempt exists for it
 * (the database refuses one as well, 20261003120000). It answers with the shape
 * every shipped build already handles, {status:'disabled'}, which they show as
 * "Online payment is unavailable right now."; the reason lets a newer build say
 * what to change instead.
 */
function refuseBelowMinimum(flow: 'order' | 'session'): Response {
  console.warn(JSON.stringify({ event: 'payment_initiate_refused', reason: 'amount_below_minimum', flow }));
  return json({ status: 'disabled', reason: 'amount_below_minimum' }, 200);
}

/**
 * Retire a checkout session whose total is under Moyasar's minimum.
 *
 * Nothing can ever pay it: its total is frozen, no invoice can be opened for
 * it, and no attempt exists. Left 'pending_payment' for its 30 minutes, it is
 * what begin_checkout_session hands back for the same cart's idempotency key,
 * so a customer who takes fewer points is shown the same refused total again,
 * and its points stay reserved against every other session they open
 * (begin_session_attempt's loyalty guard). 'expired' rather than 'cancelled',
 * because finalize_checkout_session accepts an expired session and a captured
 * payment must never be refused, however impossible one is here. Best-effort:
 * if it fails, payment-verify still answers the session terminal.
 */
async function retireUnpayableSession(admin: SupabaseClient, sessionId: string): Promise<void> {
  await admin.from('checkout_sessions').update({ status: 'expired' })
    .eq('id', sessionId).eq('status', 'pending_payment').is('order_id', null)
    .then(() => {}, () => {});
}

async function initiateMoyasar(
  admin: SupabaseClient,
  order: Record<string, unknown>,
  cfg: ProviderConfig,
  lang: CheckoutLanguage,
): Promise<Response> {
  if (String(order.payment_method ?? '') !== 'online') {
    return json({ error: 'This order is not an online-payment order' }, 400);
  }
  const total = Number(order.total ?? 0);
  if (!(total > 0)) return json({ error: 'Order total must be greater than zero' }, 400);
  if (isBelowMoyasarMinimum(total, 'SAR')) return refuseBelowMinimum('order');

  const m = resolveMoyasarConfig(cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig);
  if (!m.ok) {
    // Fail closed. A disabled row, or one naming another provider, is a global
    // state (safe to reveal); everything else — a missing key, a key filed under
    // the wrong mode, a missing webhook secret — is treated the same to the
    // client: online payment simply isn't offered.
    if (m.reason === 'disabled' || m.reason === 'not_moyasar') return json({ status: 'disabled' }, 200);
    console.error('Moyasar config unusable', m.reason);
    return json({ error: 'Online payment is not available' }, 400);
  }
  if (m.mode !== 'live') return refuseTestModeCheckout('order', 'configured');

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
  if (attempt.mode !== 'live') return refuseTestModeCheckout('order', 'attempt');

  // The attempt's stored mode is authoritative from here on — a reused attempt
  // may predate a mode switch. See configForAttempt().
  const mAttempt = configForAttempt(cfg, attempt);
  if (!mAttempt) {
    console.error('Moyasar config unusable for the attempt mode', String(attempt.mode ?? ''));
    return json({ error: 'Online payment is not available' }, 400);
  }

  if (attempt.reused && attempt.checkout_url && attempt.provider_checkout_ref) {
    const checkoutUrl = customerCheckoutUrl(attempt.checkout_url, lang);
    if (!checkoutUrl) return refuseCheckoutUrl(attempt.checkout_url, 'reused');
    return json({
      provider: 'moyasar', mode: mAttempt.mode, invoiceId: attempt.provider_checkout_ref,
      checkoutUrl, expiryMinutes: mAttempt.expiryMinutes,
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
    lang,
  });
}

async function initiateMoyasarForSession(
  admin: SupabaseClient,
  supaUser: SupabaseClient,
  sessionId: string,
  cfg: ProviderConfig,
  lang: CheckoutLanguage,
): Promise<Response> {
  // Read the session AS THE USER — RLS returns it only if they own it; its
  // `total` is the server-computed amount we charge (never a client value).
  const { data: session, error: sErr } = await supaUser
    .from('checkout_sessions')
    .select('id, status, total, currency, order_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (sErr) return json({ error: sErr.message }, 400);
  if (!session) return json({ error: 'Checkout session not found' }, 404);
  if (session.order_id) return json({ status: 'already_paid', orderId: session.order_id }, 200);
  if (session.status !== 'pending_payment') return json({ error: 'This checkout can no longer be paid.' }, 400);

  const total = Number(session.total ?? 0);
  if (!(total > 0)) return json({ error: 'Order total must be greater than zero' }, 400);
  if (isBelowMoyasarMinimum(total, String(session.currency ?? 'SAR'))) {
    await retireUnpayableSession(admin, String(session.id));
    return refuseBelowMinimum('session');
  }

  const m = resolveMoyasarConfig(cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig);
  if (!m.ok) {
    if (m.reason === 'disabled' || m.reason === 'not_moyasar') return json({ status: 'disabled' }, 200);
    console.error('Moyasar config unusable', m.reason);
    return json({ error: 'Online payment is not available' }, 400);
  }
  if (m.mode !== 'live') return refuseTestModeCheckout('session', 'configured');

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
  if (attempt.mode !== 'live') return refuseTestModeCheckout('session', 'attempt');

  const mAttempt = configForAttempt(cfg, attempt);
  if (!mAttempt) {
    console.error('Moyasar config unusable for the attempt mode', String(attempt.mode ?? ''));
    return json({ error: 'Online payment is not available' }, 400);
  }

  if (attempt.reused && attempt.checkout_url && attempt.provider_checkout_ref) {
    const checkoutUrl = customerCheckoutUrl(attempt.checkout_url, lang);
    if (!checkoutUrl) return refuseCheckoutUrl(attempt.checkout_url, 'reused');
    return json({
      provider: 'moyasar', mode: mAttempt.mode, invoiceId: attempt.provider_checkout_ref,
      checkoutUrl, checkoutSessionId: session.id,
      expiryMinutes: mAttempt.expiryMinutes,
    }, 200);
  }

  return await createMoyasarInvoice(admin, mAttempt, attempt, {
    amount: total,
    description: 'Spicy Meal order',
    returnQuery: `session=${encodeURIComponent(String(session.id))}`,
    extra: { checkoutSessionId: session.id },
    lang,
  });
}
