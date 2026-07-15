// account-delete-request — authenticated customer requests deletion of their OWN
// account (verify_jwt=true). Two actions:
//   { action: 'send_otp', language }         → sends an OTP to the REGISTERED phone
//   { action: 'submit', method, code|password } → re-verifies identity, then
//                                                 idempotently enqueues the request
//
// Security:
//  - The user id ALWAYS comes from the verified JWT (auth.getUser), never the body.
//  - OTP is sent only to the account's registered phone (server-derived) with a
//    dedicated 'account_deletion' purpose — the customer cannot enter another number.
//  - The reauth fallback re-checks the password server-side; the password is never
//    logged or stored.
//  - Creation is idempotent (returns an existing active request); a client can
//    never mark a request completed/failed/manual_review (no such grant).
//  - Raw errors are never returned; only safe codes/generic messages.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { normalizePhoneE164, hashOtp, timingSafeEqual } from '../_shared/whatsapp.ts';
import { getOtpPepper, sendOtpViaWhatsApp, type Language } from '../_shared/whatsappSend.ts';

const OTP_PURPOSE = 'account_deletion';
const GENERIC_FAIL = 'We could not verify your identity. Please try again.';

function lang(v: unknown): Language {
  return v === 'ar' ? 'ar' : 'en';
}

/** Verify an 'account_deletion' OTP for a specific (server-derived) phone. */
async function verifyDeletionOtp(admin: ReturnType<typeof adminClient>, e164: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const pepper = await getOtpPepper(admin);
  if (!pepper) return false;
  const { data: rows } = await admin.rpc('otp_get_active_challenge', {
    p_phone: e164, p_purpose: OTP_PURPOSE, p_channel: 'whatsapp',
  });
  const ch = Array.isArray(rows) ? rows[0] : rows;
  if (!ch) return false;
  if (new Date(ch.expires_at).getTime() < Date.now()) return false;
  if (Number(ch.attempt_count) >= Number(ch.max_attempts)) return false;
  const candidate = await hashOtp(pepper, e164, OTP_PURPOSE, code, ch.otp_salt ?? '');
  if (!timingSafeEqual(candidate, String(ch.otp_hash))) {
    await admin.rpc('otp_increment_attempt', { p_id: ch.id });
    return false;
  }
  await admin.rpc('otp_consume', { p_id: ch.id }); // single-use
  return true;
}

/** Re-check the account password without persisting a session. Never logs it. */
async function verifyPassword(email: string, password: string): Promise<boolean> {
  if (!email || !password) return false;
  try {
    const { data, error } = await userClient(null).auth.signInWithPassword({ email, password });
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Authentication required' }, 401);

  // Identity is the verified JWT — never a client-supplied id.
  const { data: { user } } = await userClient(authHeader).auth.getUser();
  if (!user) return json({ error: 'Authentication required' }, 401);

  let body: { action?: string; method?: string; code?: string; password?: string; language?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }

  const admin = adminClient();

  // The account's registered phone/email — server-derived, authoritative.
  const { data: profile } = await admin
    .from('profiles').select('phone_number, email').eq('id', user.id).maybeSingle();
  const norm = normalizePhoneE164(profile?.phone_number ?? user.phone ?? null);
  const email = String(profile?.email ?? user.email ?? '');

  // ---- action: send_otp --------------------------------------------------
  if (body.action === 'send_otp') {
    if (!norm.ok) return json({ status: 'no_phone' }, 200); // no phone → client uses reauth
    const outcome = await sendOtpViaWhatsApp(admin, norm.e164, OTP_PURPOSE, lang(body.language));
    // outcome: 'sent' | 'disabled' | 'rate_limited' | 'error' — own phone, no enumeration risk.
    return json({ status: outcome }, 200);
  }

  // ---- action: submit ----------------------------------------------------
  if (body.action === 'submit') {
    // Idempotency: if an active request already exists, return it WITHOUT
    // requiring re-verification again (repeated taps / existing pending request).
    const { data: existing } = await admin
      .from('account_deletion_requests')
      .select('id, status')
      .eq('user_id', user.id)
      .in('status', ['queued', 'waiting_for_active_order', 'waiting_for_financial_process', 'processing', 'retry_scheduled', 'manual_review'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return json({ status: existing.status, requestId: existing.id, existing: true }, 200);

    const method = body.method === 'reauth' ? 'reauth' : body.method === 'otp' ? 'otp' : null;
    if (!method) return json({ error: 'verification required', code: 'verification_required' }, 400);

    let verified = false;
    if (method === 'otp') {
      verified = norm.ok ? await verifyDeletionOtp(admin, norm.e164, String(body.code ?? '').trim()) : false;
    } else {
      verified = await verifyPassword(email, String(body.password ?? ''));
    }
    if (!verified) return json({ verified: false, code: 'verification_failed', message: GENERIC_FAIL }, 200);

    // Verified → idempotently enqueue (user id from the JWT, not the body).
    const { data: created, error } = await admin.rpc('create_account_deletion_request', {
      p_user_id: user.id, p_method: method,
    });
    if (error || !created) return json({ error: 'request_failed', code: 'request_failed' }, 500);
    const row = Array.isArray(created) ? created[0] : created;

    // Best-effort: kick the processor so a no-blocker request completes promptly.
    // Failure here never fails the request (the processor also runs on schedule).
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const fnBase = Deno.env.get('SUPABASE_URL');
    if (serviceKey && fnBase) {
      const kick = fetch(`${fnBase}/functions/v1/account-delete-process`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'post_create' }),
      }).catch(() => { /* ignore — scheduled processor will pick it up */ });
      // Fire-and-forget without blocking the response.
      try { (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(kick); } catch { /* ignore */ }
    }

    return json({ status: row?.status ?? 'queued', requestId: row?.id ?? null, verified: true }, 200);
  }

  return json({ error: 'Unknown action' }, 400);
});
