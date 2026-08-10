// whatsapp-send-otp — signed-in customer phone-ownership verification send.
// Gateway verify_jwt=true is necessary but NOT sufficient because the public anon
// JWT is also a valid Supabase JWT. The handler resolves auth.getUser() and binds
// the requested phone to auth.users.phone before any Meta send can occur.
// REAL login OTP delivery uses auth-send-sms-whatsapp, not this endpoint.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
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

  // Prove this bearer represents a signed-in user, not merely the bundled anon
  // key. No Meta/provider work occurs before this check succeeds.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);
  const { data: { user }, error: userError } = await userClient(authHeader).auth.getUser();
  if (userError || !user) return json({ error: 'Unauthorized' }, 401);

  let payload: { phone?: string; purpose?: string; language?: string };
  try { payload = await req.json(); } catch { return json({ status: 'ok', message: GENERIC }, 200); }

  // This legacy endpoint no longer accepts login/signup purposes. Those belong
  // to the Supabase Auth hook, which owns the real login OTP/session lifecycle.
  const purpose = String(payload.purpose ?? 'phone_verification');
  if (purpose !== 'phone_verification') return json({ status: 'ok', message: GENERIC }, 200);

  const requested = normalizeSaudiPhoneE164(payload.phone);
  const owned = normalizeSaudiPhoneE164(user.phone ?? null);
  const language: Language = payload.language === 'ar' ? 'ar' : 'en';

  // Ownership binding is AUTH-owned, never profile-owned. The profile phone is
  // customer-editable legacy data in older migrations and must not authorize a
  // send. Keep mismatch generic so this endpoint does not become an oracle.
  if (!requested.ok || !owned.ok || requested.e164 !== owned.e164) {
    return json({ status: 'ok', message: GENERIC }, 200);
  }

  const admin = adminClient();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const ipHash = ip ? await sha256Hex(ip) : null;

  try {
    const outcome = await sendOtpViaWhatsApp(admin, requested.e164, 'phone_verification', language, { ipHash });
    if (outcome === 'disabled') {
      return json({ status: 'disabled', message: 'WhatsApp verification is not available right now.' }, 200);
    }
    return json({ status: 'ok', message: GENERIC }, 200);
  } catch {
    return json({ status: 'ok', message: GENERIC }, 200);
  }
});
