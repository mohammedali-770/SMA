// whatsapp-test-config — ADMIN-only (verify_jwt=true + is_admin check).
//   action 'status'    → boolean config indicators (no secret values ever).
//   action 'test_send' → send a test OTP to a phone (never reveals the code).
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { normalizePhoneE164 } from '../_shared/whatsapp.ts';
import { sendOtpViaWhatsApp, type Language } from '../_shared/whatsappSend.ts';

function has(v: unknown): boolean { return typeof v === 'string' && v.trim().length > 0; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const admin = adminClient();

  // Admin gate: resolve the caller and confirm their profile role is 'admin'.
  const { data: { user } } = await userClient(authHeader).auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!profile || profile.role !== 'admin') return json({ error: 'forbidden' }, 403);

  let payload: { action?: string; phone?: string; language?: string };
  try { payload = await req.json(); } catch { payload = {}; }

  const cfg = await getProviderConfig(admin, 'whatsapp');
  const pub = (cfg?.publicConfig ?? {}) as Record<string, unknown>;
  const sec = (cfg?.secretConfig ?? {}) as Record<string, unknown>;

  if (payload.action === 'test_send') {
    const norm = normalizePhoneE164(payload.phone);
    if (!norm.ok) return json({ ok: false, message: 'Invalid phone number.' }, 200);
    const language: Language = payload.language === 'ar' ? 'ar' : 'en';
    const outcome = await sendOtpViaWhatsApp(admin, norm.e164, 'phone_verification', language);
    if (outcome === 'disabled') return json({ ok: false, status: 'disabled', message: 'WhatsApp OTP is not configured/enabled.' }, 200);
    if (outcome === 'sent') return json({ ok: true, message: 'Test code sent.' }, 200);
    if (outcome === 'rate_limited') return json({ ok: false, message: 'Rate limit reached — try again shortly.' }, 200);
    return json({ ok: false, message: 'Send failed — check credentials/template.' }, 200);
  }

  // Default: status booleans (never any secret values).
  return json({
    status: 'ok',
    enabled: Boolean(cfg?.enabled),
    provider: 'meta_cloud',
    graph_api_version: has(pub.graph_api_version) ? String(pub.graph_api_version) : null,
    phone_number_id_set: has(pub.phone_number_id),
    business_account_id_set: has(pub.business_account_id),
    template_ar_set: has(pub.otp_template_name_ar),
    template_en_set: has(pub.otp_template_name_en),
    access_token_set: has(sec.access_token),
    app_secret_set: has(sec.app_secret),
    webhook_verify_token_set: has(sec.webhook_verify_token),
    pepper_set: Boolean(Deno.env.get('WHATSAPP_OTP_HMAC_SECRET')) || has(sec.otp_hmac_secret),
    // Login (Send SMS Hook) readiness — separate from phone verification.
    login_enabled: pub.whatsapp_login_enabled === true,
    send_sms_hook_secret_set: Boolean(Deno.env.get('SEND_SMS_HOOK_SECRET')) || has(sec.send_sms_hook_secret),
  }, 200);
});
