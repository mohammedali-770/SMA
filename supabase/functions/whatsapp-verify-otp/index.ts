// whatsapp-verify-otp — signed-in customer phone-ownership verification.
// Gateway verify_jwt=true plus auth.getUser() prove a real user session; the
// requested phone must equal auth.users.phone before a challenge is read/consumed.
// This endpoint never issues a login session. REAL login is Supabase Auth.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { normalizeSaudiPhoneE164, hashOtp, timingSafeEqual } from '../_shared/whatsapp.ts';
import { getOtpPepper } from '../_shared/whatsappSend.ts';

const GENERIC_FAIL = 'Invalid or expired verification code.';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);
  const { data: { user }, error: userError } = await userClient(authHeader).auth.getUser();
  if (userError || !user) return json({ error: 'Unauthorized' }, 401);

  let payload: { phone?: string; code?: string; purpose?: string };
  try { payload = await req.json(); } catch { return json({ verified: false, message: GENERIC_FAIL }, 200); }

  const requested = normalizeSaudiPhoneE164(payload.phone);
  const owned = normalizeSaudiPhoneE164(user.phone ?? null);
  const code = String(payload.code ?? '').trim();
  const purpose = String(payload.purpose ?? 'phone_verification');

  if (purpose !== 'phone_verification'
      || !requested.ok || !owned.ok || requested.e164 !== owned.e164
      || !/^\d{6}$/.test(code)) {
    return json({ verified: false, message: GENERIC_FAIL }, 200);
  }

  const admin = adminClient();
  try {
    const pepper = await getOtpPepper(admin);
    if (!pepper) return json({ verified: false, message: GENERIC_FAIL }, 200);

    const { data: rows } = await admin.rpc('otp_get_active_challenge', {
      p_phone: requested.e164, p_purpose: 'phone_verification', p_channel: 'whatsapp',
    });
    const ch = Array.isArray(rows) ? rows[0] : rows;
    if (!ch) return json({ verified: false, message: GENERIC_FAIL }, 200);
    if (new Date(ch.expires_at).getTime() < Date.now()) return json({ verified: false, message: GENERIC_FAIL }, 200);
    if (Number(ch.attempt_count) >= Number(ch.max_attempts)) return json({ verified: false, message: GENERIC_FAIL }, 200);

    const candidate = await hashOtp(pepper, requested.e164, 'phone_verification', code, ch.otp_salt ?? '');
    if (!timingSafeEqual(candidate, String(ch.otp_hash))) {
      await admin.rpc('otp_increment_attempt', { p_id: ch.id });
      return json({ verified: false, message: GENERIC_FAIL }, 200);
    }

    await admin.rpc('otp_consume', { p_id: ch.id });
    await admin.rpc('mark_phone_verified', { p_user_id: user.id, p_phone: requested.e164 });
    return json({ verified: true, session: true, message: 'Phone verified successfully' }, 200);
  } catch {
    return json({ verified: false, message: GENERIC_FAIL }, 200);
  }
});
