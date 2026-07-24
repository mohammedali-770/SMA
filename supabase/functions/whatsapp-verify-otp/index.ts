// whatsapp-verify-otp — verify a submitted code (verify_jwt=false; optional
// Authorization). On success marks the SIGNED-IN user's profile phone_verified
// (via a service-role RPC); it never issues a login session and never fakes one.
// Always returns a generic failure message. Never logs the OTP.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { normalizeSaudiPhoneE164, hashOtp, timingSafeEqual } from '../_shared/whatsapp.ts';
import { getOtpPepper } from '../_shared/whatsappSend.ts';

const GENERIC_FAIL = 'Invalid or expired verification code.';
const VALID_PURPOSES = new Set(['login', 'signup', 'phone_verification', 'passwordless_login']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let payload: { phone?: string; code?: string; purpose?: string };
  try { payload = await req.json(); } catch { return json({ verified: false, message: GENERIC_FAIL }, 200); }

  // Must normalize exactly like whatsapp-send-otp, or the challenge lookup misses.
  const norm = normalizeSaudiPhoneE164(payload.phone);
  const code = String(payload.code ?? '').trim();
  const purpose = VALID_PURPOSES.has(String(payload.purpose)) ? String(payload.purpose) : 'phone_verification';
  if (!norm.ok || !/^\d{6}$/.test(code)) return json({ verified: false, message: GENERIC_FAIL }, 200);

  const admin = adminClient();
  try {
    const pepper = await getOtpPepper(admin);
    if (!pepper) return json({ verified: false, message: GENERIC_FAIL }, 200);

    const { data: rows } = await admin.rpc('otp_get_active_challenge', {
      p_phone: norm.e164, p_purpose: purpose, p_channel: 'whatsapp',
    });
    const ch = Array.isArray(rows) ? rows[0] : rows;
    if (!ch) return json({ verified: false, message: GENERIC_FAIL }, 200);
    if (new Date(ch.expires_at).getTime() < Date.now()) return json({ verified: false, message: GENERIC_FAIL }, 200);
    if (Number(ch.attempt_count) >= Number(ch.max_attempts)) return json({ verified: false, message: GENERIC_FAIL }, 200);

    const candidate = await hashOtp(pepper, norm.e164, purpose, code, ch.otp_salt ?? '');
    if (!timingSafeEqual(candidate, String(ch.otp_hash))) {
      await admin.rpc('otp_increment_attempt', { p_id: ch.id });
      return json({ verified: false, message: GENERIC_FAIL }, 200);
    }

    // Correct code → single-use consume.
    await admin.rpc('otp_consume', { p_id: ch.id });

    // If the caller is a signed-in user, persist phone_verified on THEIR profile.
    // No session is minted here — login continues via the existing auth flow.
    let session = false;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const { data: { user } } = await userClient(authHeader).auth.getUser();
      if (user) {
        await admin.rpc('mark_phone_verified', { p_user_id: user.id, p_phone: norm.e164 });
        session = true;
      }
    }
    return json({ verified: true, session, message: 'Phone verified successfully' }, 200);
  } catch {
    return json({ verified: false, message: GENERIC_FAIL }, 200);
  }
});
