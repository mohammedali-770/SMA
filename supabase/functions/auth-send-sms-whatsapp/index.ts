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

  // 6) Deliver Supabase's OTP over WhatsApp. Success → 200 {}; anything else →
  //    an error so Supabase surfaces "couldn't send the code".
  const outcome = await deliverOtpTemplate(admin, cfg, norm.e164, parsed.data.otp, 'auth_login');
  if (outcome !== 'sent') return hookError(502, 'Failed to deliver the verification code');

  return hookOk();
});
