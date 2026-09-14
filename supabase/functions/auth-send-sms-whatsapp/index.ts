// auth-send-sms-whatsapp — Supabase Auth **Send SMS Hook** (verify_jwt=false).
//
// This is the delivery leg of the REAL customer login:
//   app → supabase.auth.signInWithOtp({ phone })   (Supabase Auth generates OTP)
//       → Supabase Auth calls THIS hook (Standard Webhooks signed)
//       → we send Supabase's OTP over the Meta WhatsApp Cloud API auth template
//   app → supabase.auth.verifyOtp({ phone, token, type:'sms' })  → real session
//
// Supabase Auth is the SOLE login authority. This function issues no session,
// generates no code, and stores no `otp_challenges` row — it only *delivers* the
// code Supabase already generated. It NEVER logs the OTP or the Meta access
// token, and it fails CLOSED (login can't proceed) when WhatsApp login is not
// fully configured + enabled.
//
// Supabase reads the response to decide success/failure:
//   success → 200 `{}`
//   failure → 200 `{ "error": { "http_code": <n>, "message": "..." } }`
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { normalizeSaudiPhoneE164 } from '../_shared/whatsapp.ts';
import { resolveWhatsAppConfig, deliverOtpTemplate, type Language } from '../_shared/whatsappSend.ts';
import { verifyStandardWebhook, parseSendSmsHookPayload } from '../_shared/authHook.ts';

function hookError(httpCode: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
function hookOk(): Response {
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function pickLanguage(pub: Record<string, unknown> | undefined): Language {
  return String(pub?.otp_default_language ?? '').toLowerCase() === 'ar' ? 'ar' : 'en';
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return hookError(405, 'Method not allowed');

  const raw = await req.text();
  const admin = adminClient();

  // Read provider config once (used for the hook secret, the login flag, and
  // the default language). Missing/erroring config → fail closed below.
  let providerCfg;
  try { providerCfg = await getProviderConfig(admin, 'whatsapp'); } catch { providerCfg = null; }
  const secretConfig = (providerCfg?.secretConfig ?? {}) as Record<string, unknown>;
  const publicConfig = (providerCfg?.publicConfig ?? {}) as Record<string, unknown>;

  // 1) Hook secret: prefer the Deno env (Supabase's own convention for hooks),
  //    else the admin-managed secret_config.send_sms_hook_secret. No secret →
  //    fail closed: an unsigned/mis-signed call must never deliver an OTP.
  const secret = Deno.env.get('SEND_SMS_HOOK_SECRET')
    || String(secretConfig.send_sms_hook_secret ?? '');
  if (!secret) return hookError(500, 'WhatsApp login hook is not configured');

  // 2) Verify the Standard Webhooks signature (proves the call is from our
  //    Supabase Auth). Reject anything that doesn't verify.
  const verified = await verifyStandardWebhook(secret, req.headers, raw);
  if (!verified.ok) return hookError(401, 'Invalid signature');

  // 3) Parse the official payload → { phone, otp } (the OTP is Supabase's).
  const parsed = parseSendSmsHookPayload(raw);
  if (!parsed.ok) return hookError(400, 'Invalid hook payload');
  // Saudi-only: login is restricted to KSA mobiles (+9665XXXXXXXX). This is the
  // authoritative check — the app validates too, but a client can be bypassed,
  // so a non-Saudi number never gets a code delivered.
  const norm = normalizeSaudiPhoneE164(parsed.data.phone);
  if (!norm.ok) return hookError(400, 'Enter a Saudi mobile number (+9665XXXXXXXX)');

  // 4) Login must be explicitly enabled by the admin (separate from the
  //    provider master switch and from the phone-verification feature).
  if (publicConfig.whatsapp_login_enabled !== true) {
    return hookError(503, 'WhatsApp login is temporarily unavailable');
  }

  // 5) Resolve the WhatsApp send config (requires provider enabled + Meta creds
  //    + an approved template). Missing → fail closed so login can't succeed
  //    without a delivered code.
  const cfg = await resolveWhatsAppConfig(admin, pickLanguage(publicConfig));
  if (!cfg) return hookError(503, 'WhatsApp login is temporarily unavailable');

  // 6) RESERVE a send before delivering. This path calls deliverOtpTemplate
  //    directly — the raw sender, which does no limiting — so without this the
  //    only throttle on real customer login is Supabase Auth's project-wide SMS
  //    cap, which is dashboard state and not verifiable from here. Every attempt
  //    is a billable Meta authentication-template message.
  //
  //    A reservation, not a check. The budget is consumed BEFORE the send, under
  //    a per-phone advisory lock, because a post-send counter lets every request
  //    in a concurrent burst read the same empty history and all pass — which is
  //    precisely the abuse this exists to stop.
  //
  //    It cannot reuse the challenge path: otp_begin_send also writes an
  //    `otp_challenges` row holding a hashed OTP, and here Supabase Auth is the
  //    sole OTP authority — minting a second code would let verification match a
  //    code the customer was never sent. Both functions now share one budget
  //    through `otp_send_reservations`.
  //
  //    IT FAILS CLOSED ON AN RPC ERROR. It used to fail open, on the reasoning
  //    that "a limiter that cannot be reached must not become an outage of the
  //    entire login system". That reasoning does not survive looking at where
  //    this call sits: `resolveWhatsAppConfig` at step 5 just read
  //    `integration_settings` through this same admin client and returned 503 if
  //    it could not. So by the time control reaches here, Postgres is reachable
  //    — the general-outage case the old comment feared has already been handled
  //    upstream, and failing open here bought availability that was not actually
  //    at risk.
  //
  //    What `gateErr` really means is that something specific is wrong with the
  //    limiter itself: a missing function, a revoked grant, a signature change.
  //    In that state the correct answer is to stop, because this reservation is
  //    the ONLY per-phone throttle on a live, billable Meta channel — the 2026-09-13
  //    audit's finding 1.4. An attacker who can induce one RPC error would
  //    otherwise have removed rate limiting from the customer login path
  //    entirely, which is a worse outage than a login pause and an invisible one.
  const { data: gateRows, error: gateErr } = await admin.rpc('otp_reserve_send', {
    p_phone: norm.e164,
    p_purpose: 'auth_login',
    p_cooldown_seconds: cfg.cooldownSeconds,
    p_max_per_hour: cfg.maxPerHour,
    p_max_per_day: cfg.maxPerDay,
  });
  if (gateErr) {
    // Distinct from the 503s above so an operator reading logs can tell "the
    // limiter is broken" apart from "WhatsApp login is switched off". The
    // message stays generic for the customer.
    console.error('otp_reserve_send failed; refusing to deliver unthrottled', {
      code: gateErr.code ?? null,
      message: gateErr.message ?? null,
    });
    return hookError(503, 'Verification is temporarily unavailable. Please try again shortly.');
  }
  const gate = Array.isArray(gateRows) ? gateRows[0] : gateRows;
  // 429 so Supabase surfaces rate limiting rather than a delivery fault. The
  // reason is NOT echoed: 'cooldown' vs 'daily_limit' would tell an enumerator
  // how much traffic a given number has already had.
  if (gate && gate.allowed === false) {
    return hookError(429, 'Too many verification codes requested. Please wait and try again.');
  }

  // 7) Deliver Supabase's OTP over WhatsApp. Success → 200 {}; anything else →
  //    an error so Supabase surfaces "couldn't send the code".
  const outcome = await deliverOtpTemplate(admin, cfg, norm.e164, parsed.data.otp, 'auth_login');
  if (outcome !== 'sent') {
    // Hand the budget back. A Meta outage would otherwise burn every customer's
    // daily quota while delivering nothing. Best-effort: a failed release costs
    // one slot, never correctness, so it must not mask the delivery error.
    if (gate?.reservation_id) {
      await admin.rpc('otp_release_send', { p_reservation_id: gate.reservation_id });
    }
    return hookError(502, 'Failed to deliver the verification code');
  }

  return hookOk();
});
