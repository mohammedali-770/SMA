// whatsapp-send-otp — signed-in customer phone-verification send.
// Supabase gateway requires a valid user JWT (config.toml verify_jwt=true).
// REAL login OTP delivery uses auth-send-sms-whatsapp, not this endpoint.
// Rate-limited + generic responses server-side (anti-enumeration). Never logs
// the OTP or the WhatsApp token. Returns {status:'disabled'} only for the GLOBAL
// unconfigured/off state (safe to reveal); otherwise a generic success.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { normalizeSaudiPhoneE164 } from '../_shared/whatsapp.ts';
import { sendOtpViaWhatsApp, type Language } from '../_shared/whatsappSend.ts';

const GENERIC = 'If this phone number is valid, a verification code will be sent.';

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let payload: { phone?: string; purpose?: string; language?: string };
  try { payload = await req.json(); } catch { return json({ status: 'ok', message: GENERIC }, 200); }

  // This legacy endpoint no longer accepts login/signup purposes. Those belong
  // to the Supabase Auth hook, which owns the real login OTP/session lifecycle.
  const purpose = String(payload.purpose ?? 'phone_verification');
  if (purpose !== 'phone_verification') {
    return json({ status: 'ok', message: GENERIC }, 200);
  }

  // Saudi-only, like the profile verification UI: +9665XXXXXXXX.
  const norm = normalizeSaudiPhoneE164(payload.phone);
  const language: Language = payload.language === 'ar' ? 'ar' : 'en';

  // Invalid phone → still generic (don't reveal validity), but nothing is sent.
  if (!norm.ok) return json({ status: 'ok', message: GENERIC }, 200);

  const admin = adminClient();
  // Hash the caller IP for a coarse abuse signal (never store the raw IP).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const ipHash = ip ? await sha256Hex(ip) : null;

  try {
    const outcome = await sendOtpViaWhatsApp(admin, norm.e164, 'phone_verification', language, { ipHash });
    if (outcome === 'disabled') {
      return json({ status: 'disabled', message: 'WhatsApp verification is not available right now.' }, 200);
    }
    // sent / rate_limited / error all return the SAME generic success.
    return json({ status: 'ok', message: GENERIC }, 200);
  } catch {
    return json({ status: 'ok', message: GENERIC }, 200);
  }
});
