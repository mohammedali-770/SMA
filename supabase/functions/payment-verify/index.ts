import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig, type ProviderConfig } from '../_shared/secrets.ts';
import {
  DUPLICATE_PAYMENT, NOT_A_DUPLICATE_FILTER, SESSION_TERMINAL_STATUSES, decideSessionVerify,
  isSessionLive, olderInvoiceVerdict, resolveMoyasarConfig, verifyAnswerStatus,
} from '../_shared/moyasar.ts';
import { verifyMoyasarAttempt, type MoyasarAttempt } from '../_shared/moyasarVerify.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * payment-verify — the app calls this after returning from Moyasar's hosted
 * checkout. It is the ONLY thing the app trusts: it retrieves the invoice and its
 * payment server-to-server and confirms the order paid only on a clean success.
 * The redirect params the app saw are never trusted — Moyasar's redirect appends
 * only an unsigned `id`, and Moyasar's own guide requires this server-side fetch
 * before fulfilling an order. verify_jwt = true and the order is read via the
 * user's RLS, so a customer can only ever verify their OWN order.
 *
 * The secret key is chosen by the STORED attempt's mode (not the current Admin
 * mode), so flipping Admin test↔live never breaks verification of older attempts.
 * Only Moyasar attempts are looked up. Idempotent: repeated calls converge on a
 * single confirmation.
 *
 * A checkout session that never got a usable invoice is answered TERMINAL
 * ('expired' or 'cancelled'), never 'pending' for ever: see decideSessionVerify.
 * That decision needs no key, so it is made before the payment configuration is
 * read, and a missing or disabled payment row cannot keep a dead session alive.
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
  // paid payment. Return its id so the app can open the receipt.
  if (sessionId) return await verifySession(supaUser, admin, sessionId);

  // Legacy order flow: verify an already-created order. No shipped build calls
  // it; it keeps 'pending' for an order with no invoice, as it always has.
  // NOTE: order_number (the internal SM-… id) is deliberately neither selected
  // nor returned. The app opens the receipt by orderId and renders only the
  // branch's own number once Lazywait issues one (Issue #94).
  const { data: order, error: orderErr } = await supaUser
    .from('orders').select('id, payment_status').eq('id', orderId).maybeSingle();
  if (orderErr) return json({ error: orderErr.message }, 400);
  if (!order) return json({ error: 'Order not found' }, 404);
  if (order.payment_status === 'paid') return json({ status: 'paid', orderId }, 200);

  // An explicit guard, not an assertion: with no payment row there is no key to
  // verify with, and the app keeps polling 'pending' rather than seeing a crash.
  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg) return json({ status: 'pending' }, 200);
  return await verifyMoyasarOrder(supaUser, admin, cfg, orderId);
});

/**
 * Verify the Moyasar payment tied to a CHECKOUT SESSION. On a clean `paid`,
 * validateAndConfirmMoyasarPayment → finalize_checkout_session creates the real
 * order; we return its id so the app opens the receipt. Never trusts the app.
 *
 * THE ATTEMPT IS READ BEFORE THE CONFIGURATION. Whether this session can still
 * be paid at all is decided from the session and its newest Moyasar attempt
 * (decideSessionVerify); only an attempt that carries an invoice needs a key,
 * because only then is there anything to ask Moyasar. Nothing here writes the
 * session.
 *
 * BEFORE ANY ANSWER THAT LETS THE APP DROP THE SESSION, THE OLDER INVOICES ARE
 * ASKED TOO (olderInvoiceVerdict). The newest attempt is not the only thing
 * that can pay a session: an expired attempt keeps its invoice, and a payment
 * made on it in time can settle late. Likewise while the newest attempt has no
 * invoice yet, since there is then nothing newer to ask.
 */
type VerifyBody = Record<string, unknown> & { status: string };

async function verifySession(supaUser: SupabaseClient, admin: SupabaseClient, sessionId: string): Promise<Response> {
  const { data: session, error: sErr } = await supaUser
    .from('checkout_sessions').select('id, status, order_id, expires_at').eq('id', sessionId).maybeSingle();
  if (sErr) return json({ error: sErr.message }, 400);
  if (!session) return json({ error: 'Checkout session not found' }, 404);
  if (session.order_id) {
    return json({ status: 'paid', orderId: session.order_id }, 200);
  }

  const latest = await latestMoyasarAttempt(admin, 'checkout_session_id', sessionId);
  // A failed read is not "no attempt": that would answer terminal and let the
  // app drop a session whose invoice may be paid.
  if (!latest.ok) return json({ status: 'pending' }, 200);

  const nowMs = Date.now();
  const verdict = decideSessionVerify({
    sessionStatus: session.status,
    sessionExpiresAt: session.expires_at,
    attempt: latest.rec,
    nowMs,
  });

  let primary: VerifyBody;
  if (verdict.kind === 'terminal') {
    primary = { status: verdict.status, messageKey: verdict.messageKey, orderId: null };
  } else if (verdict.kind === 'pending' || !latest.rec) {
    primary = { status: 'pending' };
  } else {
    const cfg = await getProviderConfig(admin, 'payment');
    primary = cfg
      ? await verifyMoyasarSession(supaUser, admin, cfg, sessionId, latest.rec)
      : { status: 'pending' };
  }

  if (SESSION_TERMINAL_STATUSES.has(primary.status) || verdict.kind === 'pending') {
    const older = await askOlderInvoices(
      supaUser, admin, sessionId, latest.rec?.id ?? null,
      isSessionLive(session.status, session.expires_at, nowMs),
    );
    if (older) return json(older, 200);
  }
  return json(primary, 200);
}

/** How many older invoices are asked; a session rarely holds more than two. */
const OLDER_INVOICE_LIMIT = 5;

/**
 * Ask the session's OLDER invoice-carrying attempts, newest first. Answers
 * 'paid' or 'pending' when one of them says so (olderInvoiceVerdict), else
 * null and the newest attempt's answer stands. With no configuration or no key
 * nothing can be asked, and nothing else could confirm such a payment either
 * (the webhook needs the same key), so the answer stands then too.
 */
async function askOlderInvoices(
  supaUser: SupabaseClient, admin: SupabaseClient, sessionId: string, excludeId: string | null,
  sessionLive: boolean,
): Promise<VerifyBody | null> {
  let q = admin.from('payment_records')
    .select(moyasarSelect())
    .eq('checkout_session_id', sessionId).eq('provider', 'moyasar')
    .not('provider_checkout_ref', 'is', null)
    .or(NOT_A_DUPLICATE_FILTER);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(OLDER_INVOICE_LIMIT);
  // Unknown is not "none": keep the session while it can still be paid.
  if (error) return sessionLive ? { status: 'pending' } : null;
  const recs = (Array.isArray(data) ? data : []) as unknown as MoyasarAttempt[];
  if (recs.length === 0) return null;

  const cfg = await getProviderConfig(admin, 'payment');
  if (!cfg) return null;

  for (const rec of recs) {
    const m = resolveMoyasarConfig(
      cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig,
      (rec.mode as 'test' | 'live') ?? undefined,
    );
    if (!m.secretKey) continue;
    const result = await verifyMoyasarAttempt(admin, rec, m.secretKey);
    if (result.reason === DUPLICATE_PAYMENT) {
      // Paid nothing itself; the session's own state is the answer if it is paid.
      const { data: s2 } = await supaUser.from('checkout_sessions').select('order_id').eq('id', sessionId).maybeSingle();
      if (s2?.order_id) return { status: 'paid', orderId: s2.order_id };
      continue;
    }
    const v = olderInvoiceVerdict(result, sessionLive);
    if (v === 'paid') {
      let orderId = result.orderId ?? '';
      if (!orderId) {
        const { data: s2 } = await supaUser.from('checkout_sessions').select('order_id').eq('id', sessionId).maybeSingle();
        orderId = String(s2?.order_id ?? '');
      }
      return { status: 'paid', messageKey: result.messageKey, orderId: orderId || null };
    }
    if (v === 'pending') return { status: 'pending' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Moyasar verification.
//
// The attempt's STORED mode picks the secret key (so flipping Admin test<->live
// never breaks verification of an older attempt), Moyasar is asked directly,
// and confirmation runs through the shared idempotent RPCs. A transient failure
// returns 'pending' so the app retries rather than showing a customer a failure
// that did not happen.
// ---------------------------------------------------------------------------
function moyasarSelect(): string {
  return 'id, order_id, checkout_session_id, provider_ref, provider_checkout_ref, reference_transaction, reference_order, amount, currency, mode, status';
}

/**
 * The newest Moyasar ATTEMPT. A recorded duplicate payment is a row too, but it
 * is a refund record rather than an attempt, and it carries no invoice: taken
 * as the newest attempt it would hide the one whose payment is still being
 * confirmed (NOT_A_DUPLICATE_FILTER). `ok: false` means the read failed.
 */
async function latestMoyasarAttempt(
  admin: SupabaseClient, column: 'order_id' | 'checkout_session_id', value: string,
): Promise<{ ok: boolean; rec: MoyasarAttempt | null }> {
  const { data, error } = await admin.from('payment_records')
    .select(moyasarSelect())
    .eq(column, value).eq('provider', 'moyasar')
    .or(NOT_A_DUPLICATE_FILTER)
    .order('created_at', { ascending: false }).limit(1);
  if (error) return { ok: false, rec: null };
  return { ok: true, rec: (Array.isArray(data) ? data[0] ?? null : null) as MoyasarAttempt | null };
}

async function verifyMoyasarOrder(
  supaUser: SupabaseClient, admin: SupabaseClient, cfg: ProviderConfig, orderId: string,
): Promise<Response> {
  const { rec } = await latestMoyasarAttempt(admin, 'order_id', orderId);
  if (!rec || !rec.provider_checkout_ref) return json({ status: 'pending' }, 200);

  const m = resolveMoyasarConfig(
    cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig,
    (rec.mode as 'test' | 'live') ?? undefined,
  );
  if (!m.secretKey) return json({ status: 'pending' }, 200);

  const result = await verifyMoyasarAttempt(admin, rec, m.secretKey);
  if (result.reason === DUPLICATE_PAYMENT) {
    // The payment found did not pay this order; the order's own state answers.
    const { data: o2 } = await supaUser.from('orders').select('payment_status').eq('id', orderId).maybeSingle();
    return json(o2?.payment_status === 'paid' ? { status: 'paid', orderId } : { status: 'pending' }, 200);
  }
  const outcome = verifyAnswerStatus(result.outcome, result.paid);
  return json({ status: outcome, messageKey: result.messageKey, orderId }, 200);
}

async function verifyMoyasarSession(
  supaUser: SupabaseClient, admin: SupabaseClient, cfg: ProviderConfig, sessionId: string, rec: MoyasarAttempt,
): Promise<VerifyBody> {
  const m = resolveMoyasarConfig(
    cfg.enabled, cfg.providerName, cfg.publicConfig, cfg.secretConfig,
    (rec.mode as 'test' | 'live') ?? undefined,
  );
  if (!m.secretKey) return { status: 'pending' };

  const result = await verifyMoyasarAttempt(admin, rec, m.secretKey);
  if (result.reason === DUPLICATE_PAYMENT) {
    // This payment paid nothing: the session was, or is being, paid by another.
    // The session's own state is the customer's answer, exactly as when it is
    // read first above; never 'failed', which would drop a paid checkout.
    const { data: s2 } = await supaUser.from('checkout_sessions').select('order_id').eq('id', sessionId).maybeSingle();
    return s2?.order_id ? { status: 'paid', orderId: s2.order_id } : { status: 'pending' };
  }
  // Never 'refunded' (verifyAnswerStatus): a shipped build would not let go.
  const outcome = verifyAnswerStatus(result.outcome, result.paid);

  let outOrderId = result.orderId ?? '';
  if (outcome === 'paid' && !outOrderId) {
    const { data: s2 } = await supaUser.from('checkout_sessions').select('order_id').eq('id', sessionId).maybeSingle();
    outOrderId = String(s2?.order_id ?? '');
  }
  return { status: outcome, messageKey: result.messageKey, orderId: outOrderId || null };
}
